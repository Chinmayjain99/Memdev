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

The API derives user identity from verified authentication. Client-supplied user IDs are never authorization inputs. Every memory read or mutation is scoped to that identity. Secrets are supplied through local environment configuration and must not enter source control or logs.

## Delivery order

Backend and database foundations come first, followed by authentication, memory operations, search, synchronization, API contracts, the dashboard, and extension integration. The implementation status and actual verification results are recorded in `docs/progress.md`.

## Backend foundation (implemented)

The backend is a TypeScript Express service. `backend/src/app.ts` composes the HTTP middleware and routes; `backend/src/server.ts` owns process startup and graceful shutdown. Configuration is parsed and validated centrally. PostgreSQL access uses the `pg` connection pool through a small database module; transactions use one checked-out client and always release it. The initial routes provide liveness (`GET /health`) and database readiness (`GET /health/database`). No authentication or product data APIs are implemented in this phase.

The database schema is applied by tracked `node-pg-migrate` migrations. See [docs/database-schema.md](database-schema.md) for the current tables, constraints, indexes, cursor protocol, and deferred RLS decision.
