import { useState, type FormEvent } from 'react';
import { useNavigate }              from 'react-router-dom';
import { useAuth }                  from '../hooks/useAuth';
import { Button }                   from '@/shared/components/Button';

export function LoginPage() {
  const { signIn, loading, error } = useAuth();
  const navigate                   = useNavigate();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await signIn(email.trim(), password);
      navigate('/dashboard/inbox', { replace: true });
    } catch {
      // error is already set in context
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-12 w-12 rounded-xl bg-violet-600 flex items-center justify-center text-xl font-bold mb-3">
            M
          </div>
          <h1 className="text-xl font-semibold text-zinc-100">Meraki CRM</h1>
          <p className="text-sm text-zinc-500 mt-1">Inicia sesión para continuar</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Error */}
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
              className="
                rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2.5
                text-sm text-zinc-100 placeholder-zinc-500
                focus:outline-none focus:border-violet-500/50
                transition-colors
              "
            />
          </div>

          {/* Password */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400" htmlFor="password">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="
                rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2.5
                text-sm text-zinc-100 placeholder-zinc-500
                focus:outline-none focus:border-violet-500/50
                transition-colors
              "
            />
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

        <p className="text-center text-[11px] text-zinc-600 mt-6">
          Grupo Constructor Meraki SAS · CRM Conversacional
        </p>
      </div>
    </div>
  );
}
