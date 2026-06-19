import { useState, useEffect } from 'react';
import { Spinner }   from '@/shared/components/Spinner';
import { Button }    from '@/shared/components/Button';
import { listTemplates, sendTemplateMessage } from '@/features/templates/services/templates.service';
import type { WhatsAppTemplate } from '@/features/templates/types';

interface TemplatePickerModalProps {
  companyId:  string;
  leadId:     string;
  onClose:    () => void;
  onSent:     () => void;
}

const CATEGORY_LABEL: Record<string, string> = {
  marketing:      '📣 Marketing',
  utility:        '🔧 Utilidad',
  authentication: '🔐 Autenticación',
};

const STATUS_COLOR: Record<string, string> = {
  approved: 'text-green-400 bg-green-500/10 border-green-500/20',
  local:    'text-zinc-400  bg-zinc-700/40  border-zinc-600/30',
  pending:  'text-amber-400 bg-amber-500/10 border-amber-500/20',
  rejected: 'text-red-400   bg-red-500/10   border-red-500/20',
};

/** Reemplaza {{variable}} por el valor del draft */
function fillTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

export function TemplatePickerModal({ companyId, leadId, onClose, onSent }: TemplatePickerModalProps) {
  const [templates, setTemplates]   = useState<WhatsAppTemplate[]>([]);
  const [loading,   setLoading]     = useState(true);
  const [selected,  setSelected]    = useState<WhatsAppTemplate | null>(null);
  const [variables, setVariables]   = useState<Record<string, string>>({});
  const [sending,   setSending]     = useState(false);
  const [error,     setError]       = useState<string | null>(null);

  useEffect(() => {
    listTemplates(companyId)
      .then((list) => { setTemplates(list); setLoading(false); })
      .catch(() => { setError('No se pudieron cargar las plantillas.'); setLoading(false); });
  }, [companyId]);

  const handleSelect = (t: WhatsAppTemplate) => {
    setSelected(t);
    // Pre-rellenar con los ejemplos
    const init: Record<string, string> = {};
    t.variables.forEach((v) => { init[v.key] = ''; });
    setVariables(init);
    setError(null);
  };

  const handleSend = async () => {
    if (!selected) return;
    setSending(true);
    setError(null);
    try {
      await sendTemplateMessage(companyId, leadId, selected.id, variables);
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
  const canSend = !!selected && !sending &&
    selected.variables.every((v) => variables[v.key]?.trim());

  return (
    /* Overlay */
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative z-10 w-full max-w-xl bg-zinc-900 rounded-2xl border border-zinc-800 shadow-2xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Enviar plantilla</h3>
            <p className="text-xs text-zinc-500 mt-0.5">Mensajes pre-aprobados por Meta/WhatsApp</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">✕</button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Lista de plantillas */}
          <div className="w-52 shrink-0 border-r border-zinc-800 overflow-y-auto">
            {loading && (
              <div className="flex justify-center p-6"><Spinner /></div>
            )}
            {!loading && templates.length === 0 && (
              <div className="p-4 text-center">
                <p className="text-xs text-zinc-500">Sin plantillas.</p>
                <p className="text-xs text-zinc-600 mt-1">Crea una en Config → Plantillas</p>
              </div>
            )}
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => handleSelect(t)}
                className={`
                  w-full text-left px-4 py-3 border-b border-zinc-800/60 transition-colors
                  hover:bg-zinc-800/50
                  ${selected?.id === t.id ? 'bg-zinc-800 border-l-2 border-l-violet-500' : ''}
                `}
              >
                <p className="text-xs font-medium text-zinc-100 truncate">{t.displayName}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">{CATEGORY_LABEL[t.category]}</p>
                <span className={`mt-1 inline-flex text-[9px] px-1.5 py-0.5 rounded-full border ${STATUS_COLOR[t.status]}`}>
                  {t.status}
                </span>
              </button>
            ))}
          </div>

          {/* Panel derecho: variables + preview */}
          <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
            {!selected ? (
              <div className="flex flex-col items-center justify-center h-full text-center gap-2">
                <span className="text-3xl">📋</span>
                <p className="text-sm text-zinc-400">Selecciona una plantilla</p>
                <p className="text-xs text-zinc-600">para ver las variables y el preview</p>
              </div>
            ) : (
              <>
                {/* Variables */}
                {selected.variables.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Variables</p>
                    {selected.variables.map((v) => (
                      <div key={v.key} className="flex flex-col gap-1">
                        <label className="text-xs text-zinc-400">
                          {`{{${v.key}}}`}
                          <span className="text-zinc-600 ml-1">ej: {v.example}</span>
                        </label>
                        <input
                          type="text"
                          value={variables[v.key] ?? ''}
                          onChange={(e) => setVariables((prev) => ({ ...prev, [v.key]: e.target.value }))}
                          placeholder={v.example}
                          className="
                            rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2
                            text-sm text-zinc-100 placeholder-zinc-600
                            focus:outline-none focus:border-violet-500/50 transition-colors
                          "
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Preview */}
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Preview</p>
                  <div className="rounded-xl bg-zinc-800/60 border border-zinc-700 p-4">
                    {selected.header && (
                      <p className="text-xs font-semibold text-zinc-200 mb-2">{selected.header}</p>
                    )}
                    <p className="text-sm text-zinc-100 whitespace-pre-wrap leading-relaxed">
                      {preview}
                    </p>
                    {selected.footer && (
                      <p className="text-xs text-zinc-500 mt-2 italic">{selected.footer}</p>
                    )}
                  </div>
                </div>

                {/* Error */}
                {error && (
                  <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        {selected && (
          <div className="px-5 py-4 border-t border-zinc-800 flex items-center justify-between shrink-0">
            <p className="text-xs text-zinc-500">
              {selected.status === 'approved'
                ? '✅ Aprobada por Meta — puede enviarse fuera de la ventana de 24h'
                : '⚠️ Solo funciona dentro de la ventana de 24h hasta ser aprobada'
              }
            </p>
            <Button onClick={handleSend} disabled={!canSend} loading={sending} size="sm">
              Enviar
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
