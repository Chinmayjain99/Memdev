import {
  memoryListResponseSchema,
  memoryResponseSchema,
  type CreateMemoryRequest,
  type MemoryListResponse,
  type MemoryResponse,
  type UpdateMemoryRequest,
} from '@memdev/contracts';
import { apiClient } from './client';

export const memoryApi = {
  create: (input: CreateMemoryRequest) => apiClient.request<MemoryResponse>('/memories', {
    method: 'POST', body: input, responseSchema: memoryResponseSchema,
  }),
  list: (params: { limit?: number; cursor?: string } = {}) => apiClient.request<MemoryListResponse>(
    `/memories${query(params)}`, { responseSchema: memoryListResponseSchema },
  ),
  get: (id: string) => apiClient.request<MemoryResponse>(`/memories/${encodeURIComponent(id)}`, {
    responseSchema: memoryResponseSchema,
  }),
  update: (id: string, version: number, patch: UpdateMemoryRequest) => apiClient.request<MemoryResponse>(`/memories/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: patch, headers: { 'If-Match': `"${version}"` }, responseSchema: memoryResponseSchema,
  }),
  remove: (id: string) => apiClient.request<void>(`/memories/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  revisit: (id: string) => apiClient.request<MemoryResponse>(`/memories/${encodeURIComponent(id)}/revisit`, {
    method: 'POST', responseSchema: memoryResponseSchema,
  }),
};

function query(input: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) if (value !== undefined) params.set(key, String(value));
  const result = params.toString();
  return result ? `?${result}` : '';
}
