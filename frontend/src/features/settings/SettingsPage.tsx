import { Button } from '../../components/common/Button';
import { useState } from 'react';
import { useAuth } from '../../app/providers/AuthProvider';
import { ApiError } from '../../services/api/client';
import { ErrorState } from '../../components/common/States';

export function SettingsPage() {
  const { user, logout, logoutAll } = useAuth();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function signOutAll() {
    setError(''); setPending(true);
    try { await logoutAll(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Could not sign out of all sessions.'); }
    finally { setPending(false); }
  }
  return <>
    <p className="eyebrow">ACCOUNT</p>
    <h1>Settings</h1>
    <section className="panel">
      <h2>Profile</h2>
      <p>{user?.displayName ?? user?.email ?? 'Your account'}</p>
      <Button type="button" onClick={() => void logout().catch(() => undefined)}>Log out</Button>
      <h2>Sessions</h2>
      <p className="hint">Sign out this browser or revoke every active session for your account.</p>
      {error && <ErrorState>{error}</ErrorState>}
      <Button type="button" disabled={pending} onClick={() => void signOutAll()}>{pending ? 'Signing out…' : 'Log out of all sessions'}</Button>
    </section>
  </>;
}
