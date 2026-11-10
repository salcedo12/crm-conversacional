import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type AppTheme = 'dark' | 'light';

interface ThemeContextValue {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'meraki_theme_mode';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {}
    return 'dark'; // Por defecto se mantiene en modo oscuro como lo maneja Meraki actualmente
  });

  const setTheme = (newTheme: AppTheme) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem(STORAGE_KEY, newTheme);
    } catch {}
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(theme);
    root.setAttribute('data-theme', theme);

    // Ajustar color de fondo del body inmediatamente
    if (theme === 'light') {
      root.style.colorScheme = 'light';
      document.body.style.backgroundColor = '#f8f9fa';
      document.body.style.color = '#0d060a';
    } else {
      root.style.colorScheme = 'dark';
      document.body.style.backgroundColor = '#0d0d0f';
      document.body.style.color = '#f4f4f5';
    }
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme debe usarse dentro de un <ThemeProvider>');
  return ctx;
}
