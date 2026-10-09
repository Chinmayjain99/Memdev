import type { SyncBootstrapResponse, SyncChangesResponse, SyncMutation, SyncMutationsResponse } from '@memdev/contracts';
import { apiClient } from './client';

export const syncApi = {
  bootstrap: (limit = 100, pageToken?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (pageToken !== undefined) params.set('pageToken', pageToken);
    return apiClient.request<SyncBootstrapResponse>(`/sync/bootstrap?${params}`);
  },
  changes: (cursor: string, limit = 100) => apiClient.request<SyncChangesResponse>(`/sync/changes?${new URLSearchParams({ cursor, limit: String(limit) })}`),
  mutations: (mutations: SyncMutation[]) => apiClient.request<SyncMutationsResponse>('/sync/mutations', { method: 'POST', body: { mutations } }),
};
