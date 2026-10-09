# MemDev database schema

PostgreSQL is the authoritative persistent store. The initial schema is installed by the ordered TypeScript migration in `backend/src/database/migrations/001_initial_schema.ts`; `node-pg-migrate` records completed versions in `schema_migrations` and runs each migration under an advisory lock and transaction.

Run `npm run db:migrate` from the repository root to apply pending migrations to the configured `DB_NAME`. This command only moves the schema forward. It does not reset data. Tests use the separate database named by `DB_TEST_NAME` (default `memdev_test`); create it once with `createdb memdev_test` before running `npm test`. Tests wrap sample writes in rollback transactions. They never create fixtures in the normal `memdev` database.

The schema requires PostgreSQL 13 or newer. `pg_trgm` must be available to the PostgreSQL server and is installed by the migration with `CREATE EXTENSION IF NOT EXISTS`. UUID generation and full-text search use PostgreSQL built-ins. `pgvector` is not used.

## Tables

| Table | Purpose and important columns |
| --- | --- |
| `users` | UUID identity, optional email and display name, nullable bcrypt `password_hash`, and server-managed creation/update timestamps. Email is unique case-insensitively when present. |
| `oauth_accounts` | Provider account link to a user. A `(provider, provider_account_id)` unique constraint prevents the same external account from being assigned to multiple users. No provider tokens or credentials are stored here. |
| `refresh_sessions` | User-owned session metadata with unique 32-byte `token_hash`, family and replacement linkage, expiry, and optional revocation time. Raw refresh tokens are not stored. |
| `memories` | User-owned captures, content/source metadata, tags, topic/language, code flags, soft deletion, client/server timestamps, revisit metrics, version, and trigger-maintained search vector. |
| `memory_changes` | Durable create/update/delete events with an identity `sequence_id`, user and memory ownership, version, and server timestamp. |
| `sync_mutations` | User-scoped idempotency records that atomically retain each pushed mutation’s request hash and applied/conflict/not-found outcome. |

All user references cascade when a user is deleted. Memories have a unique `(user_id, id)` key in addition to the UUID primary key so `memory_changes` can enforce a composite foreign key to the same owner. Deleting a memory physically cascades its change rows; normal deletion is represented by a tombstone on the memory and a `delete` event, so sync history remains available while the tombstone exists.

`users`, `oauth_accounts`, and `memories` have `created_at` / `updated_at`. A shared trigger sets `updated_at` on updates. Checks enforce nonblank supplied email/name, supported capture and change operation values, valid capture content, sensible timestamps, matching soft-delete state, positive versions, and nonnegative revisit counts. URL capture validation requires an HTTP or HTTPS prefix; application validation will perform stricter URL parsing.

Refresh token hashes are `bytea` values constrained to 32 bytes (for a SHA-256 digest of a high-entropy random token). Session indexes support user history, active-session lookup, and global expiration cleanup. Memory indexes support per-user created/updated lists, active-memory lists, domain filters, full-text search, and fuzzy title matching. Change indexes support per-user cursor reads and memory history. The email lower-case unique index supports case-insensitive lookup.

## Important indexes

| Index / constraint | Access pattern or invariant |
| --- | --- |
| `users_email_lower_unique_idx` | Case-insensitive email lookup and uniqueness when email is present. |
| `oauth_accounts_provider_account_unique` | Prevents one provider account from linking to multiple users. |
| `oauth_accounts_user_id_idx` | Lists provider accounts for a user. |
| `refresh_sessions_token_hash_key` | Enforces unique stored token hashes and supports hash lookup. |
| `refresh_sessions_user_created_idx` | Lists a user’s sessions in creation order. |
| `refresh_sessions_active_expiry_idx` | Finds active sessions for a user by expiry. |
| `refresh_sessions_expires_at_idx` | Supports global expired-session cleanup. |
| `memories_owner_identity_unique` | Supports the same-owner composite foreign key from changes to memories. |
| `memories_user_created_idx`, `memories_user_updated_idx` | Per-user chronological and recently changed lists. |
| `memories_active_user_updated_idx` | Per-user active-memory list, excluding tombstones. |
| `memories_user_domain_idx` | Per-user domain filtering. |
| `memories_search_vector_idx` | GIN index for weighted full-text matching. |
| `memories_title_trigram_idx` | GIN trigram index for fuzzy title matching. |
| `memory_changes_pkey` | Globally unique identity cursor. |
| `memory_changes_user_cursor_idx` | Reads one user’s changes after a cursor. |
| `memory_changes_memory_id_idx` | Looks up the change history for one memory. |
| `sync_mutations_pkey` | Unique mutation ID within an authenticated user’s namespace and fast retry lookup. |

The schema also defines user, capture, version, revisit, deletion-state, and timestamp checks listed above. Foreign keys connect OAuth accounts, sessions, memories, and change events to their owning user; the composite change-to-memory foreign key enforces matching ownership.

## User isolation

Every memory requires a `user_id` foreign key. Change rows require both a user and memory, with a composite foreign key ensuring the event owner is the memory owner. Future API code must derive user identity from verified server-side authentication and scope every query by that identity; client-supplied user IDs are never authorization inputs.

Row Level Security is deferred. The current connection pool does not establish a transaction-scoped authenticated user identity. Enabling policies without a reliable `SET LOCAL` identity on every transaction would provide false assurance.

## Atomic writes and change cursor

Memory create, update, revisit, and soft-delete use one `withTransaction` call with their `memory_changes` insert. Both writes commit together; if either fails, the transaction helper rolls the whole operation back. Before changing a user’s memory and allocating its event, the transaction locks that user row (`SELECT id FROM users WHERE id = $1 FOR UPDATE`) and holds it until commit. This preserves per-user sequence ordering.

`sequence_id` is a database-generated, globally increasing identity. Gaps are expected. Sync reads use `WHERE user_id = $1 AND sequence_id > $2 ORDER BY sequence_id`. The per-user row lock serializes mutations before identity allocation, ensuring a later committed event for that user receives a later cursor even when writes run concurrently. Cursor values are opaque; clients should persist the last returned sequence and must not infer that global gaps are missing events for their user.

## Search preparation

`memories.search_vector` is a stored, trigger-maintained `tsvector` using PostgreSQL’s `simple` text configuration for language-neutral tokenization. It combines title at weight A, tags at B, selected text at C, and domain at D. `memories_search_vector_idx` supports full-text candidate lookup; `memories_title_trigram_idx` supports fuzzy title lookup using `pg_trgm` similarity operators. The search API scopes both candidate queries to the authenticated user and active rows before ranking. It uses FTS plus title similarity/word similarity and RRF; it does not change this trigger, add an index, or store a second vector. Semantic/vector search remains deferred.

Migration 004 adds `sync_mutations`; its `(user_id, mutation_id)` primary key scopes idempotency keys per user. Applied outcomes reference their event cursor and same-owner memory; conflicts that might refer to another user’s UUID store no memory ID. It duplicates no memory content. The migration is forward-only in the application scripts. Although the migration library can run down migrations explicitly, no down/reset npm script is provided. The down operation intentionally leaves `pg_trgm` installed because the extension may be shared by other database objects.

See [offline sync protocol](offline-sync.md) for the bootstrap lock, pull semantics, and client cursor behavior.
