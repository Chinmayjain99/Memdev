import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { AuthProvider } from '../../app/providers/AuthProvider';
import { LoginPage, RegisterPage } from './AuthPages';
import { ProtectedRoute } from '../../app/routes/ProtectedRoute';
import { Route, Routes } from 'react-router';
import { authApi } from '../../services/api/auth-api';

vi.mock('../../services/api/auth-api', () => ({
  authApi: { refresh: vi.fn(), me: vi.fn(), login: vi.fn(), register: vi.fn(), logout: vi.fn(), logoutAll: vi.fn() },
}));
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(authApi.refresh).mockReset().mockRejectedValue(new Error('no session'));
  vi.mocked(authApi.me).mockReset();
});

function wrapper(page: React.ReactNode) {
  return <MemoryRouter initialEntries={['/login']}><AuthProvider>{page}</AuthProvider></MemoryRouter>;
}

describe('auth foundation pages', () => {
  it('renders accessible login controls', async () => {
    render(wrapper(<LoginPage />));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });
  it('renders register controls and password guidance', async () => {
    render(wrapper(<RegisterPage />));
    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
    expect(screen.getByText('Use at least 12 characters.')).toBeInTheDocument();
  });
  it('shows local login validation', async () => {
    render(wrapper(<LoginPage />));
    const button = await screen.findByRole('button', { name: 'Sign in' });
    fireEvent.submit(button.closest('form')!);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Enter your email and password.'));
  });
  it('redirects unauthenticated users from protected routes', async () => {
    render(<MemoryRouter initialEntries={['/dashboard']}><AuthProvider><Routes>
      <Route element={<ProtectedRoute />}><Route path="/dashboard" element={<p>Protected content</p>} /></Route>
      <Route path="/login" element={<p>Sign in route</p>} />
    </Routes></AuthProvider></MemoryRouter>);
    expect(await screen.findByText('Sign in route')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });
  it('loads an authenticated user before rendering a protected route', async () => {
    const user = { id: 'user-1', email: 'person@example.com', displayName: null };
    vi.mocked(authApi.refresh).mockResolvedValue({ user, accessToken: 'memory-token', expiresIn: 600 });
    vi.mocked(authApi.me).mockResolvedValue({ user });
    render(<MemoryRouter initialEntries={['/dashboard']}><AuthProvider><Routes>
      <Route element={<ProtectedRoute />}><Route path="/dashboard" element={<p>Protected content</p>} /></Route>
      <Route path="/login" element={<p>Sign in route</p>} />
    </Routes></AuthProvider></MemoryRouter>);
    expect(await screen.findByText('Protected content')).toBeInTheDocument();
    expect(authApi.refresh).toHaveBeenCalledOnce();
    expect(authApi.me).toHaveBeenCalledOnce();
  });
  it('keeps protected content hidden while session bootstrap is pending', async () => {
    const user = { id: 'user-1', email: 'person@example.com', displayName: null };
    let completeRefresh!: (response: { user: typeof user; accessToken: string; expiresIn: number }) => void;
    vi.mocked(authApi.refresh).mockReturnValue(new Promise((resolve) => { completeRefresh = resolve; }));
    vi.mocked(authApi.me).mockResolvedValue({ user });
    render(<MemoryRouter initialEntries={['/dashboard']}><AuthProvider><Routes>
      <Route element={<ProtectedRoute />}><Route path="/dashboard" element={<p>Protected content</p>} /></Route>
      <Route path="/login" element={<p>Sign in route</p>} />
    </Routes></AuthProvider></MemoryRouter>);
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    completeRefresh({ user, accessToken: 'memory-token', expiresIn: 600 });
    expect(await screen.findByText('Protected content')).toBeInTheDocument();
  });
});
