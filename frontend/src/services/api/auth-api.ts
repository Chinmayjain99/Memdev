import type { AuthResponse, AuthRequest, PublicUser, RegisterRequest } from '@memdev/contracts';
import { apiClient } from './client';

export const authApi = {
  async login(input: AuthRequest): Promise<AuthResponse> {
    const result = await apiClient.request<AuthResponse>('/auth/login', { method: 'POST', body: input, authenticated: false });
    apiClient.setAccessToken(result.accessToken);
    return result;
  },
  async register(input: RegisterRequest): Promise<AuthResponse> {
    const result = await apiClient.request<AuthResponse>('/auth/register', { method: 'POST', body: input, authenticated: false });
    apiClient.setAccessToken(result.accessToken);
    return result;
  },
  async refresh(): Promise<AuthResponse> {
    return apiClient.refreshSession();
  },
  me: () => apiClient.request<{ user: PublicUser }>('/auth/me'),
  async logout(): Promise<void> {
    try { await apiClient.request<void>('/auth/logout', { method: 'POST', authenticated: false }); }
    finally { apiClient.setAccessToken(null); }
  },
  async logoutAll(): Promise<void> {
    try { await apiClient.request<void>('/auth/logout-all', { method: 'POST' }); }
    finally { apiClient.setAccessToken(null); }
  },
};
