import { useState, useEffect, useMemo } from 'react';
import {
  Search, ArrowLeft, Send, CheckCircle2, AlertTriangle,
  LayoutTemplate
} from 'lucide-react';
import { Spinner }   from '@/shared/components/Spinner';
import { useAuth }   from '@/features/auth/hooks/useAuth';
import { inboxLabel }  from '@/features/inbox/utils/inboxes';
import { listTemplates, sendTemplateMessage, listMessagingLines, type MessagingLine } from '@/features/templates/services/templates.service';
import type { WhatsAppTemplate } from '@/features/templates/types';

interface TemplatePickerModalProps {
  companyId:  string;
  leadId:     string;
  /** Inbox del lead: línea por defecto y filtro inicial de plantillas. */
  inboxId?:   string | null;
  onClose:    () => void;
  onSent:     () => void;
}

const CATEGORY_LABEL: Record<string, string> = {
  marketing:      '📣 Marketing',
  utility:        '⚙️ Utilidad / Servicio',
  authentication: '🔐 Autenticación',
};

const STATUS_INFO: Record<string, { label: string; className: string }> = {
  approved: {
    label: '✓ Aprobada Meta',
    className: 'text-emerald-700 bg-emerald-50 border-emerald-200/80 dark:text-emerald-300 dark:bg-emerald-950/40 dark:border-emerald-500/30',
  },
  local: {
    label: 'Borrador Local',
    className: 'text-zinc-500 bg-zinc-100 border-zinc-200 dark:text-zinc-400 dark:bg-zinc-800/60 dark:border-zinc-700/60',
  },
  pending: {
    label: '⏳ En Revisión Meta',
    className: 'text-amber-800 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-500/30',
  },
  rejected: {
    label: '✕ Rechazada',
    className: 'text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-300 dark:bg-rose-950/40 dark:border-rose-500/30',
  },
};

/** Solo dígitos, para comparar números +E.164 sin depender del formato. */
const digits = (value?: string | null) => (value ?? '').replace(/\D/g, '');

/** Reemplaza {{variable}} por el valor del draft */
function fillTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

