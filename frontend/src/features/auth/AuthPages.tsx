import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { ApiError } from '../../services/api/client';
import { useAuth } from '../../app/providers/AuthProvider';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { ErrorState } from '../../components/common/States';

export function LoginPage() {
  const { login, status, error: sessionError } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const visibleError = error || sessionError;
  if (status === 'authenticated') return <Navigate to="/dashboard" replace />;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    if (!hasValidEmail(event.currentTarget)) { setError('Enter a valid email address.'); return; }
    if (new TextEncoder().encode(password).byteLength > 72) { setError('Password must be 72 UTF-8 bytes or fewer.'); return; }
    setPending(true);
    try { await login(email, password); navigate('/dashboard', { replace: true }); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Sign in failed. Try again.'); }
    finally { setPending(false); }
  }
  return <AuthFrame title="Welcome back" alternate={<>New to MemDev? <Link to="/register">Create an account</Link></>}>
    <form onSubmit={(event) => void submit(event)} noValidate>
      {visibleError && <ErrorState>{visibleError}</ErrorState>}
      <Input label="Email" name="email" type="email" autoComplete="email" required value={email}
        onChange={(event) => setEmail(event.target.value)} />
      <Input label="Password" name="password" type="password" autoComplete="current-password" required value={password}
        onChange={(event) => setPassword(event.target.value)} />
      <Button className="primary" type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  </AuthFrame>;
}

export function RegisterPage() {
  const { register, status, error: sessionError } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const visibleError = error || sessionError;
  if (status === 'authenticated') return <Navigate to="/dashboard" replace />;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (!hasValidEmail(event.currentTarget)) { setError('Enter a valid email address.'); return; }
    if (password.length < 12) { setError('Password must be at least 12 characters.'); return; }
    if (new TextEncoder().encode(password).byteLength > 72) { setError('Password must be 72 UTF-8 bytes or fewer.'); return; }
    setPending(true);
    try { await register({ email, password }); navigate('/dashboard', { replace: true }); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Account creation failed. Try again.'); }
    finally { setPending(false); }
  }
  return <AuthFrame title="Create your account" alternate={<>Already registered? <Link to="/login">Sign in</Link></>}>
    <form onSubmit={(event) => void submit(event)} noValidate>
      {visibleError && <ErrorState>{visibleError}</ErrorState>}
      <Input label="Email" name="email" type="email" autoComplete="email" required value={email}
        onChange={(event) => setEmail(event.target.value)} />
      <Input label="Password" name="password" type="password" autoComplete="new-password" required minLength={12} value={password}
        onChange={(event) => setPassword(event.target.value)} />
      <p className="hint">Use at least 12 characters.</p>
      <Button className="primary" type="submit" disabled={pending}>
        {pending ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  </AuthFrame>;
}

function hasValidEmail(form: HTMLFormElement): boolean {
  return (form.elements.namedItem('email') as HTMLInputElement | null)?.validity.valid ?? false;
}

function AuthFrame({ title, alternate, children }: { title: string; alternate: React.ReactNode; children: React.ReactNode }) {
  return <main className="auth-page">
    <section className="auth-card">
      <Link to="/" className="brand">MemDev</Link>
      <h1>{title}</h1>
      {children}
      <p className="auth-alternate">{alternate}</p>
    </section>
  </main>;
}
