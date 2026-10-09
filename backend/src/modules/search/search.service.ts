import type { Pool } from 'pg';
import { withTransaction } from '../../database/transaction.js';
import type { Memory } from '../memories/memory.types.js';
import * as repository from './search.repository.js';
import type { FusedSearchCandidate, RankedSearchCandidate, SearchPage } from './search.types.js';
import type { SearchQuery } from './search.validators.js';

export const RRF_K = 60;

export function fuseRankedCandidates(candidates: RankedSearchCandidate[], k = RRF_K): FusedSearchCandidate[] {
  const fused = new Map<string, number>();
  for (const candidate of candidates) {
    fused.set(candidate.memoryId, (fused.get(candidate.memoryId) ?? 0) + 1 / (k + candidate.rank));
  }
  return [...fused].map(([memoryId, score]) => ({ memoryId, score }))
    .sort((a, b) => b.score - a.score || compareIds(a.memoryId, b.memoryId));
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function createSearchService(pool: Pool) {
  return {
    search(userId: string, query: SearchQuery): Promise<SearchPage> {
      return withTransaction(pool, async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await client.query("SET LOCAL pg_trgm.similarity_threshold = '0.3'");
        await client.query("SET LOCAL pg_trgm.word_similarity_threshold = '0.3'");
        const offset = (query.page - 1) * query.limit;
        let memories: Memory[];
        let candidateCount = 0;

        if (!query.q) {
          memories = await repository.listFilteredMemories(client, userId, query, query.limit + 1, offset);
        } else {
          const ranked = repository.rankSearchCandidates(client, userId, query, query.q, [...query.q].length >= 3);
          const candidates = fuseRankedCandidates(await ranked);
          candidateCount = candidates.length;
          const pageCandidates = candidates.slice(offset, offset + query.limit + 1);
          const ids = pageCandidates.map(({ memoryId }) => memoryId);
          const rows = await repository.findMemoriesByIds(client, userId, ids);
          const byId = new Map(rows.map((memory) => [memory.id, memory]));
          memories = ids.flatMap((id) => {
            const memory = byId.get(id);
            return memory ? [memory] : [];
          });
        }

        const hasMore = memories.length > query.limit || (Boolean(query.q) && offset + query.limit < candidateCount);
        return {
          memories: memories.slice(0, query.limit),
          page: query.page,
          limit: query.limit,
          hasMore,
          nextPage: hasMore ? query.page + 1 : null,
        };
      });
    },
  };
}
