import { searchResponseSchema, type SearchFilters, type SearchResponse } from '@memdev/contracts';
import { apiClient } from './client';

export function searchMemories(filters: SearchFilters = {}): Promise<SearchResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return apiClient.request<SearchResponse>(`/memories/search${params.size ? `?${params}` : ''}`, {
    responseSchema: searchResponseSchema,
  });
}
