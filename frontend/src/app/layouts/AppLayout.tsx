import { Link, Outlet } from 'react-router';
import { Button } from '../../components/common/Button';
import { useAuth } from '../providers/AuthProvider';

export function AppLayout() {
  const { user, logout } = useAuth();
  return <div className="app-shell">
    <header className="topbar">
      <Link className="brand" to="/dashboard">MemDev</Link>
      <nav aria-label="Main navigation">
        <Link to="/dashboard">Dashboard</Link>
        <Link to="/search">Search</Link>
        <Link to="/settings">Settings</Link>
      </nav>
      <div className="user-area">
        <span>{user?.displayName ?? user?.email}</span>
        <Button type="button" onClick={() => void logout().catch(() => undefined)}>Log out</Button>
      </div>
    </header>
    <main className="page"><Outlet /></main>
  </div>;
}
