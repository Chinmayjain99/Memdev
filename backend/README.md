# MemDev backend

The backend foundation is a Node.js 22.9+ / Express 5 / TypeScript API with PostgreSQL as its persistent store. It currently provides process liveness and PostgreSQL readiness checks. Authentication and product APIs are not implemented.

## Local development

From the repository root, run `npm install`, copy `backend/.env.example` to `backend/.env`, and set the local database password. Start with `npm run dev`. The default database settings target `localhost:5432`, database `memdev`, user `postgres`.

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` from the root. `npm run db:migrate` applies pending migrations to the configured `DB_NAME`; this is forward-only and must be run deliberately. `npm start` runs the compiled service. `GET /health` reports process liveness; `GET /health/database` performs a bounded PostgreSQL check and reports readiness without leaking connection details.

Schema integration tests use the database named by `DB_TEST_NAME` (default `memdev_test`) and never use `DB_NAME`. Create that separate database once with `createdb memdev_test`. Tests apply the migration there and rollback representative test writes; they do not reset or delete the test database. See [docs/database-schema.md](../docs/database-schema.md).
