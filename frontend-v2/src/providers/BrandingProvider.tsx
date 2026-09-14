import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useAuthContext } from './AuthProvider';
import { useAppBranding } from '@/features/config/hooks/useAppBranding';
import { DEFAULT_APP_BRANDING, type AppBrandingDraft } from '@/features/config/services/appBranding.service';

interface BrandingContextValue {
  branding: AppBrandingDraft;
  draft: AppBrandingDraft;
  status: 'idle' | 'loading' | 'saving' | 'error';
  error: string | null;
  isDirty: boolean;
  update: <K extends keyof AppBrandingDraft>(key: K, value: AppBrandingDraft[K]) => void;
  save: () => Promise<void>;
  reset: () => void;
}

const BrandingContext = createContext<BrandingContextValue | null>(null);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { companyId } = useAuthContext();
  const state = useAppBranding(companyId);
  const activeBranding = state.branding ?? DEFAULT_APP_BRANDING;

  useEffect(() => {
    applyBranding(activeBranding);
  }, [activeBranding]);

  useEffect(() => {
    document.title = activeBranding.appName;
  }, [activeBranding.appName]);

  return (
    <BrandingContext.Provider value={state}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error('useBranding debe usarse dentro de <BrandingProvider>');
  return ctx;
}

function applyBranding(branding: AppBrandingDraft) {
  const root = document.documentElement;
  const rgb = hexToRgb(branding.primaryColor) ?? hexToRgb(DEFAULT_APP_BRANDING.primaryColor)!;

  root.style.setProperty('--brand-primary', branding.primaryColor);
  root.style.setProperty('--brand-primary-rgb', `${rgb.r} ${rgb.g} ${rgb.b}`);
  root.style.setProperty('--brand-primary-hover', `color-mix(in srgb, ${branding.primaryColor} 88%, white)`);
  root.style.setProperty('--brand-primary-soft', `rgb(${rgb.r} ${rgb.g} ${rgb.b} / 0.16)`);
  root.style.setProperty('--brand-primary-border', `rgb(${rgb.r} ${rgb.g} ${rgb.b} / 0.38)`);
  root.style.setProperty('--brand-primary-text', `color-mix(in srgb, ${branding.primaryColor} 72%, white)`);
}

function hexToRgb(hex: string) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) return null;
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  };
}
