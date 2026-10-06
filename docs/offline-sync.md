# Offline synchronization protocol

PostgreSQL remains the authoritative persistent store. The future extension may keep a local IndexedDB snapshot and pending mutation queue; this backend phase does not implement IndexedDB, UI, or extension jobs. All three `/sync` endpoints require the normal bearer access token. Ownership always comes from the verified token subject.

## Bootstrap

`GET /sync/bootstrap?limit=100` returns `{ memories, tombstones, cursor, hasMore, nextPageToken }`. `limit` defaults to 100 and is bounded to 1–500. Active memory representations appear in `memories`; soft-deleted rows appear as `{ id, version, deletedAt }` in `tombstones`. The first page starts a transaction, locks the authenticated user's row with the same `FOR UPDATE` lock used by every memory write, reads one bounded page, then reads the greatest committed change cursor for that user before releasing the lock. Continue with `GET /sync/bootstrap?limit=100&pageToken=...` until `nextPageToken` is null. Each token carries the fixed boundary and keyset position; the same limit must be used for each page.

Every memory mutation holds that user lock until both its row and `memory_changes` event commit. Therefore a write committed before bootstrap acquires the lock is covered by the snapshot and cursor boundary. A write that waits behind bootstrap receives a cursor after the boundary and is returned by a subsequent pull. Continuation pages use a stable keyset over immutable `created_at,id`; rows are not physically removed or pruned in this phase. A mutation after the boundary may be reflected in a later page or may fall behind an already-passed keyset position, but either way its change event is after the fixed boundary and will be pulled. Pages can therefore contain newer state than the boundary; clients reconcile by memory version and tolerate the corresponding repeated change. Apply every snapshot page before saving the boundary and pulling changes after it. Timestamps are only keyset positions here, never synchronization cursors.

## Pull changes

`GET /sync/changes?cursor=<decimal>&limit=100` requires `cursor`; use `0` for the first pull only when a client deliberately chooses change replay instead of bootstrap. `limit` defaults to 100 and is bounded to 1–500. The response is `{ changes, nextCursor, hasMore }`. Each change contains `cursor`, `memoryId`, `operation`, resulting event `version`, `serverCreatedAt`, and a current memory representation or tombstone. Historical events do not store memory snapshots, so the representation reflects the memory's current state when read and may have a version newer than the event. Clients should reconcile using the memory version as well as event ordering.

Reads filter by both the authenticated user and `sequence_id > cursor`, ordered by sequence ascending. The identity sequence is global, so gaps are normal. If rows are returned, `nextCursor` equals the last included row; with no rows it remains the request cursor. `hasMore` signals that another page is available. Repeating a cursor is safe; the server has no delivery state and does not invalidate cursors.

Clients must apply all returned changes locally before persisting `nextCursor`. If local application fails or the client crashes, request again from the prior applied cursor. Revisit operations appear as `update` events because they increment the memory version, but revisit counts are not pushable offline mutations.

## Push mutations

`POST /sync/mutations` accepts `{ "mutations": [...] }`, with 1–25 strict-schema mutations. Express caps the complete JSON request at 100 KiB; the existing memory schemas bound individual fields. Every mutation has a client-generated UUID `mutationId` independent of `memoryId`.

- Create: `{ mutationId, operation: "create", memoryId, memory }`. The server preserves an unused client UUID.
- Update: `{ mutationId, operation: "update", memoryId, baseVersion, patch }`.
- Delete: `{ mutationId, operation: "delete", memoryId, baseVersion }`.

Unknown fields, including user IDs and server-owned values, are rejected. Each item runs in its own transaction and returns an `applied`, `conflict`, `not_found`, or state-dependent `invalid` result. A batch containing a conflict returns HTTP 409 with all item results, including later items. A state-dependent invalid item returns HTTP 400 with the complete result list; other items still run. Earlier results remain committed if a later item fails unexpectedly; retry the batch safely with the same mutation IDs. One mutation's memory update, `memory_changes` event, and idempotency record are always atomic.

Mutations run sequentially in array order, and the response includes a result for every item. A later item may use the version created by an earlier item in that batch. After a partial result, clients can remove `applied` IDs from their queue, reconcile `conflict` and `invalid` items, and retry transient failures. Retrying an applied ID remains safe and returns its recorded outcome.

`sync_mutations` stores `(user_id, mutation_id)`, a SHA-256 fingerprint of the validated canonical request, operation, safe result/version information, and event cursor. An exact retry returns the saved outcome with `replayed: true`, without adding a second event or incrementing the version. Reusing a key for a different payload returns `IDEMPOTENCY_KEY_REUSED`. Keys are isolated across users. Memory content is not copied into this table.

Updates and deletes require `baseVersion` to match the current version. A stale version returns a conflict containing the caller-owned current state and both base/current versions. Clients must reconcile and submit a new mutation ID after refreshing. Missing or foreign-owned memory IDs do not disclose whether another user owns the UUID. A create UUID collision with another owner returns a generic conflict without memory state.

## Limits and boundaries

Pull and bootstrap page limit: 500 maximum. Mutation batch: 25 maximum. JSON body: 100 KiB maximum. Memory field lengths follow the existing Zod schemas. Bootstrap pages are stateless and can reflect concurrent post-boundary state; clients must finish paging before persisting the boundary, then pull and version-reconcile changes after it. No delivery acknowledgments, cursor expiry, history pruning, tombstone cleanup, or automatic data deletion are implemented. Revisit is intentionally excluded from the offline mutation types because client counters cannot be safely merged under retries and concurrent devices.
