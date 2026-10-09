# MemDev frontend foundation

React 19, TypeScript, Vite, and React Router provide the initial web application. Portable wire types are in `shared/contracts`; API transport is centralized in `src/services/api/` using browser `fetch`. React pages do not issue raw HTTP calls. Backend implementation and PostgreSQL dependencies are not imported into the frontend.

## Configure and run

From the repository root, install dependencies with `npm install`. Copy `frontend/.env.example` to the ignored `frontend/.env` and set `VITE_API_BASE_URL` to the API origin (the example uses `http://localhost:4000`). The backend's `AUTH_WEB_ORIGIN` must match the frontend origin (default Vite origin: `http://localhost:5173`). Then run `npm run dev:frontend`.

Available frontend checks from the root are `npm run test:frontend`, `npm run typecheck:frontend`, `npm run lint:frontend`, and `npm run build:frontend`. Equivalent scripts are available inside this workspace with `npm run <script> --workspace @memdev/frontend`.

## Authentication and routes

The refresh token stays in the backend's HttpOnly cookie. It is never read by JavaScript or written to localStorage, sessionStorage, or IndexedDB. The short-lived access token stays only in the API client's memory. On startup, AuthProvider refreshes through the cookie, then calls `/auth/me`; simultaneous startup and 401 refresh attempts share one promise. Each original request is retried once, and a refresh failure clears the access token and authenticated state. Cookie requests include credentials and `X-Memdev-Request: 1` where required by backend CSRF checks.

Routes include `/login`, `/register`, `/dashboard`, `/memories/:id`, and `/settings`. Protected routes wait for session bootstrap before rendering and redirect unauthenticated users to sign in. This is a user-interface safeguard; server authorization remains authoritative. Current authenticated page contents are placeholders for future product work.

## API contracts and errors

`shared/contracts` describes authentication, memory, search, pagination, and sync requests/responses using JSON-safe timestamps. Shared Zod schemas validate response shapes and the error envelope at the HTTP boundary; backend validators remain server-owned to avoid duplicating request schemas. The client maps HTTP failures to a typed `ApiError` and avoids exposing transport internals in network errors. `/sync/mutations` 400/409 bodies with per-item results are schema-checked and preserved for partial processing.

## Scope

This is a functional foundation, not a complete dashboard. Persistent browser storage, offline queues, extension integration, semantic search, and deployment are deferred.
