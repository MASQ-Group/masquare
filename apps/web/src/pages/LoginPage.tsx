import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

/** MASQ geometric mark (assets/masq-mark.svg). `fill` recolors all three glyphs
 *  (solid white on the brand panel); omit it for the original brand colours. */
function MasqMark({ width, fill }: { width: number; fill?: string }) {
  return (
    <svg viewBox="0 0 1402 432" style={{ width, height: 'auto' }} aria-label="maSquare">
      <path d="M0 432V0H467.65V432H322.971V108H305.434V432H160.755V108H143.218V432H0Z" fill={fill ?? '#14A79D'} />
      <path fillRule="evenodd" clipRule="evenodd" d="M485.186 431.27V0H934.568V432H718.28V288.243H700.743V432L485.186 431.27ZM700.013 233.513H719.011V108H700.013V233.513Z" fill={fill ?? '#8DC73F'} />
      <path d="M1401.49 432H951.374V0H1401.49V432ZM979.143 27.7295V404.271H1373.72V27.7295H979.143Z" fill={fill ?? '#F1592A'} />
    </svg>
  );
}

const inputClass =
  'h-[50px] w-full rounded-[11px] border border-[#E1E5E3] bg-white px-[15px] text-[15px] text-[#16211F] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[#9AA6A1] ' +
  'focus:border-[#14A79D] focus:[box-shadow:0_0_0_3px_rgba(20,167,157,0.16)] focus-visible:outline-none';

/** Landing / login page — split-screen hi-fi design (design_handoff_login). */
export function LoginPage() {
  const { user, signIn, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && user) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      navigate('/');
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Sign in failed — check your email and password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-white" style={{ fontFamily: "'Hanken Grotesk', system-ui, sans-serif" }}>
      {/* Brand panel */}
      <div
        className="relative flex w-[44%] max-w-[600px] flex-none flex-col justify-between overflow-hidden p-16 max-[767px]:hidden"
        style={{ background: 'linear-gradient(160deg,#13A79D 0%,#0C7C74 100%)' }}
      >
        <div className="absolute -right-[140px] -top-[140px] h-[480px] w-[480px] rounded-full bg-white/[.06]" />
        <div className="absolute -bottom-[120px] right-20 h-[300px] w-[300px] rounded-full bg-[rgba(141,199,63,.14)]" />

        <div className="relative">
          <MasqMark width={140} fill="#ffffff" />
        </div>

        <div className="relative">
          <div className="max-w-[360px] text-[34px] font-semibold leading-[1.22] tracking-[-.015em] text-white">
            The maSquare platform.
          </div>
          <div className="mt-[18px] max-w-[340px] text-[16px] leading-[1.55] text-white/[.72]">
            One secure workspace for your foundation modules. Sign in to pick up where you left off.
          </div>
        </div>

        <div className="relative text-[13px] font-medium text-white/[.55]">maSquare · Foundation (Module 1)</div>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 flex-col items-center justify-center bg-white px-10 py-14 max-[767px]:px-6">
        {/* Compact brand header when the panel is hidden (mobile) */}
        <div className="mb-10 hidden w-full max-w-[360px] max-[767px]:block">
          <MasqMark width={104} />
        </div>

        <form onSubmit={submit} className="w-full max-w-[360px]">
          <h1 className="m-0 text-[30px] font-bold tracking-[-.02em] text-[#16211F]">Sign in</h1>
          <p className="mb-0 mt-2 text-[15px] leading-[1.5] text-[#6B7772]">Welcome back — enter your details to continue.</p>

          <div className="mt-9">
            <label htmlFor="email" className="mb-2 block text-[13px] font-semibold text-[#3B4642]">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@masquare.local"
              autoComplete="username"
              required
              className={inputClass}
            />
          </div>

          <div className="mt-[22px]">
            <div className="mb-2 flex items-baseline justify-between">
              <label htmlFor="password" className="text-[13px] font-semibold text-[#3B4642]">Password</label>
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-[#0E7A73] hover:underline"
              >
                {show ? 'Hide' : 'Show'}
              </button>
            </div>
            <input
              id="password"
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
              className={inputClass}
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="mt-[30px] h-[52px] w-full cursor-pointer rounded-[11px] border-0 bg-[#14A79D] text-[15px] font-semibold tracking-[.01em] text-white transition-colors duration-150 hover:bg-[#0E8A81] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          {error && (
            <p className="mt-4 text-[13.5px] leading-[1.45] text-[#C8372E]" role="alert">{error}</p>
          )}
        </form>
      </div>
    </div>
  );
}
