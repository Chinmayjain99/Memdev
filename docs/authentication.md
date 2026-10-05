# MemDev authentication

## Implemented now

- `POST /auth/register` normalizes email addresses, validates a 12-character minimum password (without composition rules), hashes it with bcrypt, then creates the user and initial session in one PostgreSQL transaction.
- `POST /auth/login` verifies bcrypt hashes and returns the same generic 401 response for an unknown email and a wrong password. Emails without password credentials cannot log in with a password.
- `POST /auth/refresh` rotates the refresh token. Refresh values are random 256-bit tokens; only SHA-256 digests are stored. The previous session is revoked and linked to its replacement in the same transaction.
- `POST /auth/logout` revokes the presented refresh session and clears the cookie. `POST /auth/logout-all` revokes all active sessions for the verified JWT subject only.
- `GET /auth/me` returns only public account fields. Access tokens use HS256 through `jose`, contain UUID `sub` and `token_use=access`, and expire after 10 minutes by default. Signature, algorithm, expiry, issuer, audience, token use, and UUID subject are checked.
- Middleware attaches the trusted UUID as `request.auth.id`; client-supplied IDs are not used as identity.

## Refresh sessions and replay defense

Refresh requests lock the matching session row using `SELECT ... FOR UPDATE`. One concurrent request can rotate it; a waiting request sees the revoked row. Reuse of a rotated token revokes all still-active sessions in that family. Refresh expiry defaults to 30 days. Logout-all is a user-scoped update.

## Cookies and CSRF

The refresh token is never returned in JSON. It is set as `HttpOnly`, `SameSite=Lax`, path `/auth`, and with a 30-day default max age. `Secure` is enabled in production and disabled for local HTTP development. The frontend origin is configured exactly in `AUTH_WEB_ORIGIN`. Credentialed CORS allows only that origin, and cookie-authenticated state-changing routes additionally require that exact `Origin` plus `X-Memdev-Request: 1`. The custom header requires browser preflight and rejects cross-origin form submissions; `SameSite=Lax` adds a further restriction. Production requires an HTTPS frontend origin. The frontend must send credentials and the custom header.

## Configuration

Set `AUTH_JWT_SECRET` to a randomly generated value with at least 32 characters; it has no code default. Never commit it. `AUTH_JWT_ISSUER` and `AUTH_JWT_AUDIENCE` default to `memdev-api` and `memdev-client`. `AUTH_ACCESS_TTL_SECONDS` defaults to 600 (allowed 60–3600); `AUTH_REFRESH_TTL_DAYS` defaults to 30 (allowed 1–365); `AUTH_BCRYPT_ROUNDS` defaults to 12 (allowed 10–14); `AUTH_WEB_ORIGIN` defaults to `http://localhost:5173`. `backend/.env.example` contains placeholders only.

Rate limits apply to signup/login/refresh. The in-memory limiter is per process; deployments with multiple instances should configure a shared rate-limit store.

## OAuth and future account linking

**Architecture ready / implementation deferred.** The existing `oauth_accounts` relation remains the place for provider identities. A future provider adapter must resolve a verified provider subject to a user, then call `createSessionForUser` in the auth service to share the session/token path used by password authentication. Do not auto-link based only on an email supplied by a client; linking must require provider-verified identity and explicit proof/control of both accounts. No provider credentials or real OAuth integration are included.

## Deferred

- Password reset/recovery is not implemented.
- Google/GitHub or other provider integrations and account-linking flows are not implemented.
- Product APIs (memory/search/sync) are not implemented; they must scope every query using `request.auth.id`.
- No development/test authentication bypass exists. Automated tests use an ephemeral test signing key and isolated `DB_TEST_NAME`.

## Migration and test safety

Migration 003 adds nullable `users.password_hash`, refresh `family_id`, and replacement linkage. It is additive and has a reversible down migration. Integration tests assert `DB_TEST_NAME` differs from `DB_NAME`, run migrations only there, and clean only their generated auth fixture email prefix. Never point `DB_TEST_NAME` at the application database.