export function TemplatePickerModal({ companyId, leadId, inboxId, onClose, onSent }: TemplatePickerModalProps) {
  const { user } = useAuth();
  const uid = user?.uid;

  const [allTemplates, setAllTemplates] = useState<WhatsAppTemplate[]>([]);
  const [lines,        setLines]        = useState<MessagingLine[]>([]);
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [selected,     setSelected]     = useState<WhatsAppTemplate | null>(null);
  const [variables,    setVariables]    = useState<Record<string, string>>({});
  const [sending,      setSending]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [search,       setSearch]       = useState('');
  /** En móvil: 'list' muestra la lista completa de plantillas, 'preview' muestra el detalle */
  const [mobileView,   setMobileView]   = useState<'list' | 'preview'>('list');

  // Línea por defecto (317) y línea de coexistencia del asesor logueado (si tiene).
  const defaultLine = useMemo(() => lines.find((l) => l.isDefault) ?? null, [lines]);
  const myLine      = useMemo(() => (uid ? lines.find((l) => l.advisorId === uid) : null) ?? null, [lines, uid]);
  const canChoose   = !!myLine && !!defaultLine;

  useEffect(() => {
    Promise.all([
      listTemplates(companyId).catch(() => [] as WhatsAppTemplate[]),
      listMessagingLines(companyId).catch(() => [] as MessagingLine[]),
    ])
      .then(([tpls, lns]) => {
        setAllTemplates(tpls);
        setLines(lns);
        const mine = uid ? lns.find((l) => l.advisorId === uid) : undefined;
        const def  = lns.find((l) => l.isDefault);
        const initial = mine && digits(inboxId) === digits(mine.number)
          ? mine.number
          : (def?.number ?? mine?.number ?? null);
        setSelectedLine(initial);
        setLoading(false);
      })
      .catch(() => { setError('No se pudieron cargar las plantillas.'); setLoading(false); });
  }, [companyId, uid, inboxId]);

  const activeLineNumber = canChoose ? selectedLine : (inboxId ?? null);

  const templates = useMemo(() => {
    const byLine = allTemplates.filter((t) => !activeLineNumber || !t.lineNumber || digits(t.lineNumber) === digits(activeLineNumber));
    if (!search.trim()) return byLine;
    const q = search.toLowerCase();
    return byLine.filter(
      (t) =>
        t.displayName.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q) ||
        (t.category && t.category.toLowerCase().includes(q))
    );
  }, [allTemplates, activeLineNumber, search]);

  const changeLine = (num: string) => {
    if (num === selectedLine) return;
    setSelectedLine(num);
    setSelected(null);
    setVariables({});
    setError(null);
    setMobileView('list');
  };

  const handleSelect = (t: WhatsAppTemplate) => {
    setSelected(t);
    const init: Record<string, string> = {};
    t.variables.forEach((v) => { init[v.key] = ''; });
    setVariables(init);
    setError(null);
    setMobileView('preview'); // En celular pasa inmediatamente a la vista previa amplia
  };

  const handleSend = async () => {
    if (!selected) return;
    setSending(true);
    setError(null);
    try {
      await sendTemplateMessage(companyId, leadId, selected.id, variables, canChoose ? selectedLine ?? undefined : undefined);
      onSent();
      onClose();
    } catch (err) {
      const msg = (err as { message?: string })?.message;
      setError(msg || 'Error al enviar la plantilla. Verifica que esté aprobada por Meta.');
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  const preview = selected ? fillTemplate(selected.body, variables) : '';
  const canSend = !!selected && !sending && selected.variables.every((v) => variables[v.key]?.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-sm overflow-hidden" onClick={onClose}>
      <div
        className="relative z-10 w-full max-w-4xl h-dvh sm:h-[88vh] sm:max-h-[760px] bg-zinc-950 sm:rounded-3xl border-0 sm:border border-zinc-800 shadow-2xl flex flex-col text-zinc-100 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Principal */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] sm:py-3.5 sm:pt-3.5 border-b border-zinc-800 bg-zinc-900/80 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {mobileView === 'preview' && (
              <button
                type="button"
                onClick={() => setMobileView('list')}
                className="sm:hidden p-1.5 -ml-1 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
                title="Volver a la lista"
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold text-zinc-100 flex items-center gap-2 truncate">
                <LayoutTemplate size={16} className="text-amber-500 shrink-0" />
                <span className="truncate">Enviar Plantilla de WhatsApp</span>
              </h3>
              <p className="text-[11px] text-zinc-400 truncate">Mensajes oficiales pre-aprobados por Meta</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center rounded-xl bg-zinc-800/80 hover:bg-zinc-800 text-zinc-200 hover:text-white transition-colors cursor-pointer text-base sm:text-sm font-bold shrink-0 shadow-sm active:scale-95"
            aria-label="Cerrar modal"
          >
            ✕
          </button>
        </div>

        {/* Barra de Línea de Envío */}
        <div className="px-4 sm:px-6 py-2 bg-zinc-900/40 border-b border-zinc-800/80 flex items-center justify-between gap-3 text-xs shrink-0 flex-wrap">
          {canChoose ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-zinc-400 font-medium">Línea de salida:</span>
              <div className="flex rounded-lg border border-zinc-700 bg-zinc-900 p-0.5">
                {[defaultLine, myLine].map((line) => {
                  if (!line) return null;
                  const active = digits(selectedLine) === digits(line.number);
                  return (
                    <button
                      key={line.number}
                      type="button"
                      onClick={() => changeLine(line.number)}
                      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                        active
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <span>{line.isDefault ? '🏢' : '📱'}</span>
                      <span>{line.isDefault ? 'Ventas 317' : 'Mi WhatsApp'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : activeLineNumber ? (
            <div className="flex items-center gap-2 text-[11px] text-zinc-400">
              <span>Se enviará desde:</span>
              <span className="font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                🏢 {inboxLabel(activeLineNumber)}
              </span>
            </div>
          ) : null}

          {/* Contador de plantillas */}
          <span className="text-[11px] text-zinc-500 ml-auto hidden sm:inline">
            {templates.length} plantilla(s) disponible(s)
          </span>
        </div>

        {/* Cuerpo Principal del Modal */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* ── COLUMNA IZQUIERDA: Lista de Plantillas ─────────────────────────────── */}
          <div
            className={`
              w-full sm:w-72 md:w-80 border-r border-zinc-800/90 flex flex-col shrink-0 bg-zinc-950 sm:bg-zinc-900/30
              ${mobileView === 'list' ? 'flex' : 'hidden sm:flex'}
            `}
          >
            {/* Buscador de plantillas */}
            <div className="p-3 border-b border-zinc-800/80 bg-zinc-900/50">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar plantilla..."
                  className="w-full rounded-xl bg-zinc-900 border border-zinc-700/80 pl-8 pr-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500/60"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hover:text-white"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Listado con scroll */}
            <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/50">
              {loading && (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-zinc-500 text-xs">
                  <Spinner />
                  <span>Cargando plantillas de Meta...</span>
                </div>
              )}

              {!loading && templates.length === 0 && (
                <div className="p-6 text-center text-zinc-500">
                  <p className="text-2xl mb-1">🔍</p>
                  <p className="text-xs font-medium text-zinc-300">No hay plantillas que coincidan</p>
                  <p className="text-[11px] text-zinc-500 mt-1">Intenta con otra búsqueda o cambia de línea.</p>
                </div>
              )}

              {templates.map((t) => {
                const isSelected = selected?.id === t.id;
                const status = STATUS_INFO[t.status] || STATUS_INFO.local;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleSelect(t)}
                    className={`
                      w-full text-left p-3.5 transition-all cursor-pointer flex flex-col gap-1.5
                      ${isSelected
                        ? 'bg-amber-500/10 border-l-4 border-l-amber-500 text-zinc-100'
                        : 'hover:bg-zinc-800/50 text-zinc-300'
                      }
                    `}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-xs font-bold leading-snug line-clamp-2 ${isSelected ? 'text-amber-400' : 'text-zinc-100'}`}>
                        {t.displayName}
                      </p>
                      <span className={`shrink-0 inline-flex text-[9px] px-1.5 py-0.5 rounded-full border font-mono ${status.className}`}>
                        {status.label}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[10px] text-zinc-400">
                      <span>{CATEGORY_LABEL[t.category] || t.category}</span>
                      {t.variables.length > 0 && (
                        <span>• {t.variables.length} var</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── COLUMNA DERECHA: Vista Previa y Variables ──────────────────────────── */}
          <div
            className={`
              flex-1 flex-col overflow-y-auto bg-zinc-950 p-4 sm:p-6
              ${mobileView === 'preview' ? 'flex' : 'hidden sm:flex'}
            `}
          >
            {!selected ? (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-16 text-zinc-500">
                <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-3xl">
                  📑
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-300">Selecciona una plantilla de la lista</p>
                  <p className="text-xs text-zinc-500 mt-0.5 max-w-xs">
                    Podrás ver la vista previa real como llegará al celular del prospecto y completar las variables antes de enviar.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-5 max-w-xl mx-auto w-full">
                {/* Botón Volver en móvil */}
                <div className="sm:hidden flex items-center justify-between pb-2 border-b border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setMobileView('list')}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-400 hover:text-amber-300 py-1"
                  >
                    <ArrowLeft size={15} />
                    <span>← Elegir otra plantilla</span>
                  </button>
                  <span className={`inline-flex text-[10px] px-2 py-0.5 rounded-full border font-mono ${STATUS_INFO[selected.status]?.className}`}>
                    {STATUS_INFO[selected.status]?.label}
                  </span>
                </div>

                {/* Título de la plantilla seleccionada */}
                <div>
                  <h4 className="text-sm sm:text-base font-bold text-zinc-100 flex items-center gap-2">
                    <span>{selected.displayName}</span>
                  </h4>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Categoría: <strong className="text-zinc-300">{CATEGORY_LABEL[selected.category] || selected.category}</strong>
                  </p>
                </div>

                {/* Formulario de Variables */}
                {selected.variables.length > 0 && (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-3.5 space-y-3">
                    <p className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                      <span>✏️</span> Variables requeridas ({selected.variables.length})
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {selected.variables.map((v) => (
                        <div key={v.key} className="space-y-1">
                          <label className="text-[11px] font-medium text-zinc-400 block truncate">
                            {`{{${v.key}}}`} {v.example && <span className="text-zinc-500">(ej: {v.example})</span>}
                          </label>
                          <input
                            type="text"
                            value={variables[v.key] ?? ''}
                            onChange={(e) => setVariables((prev) => ({ ...prev, [v.key]: e.target.value }))}
                            placeholder={v.example || `Valor para {{${v.key}}}`}
                            className="w-full rounded-xl bg-zinc-950 border border-zinc-700/80 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Simulación Real de Burbuja de WhatsApp */}
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-3.5 sm:p-4 space-y-2">
                  <div className="flex items-center justify-between pb-1.5 border-b border-zinc-800/60">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                      <span>📱</span> Vista Previa en el WhatsApp del Cliente
                    </span>
                    <span className="text-[10px] font-mono text-zinc-500">
                      Formato Oficial Meta
                    </span>
                  </div>

                  {/* Burbuja WhatsApp */}
                  <div className="max-w-md mx-auto rounded-2xl p-4 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-md border border-zinc-200 dark:border-zinc-800 space-y-2.5">
                    {selected.header && (
                      <div className="font-bold text-xs sm:text-sm text-zinc-900 dark:text-zinc-100 pb-1.5 border-b border-zinc-100 dark:border-zinc-800/80">
                        {selected.header}
                      </div>
                    )}
                    <p className="text-xs sm:text-sm whitespace-pre-wrap leading-relaxed text-zinc-800 dark:text-zinc-200">
                      {preview}
                    </p>
                    {selected.footer && (
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 italic pt-1 border-t border-zinc-100 dark:border-zinc-800/50">
                        {selected.footer}
                      </p>
                    )}
                    <div className="flex items-center justify-end gap-1 text-[10px] text-zinc-400 dark:text-zinc-500 pt-0.5">
                      <span>Ahora</span>
                      <span className="text-sky-500 font-bold">✓✓</span>
                    </div>
                  </div>
                </div>

                {/* Mensaje de Error */}
                {error && (
                  <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-500/40 text-rose-200 text-xs flex items-start gap-2">
                    <AlertTriangle size={15} className="text-rose-400 shrink-0 mt-0.5" />
                    <p className="leading-relaxed">{error}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── FOOTER DE ACCIÓN ────────────────────────────────────────────── */}
        {selected && (
          <div className="px-4 sm:px-6 py-3 border-t border-zinc-800/90 bg-zinc-900/90 backdrop-blur-md flex items-center justify-between gap-3 shrink-0 flex-wrap pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="flex items-center gap-2 text-xs text-zinc-400 max-w-sm">
              {selected.status === 'approved' ? (
                <>
                  <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                  <span className="text-[11px] leading-tight">
                    Plantilla aprobada por Meta. Puede enviarse <strong>fuera de las 24 horas</strong>.
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle size={16} className="text-amber-400 shrink-0" />
                  <span className="text-[11px] leading-tight">
                    Solo puede enviarse mientras la <strong>ventana de 24h esté activa</strong>.
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                className="py-2.5 px-5 bg-gradient-to-r from-amber-600 via-amber-500 to-amber-600 hover:from-amber-500 hover:to-amber-400 text-white font-bold rounded-xl text-xs sm:text-sm transition-all shadow-lg flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.99]"
              >
                {sending ? (
                  <>
                    <Spinner size="sm" />
                    <span>Enviando por WhatsApp...</span>
                  </>
                ) : (
                  <>
                    <Send size={14} />
                    <span>Enviar Plantilla</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
