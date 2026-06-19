import { useState, useEffect, useCallback } from 'react';
import { useAuth }     from '@/features/auth/hooks/useAuth';
import { Spinner }     from '@/shared/components/Spinner';
import { Button }      from '@/shared/components/Button';
import { TemplateForm } from '../components/TemplateForm';
import {
  listTemplates, createTemplate, deleteTemplate, syncTemplates,
} from '../services/templates.service';
import type { WhatsAppTemplate, CreateTemplateInput } from '../types';

const STATUS_COLOR: Record<string, string> = {
  approved: 'bg-green-500/15 text-green-300 border-green-500/20',
  local:    'bg-zinc-700/40  text-zinc-400  border-zinc-600/30',
  pending:  'bg-amber-500/15 text-amber-300 border-amber-500/20',
  rejected: 'bg-red-500/15   text-red-300   border-red-500/20',
};

const CATEGORY_ICON: Record<string, string> = {
  marketing: '📣', utility: '🔧', authentication: '🔐',
};

export function TemplatesPage() {
  const { companyId } = useAuth();
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [syncing,   setSyncing]   = useState(false);
  const [showForm,  setShowForm]  = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      setTemplates(await listTemplates(companyId));
    } catch {
      setError('Error cargando plantillas');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (data: Omit<CreateTemplateInput, 'companyId'>) => {
    if (!companyId) return;
    await createTemplate(companyId, data);
    setShowForm(false);
    load();
  };

  const handleDelete = async (templateId: string) => {
    if (!companyId) return;
    if (!confirm('¿Eliminar esta plantilla?')) return;
    await deleteTemplate(companyId, templateId);
    load();
  };

  const handleSync = async () => {
    if (!companyId) return;
    setSyncing(true);
    setError(null);
    try {
      const count = await syncTemplates(companyId);
      alert(`${count} plantilla(s) sincronizadas desde YCloud.`);
      load();
    } catch {
      setError('Error sincronizando. Verifica la configuración de YCloud.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Plantillas de WhatsApp</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Mensajes pre-aprobados por Meta para iniciar conversaciones o re-enganchar leads
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={handleSync} loading={syncing} disabled={syncing}>
            🔄 Sync YCloud
          </Button>
          <Button size="sm" onClick={() => setShowForm(true)}>
            + Nueva plantilla
          </Button>
        </div>
      </div>

      {/* Info aprobación */}
      <div className="mx-5 mt-4 rounded-xl bg-amber-500/8 border border-amber-500/20 px-4 py-3 shrink-0">
        <p className="text-xs text-amber-300 font-medium">ℹ️ Aprobación de plantillas (YCloud → Meta)</p>
        <p className="text-xs text-amber-400/80 mt-1">
          Al crear una plantilla se registra en YCloud y queda en estado <strong>pending</strong> hasta
          que Meta la revisa (suele tardar de minutos a 24h). Usa <strong>🔄 Sync YCloud</strong> para
          refrescar el estado. Solo las <strong>approved</strong> pueden enviarse a cualquier número en
          cualquier momento; las <strong>local</strong> únicamente dentro de la ventana de 24h.
        </p>
      </div>

      <div className="flex-1 overflow-auto px-5 py-4">
        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 mb-4">
            {error}
          </p>
        )}

        {/* Formulario */}
        {showForm && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-6">
            <h3 className="text-sm font-semibold text-zinc-100 mb-4">Nueva plantilla</h3>
            <TemplateForm
              onSave={handleCreate}
              onCancel={() => setShowForm(false)}
            />
          </div>
        )}

        {/* Lista */}
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <span className="text-4xl">📋</span>
            <p className="text-sm font-medium text-zinc-300">Sin plantillas todavía</p>
            <p className="text-xs text-zinc-500">Crea tu primera plantilla o sincroniza desde Twilio</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {templates.map((t) => (
              <div key={t.id} className="flex items-start gap-4 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-4">
                <span className="text-xl mt-0.5">{CATEGORY_ICON[t.category]}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-zinc-100">{t.displayName}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-medium ${STATUS_COLOR[t.status]}`}>
                      {t.status}
                    </span>
                    {t.twilioContentSid && (
                      <span className="text-[9px] text-zinc-500">SID: {t.twilioContentSid.slice(0, 12)}...</span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400 whitespace-pre-wrap line-clamp-2 leading-relaxed">
                    {t.body}
                  </p>
                  {t.variables.length > 0 && (
                    <p className="text-[10px] text-zinc-600 mt-1">
                      Variables: {t.variables.map((v) => `{{${v.key}}}`).join(', ')}
                    </p>
                  )}
                  {(t.headerType && t.headerType !== 'none' && t.headerType !== 'text' || (t.buttons?.length ?? 0) > 0 || t.footer) && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {t.headerType && t.headerType !== 'none' && t.headerType !== 'text' && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                          {t.headerType === 'image' ? '🖼️ Imagen' : t.headerType === 'video' ? '🎥 Video' : '📄 Doc'}
                        </span>
                      )}
                      {t.footer && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                          Pie: {t.footer.slice(0, 20)}
                        </span>
                      )}
                      {(t.buttons?.length ?? 0) > 0 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                          🔘 {t.buttons!.length} botón(es)
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(t.id)}
                  className="text-zinc-600 hover:text-red-400 transition-colors text-sm shrink-0"
                  title="Eliminar"
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
