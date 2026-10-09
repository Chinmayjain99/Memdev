# MemDev API

The portable TypeScript contracts consumed by the web client live in [`shared/contracts/src/index.ts`](../shared/contracts/src/index.ts). They describe JSON wire values (timestamps are ISO strings), request/response shapes, pagination, search filters, sync outcomes, and the error envelope. Small shared Zod schemas validate common successful response shapes and the error envelope at the HTTP boundary. The shared package has no backend runtime imports; existing backend validators remain the source of server-side request validation.

## Authentication

Cookie-authenticated auth actions include `X-Memdev-Request: 1`. The browser also sends its `Origin`; the server validates both and its credentialed CORS policy allows only configured `AUTH_WEB_ORIGIN`. The frontend uses `credentials: "include"`. The refresh token is issued only as the `HttpOnly`, `SameSite=Lax` `memdev_refresh` cookie scoped to `/auth`; it is never included in JSON or readable by browser JavaScript.

| Method and path | Behavior |
| --- | --- |
| `POST /auth/register` | Validates email and password (minimum 12 characters, maximum 72 UTF-8 bytes); returns `201 { user, accessToken, expiresIn }` and sets the refresh cookie. |
| `POST /auth/login` | Returns `{ user, accessToken, expiresIn }` and sets/rotates the refresh cookie. |
| `POST /auth/refresh` | Uses the refresh cookie and returns a new `{ user, accessToken, expiresIn }`; invalid refresh clears the cookie. |
| `POST /auth/logout` | Revokes the current refresh session when present, clears cookie, and returns `204`. |
| `POST /auth/logout-all` | Requires a bearer access token, revokes all sessions, clears cookie, and returns `204`. |
| `GET /auth/me` | Requires a bearer token; returns `{ user }`. |

The client keeps only the short-lived access token in JavaScript memory. On application startup it attempts refresh and then loads `/auth/me`. If an authenticated API call receives `401`, the client shares one in-flight refresh among callers and retries each original call at most once. Failed refresh clears client authentication state. No browser persistent storage is used for credentials.

## CORS and request credentials

`backend/src/app.ts` enables credentialed CORS only for configured `AUTH_WEB_ORIGIN`, allows `Content-Type`, `Authorization`, `If-Match`, and `X-Memdev-Request`, and does not allow wildcard origins with credentials. Set the local frontend origin to backend `AUTH_WEB_ORIGIN` (default `http://localhost:5173`). Set `VITE_API_BASE_URL` to the backend origin in the local frontend environment.

## HTTP errors

Errors use `{ "error": { "code": string, "message": string } }`. The frontend maps status `401` to unauthenticated, `403` to forbidden, `400`/`422` to validation, `428` to a missing precondition, `404` to not found, `409` to conflict, `429` to rate limited, and `5xx` to server errors. The server emits generic unexpected-error messages and does not return SQL details. `/sync/mutations` is intentionally special: HTTP `400`/`409` may carry `{ results }` with per-mutation `invalid`/`conflict` outcomes; clients must preserve and process that body instead of discarding it as a request-wide exception.

All memory endpoints require `Authorization: Bearer <access-token>`. The identity is taken from the verified token subject (`request.auth.id`); request bodies and query parameters cannot select an owner. Memory request schemas reject unknown fields, including `user_id` and server-managed fields.

Successful memory responses use `{ "memory": { ... } }`, except `GET /memories`, which returns `{ "memories": [...], "hasMore": boolean, "nextCursor": string | null }`. Memory objects use camelCase and include `id`, `captureType`, editable/content metadata, `createdAt`, `updatedAt`, `clientCreatedAt`, revisit metadata, and `version`. They omit `user_id`, deletion internals, and `search_vector`.

## Endpoints

