import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import { useAuth } from './AuthProvider';

export interface AppBranding {
  appName: string;
  tagline: string;
  logoUrl: string;
  primaryColor: string;
  updatedAt?: number | null;
}

export type AppBrandingDraft = Omit<AppBranding, 'updatedAt'>;

export const DEFAULT_APP_BRANDING: AppBrandingDraft = {
  appName: 'Meraki CRM',
  tagline: 'Conversacional',
  logoUrl: '',
  primaryColor: '#B7871C',
};

interface BrandingContextValue {
  branding: AppBrandingDraft;
  draft: AppBrandingDraft;
  status: 'idle' | 'loading' | 'saving' | 'error';
  error: string | null;
  isDirty: boolean;
  update: <K extends keyof AppBrandingDraft>(key: K, value: AppBrandingDraft[K]) => void;
  save: () => Promise<void>;
  reset: () => void;
  reload: () => Promise<void>;
}

const BrandingContext = createContext<BrandingContextValue | null>(null);
const functionsInstance = getFunctions(undefined, 'us-central1');
const getAppBrandingCall = httpsCallable<{ companyId: string }, AppBranding>(functionsInstance, 'getAppBranding');
const saveAppBrandingCall = httpsCallable<{ companyId: string } & AppBrandingDraft, { ok: boolean }>(functionsInstance, 'saveAppBranding');

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { companyId } = useAuth();
  const [branding, setBranding] = useState<AppBrandingDraft>(DEFAULT_APP_BRANDING);
  const [draft, setDraft] = useState<AppBrandingDraft>(DEFAULT_APP_BRANDING);
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!companyId) {
      setBranding(DEFAULT_APP_BRANDING);
      setDraft(DEFAULT_APP_BRANDING);
      return;
    }
    setStatus('loading');
    setError(null);
    try {
      const res = await getAppBrandingCall({ companyId });
      const loaded: AppBrandingDraft = {
        appName: res.data?.appName || DEFAULT_APP_BRANDING.appName,
        tagline: res.data?.tagline || DEFAULT_APP_BRANDING.tagline,
        logoUrl: res.data?.logoUrl && !res.data.logoUrl.startsWith('/') ? res.data.logoUrl : '',
        primaryColor: res.data?.primaryColor || DEFAULT_APP_BRANDING.primaryColor,
      };
      setBranding(loaded);
      setDraft(loaded);
      setStatus('idle');
    } catch {
      setStatus('idle');
    }
  }, [companyId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const update = useCallback(<K extends keyof AppBrandingDraft>(key: K, value: AppBrandingDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const save = useCallback(async () => {
    if (!companyId) return;
    setStatus('saving');
    setError(null);
    try {
      const payload: AppBrandingDraft = {
        ...draft,
        logoUrl: draft.logoUrl || '/meraki-logo.png',
      };
      await saveAppBrandingCall({ companyId, ...payload });
      setBranding(draft);
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'No se pudo guardar la marca.');
      throw err;
    }
  }, [companyId, draft]);

  const reset = useCallback(() => {
    setDraft(DEFAULT_APP_BRANDING);
  }, []);

  const isDirty = useMemo(
    () =>
      draft.appName !== branding.appName ||
      draft.tagline !== branding.tagline ||
      draft.logoUrl !== branding.logoUrl ||
      draft.primaryColor !== branding.primaryColor,
    [draft, branding]
  );

  const value = useMemo<BrandingContextValue>(
    () => ({ branding, draft, status, error, isDirty, update, save, reset, reload }),
    [branding, draft, status, error, isDirty, update, save, reset, reload]
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (!ctx) {
    return {
      branding: DEFAULT_APP_BRANDING,
      draft: DEFAULT_APP_BRANDING,
      status: 'idle',
      error: null,
      isDirty: false,
      update: () => {},
      save: async () => {},
      reset: () => {},
      reload: async () => {},
    };
  }
  return ctx;
}
