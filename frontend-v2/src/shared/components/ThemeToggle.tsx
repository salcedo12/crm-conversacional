import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/providers/ThemeProvider';

interface ThemeToggleProps {
  className?: string;
  variant?: 'pill' | 'compact';
}

export function ThemeToggle({ className = '', variant = 'pill' }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        className={`p-2 rounded-xl transition-all cursor-pointer flex items-center justify-center ${
          theme === 'dark'
            ? 'bg-zinc-800/80 text-amber-300 hover:bg-zinc-700 border border-zinc-700/60'
            : 'bg-white text-amber-600 hover:bg-zinc-100 border border-zinc-300 shadow-sm'
        } ${className}`}
        title={`Cambiar a modo ${theme === 'dark' ? 'claro' : 'oscuro'}`}
        aria-label="Cambiar tema visual"
      >
        {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
      </button>
    );
  }

  return (
    <div
      className={`grid grid-cols-2 p-1 rounded-xl bg-zinc-900/90 border border-zinc-800 shadow-inner ${className}`}
      role="radiogroup"
      aria-label="Selector de tema visual"
    >
      <button
        type="button"
        onClick={() => setTheme('dark')}
        role="radio"
        aria-checked={theme === 'dark'}
        className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs transition-all cursor-pointer ${
          theme === 'dark'
            ? 'bg-zinc-800 text-amber-300 shadow-sm border border-amber-500/40 font-bold'
            : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        <Moon size={13} className="shrink-0 text-amber-400" />
        <span>Oscuro</span>
      </button>

      <button
        type="button"
        onClick={() => setTheme('light')}
        role="radio"
        aria-checked={theme === 'light'}
        className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs transition-all cursor-pointer ${
          theme === 'light'
            ? 'bg-white text-zinc-900 shadow-sm border border-zinc-300 font-bold'
            : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        <Sun size={13} className="shrink-0 text-amber-500" />
        <span>Claro</span>
      </button>
    </div>
  );
}
