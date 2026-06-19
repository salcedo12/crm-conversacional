import { useState, useEffect, useCallback } from 'react';
import { fetchAiConfig, persistAiConfig, restoreAiConfigDefaults } from '../services/aiConfig.service';
import type { AiConfig, AiConfigDraft } from '../types';

type Status = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

export function useAiConfig(companyId: string | null) {
  const [config,  setConfig]  = useState<AiConfig | null>(null);
  const [draft,   setDraft]   = useState<AiConfigDraft | null>(null);
  const [status,  setStatus]  = useState<Status>('idle');
  const [error,   setError]   = useState<string | null>(null);

  // Carga inicial
  useEffect(() => {
    if (!companyId) return;
    setStatus('loading');
    setError(null);

    fetchAiConfig(companyId)
      .then((cfg) => {
        setConfig(cfg);
        setDraft(toDraft(cfg));
        setStatus('idle');
      })
      .catch((err) => {
        console.error('[useAiConfig] load error:', err);
        setError('No se pudo cargar la configuración.');
        setStatus('error');
      });
  }, [companyId]);

  const isDirty = draft !== null && config !== null
    ? JSON.stringify(toDraft(config)) !== JSON.stringify(draft)
    : false;

  const save = useCallback(async () => {
    if (!companyId || !draft) return;
    setStatus('saving');
    setError(null);
    try {
      await persistAiConfig(companyId, draft);
      // Recargar para obtener updatedAt del servidor
      const updated = await fetchAiConfig(companyId);
      setConfig(updated);
      setDraft(toDraft(updated));
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2500);
    } catch (err) {
      console.error('[useAiConfig] save error:', err);
      setError('Error al guardar. Intenta nuevamente.');
      setStatus('error');
    }
  }, [companyId, draft]);

  const reset = useCallback(async () => {
    if (!companyId) return;
    setStatus('saving');
    setError(null);
    try {
      await restoreAiConfigDefaults(companyId);
      const updated = await fetchAiConfig(companyId);
      setConfig(updated);
      setDraft(toDraft(updated));
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2500);
    } catch (err) {
      console.error('[useAiConfig] reset error:', err);
      setError('Error al restaurar. Intenta nuevamente.');
      setStatus('error');
    }
  }, [companyId]);

  const update = useCallback(<K extends keyof AiConfigDraft>(key: K, value: AiConfigDraft[K]) => {
    setDraft((prev) => prev ? { ...prev, [key]: value } : prev);
  }, []);

  return { config, draft, status, error, isDirty, save, reset, update };
}

function toDraft(cfg: AiConfig): AiConfigDraft {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { updatedAt, ...rest } = cfg;
  return {
    ...rest,
    // Campos que pueden faltar en configs guardadas antes de esta versión
    followUpSequence: rest.followUpSequence ?? [],
    transferKeywords: rest.transferKeywords ?? [],
    blockedTopics:    rest.blockedTopics    ?? [],
    tags:             (rest as unknown as Record<string, unknown>).tags as string[] ?? undefined,
  } as AiConfigDraft;
}
