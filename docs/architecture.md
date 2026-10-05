# MemDev architecture

## Product boundary

MemDev has three application surfaces: a browser extension for intentional capture, an Express API for authenticated persistence and synchronization, and a React dashboard for search and review. PostgreSQL is the authoritative persistent store. The extension will use IndexedDB as an offline queue and cache.

## Planned request flow

```text
Browser extension -> API -> PostgreSQL
        |               ^
        v               |
     IndexedDB      Web dashboard
```

## Security boundary

The API derives user identity from a verified JWT access token. Client-supplied user IDs are never authorization inputs. Every future memory read or mutation is scoped to that identity. Refresh tokens are HttpOnly cookies; their SHA-256 hashes alone are stored in PostgreSQL. Cookie-authenticated state changes require an exact configured Origin and a custom request header, with credentialed CORS restricted to that origin. Secrets are supplied through local environment configuration and must not enter source control or logs.

## Delivery order

Backend and database foundations come first, followed by authentication, memory operations, search, synchronization, API contracts, the dashboard, and extension integration. The implementation status and actual verification results are recorded in `docs/progress.md`.

## Backend foundation (implemented)

The backend is a TypeScript Express service. `backend/src/app.ts` composes HTTP middleware and routes; `backend/src/server.ts` owns startup and shutdown. Configuration is parsed and validated centrally. PostgreSQL transactions use a checked-out client. Health endpoints provide liveness and readiness; the auth module provides registration, login, refresh, logout, logout-all, and authenticated account lookup. Password authentication and future OAuth identity resolution are intended to share user/session/token services; real OAuth providers and account linking remain deferred.

The database schema is applied by tracked `node-pg-migrate` migrations. See [docs/database-schema.md](database-schema.md) for the current tables, constraints, indexes, cursor protocol, and deferred RLS decision.
