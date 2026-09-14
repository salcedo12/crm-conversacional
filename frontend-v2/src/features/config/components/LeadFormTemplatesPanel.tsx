import { useEffect, useState, useCallback } from 'react';
import { Spinner } from '@/shared/components/Spinner';
import { listTemplates } from '@/features/templates/services/templates.service';
import type { WhatsAppTemplate } from '@/features/templates/types';
import {
  listLeadFormTemplates,
  setLeadFormTemplate,
  deleteLeadFormTemplate,
  type LeadFormMapping,
} from '../services/leadForms.service';

interface Props {
  companyId: string;
}

function formatDate(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Panel de "Plantillas de bienvenida por pauta de formulario (Meta Ads)".
 * Cada formulario de Meta (pauta) puede tener su propia plantilla; si no se
 * asigna ninguna, se usa la global por defecto (env META_LEAD_WELCOME_TEMPLATE).
 * Los formularios se autorregistran cuando entra el primer lead.
 */
export function LeadFormTemplatesPanel({ companyId }: Props) {
  const [forms, setForms]         = useState<LeadFormMapping[]>([]);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [savingId, setSavingId]   = useState<string | null>(null);
  const [newFormId, setNewFormId] = useState('');

  const approved = templates.filter((t) => t.status === 'approved');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [f, t] = await Promise.all([listLeadFormTemplates(companyId), listTemplates(companyId)]);
      setForms(f);
      setTemplates(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la información.');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  const handleAssign = async (formId: string, templateName: string) => {
    setSavingId(formId);
    setError(null);
    try {
      await setLeadFormTemplate(companyId, formId, templateName);
      setForms((prev) => prev.map((f) => (f.formId === formId ? { ...f, templateName: templateName || null } : f)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setSavingId(null);
    }
  };

  const handleAdd = async () => {
    const id = newFormId.trim();
    if (!id) return;
    setSavingId(id);
    setError(null);
    try {
      await setLeadFormTemplate(companyId, id, '');
      setNewFormId('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo agregar el formulario.');
    } finally {
      setSavingId(null);
    }
  };

  const handleRemove = async (formId: string) => {
    setSavingId(formId);
    try {
      await deleteLeadFormTemplate(companyId, formId);
      setForms((prev) => prev.filter((f) => f.formId !== formId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-zinc-100">Pautas de formulario (Meta Ads)</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Asigna una plantilla de bienvenida distinta a cada formulario. Cuando entra un lead por una pauta,
          se le envía automáticamente esa plantilla por WhatsApp. Los formularios aparecen aquí solos cuando
          reciben su primer lead; si dejas uno sin plantilla, se usará la plantilla global por defecto.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <div className="flex flex-col gap-3">
          {forms.length === 0 && (
            <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-500">
              Aún no ha entrado ningún lead por formulario. Cuando llegue el primero, la pauta aparecerá aquí
              para asignarle su plantilla. También puedes agregar el ID del formulario manualmente abajo.
            </p>
          )}

          {forms.map((f) => (
            <div
              key={f.formId}
              className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-100">{f.label || `Formulario ${f.formId}`}</p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-600">ID: {f.formId}</p>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  {f.leadCount} {f.leadCount === 1 ? 'lead' : 'leads'} · último {formatDate(f.lastLeadAt)}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={f.templateName ?? ''}
                  disabled={savingId === f.formId}
                  onChange={(e) => void handleAssign(f.formId, e.target.value)}
                  className="w-full max-w-xs rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100 focus:border-violet-500 focus:outline-none sm:w-56"
                >
                  <option value="">Plantilla global por defecto</option>
                  {approved.map((t) => (
                    <option key={t.id} value={t.name}>{t.displayName}</option>
                  ))}
                  {/* Si tenía una plantilla que ya no está aprobada, la mostramos igual para no perderla. */}
                  {f.templateName && !approved.some((t) => t.name === f.templateName) && (
                    <option value={f.templateName}>{f.templateName} (no aprobada)</option>
                  )}
                </select>
                <button
                  onClick={() => void handleRemove(f.formId)}
                  disabled={savingId === f.formId}
                  className="rounded-lg px-2 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                  title="Quitar de la lista"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}

          <div className="mt-2 flex items-center gap-2 border-t border-zinc-800 pt-4">
            <input
              value={newFormId}
              onChange={(e) => setNewFormId(e.target.value)}
              placeholder="Agregar ID de formulario manualmente"
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
            />
            <button
              onClick={() => void handleAdd()}
              disabled={!newFormId.trim() || savingId === newFormId.trim()}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
            >
              Agregar
            </button>
          </div>
        </div>
      )}

      {approved.length === 0 && !loading && (
        <p className="mt-4 text-[11px] text-amber-400/80">
          No tienes plantillas aprobadas todavía. Crea y haz aprobar una en la sección de Plantillas para poder asignarla.
        </p>
      )}
    </div>
  );
}
