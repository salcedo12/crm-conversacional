import { useEffect, useMemo, useState } from 'react';
import { useAuth }       from '@/features/auth/hooks/useAuth';
import { useLeads }      from '@/features/inbox/hooks/useLeads';
import { Button }        from '@/shared/components/Button';
import { Spinner }       from '@/shared/components/Spinner';
import { listTemplates } from '@/features/templates/services/templates.service';
import { listLeadLists, type LeadList } from '@/features/leads/services/leadLists.service';
import type { WhatsAppTemplate } from '@/features/templates/types';
import {
  countBroadcastAudience, listBroadcasts, sendBroadcast,
  type BroadcastRecord, type BroadcastAudience, type SendBroadcastResult,
} from '../services/broadcasts.service';

const STATUS_OPTIONS = [
  { value: 'new',       label: 'Nuevo'      },
  { value: 'active',    label: 'Activo'     },
  { value: 'qualified', label: 'Calificado' },
  { value: 'scheduled', label: 'Agendado'   },
  { value: 'lost',      label: 'Perdido'    },
  { value: 'closed',    label: 'Cerrado'    },
];

/** Variables que el backend rellena automáticamente con el nombre del lead. */
function isAutomaticNameVariable(
  variable: WhatsAppTemplate['variables'][number],
  body: string
): boolean {
  const normalize = (value: string) =>
    value.trim().replace(/^\{\{\s*|\s*\}\}$/g, '').replace(/^\[|\]$/g, '').toLowerCase();
  const aliases = new Set(['nombre', 'name']);
  const greetingVariable = body.match(/\b(?:hola|estimad[oa])\s+\{\{\s*(\w+)\s*\}\}/i)?.[1];

  return aliases.has(normalize(variable.key))
    || aliases.has(normalize(variable.example))
    || normalize(greetingVariable ?? '') === normalize(variable.key);
}

