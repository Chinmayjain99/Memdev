# MemDev backend

The backend foundation is a Node.js 22.9+ / Express 5 / TypeScript API with PostgreSQL as its persistent store. It currently provides process liveness and PostgreSQL readiness checks. Authentication and product APIs are not implemented.

## Local development

From the repository root, run `npm install`, copy `backend/.env.example` to `backend/.env`, and set the local database password. Start with `npm run dev`. The default database settings target `localhost:5432`, database `memdev`, user `postgres`.

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` from the root. `npm start` runs the compiled service. `GET /health` reports process liveness; `GET /health/database` performs a bounded PostgreSQL check and reports readiness without leaking connection details.

Tests do not mutate or reset a database. The PostgreSQL integration test uses only `SELECT 1`; configure a separate test database via the DB_* environment variables if preferred.
