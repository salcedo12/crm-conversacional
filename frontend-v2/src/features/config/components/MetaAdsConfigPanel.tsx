import { useEffect, useState } from 'react';
import { Megaphone, CheckCircle2, AlertCircle, Eye, EyeOff, Loader2, HelpCircle } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import {
  fetchMetaAdsConfig,
  updateMetaAdsConfig,
  verifyMetaAdsConnection,
  type MetaAdsConfig,
} from '@/features/inbox/services/metaCreative.service';

interface Props {
  companyId: string;
}

export function MetaAdsConfigPanel({ companyId }: Props) {
  const [config, setConfig] = useState<MetaAdsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [tokenInput, setTokenInput] = useState('');
  const [accountInput, setAccountInput] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMetaAdsConfig(companyId)
      .then((cfg) => {
        if (cancelled) return;
        setConfig(cfg);
        setAccountInput(cfg.adAccountId || '');
      })
      .catch((err) => {
        console.warn('[MetaAdsConfig] Error cargando config:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const handleTest = async () => {
    setTesting(true);
    setFeedback(null);
    try {
      // Si el usuario escribió un token nuevo en el input sin guardar, guardarlo temporalmente o probar directo
      if (tokenInput.trim() || accountInput.trim()) {
        await updateMetaAdsConfig(companyId, {
          accessToken: tokenInput.trim() || undefined,
          adAccountId: accountInput.trim() || undefined,
        });
      }
      const res = await verifyMetaAdsConnection(companyId);
      setFeedback({
        type: 'success',
        message: `¡Conexión exitosa con Meta! Cuenta: ${res.accountName} (${res.currency}).`,
      });
      setConfig({
        configured: true,
        hasToken: true,
        adAccountId: accountInput.trim(),
      });
      setTokenInput('');
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'No se pudo conectar con Meta Ads.',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      await updateMetaAdsConfig(companyId, {
        accessToken: tokenInput.trim() || undefined,
        adAccountId: accountInput.trim() || undefined,
      });
      setFeedback({
        type: 'success',
        message: 'Configuración de Meta Ads guardada correctamente.',
      });
      setConfig((prev) => ({
        configured: !!tokenInput.trim() || !!prev?.configured,
        hasToken: !!tokenInput.trim() || !!prev?.hasToken,
        adAccountId: accountInput.trim(),
      }));
      setTokenInput('');
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error al guardar.',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 size={14} className="animate-spin text-violet-400" />
          <span>Cargando configuración de Meta Ads…</span>
        </div>
      </div>
    );
  }

  const isConfigured = config?.configured && config?.hasToken;

  return (
    <div className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm">
      {/* Encabezado */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-zinc-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Megaphone size={18} className="text-violet-400" />
            <h3 className="text-sm font-semibold text-zinc-100">
              Conexión Meta Marketing API (Videos y Pautas)
            </h3>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            Descarga y reproduce automáticamente los videos de tus anuncios de Facebook e Instagram en el chat de los asesores.
          </p>
        </div>

        <div className="shrink-0">
          {isConfigured ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
              <CheckCircle2 size={13} />
              <span>Conectado a Meta</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">
              <AlertCircle size={13} />
              <span>Sin token configurado</span>
            </span>
          )}
        </div>
      </div>

      {/* Formulario */}
      <div className="mt-4 space-y-4">
        <div>
          <label className="block text-xs font-medium text-zinc-300">
            Token de Acceso de Meta (System User Token con permiso <code className="text-violet-300">ads_read</code>)
          </label>
          <div className="relative mt-1">
            <input
              type={showToken ? 'text' : 'password'}
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={isConfigured ? '•••••••••••••••••••••••••••••••••••••• (Token configurado)' : 'Pega el token que empieza por EAA...'}
              className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 pr-10 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500/60 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="absolute right-3 top-2.5 text-zinc-400 hover:text-zinc-200"
            >
              {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-zinc-500">
            Permite leer los archivos .mp4 de los anuncios para reproducirlos nativamente en el CRM.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-300">
            ID de la Cuenta Publicitaria de Meraki
          </label>
          <div className="mt-1">
            <input
              type="text"
              value={accountInput}
              onChange={(e) => setAccountInput(e.target.value)}
              placeholder="Ej: act_1202547817098 o solo números"
              className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500/60 focus:outline-none"
            />
          </div>
        </div>

        {/* Feedback alert */}
        {feedback && (
          <div
            className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${
              feedback.type === 'success'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                : 'border-red-500/30 bg-red-500/10 text-red-200'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-400" />
            ) : (
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-400" />
            )}
            <p className="leading-relaxed">{feedback.message}</p>
          </div>
        )}

        {/* Botones de acción */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={() => setShowGuide(!showGuide)}
            className="flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 transition-colors"
          >
            <HelpCircle size={14} />
            <span>{showGuide ? 'Ocultar guía' : '¿Cómo generar este token en Meta?'}</span>
          </button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleTest}
              disabled={testing || saving}
              className="text-xs"
            >
              {testing ? (
                <>
                  <Loader2 size={12} className="animate-spin mr-1.5" />
                  Verificando…
                </>
              ) : (
                'Probar conexión'
              )}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleSave}
              disabled={saving || testing}
              className="text-xs bg-violet-600 hover:bg-violet-500 text-white"
            >
              {saving ? (
                <>
                  <Loader2 size={12} className="animate-spin mr-1.5" />
                  Guardando…
                </>
              ) : (
                'Guardar'
              )}
            </Button>
          </div>
        </div>

        {/* Guía paso a paso */}
        {showGuide && (
          <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-xs text-zinc-300 space-y-2">
            <p className="font-semibold text-zinc-100">Pasos para generar el Token en Meta Business Manager:</p>
            <ol className="list-decimal pl-4 space-y-1 text-zinc-400 leading-relaxed">
              <li>
                Entra a <a href="https://business.facebook.com/settings" target="_blank" rel="noopener noreferrer" className="text-violet-400 underline">business.facebook.com/settings</a> y selecciona el negocio de <strong>Grupo Constructor Meraki</strong>.
              </li>
              <li>
                En el menú lateral izquierdo ve a <strong>Usuarios &gt; Usuarios del sistema</strong>.
              </li>
              <li>
                Crea un nuevo usuario del sistema (ej: <em>CRM Meraki</em>) con rol de <strong>Administrador</strong>.
              </li>
              <li>
                Haz clic en <strong>Agregar activos</strong> y asigna tu <strong>Cuenta Publicitaria</strong> con control total.
              </li>
              <li>
                Haz clic en <strong>Generar nuevo token</strong>. Selecciona la app correspondiente y marca los permisos:
                <ul className="list-disc pl-4 mt-1 text-zinc-300">
                  <li><code className="text-violet-300">ads_read</code> (necesario para leer los videos y copys)</li>
                  <li><code className="text-violet-300">leads_retrieval</code> (para formularios de leads)</li>
                  <li><code className="text-violet-300">pages_read_engagement</code></li>
                </ul>
              </li>
              <li>
                Copia el token generado y pégalo en el campo superior.
              </li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
