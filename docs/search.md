# MemDev memory search

## Endpoint and filters

`GET /memories/search` requires a verified bearer access token. The owner is always `request.auth.id`; the request cannot supply an owner. Deleted memories are excluded from candidate lists and final result lookup.

Supported query parameters:

| Parameter | Meaning |
| --- | --- |
| `q` | Optional search text, trimmed, up to 200 characters. |
| `page` | One-based page, default 1, maximum 2000. |
| `limit` | Page size, default 20, maximum 50. |
| `domain` | Exact domain match. |
| `tags` | Comma-separated tags; a memory matches when it has any requested tag (up to 10). |
| `topic` | Exact topic match. |
| `capture_type` | `text` or `url`. |
| `created_from`, `created_to` | Inclusive ISO timestamps with timezone, applied to server `created_at`. |
| `language` | Exact language match. |
| `is_code` | `true` or `false`. |

All filters compose and are parameterized. Unknown, repeated-as-array, malformed, or out-of-range parameters return `400 VALIDATION_ERROR`. The API returns memory objects in the same safe camelCase shape as the memory endpoints, without owner IDs, `search_vector`, database scores, or SQL details.

## Search and ranking

The migration-maintained `memories.search_vector` is the only full-text vector. PostgreSQL's `simple` configuration keeps tokenization language-neutral; its established weights prioritize title (A), tags (B), selected text (C), and domain (D). The API uses `websearch_to_tsquery('simple', q)` and `ts_rank_cd` for the FTS list.

The fuzzy list uses `pg_trgm` title similarity operators (`%` and word-similarity `<%`) with both PostgreSQL thresholds set transaction-locally to `0.3`. It orders candidates by word similarity, then ordinary title similarity, then UUID. This supports title misspellings and partial words. Fuzzy matching deliberately uses titles, not every long content field, to constrain work and keep the existing title trigram GIN index useful. Queries shorter than three Unicode characters skip trigram matching, avoiding an index search that has too few trigrams to be selective.

FTS and fuzzy matches are ranked separately. The service combines each 1-based rank using reciprocal rank fusion:

`RRF(memory) = Σ 1 / (60 + source_rank)`

Thus `k=60`; each memory can receive one contribution from the FTS list and one from the fuzzy list. The response does not expose this internal score. Final ties use ascending UUID. Each source contributes at most its top 1,000 candidates, so the ranked union contains at most 2,000 memories. `hasMore` reports additional results within that bounded union; results beyond a source's candidate cap are intentionally not traversable in this phase.

## Empty query and pagination

An omitted `q`, `q=`, or whitespace-only `q` means filter-only listing ordered by `created_at DESC, id ASC`; it does not run FTS or trigram matching. Search results use bounded page-number pagination over the deterministic rank order and return `page`, `limit`, `hasMore`, and `nextPage`. The ranked candidate window is bounded to 1,000 candidates per source. Page membership may shift if memories are inserted or edited between requests; clients needing a stable view should finish pagination promptly. Filter-only pages are also deterministic for a stable dataset.

Search executes its ranked lookup and page fetch in one repeatable-read transaction. Candidate ranking and final fetch both enforce `user_id = request.auth.id` and `is_deleted = false`; a memory from another user cannot enter a source rank list or page.

## Indexes and limits

No migration was required. The implementation uses existing `memories_search_vector_idx` (GIN on `search_vector`), `memories_title_trigram_idx` (GIN with `gin_trgm_ops`, partial on non-null titles), and where useful `memories_user_domain_idx`; the per-user created index supports filter-only chronological ordering. PostgreSQL may combine bitmap index scans for the user/filter and text predicates. Tags, topic, capture type, and language have no dedicated indexes, so selective combinations of those metadata filters may scan the already user-scoped/lexically matched candidates. No index was added without measured need.

Semantic/vector search, embeddings, `pgvector`, offline synchronization, frontend, browser extension, OAuth providers, and deployment are not implemented. Fuzzy matching is lexical title matching rather than semantic similarity.
