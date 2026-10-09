import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../providers/AuthProvider';
import { LoadingState } from '../../components/common/States';

export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <LoadingState label="Checking your session…" />;
  if (status !== 'authenticated') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
