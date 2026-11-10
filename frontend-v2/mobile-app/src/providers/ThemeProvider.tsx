import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme as useNativeWindColorScheme } from 'nativewind';
import { darkPalette, lightPalette, type MerakiThemePalette } from '../theme/colors';

export type AppTheme = 'dark' | 'light';

interface ThemeContextValue {
  theme: AppTheme;
  isDark: boolean;
  palette: MerakiThemePalette;
  setTheme: (theme: AppTheme) => void;
  toggleTheme: () => void;
}

const STORAGE_KEY = 'meraki_theme_mode';
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>('dark');
  const nwScheme = useNativeWindColorScheme();

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (!mounted) return;
        if (saved === 'light' || saved === 'dark') {
          setThemeState(saved);
          try { nwScheme.setColorScheme(saved); } catch {}
        } else {
          try { nwScheme.setColorScheme('dark'); } catch {}
        }
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setTheme = useCallback((next: AppTheme) => {
    setThemeState(next);
    try { nwScheme.setColorScheme(next); } catch {}
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, [nwScheme]);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    isDark: theme === 'dark',
    palette: theme === 'dark' ? darkPalette : lightPalette,
    setTheme,
    toggleTheme,
  }), [theme, setTheme, toggleTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      theme: 'dark',
      isDark: true,
      palette: darkPalette,
      setTheme: () => {},
      toggleTheme: () => {},
    };
  }
  return ctx;
}
