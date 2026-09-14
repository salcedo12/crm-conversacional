import { useState, type FormEvent } from 'react';
import { useNavigate }              from 'react-router-dom';
import { Eye, EyeOff }              from 'lucide-react';
import { useAuth }                  from '../hooks/useAuth';
import { Button }                   from '@/shared/components/Button';
import { useBranding }              from '@/providers/BrandingProvider';

type Mode = 'login' | 'reset';

export function LoginPage() {
  const { signIn, resetPassword, loading, error } = useAuth();
  const { branding } = useBranding();
  const navigate                   = useNavigate();

  const [mode,     setMode]     = useState<Mode>('login');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resetSent,    setResetSent]    = useState(false);
  const [resetError,   setResetError]   = useState<string | null>(null);
  const [resetBusy,    setResetBusy]    = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await signIn(email.trim(), password);
      navigate('/dashboard/inbox', { replace: true });
    } catch {
      // error is already set in context
    }
  };

  const handleReset = async (e: FormEvent) => {
    e.preventDefault();
    setResetError(null);
    if (!email.trim()) {
      setResetError('Escribe tu correo para enviarte el enlace.');
      return;
    }
    setResetBusy(true);
    try {
      await resetPassword(email.trim());
      setResetSent(true);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'No se pudo enviar el correo.');
    } finally {
      setResetBusy(false);
    }
  };

  const inputCls = `
    rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2.5
    text-sm text-zinc-100 placeholder-zinc-500
    focus:outline-none focus:border-violet-500/50 transition-colors
  `;

  return (
    <div className="min-h-dvh bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img src={branding.logoUrl || '/meraki-logo.png'} alt={`${branding.appName} logo`} className="mb-3 h-16 w-16 rounded-full" />
          <h1 className="text-xl font-semibold text-zinc-100">{branding.appName}</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {mode === 'login' ? 'Inicia sesión para continuar' : 'Recupera tu contraseña'}
          </p>
        </div>

        {mode === 'reset' ? (
          /* ── Recuperar contraseña ─────────────────────────────────────────── */
          resetSent ? (
            <div className="flex flex-col gap-4">
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-3">
                <p className="text-sm text-emerald-300">
                  Si existe una cuenta con <span className="font-medium">{email.trim()}</span>, te enviamos un
                  correo con el enlace para restablecer tu contraseña. Revisa también la carpeta de spam.
                </p>
              </div>
              <Button
                type="button"
                className="w-full"
                onClick={() => { setMode('login'); setResetSent(false); }}
              >
                Volver a iniciar sesión
              </Button>
            </div>
          ) : (
            <form onSubmit={handleReset} className="flex flex-col gap-4">
              {resetError && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
                  <p className="text-sm text-red-300">{resetError}</p>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-400" htmlFor="reset-email">
                  Correo electrónico
                </label>
                <input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@email.com"
                  className={inputCls}
                />
              </div>
              <Button type="submit" loading={resetBusy} disabled={!email || resetBusy} className="w-full mt-1">
                Enviar enlace de recuperación
              </Button>
              <button
                type="button"
                onClick={() => { setMode('login'); setResetError(null); }}
                className="text-center text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                ← Volver a iniciar sesión
              </button>
            </form>
          )
        ) : (
          /* ── Iniciar sesión ───────────────────────────────────────────────── */
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}

            {/* Email */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-400" htmlFor="email">
                Correo electrónico
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                className={inputCls}
              />
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-zinc-400" htmlFor="password">
                  Contraseña
                </label>
                <button
                  type="button"
                  onClick={() => { setMode('reset'); setResetError(null); setResetSent(false); }}
                  className="text-[11px] text-violet-400 hover:text-violet-300 transition-colors"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={`${inputCls} w-full pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <Button
              type="submit"
              loading={loading}
              disabled={!email || !password || loading}
              className="w-full mt-1"
            >
              Iniciar sesión
            </Button>
          </form>
        )}

        <p className="text-center text-[11px] text-zinc-600 mt-6">
          Grupo Constructor Meraki SAS · CRM Conversacional
        </p>
      </div>
    </div>
  );
}