export function BroadcastsPage() {
  const { companyId } = useAuth();
  const { leads } = useLeads(companyId);

  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [history,   setHistory]   = useState<BroadcastRecord[]>([]);
  const [lists,     setLists]     = useState<LeadList[]>([]);
  const [loading,   setLoading]   = useState(true);

  const [templateId, setTemplateId] = useState('');
  const [audType,    setAudType]    = useState<BroadcastAudience['type']>('all');
  const [audValue,   setAudValue]   = useState('');
  const [vars,       setVars]       = useState<Record<string, string>>({});

  const [confirming, setConfirming] = useState(false);
  const [sending,    setSending]    = useState(false);
  const [result,     setResult]     = useState<SendBroadcastResult | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [countingAudience, setCountingAudience] = useState(false);
  const [audienceCountError, setAudienceCountError] = useState<string | null>(null);

  // Solo plantillas aprobadas pueden enviarse masivamente
  const approved = useMemo(() => templates.filter((t) => t.status === 'approved'), [templates]);
  const selected = approved.find((t) => t.id === templateId) ?? null;

  // Variables del cuerpo que el usuario debe completar (excluye las automáticas)
  const manualVars = useMemo(
    () => (selected?.variables ?? []).filter((v) => !isAutomaticNameVariable(v, selected?.body ?? '')),
    [selected]
  );

  const selectedPreview = useMemo(() => {
    if (!selected) return '';
    return selected.variables.reduce(
      (body, variable) => isAutomaticNameVariable(variable, selected.body)
        ? body.split(`{{${variable.key}}}`).join('[nombre del lead]')
        : body,
      selected.body
    );
  }, [selected]);

  // Etiquetas disponibles (de los leads cargados)
  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => (l.tags ?? []).forEach((t) => set.add(t)));
    return [...set].sort();
  }, [leads]);

  const loadAll = async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [tpls, hist, leadLists] = await Promise.all([listTemplates(companyId), listBroadcasts(companyId), listLeadLists(companyId)]);
      setTemplates(tpls);
      setHistory(hist);
      setLists(leadLists);
    } catch (err) {
      console.error('[Broadcasts] load error:', err);
      setError('No se pudieron cargar las plantillas o el historial.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const audienceValid = audType === 'all' || !!audValue;
  const varsComplete  = manualVars.every((v) => (vars[v.key] ?? '').trim().length > 0);
  const selectedAudience: BroadcastAudience =
    audType === 'all' ? { type: 'all' } : { type: audType, value: audValue };
  const canSend       = !!templateId && audienceValid && varsComplete && !sending && !countingAudience && audienceCount !== null && audienceCount > 0;

  useEffect(() => {
    if (!companyId || !audienceValid) {
      setAudienceCount(null);
      setAudienceCountError(null);
      return;
    }

    let cancelled = false;
    setCountingAudience(true);
    setAudienceCountError(null);
    countBroadcastAudience(companyId, selectedAudience)
      .then((total) => {
        if (!cancelled) setAudienceCount(total);
      })
      .catch((err) => {
        console.error('[Broadcasts] count audience error:', err);
        if (!cancelled) {
          setAudienceCount(null);
          setAudienceCountError('No se pudo calcular la audiencia real.');
        }
      })
      .finally(() => {
        if (!cancelled) setCountingAudience(false);
      });

    return () => { cancelled = true; };
  }, [companyId, audienceValid, audType, audValue]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = async () => {
    if (!companyId || !canSend) return;
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const r = await sendBroadcast(companyId, templateId, selectedAudience, vars);
      setResult(r);
      setConfirming(false);
      await loadAll();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al enviar.';
      setError(msg.replace(/^FirebaseError:\s*/, ''));
      setConfirming(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 overflow-y-auto">
      {/* Header */}
      <div className="px-5 py-4 border-b border-zinc-800">
        <h1 className="text-base font-semibold text-zinc-100">Envío masivo</h1>
        <p className="text-xs text-zinc-500 mt-0.5">
          Envía una plantilla aprobada a varios leads a la vez (campañas, reactivación, avisos).
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center p-12"><Spinner /></div>
      ) : (
        <div className="flex flex-col gap-6 p-5 max-w-2xl">
          {/* ── Composer ─────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            {/* Plantilla */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-400">Plantilla aprobada</label>
              {approved.length === 0 ? (
                <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                  No tienes plantillas aprobadas. Crea y aprueba una en la sección Plantillas.
                </p>
              ) : (
                <select
                  value={templateId}
                  onChange={(e) => { setTemplateId(e.target.value); setVars({}); setResult(null); }}
                  className="rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-violet-500/50"
                >
                  <option value="">— Selecciona —</option>
                  {approved.map((t) => (
                    <option key={t.id} value={t.id}>{t.displayName || t.name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Preview del cuerpo */}
            {selected && (
              <div className="text-xs text-zinc-400 bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-3 py-2 whitespace-pre-wrap">
                {selectedPreview}
              </div>
            )}

            {/* Variables manuales */}
            {manualVars.length > 0 && (
              <div className="flex flex-col gap-3">
                <p className="text-xs font-medium text-zinc-400">Variables</p>
                {manualVars.map((v) => (
                  <div key={v.key} className="flex flex-col gap-1">
                    <label className="text-[11px] text-zinc-500">{`{{${v.key}}}`}</label>
                    <input
                      type="text"
                      value={vars[v.key] ?? ''}
                      placeholder={v.example}
                      onChange={(e) => setVars((p) => ({ ...p, [v.key]: e.target.value }))}
                      className="rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50"
                    />
                  </div>
                ))}
                <p className="text-[10px] text-zinc-600">
                  Las variables <code>{'{{nombre}}'}</code> se rellenan automáticamente con el nombre de cada lead.
                </p>
              </div>
            )}

            {/* Audiencia */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-400">Audiencia</label>
              <div className="flex gap-2">
                <select
                  value={audType}
                  onChange={(e) => { setAudType(e.target.value as BroadcastAudience['type']); setAudValue(''); }}
                  className="rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-violet-500/50"
                >
                  <option value="all">Todos los leads</option>
                  <option value="status">Por estado</option>
                  <option value="tag">Por etiqueta</option>
                  <option value="list">Por lista</option>
                </select>

                {audType === 'status' && (
                  <select
                    value={audValue}
                    onChange={(e) => setAudValue(e.target.value)}
                    className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-violet-500/50"
                  >
                    <option value="">— Estado —</option>
                    {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                )}
                {audType === 'tag' && (
                  <select
                    value={audValue}
                    onChange={(e) => setAudValue(e.target.value)}
                    className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-violet-500/50"
                  >
                    <option value="">— Etiqueta —</option>
                    {tagOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
                {audType === 'list' && (
                  <select
                    value={audValue}
                    onChange={(e) => setAudValue(e.target.value)}
                    className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-violet-500/50"
                  >
                    <option value="">Lista</option>
                    {lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
                  </select>
                )}
              </div>
              <p className="text-[10px] text-zinc-600">
                {countingAudience
                  ? 'Calculando audiencia real...'
                  : audienceCountError
                    ? audienceCountError
                    : audienceCount === null
                      ? 'Selecciona una audiencia para calcular el total real.'
                      : `${audienceCount} leads cumplen este filtro en toda la base.`}
              </p>
            </div>

            {/* Error / resultado */}
            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
            )}
            {result && (
              <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                {result.queued
                  ? `Campaña encolada para ${result.total} leads. El envío se procesará por lotes.`
                  : `Enviado a ${result.sent}/${result.total}. `}
                {!result.queued && result.failed > 0 && `${result.failed} fallidos. `}
                {result.truncated && 'Se aplicó el tope de 1000 destinatarios.'}
              </p>
            )}

            {/* Botón / confirmación */}
            {!confirming ? (
              <Button onClick={() => { setError(null); setResult(null); setConfirming(true); }} disabled={!canSend}>
                Enviar masivamente
              </Button>
            ) : (
              <div className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="text-xs text-amber-200">
                  ¿Enviar la plantilla a {audienceCount ?? 0} leads? Esta acción no se puede deshacer.
                </p>
                <div className="flex gap-2">
                  <Button onClick={handleSend} loading={sending} className="flex-1">Confirmar envío</Button>
                  <button
                    onClick={() => setConfirming(false)}
                    disabled={sending}
                    className="px-4 rounded-lg text-xs border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Historial ────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-zinc-200">Historial de envíos</h2>
            {history.length === 0 ? (
              <p className="text-xs text-zinc-500">Aún no has hecho envíos masivos.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {history.map((b) => (
                  <BroadcastStatsCard key={b.id} broadcast={b} />
                ))}
                {false && history.map((b) => (
                  <div key={b.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-200 truncate">{b.templateName}</p>
                      <p className="text-[11px] text-zinc-500">
                        {b.audience.type === 'all' ? 'Todos' : `${b.audience.type}: ${b.audience.value}`}
                        {' · '}
                        {b.createdAt ? new Date(b.createdAt).toLocaleString('es-CO') : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="text-xs text-emerald-400">{b.sent} enviados</p>
                      {b.failed > 0 && <p className="text-[11px] text-red-400">{b.failed} fallidos</p>}
                      <p className="text-[10px] text-zinc-600 capitalize">{b.status}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function BroadcastStatsCard({ broadcast }: { broadcast: BroadcastRecord }) {
  const delivered = broadcast.delivered ?? 0;
  const read = broadcast.read ?? 0;
  const undelivered = broadcast.undelivered ?? 0;
  const confirmed = delivered + read + undelivered;
  const unconfirmed = Math.max(0, broadcast.sent - confirmed);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-zinc-200">{broadcast.templateName}</p>
          <p className="text-[11px] text-zinc-500">
            {broadcast.audience.type === 'all' ? 'Todos' : `${broadcast.audience.type}: ${broadcast.audience.value}`}
            {' - '}
            {broadcast.createdAt ? new Date(broadcast.createdAt).toLocaleString('es-CO') : ''}
          </p>
        </div>
        <p className="shrink-0 text-[10px] capitalize text-zinc-600">{broadcast.status}</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-6">
        <Stat label="Audiencia" value={broadcast.total} tone="text-zinc-300" />
        <Stat label="Enviados" value={broadcast.sent} tone="text-emerald-400" />
        <Stat label="Sin confirmar" value={unconfirmed} tone="text-amber-400" />
        <Stat label="Leidos" value={read} tone="text-sky-400" />
        <Stat label="No llegaron" value={undelivered} tone="text-orange-400" />
        <Stat label="No enviados" value={broadcast.failed} tone="text-red-400" />
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/50 px-2.5 py-2">
      <p className={`font-semibold ${tone}`}>{value}</p>
      <p className="mt-0.5 text-[10px] text-zinc-500">{label}</p>
    </div>
  );
}
