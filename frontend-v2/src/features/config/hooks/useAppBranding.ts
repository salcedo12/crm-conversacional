import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_APP_BRANDING,
  fetchAppBranding,
  persistAppBranding,
  type AppBranding,
  type AppBrandingDraft,
} from '../services/appBranding.service';

type Status = 'idle' | 'loading' | 'saving' | 'error';

export function useAppBranding(companyId: string | null) {
  const [branding, setBranding] = useState<AppBrandingDraft>(DEFAULT_APP_BRANDING);
  const [draft, setDraft] = useState<AppBrandingDraft>(DEFAULT_APP_BRANDING);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) {
      setBranding(DEFAULT_APP_BRANDING);
      setDraft(DEFAULT_APP_BRANDING);
      return;
    }

    setStatus('loading');
    setError(null);
    try {
      const loaded = normalize(await fetchAppBranding(companyId));
      setBranding(loaded);
      setDraft(loaded);
      setStatus('idle');
    } catch (err) {
      console.error('[useAppBranding] load error:', err);
      setError('No se pudo cargar la marca.');
      setStatus('error');
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  const update = useCallback(<K extends keyof AppBrandingDraft>(key: K, value: AppBrandingDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const save = useCallback(async () => {
    if (!companyId) return;
    setStatus('saving');
    setError(null);
    try {
      await persistAppBranding(companyId, draft);
      setBranding(draft);
      setStatus('idle');
    } catch (err) {
      console.error('[useAppBranding] save error:', err);
      setError('No se pudo guardar la marca.');
      setStatus('error');
    }
  }, [companyId, draft]);

  const reset = useCallback(() => {
    setDraft(DEFAULT_APP_BRANDING);
  }, []);

  const isDirty = useMemo(
    () => JSON.stringify(branding) !== JSON.stringify(draft),
    [branding, draft]
  );

  return { branding, draft, status, error, isDirty, update, save, reset, reload: load };
}

function normalize(value: Partial<AppBranding> | null | undefined): AppBrandingDraft {
  return {
    appName: value?.appName || DEFAULT_APP_BRANDING.appName,
    tagline: value?.tagline ?? DEFAULT_APP_BRANDING.tagline,
    logoUrl: value?.logoUrl || DEFAULT_APP_BRANDING.logoUrl,
    primaryColor: value?.primaryColor || DEFAULT_APP_BRANDING.primaryColor,
  };
}
