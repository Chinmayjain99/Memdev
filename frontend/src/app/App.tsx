import { Navigate, Route, Routes } from 'react-router';
import { useAuth } from './providers/AuthProvider';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { AppLayout } from './layouts/AppLayout';
import { LoginPage, RegisterPage } from '../features/auth/AuthPages';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { SearchPage } from '../features/search/SearchPage';
import { MemoryDetailPage } from '../features/memories/MemoryDetailPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { LoadingState } from '../components/common/States';

function HomeRedirect() {
  const { status } = useAuth();
  if (status === 'loading') return <LoadingState />;
  return <Navigate to={status === 'authenticated' ? '/dashboard' : '/login'} replace />;
}

export function App() {
  return <Routes>
    <Route path="/" element={<HomeRedirect />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route element={<ProtectedRoute />}>
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/memories/:id" element={<MemoryDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Route>
    <Route path="*" element={<main className="auth-page"><h1>Page not found</h1></main>} />
  </Routes>;
}
