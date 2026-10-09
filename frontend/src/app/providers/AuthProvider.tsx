import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PublicUser, RegisterRequest } from '@memdev/contracts';
import { ApiError, apiClient } from '../../services/api/client';
import { authApi } from '../../services/api/auth-api';

type AuthState = { status: 'loading' | 'authenticated' | 'unauthenticated'; user: PublicUser | null; error: string | null };
type AuthContextValue = AuthState & {
  login(email: string, password: string): Promise<void>;
  register(input: RegisterRequest): Promise<void>;
  logout(): Promise<void>;
  logoutAll(): Promise<void>;
  checkSession(): Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null, error: null });
  const clear = useCallback(() => {
    apiClient.setAccessToken(null);
    setState({ status: 'unauthenticated', user: null, error: null });
  }, []);
  useEffect(() => {
    apiClient.setOnAuthExpired(clear);
    return () => apiClient.setOnAuthExpired(null);
  }, [clear]);

  const checkSession = useCallback(async () => {
    setState((current) => ({ ...current, status: 'loading', error: null }));
    try {
      const refreshed = await authApi.refresh();
      const { user } = await authApi.me();
      setState({ status: 'authenticated', user: user ?? refreshed.user, error: null });
    } catch (error) {
      apiClient.setAccessToken(null);
      setState({ status: 'unauthenticated', user: null,
        error: error instanceof ApiError && error.kind === 'network' ? error.message : null });
    }
  }, []);
  useEffect(() => { void checkSession(); }, [checkSession]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await authApi.login({ email, password });
    setState({ status: 'authenticated', user: result.user, error: null });
  }, []);
  const register = useCallback(async (input: RegisterRequest) => {
    const result = await authApi.register(input);
    setState({ status: 'authenticated', user: result.user, error: null });
  }, []);
  const logout = useCallback(async () => {
    try { await authApi.logout(); }
    finally { clear(); }
  }, [clear]);
  const logoutAll = useCallback(async () => {
    try { await authApi.logoutAll(); }
    finally { clear(); }
  }, [clear]);
  const value = useMemo(() => ({ ...state, login, register, logout, logoutAll, checkSession }), [state, login, register, logout, logoutAll, checkSession]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
