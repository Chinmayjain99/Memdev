import type { PoolClient } from 'pg';
import { memoryColumns } from '../memories/memory.repository.js';
import type { Memory } from '../memories/memory.types.js';
import type { RankedSearchCandidate, SearchSource } from './search.types.js';
import type { SearchQuery } from './search.validators.js';

type SearchFilters = Omit<SearchQuery, 'q' | 'page' | 'limit'>;

function filteredMemories(userId: string, filters: SearchFilters): { cte: string; values: unknown[] } {
  const values: unknown[] = [userId];
  const conditions = ['m.user_id = $1', 'm.is_deleted = false'];
  const add = (condition: (parameter: string) => string, value: unknown): void => {
    values.push(value);
    conditions.push(condition(`$${values.length}`));
  };

  if (filters.domain !== undefined) add((p) => `m.domain = ${p}`, filters.domain);
  if (filters.tags !== undefined) add((p) => `m.tags && ${p}::text[]`, filters.tags);
  if (filters.topic !== undefined) add((p) => `m.topic = ${p}`, filters.topic);
  if (filters.capture_type !== undefined) add((p) => `m.capture_type = ${p}`, filters.capture_type);
  if (filters.created_from !== undefined) add((p) => `m.created_at >= ${p}::timestamptz`, filters.created_from);
  if (filters.created_to !== undefined) add((p) => `m.created_at <= ${p}::timestamptz`, filters.created_to);
  if (filters.language !== undefined) add((p) => `m.language = ${p}`, filters.language);
  if (filters.is_code !== undefined) add((p) => `m.is_code = ${p}`, filters.is_code);

  return {
    cte: `filtered AS NOT MATERIALIZED (SELECT m.* FROM memories m WHERE ${conditions.join(' AND ')})`,
    values,
  };
}

export async function listFilteredMemories(
  client: PoolClient,
  userId: string,
  filters: SearchFilters,
  limit: number,
  offset: number,
): Promise<Memory[]> {
  const built = filteredMemories(userId, filters);
  built.values.push(limit, offset);
  const limitParameter = built.values.length - 1;
  const offsetParameter = built.values.length;
  const result = await client.query<Memory>(
    `WITH ${built.cte}
     SELECT ${memoryColumns} FROM filtered
     ORDER BY created_at DESC, id ASC
     LIMIT $${limitParameter} OFFSET $${offsetParameter}`,
    built.values,
  );
  return result.rows;
}

export async function rankSearchCandidates(
  client: PoolClient,
  userId: string,
  filters: SearchFilters,
  searchText: string,
  includeFuzzy: boolean,
): Promise<RankedSearchCandidate[]> {
  const built = filteredMemories(userId, filters);
  built.values.push(searchText);
  const searchParameter = `$${built.values.length}`;
  const fuzzyCte = includeFuzzy ? `,
     fuzzy_ranked AS (
       SELECT m.id AS memory_id,
              row_number() OVER (
                ORDER BY word_similarity(s.term, m.title) DESC,
                         similarity(m.title, s.term) DESC, m.id ASC
              )::integer AS rank
       FROM filtered m CROSS JOIN search_input s
       WHERE m.title IS NOT NULL
         AND (s.term <% m.title OR m.title % s.term)
       ORDER BY word_similarity(s.term, m.title) DESC,
                similarity(m.title, s.term) DESC, m.id ASC
       LIMIT 1000
     )` : '';
  const rankedSources = includeFuzzy
    ? `SELECT memory_id AS "memoryId", 'fts'::text AS source, rank FROM fts_ranked
       UNION ALL
       SELECT memory_id AS "memoryId", 'fuzzy'::text AS source, rank FROM fuzzy_ranked`
    : `SELECT memory_id AS "memoryId", 'fts'::text AS source, rank FROM fts_ranked`;
  const result = await client.query<{ memoryId: string; source: SearchSource; rank: number }>(
    `WITH ${built.cte},
     search_input AS (
       SELECT ${searchParameter}::text AS term,
              websearch_to_tsquery('simple', ${searchParameter}) AS tsquery
     ),
     fts_ranked AS (
       SELECT m.id AS memory_id,
              row_number() OVER (
                ORDER BY ts_rank_cd(m.search_vector, s.tsquery, 32) DESC, m.id ASC
              )::integer AS rank
       FROM filtered m CROSS JOIN search_input s
       WHERE m.search_vector @@ s.tsquery
       ORDER BY ts_rank_cd(m.search_vector, s.tsquery, 32) DESC, m.id ASC
       LIMIT 1000
     )${fuzzyCte}
     ${rankedSources}`,
    built.values,
  );
  return result.rows;
}

export async function findMemoriesByIds(client: PoolClient, userId: string, ids: string[]): Promise<Memory[]> {
  if (ids.length === 0) return [];
  const result = await client.query<Memory>(
    `SELECT ${memoryColumns} FROM memories
     WHERE user_id = $1 AND is_deleted = false AND id = ANY($2::uuid[])`,
    [userId, ids],
  );
  return result.rows;
}
