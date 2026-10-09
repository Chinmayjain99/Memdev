import { Button } from '../../components/common/Button';
import { useAuth } from '../../app/providers/AuthProvider';

export function SettingsPage() {
  const { user, logout } = useAuth();
  return <>
    <p className="eyebrow">ACCOUNT</p>
    <h1>Settings</h1>
    <section className="panel">
      <h2>Profile</h2>
      <p>{user?.displayName ?? user?.email ?? 'Your account'}</p>
      <Button type="button" onClick={() => void logout().catch(() => undefined)}>Log out</Button>
    </section>
  </>;
}
