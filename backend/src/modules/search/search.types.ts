import type { Memory } from '../memories/memory.types.js';

export type SearchSource = 'fts' | 'fuzzy';
export type RankedSearchCandidate = { memoryId: string; source: SearchSource; rank: number };
export type FusedSearchCandidate = { memoryId: string; score: number };
export type SearchPage = {
  memories: Memory[];
  page: number;
  limit: number;
  hasMore: boolean;
  nextPage: number | null;
};
