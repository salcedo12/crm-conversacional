import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Search, Download, MessageSquare, Users } from 'lucide-react';
import { Spinner } from '@/shared/components/Spinner';
import { getMarketingAdLeads, type AdContact, type MarketingWindow } from '../services/marketing.service';

const STATUS_META: Record<string, { label: string; cls: string }> = {
  new:       { label: 'Nuevo',      cls: 'border-zinc-600 bg-zinc-800 text-zinc-300' },
  active:    { label: 'Activo',     cls: 'border-sky-500/30 bg-sky-500/10 text-sky-300' },
  qualified: { label: 'Calificado', cls: 'border-violet-500/30 bg-violet-500/10 text-violet-300' },
  scheduled: { label: 'Agendado',   cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  closed:    { label: 'Vendido',    cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  lost:      { label: 'Perdido',    cls: 'border-red-500/30 bg-red-500/10 text-red-300' },
};

const LOSS_LABEL: Record<string, string> = {
  precio: 'Precio', ubicacion: 'Ubicación', competencia: 'Competencia',
  sin_respuesta: 'No respondió', tiempo: 'No es el momento', no_califica: 'No califica',
  atencion: 'Atención', otro: 'Otro',
};

const fmtDate = (ms: number | null) =>
  ms ? new Date(ms).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

function scoreColor(score: number): string {
  return score >= 66 ? 'text-emerald-400' : score >= 33 ? 'text-amber-400' : score > 0 ? 'text-sky-400' : 'text-zinc-600';
}

/** Descarga los contactos como CSV (separador ; y BOM para que Excel en español lo abra bien). */
function downloadCsv(rows: AdContact[], filename: string) {
  const header = ['Nombre', 'Teléfono', 'Correo', 'Estado', 'Score', 'Motivo pérdida', 'Asesor', 'Anuncio', 'Campaña', 'Formulario', 'Entró', 'Último mensaje'];
  const esc = (v: string | number | null) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((c) => [
    c.name, c.phone, c.email, STATUS_META[c.status]?.label ?? c.status, c.score,
    c.lossCategory ? (LOSS_LABEL[c.lossCategory] ?? c.lossCategory) : null,
    c.advisorName, c.adName, c.campaignName, c.formName,
    c.createdAt ? new Date(c.createdAt).toLocaleString('es-CO') : null,
    c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleString('es-CO') : null,
  ].map(esc).join(';'));
  const blob = new Blob(['﻿' + [header.join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface Props {
  companyId: string;
  win:       MarketingWindow;
  adKeys:    string[];
  title:     string;
  subtitle?: string | null;
  /** true = varios anuncios (campaña): muestra la columna de anuncio. */
  multiAd?:  boolean;
  onClose:   () => void;
}

export function AdContactsModal({ companyId, win, adKeys, title, subtitle, multiAd, onClose }: Props) {
  const [contacts, setContacts] = useState<AdContact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    let cancelled = false;
    getMarketingAdLeads(companyId, win, adKeys)
      .then((rows) => { if (!cancelled) setContacts(rows); })
      .catch((err) => {
        console.error('[Marketing] contactos del anuncio:', err);
        if (!cancelled) setError('No se pudieron cargar los contactos.');
      });
    return () => { cancelled = true; };
  }, [companyId, win, adKeys]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const statusCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of contacts ?? []) m.set(c.status, (m.get(c.status) ?? 0) + 1);
    return m;
  }, [contacts]);

  const filtered = useMemo(() => {
    let rows = contacts ?? [];
    if (statusFilter !== 'all') rows = rows.filter((c) => c.status === statusFilter);
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter((c) =>
        [c.name, c.phone, c.email, c.advisorName, c.adName].some((v) => v?.toLowerCase().includes(q)));
    }
    return rows;
  }, [contacts, statusFilter, query]);

  const fileName = `contactos-${title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 50) || 'anuncio'}.csv`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Encabezado */}
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <Users size={15} className="shrink-0 text-violet-400" />
              <span className="truncate" title={title}>{title}</span>
            </h2>
            {subtitle && <p className="mt-0.5 truncate text-[11px] text-zinc-500" title={subtitle}>{subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {contacts && contacts.length > 0 && (
              <button
                onClick={() => downloadCsv(filtered, fileName)}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
              >
                <Download size={13} /> Exportar CSV
              </button>
            )}
            <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200" aria-label="Cerrar">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Filtros */}
        {contacts && contacts.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-5 py-3">
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar nombre, teléfono, asesor…"
                className="h-8 w-60 rounded-md border border-zinc-700 bg-zinc-800 pl-8 pr-2 text-xs text-zinc-100 outline-none focus:border-violet-500/60"
              />
            </div>
            <div className="flex flex-wrap gap-1 rounded-lg border border-zinc-800 p-0.5">
              <button
                onClick={() => setStatusFilter('all')}
                className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${statusFilter === 'all' ? 'bg-violet-600/25 text-violet-300' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                Todos ({contacts.length})
              </button>
              {Object.keys(STATUS_META).filter((s) => statusCounts.has(s)).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${statusFilter === s ? 'bg-violet-600/25 text-violet-300' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  {STATUS_META[s].label} ({statusCounts.get(s)})
                </button>
              ))}
            </div>
            <span className="text-[11px] text-zinc-600">{filtered.length} contactos</span>
          </div>
        )}

        {/* Cuerpo */}
        <div className="min-h-0 flex-1 overflow-auto">
          {error ? (
            <p className="p-10 text-center text-sm text-red-400">{error}</p>
          ) : !contacts ? (
            <div className="flex justify-center p-12"><Spinner /></div>
          ) : contacts.length === 0 ? (
            <p className="p-10 text-center text-sm text-zinc-500">Este anuncio no tiene contactos en el periodo seleccionado.</p>
          ) : filtered.length === 0 ? (
            <p className="p-10 text-center text-sm text-zinc-500">Ningún contacto coincide con el filtro.</p>
          ) : (
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead className="sticky top-0 bg-zinc-950">
                <tr className="border-b border-zinc-800 text-left text-[10px] uppercase text-zinc-500">
                  <th className="px-4 py-2 font-semibold">Contacto</th>
                  <th className="px-3 py-2 font-semibold">Estado</th>
                  <th className="px-3 py-2 text-right font-semibold">Score</th>
                  <th className="px-3 py-2 font-semibold">Asesor</th>
                  {multiAd && <th className="px-3 py-2 font-semibold">Anuncio</th>}
                  <th className="px-3 py-2 font-semibold">Formulario</th>
                  <th className="px-3 py-2 font-semibold">Entró</th>
                  <th className="px-3 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => <ContactRow key={c.id} c={c} multiAd={!!multiAd} />)}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function ContactRow({ c, multiAd }: { c: AdContact; multiAd: boolean }) {
  const st = STATUS_META[c.status];
  const digits = c.phone?.replace(/\D/g, '') ?? '';
  return (
    <tr className="border-b border-zinc-800/60 hover:bg-zinc-900">
      <td className="px-4 py-2.5">
        <p className="max-w-[220px] truncate text-xs text-zinc-200" title={c.name ?? ''}>{c.name || 'Sin nombre'}</p>
        <p className="mt-0.5 text-[11px] tabular-nums text-zinc-500">
          {digits ? (
            <a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" className="hover:text-emerald-300">{c.phone}</a>
          ) : (c.channel !== 'whatsapp' ? c.channel : 'Sin teléfono')}
          {c.email && <span className="ml-2 text-zinc-600">{c.email}</span>}
        </p>
      </td>
      <td className="px-3 py-2.5">
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${st?.cls ?? 'border-zinc-700 text-zinc-400'}`}>
          {st?.label ?? c.status}
        </span>
        {c.lossCategory && c.lossCategory !== 'ninguno' && (
          <p className="mt-0.5 text-[10px] text-red-300/80">{LOSS_LABEL[c.lossCategory] ?? c.lossCategory}</p>
        )}
      </td>
      <td className={`px-3 py-2.5 text-right text-xs font-semibold tabular-nums ${c.score != null ? scoreColor(c.score) : 'text-zinc-600'}`}>
        {c.score ?? '—'}
      </td>
      <td className="px-3 py-2.5 text-xs text-zinc-400">
        <span className="block max-w-[140px] truncate" title={c.advisorName ?? ''}>{c.advisorName ?? '—'}</span>
      </td>
      {multiAd && (
        <td className="px-3 py-2.5 text-xs text-zinc-400">
          <span className="block max-w-[180px] truncate" title={c.adName ?? ''}>{c.adName ?? '—'}</span>
        </td>
      )}
      <td className="px-3 py-2.5 text-xs text-zinc-500">
        <span className="block max-w-[150px] truncate" title={c.formName ?? ''}>{c.formName ?? 'Chat (WhatsApp)'}</span>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-[11px] tabular-nums text-zinc-500">{fmtDate(c.createdAt)}</td>
      <td className="px-3 py-2.5 text-right">
        <Link
          to={`/dashboard/inbox?lead=${c.id}`}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:border-violet-500/50 hover:text-violet-300"
          title="Abrir la conversación"
        >
          <MessageSquare size={12} /> Chat
        </Link>
      </td>
    </tr>
  );
}
