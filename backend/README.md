# MemDev backend

The backend is a Node.js 22.9+ / Express 5 / TypeScript API with PostgreSQL as its persistent store. It provides liveness/readiness, email/password authentication with short-lived JWT access tokens and rotating refresh sessions, authenticated memory CRUD/revisit endpoints, PostgreSQL lexical/fuzzy memory search, and offline sync bootstrap/pull/push endpoints.

## Local development

From the repository root, run `npm install`, copy `backend/.env.example` to `backend/.env`, and set the local database password and a random `AUTH_JWT_SECRET` of at least 32 characters (generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`). Start with `npm run dev`. The default database settings target `localhost:5432`, database `memdev`, user `postgres`.

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` from the root. `npm run db:migrate` applies pending migrations to the configured `DB_NAME`; this is forward-only and must be run deliberately. `npm start` runs the compiled service. `GET /health` reports process liveness; `GET /health/database` performs a bounded PostgreSQL check and reports readiness without leaking connection details.

Schema, authentication, memory, search, and sync integration tests use the database named by `DB_TEST_NAME` (default `memdev_test`) and never use `DB_NAME`. Create that separate database once with `createdb memdev_test`. Tests apply forward migrations there and remove only their uniquely prefixed fixtures; they do not reset or delete the test database. See [docs/database-schema.md](../docs/database-schema.md), [docs/authentication.md](../docs/authentication.md), [docs/api.md](../docs/api.md), [docs/search.md](../docs/search.md), and [docs/offline-sync.md](../docs/offline-sync.md).
