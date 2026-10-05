# MemDev API

All memory endpoints require `Authorization: Bearer <access-token>`. The identity is taken from the verified token subject (`request.auth.id`); request bodies and query parameters cannot select an owner. Memory request schemas reject unknown fields, including `user_id` and server-managed fields.

Successful memory responses use `{ "memory": { ... } }`, except `GET /memories`, which returns `{ "memories": [...], "hasMore": boolean, "nextCursor": string | null }`. Memory objects use camelCase and include `id`, `captureType`, editable/content metadata, `createdAt`, `updatedAt`, `clientCreatedAt`, revisit metadata, and `version`. They omit `user_id`, deletion internals, and `search_vector`.

## Endpoints

| Method and path | Behavior |
| --- | --- |
| `POST /memories` | Create a text or URL capture; returns `201`, the memory, and its version `ETag`. |
| `GET /memories?limit=20&cursor=...` | List only the caller’s active memories. `limit` is 1–100. |
| `GET /memories/:id` | Return one active memory owned by the caller, with `ETag`. |
| `PATCH /memories/:id` | Update allowed metadata using the current version in `If-Match`; return new `ETag`. |
| `DELETE /memories/:id` | Soft-delete an owned memory; returns `204`. Repeated deletion remains `204`. |
| `POST /memories/:id/revisit` | Atomically increment server-managed revisit metrics and return the updated memory/version. |

For text captures, `captureType: "text"` requires nonblank `selectedText`. URL captures use `captureType: "url"` and an absolute HTTP(S) `sourceUrl`. Both support title, manual note, tags, topic, language, code metadata, page title/domain, and an optional client timestamp where appropriate. The client cannot set IDs, ownership, server timestamps, `version`, revisit counters, deletion state, or search internals.

## Pagination and ordering

Listing uses keyset pagination over `created_at DESC, id ASC`, matching the existing per-user created index. `nextCursor` is opaque and carries the full database timestamp precision so adjacent pages do not skip entries with sub-millisecond timestamps. The cursor only identifies a position; every query remains scoped by authenticated user ID. Deleted memories do not appear in list or detail.

## Update concurrency

Create/detail/update/revisit responses include a quoted numeric `ETag`, such as `"3"`. `PATCH` requires that value in `If-Match`. A missing header returns `428 PRECONDITION_REQUIRED`; a stale version returns `409 VERSION_CONFLICT`. The server increments `version`; clients never choose it. Setting `isCode` to false without a `codeLanguage` value clears the existing language to satisfy the schema constraint.

## Ownership, transactions, and change events

Each repository query filters by both memory ID and the verified user ID. Another user’s or a deleted memory’s ID returns the same `404 MEMORY_NOT_FOUND` response as an unavailable memory.

Create, update, revisit, and soft-delete run in `withTransaction`. Each transaction locks the owner row before changing a memory and allocating a `memory_changes.sequence_id`; the memory and event commit or roll back together. Event operations are `create`, `update` (including revisit metric changes), and `delete`, with the resulting memory version. The sequence remains a future sync cursor; no sync endpoint is implemented here.

## Errors

Errors use `{ "error": { "code": string, "message": string } }`. Invalid fields, malformed UUIDs, invalid cursors, and invalid capture data return `400 VALIDATION_ERROR`; missing/invalid access tokens return `401`; unavailable memories return `404`; stale versions return `409`; and missing `If-Match` returns `428`. Unexpected errors use the centralized generic `500` response without SQL details.

## Deferred phases

Search, offline synchronization endpoints, frontend, browser extension, OAuth providers, and deployment are out of scope. The database trigger continues maintaining `search_vector`, but the API does not expose it or execute search queries.
