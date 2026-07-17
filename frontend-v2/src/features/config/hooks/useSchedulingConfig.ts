import { useState, useEffect, useCallback } from 'react';
import {
  fetchSchedulingConfig, persistSchedulingConfig, type SchedulingConfig,
} from '../services/scheduling.service';

type Status = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

export function useSchedulingConfig(companyId: string | null) {
  const [config, setConfig] = useState<SchedulingConfig | null>(null);
  const [draft,  setDraft]  = useState<SchedulingConfig | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error,  setError]  = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) return;
    setStatus('loading');
    setError(null);
    fetchSchedulingConfig(companyId)
      .then((cfg) => { setConfig(cfg); setDraft(cfg); setStatus('idle'); })
      .catch((err) => {
        console.error('[useSchedulingConfig] load error:', err);
        setError('No se pudo cargar la configuración de agenda.');
        setStatus('error');
      });
  }, [companyId]);

  const isDirty = draft !== null && config !== null
    ? JSON.stringify(config) !== JSON.stringify(draft)
    : false;

  const save = useCallback(async () => {
    if (!companyId || !draft) return;
    setStatus('saving');
    setError(null);
    try {
      await persistSchedulingConfig(companyId, draft);
      setConfig(draft);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2500);
    } catch (err) {
      console.error('[useSchedulingConfig] save error:', err);
      setError('Error al guardar. Revisa los datos e intenta de nuevo.');
      setStatus('error');
    }
  }, [companyId, draft]);

  const update = useCallback(<K extends keyof SchedulingConfig>(key: K, value: SchedulingConfig[K]) => {
    setDraft((prev) => prev ? { ...prev, [key]: value } : prev);
  }, []);

  return { draft, status, error, isDirty, save, update };
}
