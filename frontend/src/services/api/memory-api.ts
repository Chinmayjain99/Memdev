import type { CreateMemoryRequest, MemoryListResponse, MemoryResponse, UpdateMemoryRequest } from '@memdev/contracts';
import { apiClient } from './client';

export const memoryApi = {
  create: (input: CreateMemoryRequest) => apiClient.request<MemoryResponse>('/memories', { method: 'POST', body: input }),
  list: (params: { limit?: number; cursor?: string } = {}) => apiClient.request<MemoryListResponse>(`/memories${query(params)}`),
  get: (id: string) => apiClient.request<MemoryResponse>(`/memories/${encodeURIComponent(id)}`),
  update: (id: string, version: number, patch: UpdateMemoryRequest) => apiClient.request<MemoryResponse>(`/memories/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: patch, headers: { 'If-Match': `"${version}"` },
  }),
  remove: (id: string) => apiClient.request<void>(`/memories/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  revisit: (id: string) => apiClient.request<MemoryResponse>(`/memories/${encodeURIComponent(id)}/revisit`, { method: 'POST' }),
};

function query(input: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) if (value !== undefined) params.set(key, String(value));
  const result = params.toString();
  return result ? `?${result}` : '';
}
