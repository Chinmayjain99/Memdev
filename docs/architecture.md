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
