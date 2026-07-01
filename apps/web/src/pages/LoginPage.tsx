import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../lib/auth';

export function LoginPage() {
  const { user, signIn, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@masquare.local');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await signIn(email, password);
      navigate('/');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-full place-items-center bg-n-50 px-4">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-teal-400 to-teal-600 text-[17px] font-bold text-white">
            m
          </div>
          <div className="text-[20px] font-semibold tracking-tight text-n-900">
            ma<span className="text-green-600">Square</span>
          </div>
        </div>

        <div className="card p-6">
          <h1 className="text-[18px] font-semibold text-n-900">Sign in</h1>
          <p className="mt-1 text-[13px] text-n-500">Welcome back — sign in to continue.</p>

          <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="input mono"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary justify-center" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-[12px] text-n-400">
          maSquare · Foundation (Module 1)
        </p>
      </div>
    </div>
  );
}
