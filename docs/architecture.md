# MemDev architecture

## Product boundary

MemDev has three application surfaces: a browser extension for intentional capture, an Express API for authenticated persistence and synchronization, and a React dashboard for search and review. PostgreSQL is the authoritative persistent store. The extension will use IndexedDB as an offline queue and cache.

## Planned request flow

```text
Browser extension <-> IndexedDB <-> Sync API <-> PostgreSQL
                                      ^              ^
                                      |              |
                                Web dashboard ------+
```

## Web frontend foundation

The React + TypeScript + Vite client lives in `frontend/`; portable wire contracts live in `shared/contracts/`. The frontend depends on the HTTP contract package, never on Express, PostgreSQL, or backend runtime modules. API calls are centralized in `frontend/src/services/api/` around native `fetch`; feature components do not issue raw requests. The client normalizes HTTP errors, validates shared response shapes, includes credentials for the refresh cookie, and holds the short-lived access token only in memory. React Context supplies the small authentication state; React Router guards UX routes while the backend remains the authorization boundary. Request validation remains server-owned and is not duplicated in the frontend.

## Security boundary

The API derives user identity from a verified JWT access token. Client-supplied user IDs are never authorization inputs. Every future memory read or mutation is scoped to that identity. Refresh tokens are HttpOnly cookies; their SHA-256 hashes alone are stored in PostgreSQL. Cookie-authenticated state changes require an exact configured Origin and a custom request header, with credentialed CORS restricted to that origin. Secrets are supplied through local environment configuration and must not enter source control or logs.

## Delivery order

Backend and database foundations come first, followed by authentication, memory operations, search, synchronization, API contracts, the dashboard, and extension integration. The implementation status and actual verification results are recorded in `docs/progress.md`.

## Backend foundation (implemented)

The backend is a TypeScript Express service. `backend/src/app.ts` composes HTTP middleware and routes; `backend/src/server.ts` owns startup and shutdown. Configuration is parsed and validated centrally. PostgreSQL transactions use a checked-out client. Health endpoints provide liveness/readiness; auth routes provide registration, login, refresh, logout, logout-all, and account lookup. Authenticated memory routes provide CRUD, soft deletion, and revisit tracking. Every memory query uses the verified `request.auth.id`. Mutations lock the user row and write a `memory_changes` event in the same transaction to preserve per-user cursor ordering. The sync module provides a locked bootstrap snapshot, bounded user-scoped pull, and idempotent version-aware create/update/delete pushes. The search module scopes full-text and trigram candidate sets by identity, fuses their independent ranks, and returns bounded pages. Semantic/vector search, full dashboard functionality, browser extension, OAuth providers, and deployment remain deferred.

The database schema is applied by tracked `node-pg-migrate` migrations. See [docs/database-schema.md](database-schema.md) for the current tables, constraints, indexes, cursor protocol, and deferred RLS decision. See [docs/api.md](api.md) and [frontend/README.md](../frontend/README.md) for wire contracts and web-client setup.
