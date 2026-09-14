import { useState } from 'react';
import {
  FileSearch, Loader2, RefreshCw, Building2, MessageSquare, PhoneOff, Hourglass,
  AlertTriangle, CheckCircle2, ArrowRight, Sparkles, NotebookPen, Cog,
} from 'lucide-react';
import { generateLeadDossier, type LeadDossier } from '../services/leadDossier.service';
import type { Lead } from '@/features/inbox/types';

interface Props {
  lead:      Lead;
  companyId: string;
}

const STATUS_LABEL: Record<string, string> = {
  new: 'Nuevo', active: 'Activo', qualified: 'Calificado',
  scheduled: 'Agendado', lost: 'Perdido', closed: 'Vendido',
};

function fmtMin(min: number | null): string {
  if (min === null || min === undefined) return '—';
  if (min < 60) return `${min} min`;
  if (min < 1440) { const h = Math.floor(min / 60), m = min % 60; return m ? `${h} h ${m} min` : `${h} h`; }
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
}

function fmtEventDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 16);
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: '2-digit' });
}

export function LeadDossierCard({ lead, companyId }: Props) {
  const [dossier, setDossier] = useState<LeadDossier | null>(null);
  const [loading, setLoading] = useState(false);
  const [withAi, setWithAi] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      setDossier(await generateLeadDossier(companyId, lead.id, withAi));
    } catch (err) {
      console.error('[LeadDossierCard] error:', err);
      setError('No se pudo generar la radiografía en este momento.');
    } finally {
      setLoading(false);
    }
  };

  // ── Estado vacío ─────────────────────────────────────────────────────────────
  if (!dossier) {
    return (
      <div className="rounded-lg border border-sky-500/20 bg-sky-500/[0.04] px-4 py-5 text-center">
        <FileSearch size={22} className="mx-auto text-sky-300" />
        <p className="mt-2 text-sm font-medium text-zinc-200">Radiografía CRM + SmartHome</p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          Cruza lo que pasó en el CRM (respuestas, tiempos, primer contacto) con el
          seguimiento del cliente en SmartHome (llamadas, visitas, etapa). No se guarda:
          se genera en el momento.
        </p>
        <label className="mt-3 inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-400">
          <input type="checkbox" checked={withAi} onChange={(e) => setWithAi(e.target.checked)} className="accent-violet-500" />
          Incluir resumen con IA <span className="text-zinc-600">(usa OpenAI)</span>
        </label>
        <div>
          <button
            onClick={run}
            disabled={loading}
            className="mt-3 inline-flex items-center gap-2 rounded-md border border-sky-500/40 bg-sky-500/15 px-3.5 py-2 text-xs font-medium text-sky-200 transition-colors hover:bg-sky-500/25 disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <FileSearch size={14} />}
            {loading ? 'Generando…' : 'Generar radiografía'}
          </button>
        </div>
        {error && <p className="mt-3 text-[11px] text-red-300">{error}</p>}
      </div>
    );
  }

  const { crm, smartHome, ai } = dossier;

  return (
    <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-800/30 px-4 py-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-500">
          Generado {new Date(dossier.generatedAt).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · no guardado
        </span>
        <button
          onClick={run}
          disabled={loading}
          title="Regenerar"
          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </button>
      </div>

      {/* ── CRM ─────────────────────────────────────────────────────────────── */}
      <section>
        <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-zinc-500">
          <MessageSquare size={12} className="text-violet-400" /> En el CRM
        </p>
        <div className="space-y-1.5">
          {crm.flags.map((f, i) => {
            const bad = /nunca|esperando|sin actividad|lento|madrugada/i.test(f);
            const Icon = /nunca/i.test(f) ? PhoneOff : /esperando/i.test(f) ? Hourglass : bad ? AlertTriangle : CheckCircle2;
            return (
              <p key={i} className={`flex items-start gap-1.5 text-[11px] leading-relaxed ${bad ? 'text-amber-300' : 'text-emerald-300'}`}>
                <Icon size={12} className="mt-0.5 shrink-0" /> {f}
              </p>
            );
          })}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3">
          <Fact label="Estado" value={STATUS_LABEL[crm.status] ?? crm.status} />
          <Fact label="Asesor" value={crm.advisorName} />
          <Fact label="Entró" value={crm.createdHour >= 0 ? `${crm.createdHour}:00${crm.nightLead ? ' 🌙' : ''}` : '—'} />
          <Fact label="Mensajes del asesor" value={String(crm.advisorMsgCount)} />
          <Fact label="Resp. promedio" value={fmtMin(crm.avgResponseMin)} />
          <Fact label="1er contacto" value={crm.firstContactAt ? new Date(crm.firstContactAt).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : 'Nunca'} />
        </div>
      </section>

      {/* ── SmartHome ───────────────────────────────────────────────────────── */}
      <section className="border-t border-zinc-800 pt-3">
        <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-zinc-500">
          <Building2 size={12} className="text-sky-400" /> En SmartHome
        </p>
        {smartHome.error ? (
          <p className="text-[11px] text-red-300">No se pudo consultar SmartHome ahora. Intenta regenerar.</p>
        ) : !smartHome.found ? (
          <p className="text-[11px] text-zinc-500">Este cliente no aparece en SmartHome (no se ha creado allí o el teléfono no coincide).</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3">
              <Fact label="Etapa" value={smartHome.stage ?? '—'} />
              <Fact label="Asesor SmartHome" value={smartHome.advisor ?? '—'} />
              <Fact label="Seguimientos" value={String(smartHome.followUps)} tone={smartHome.followUps === 0 ? 'text-red-300' : 'text-emerald-300'} />
              {smartHome.score != null && <Fact label="Score cliente" value={String(smartHome.score)} />}
              {smartHome.probability != null && <Fact label="Probabilidad" value={`${smartHome.probability}%`} />}
              {smartHome.saleCycle && <Fact label="Ciclo" value={smartHome.saleCycle} />}
            </div>
            {smartHome.followUps === 0 && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-red-300">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" /> El asesor no ha registrado ningún seguimiento en SmartHome.
              </p>
            )}
            {smartHome.actions.length > 0 && (
              <div className="mt-2">
                <p className="mb-1 text-[10px] uppercase text-zinc-500">Acciones registradas</p>
                <div className="flex flex-wrap gap-1.5">
                  {smartHome.actions.map((a) => (
                    <span key={a.label} className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-[10px] text-zinc-300">
                      {a.label} <span className="tabular-nums text-zinc-500">×{a.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Bitácora real (texto de cada nota) */}
            {smartHome.events.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase text-zinc-500">
                  <NotebookPen size={11} /> Bitácora SmartHome
                  <span className="ml-1 normal-case text-zinc-600">
                    {smartHome.advisorNotes} nota{smartHome.advisorNotes === 1 ? '' : 's'} de asesor · {smartHome.events.length} eventos
                  </span>
                </p>
                <ol className="max-h-64 space-y-2 overflow-y-auto border-l border-zinc-800 pl-3">
                  {smartHome.events.map((e, i) => (
                    <li key={i} className="relative">
                      <span className={`absolute -left-[15px] top-1 h-1.5 w-1.5 rounded-full ${e.system ? 'bg-zinc-600' : 'bg-sky-400'}`} />
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${e.system ? 'text-zinc-500' : 'text-sky-300'}`}>
                          {e.system ? <Cog size={9} /> : <NotebookPen size={9} />} {e.action || (e.system ? 'Sistema' : 'Nota')}
                        </span>
                        <span className="text-[9px] text-zinc-600">{fmtEventDate(e.date)}</span>
                      </div>
                      <p className={`mt-0.5 text-[11px] leading-relaxed ${e.system ? 'text-zinc-500' : 'text-zinc-300'}`}>{e.content}</p>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── IA (opcional) ───────────────────────────────────────────────────── */}
      {ai && (
        <section className="border-t border-zinc-800 pt-3">
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-zinc-500">
            <Sparkles size={12} className="text-violet-400" /> Resumen IA
          </p>
          <p className="text-xs leading-relaxed text-zinc-300">{ai.summary}</p>
          {ai.nextAction && (
            <div className="mt-2 rounded-md border border-violet-500/25 bg-violet-500/[0.06] px-3 py-2">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-violet-300">
                <ArrowRight size={12} /> Próximo paso
              </p>
              <p className="mt-1 text-xs font-medium text-zinc-100">{ai.nextAction}</p>
            </div>
          )}
        </section>
      )}

      {error && <p className="text-[11px] text-red-300">{error}</p>}
    </div>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md bg-zinc-800/40 px-2 py-1.5">
      <p className="text-[9px] uppercase text-zinc-500">{label}</p>
      <p className={`mt-0.5 truncate text-[11px] font-medium ${tone ?? 'text-zinc-200'}`} title={value}>{value}</p>
    </div>
  );
}