| Method and path | Behavior |
| --- | --- |
| `POST /memories` | Create a text or URL capture; returns `201`, the memory, and its version `ETag`. |
| `GET /memories?limit=20&cursor=...` | List only the caller’s active memories. `limit` is 1–100. |
| `GET /memories/search` | Search or filter the caller’s active memories with PostgreSQL full-text search and title fuzzy matching. |
| `GET /memories/:id` | Return one active memory owned by the caller, with `ETag`. |
| `PATCH /memories/:id` | Update allowed metadata using the current version in `If-Match`; return new `ETag`. |
| `DELETE /memories/:id` | Soft-delete an owned memory; returns `204`. Repeated deletion remains `204`. |
| `POST /memories/:id/revisit` | Atomically increment server-managed revisit metrics and return the updated memory/version. |
| `GET /sync/bootstrap?limit=100&pageToken=...` | Return one authenticated snapshot page and its fixed change boundary. |
| `GET /sync/changes?cursor=0&limit=100` | Pull this caller’s changes after the cursor (limit 1–500, default 100). |
| `POST /sync/mutations` | Apply up to 25 authenticated, idempotent create/update/delete mutations. |

For text captures, `captureType: "text"` requires nonblank `selectedText`. URL captures use `captureType: "url"` and an absolute HTTP(S) `sourceUrl`. Both support title, manual note, tags, topic, language, code metadata, page title/domain, and an optional client timestamp where appropriate. The client cannot set IDs, ownership, server timestamps, `version`, revisit counters, deletion state, or search internals.

## Pagination and ordering

Listing uses keyset pagination over `created_at DESC, id ASC`, matching the existing per-user created index. `nextCursor` is opaque and carries the full database timestamp precision so adjacent pages do not skip entries with sub-millisecond timestamps. The cursor only identifies a position; every query remains scoped by authenticated user ID. Deleted memories do not appear in list or detail.

## Update concurrency

Create/detail/update/revisit responses include a quoted numeric `ETag`, such as `"3"`. `PATCH` requires that value in `If-Match`. A missing header returns `428 PRECONDITION_REQUIRED`; a stale version returns `409 VERSION_CONFLICT`. The server increments `version`; clients never choose it. Setting `isCode` to false without a `codeLanguage` value clears the existing language to satisfy the schema constraint.

## Search

`GET /memories/search` accepts optional `q` (up to 200 characters), `page` (1–2000), and `limit` (1–50), plus `domain`, comma-separated `tags` (up to 10), `topic`, `capture_type`, `created_from`, `created_to`, `language`, and `is_code`. Dates are ISO timestamps with an explicit timezone. All supplied filters are combined; a tag filter matches memories containing any requested tag. Unsupported or malformed parameters return `400`.

The response is `{ "memories": [...], "page": number, "limit": number, "hasMore": boolean, "nextPage": number | null }`. An omitted or blank `q` performs a filtered listing ordered by `created_at DESC, id ASC`; it does not invoke full-text or trigram matching. Non-empty `q` searches the trigger-maintained weighted `search_vector` and fuzzy-matches titles. PostgreSQL ranks each source independently; the API combines them with reciprocal rank fusion using `k=60`. Results tie-break by UUID. Raw scores are not exposed.

Both ranked candidate lists and every final row are scoped by the verified token user ID and exclude soft-deleted memories. Pages are deterministic page-number pages over a bounded union of at most 1,000 full-text and 1,000 fuzzy candidates; `hasMore` applies within that candidate window. Inserts or updates between separate requests can change page membership. See [search behavior and limitations](search.md).

## Ownership, transactions, and change events

Each repository query filters by both memory ID and the verified user ID. Another user’s or a deleted memory’s ID returns the same `404 MEMORY_NOT_FOUND` response as an unavailable memory.

Create, update, revisit, and soft-delete run in `withTransaction`. Each transaction locks the owner row before changing a memory and allocating a `memory_changes.sequence_id`; the memory and event commit or roll back together. Sync mutation transactions also commit their user-scoped idempotency result atomically with the memory and event. See [offline sync](offline-sync.md) for cursor, bootstrap, and retry semantics. Revisit events remain pull-visible but revisit is not an offline mutation.

## Errors

Errors use `{ "error": { "code": string, "message": string } }`. Invalid fields, malformed UUIDs, invalid cursors, and invalid capture data return `400 VALIDATION_ERROR`; missing/invalid access tokens return `401`; unavailable memories return `404`; stale versions return `409`; and missing `If-Match` returns `428`. Unexpected errors use the centralized generic `500` response without SQL details.

## Deferred phases

Semantic/vector search, full dashboard functionality, browser extension, OAuth providers, and deployment remain deferred. The API uses the existing database-managed `search_vector` for lexical search and never exposes it.
