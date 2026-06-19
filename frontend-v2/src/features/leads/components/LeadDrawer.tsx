import { useState, useEffect }  from 'react';
import { useNavigate }          from 'react-router-dom';
import { Button }               from '@/shared/components/Button';
import { LeadStatusBadge }      from './LeadStatusBadge';
import { AiStatusBadge }        from '@/features/inbox/components/AiStatusBadge';
import { formatMessageTime }    from '@/shared/utils/date';
import { formatPhone }          from '@/shared/utils/formatPhone';
import { updateLead }           from '../services/leads.service';
import { pauseAi, resumeAi }    from '@/features/inbox/services/messages.service';
import type { Lead, LeadStatus } from '@/features/inbox/types';

interface LeadDrawerProps {
  lead:      Lead;
  companyId: string;
  onClose:   () => void;
}

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: 'new',       label: 'Nuevo'      },
  { value: 'active',    label: 'Activo'     },
  { value: 'qualified', label: 'Calificado' },
  { value: 'scheduled', label: 'Agendado'   },
  { value: 'lost',      label: 'Perdido'    },
  { value: 'closed',    label: 'Cerrado'    },
];

export function LeadDrawer({ lead, companyId, onClose }: LeadDrawerProps) {
  const navigate = useNavigate();

  const [name,     setName]     = useState(lead.name    ?? '');
  const [status,   setStatus]   = useState<LeadStatus>(lead.status);
  const [tagInput, setTagInput] = useState(lead.tags?.join(', ') ?? '');
  const [saving,   setSaving]   = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [saved,    setSaved]    = useState(false);

  // Reset form when lead changes
  useEffect(() => {
    setName(lead.name ?? '');
    setStatus(lead.status);
    setTagInput(lead.tags?.join(', ') ?? '');
    setError(null);
    setSaved(false);
  }, [lead.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  const isDirty =
    name.trim()   !== (lead.name    ?? '') ||
    status        !== lead.status         ||
    tagInput.trim() !== (lead.tags?.join(', ') ?? '');

  const handleSave = async () => {
    if (!isDirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const tags = tagInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      await updateLead({
        companyId,
        leadId: lead.id,
        name:   name.trim() || undefined,
        status,
        tags,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError('Error al guardar. Intenta nuevamente.');
      console.error('[LeadDrawer] save error:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleAi = async () => {
    if (toggling) return;
    setToggling(true);
    try {
      if (lead.aiEnabled) {
        await pauseAi(companyId, lead.id);
      } else {
        await resumeAi(companyId, lead.id);
      }
    } catch (err) {
      setError('Error al cambiar estado de IA.');
      console.error('[LeadDrawer] toggle AI error:', err);
    } finally {
      setToggling(false);
    }
  };

  const displayName = lead.name ?? formatPhone(lead.phone);

  return (
    /* Overlay */
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />

      {/* Panel */}
      <div
        className="relative z-50 w-80 h-full bg-zinc-900 border-l border-zinc-800 flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-zinc-800">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-100 truncate">{displayName}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{lead.phone}</p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition-colors ml-2 mt-0.5"
          >
            ✕
          </button>
        </div>

        {/* Scroll content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">

          {/* Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <LeadStatusBadge status={lead.status} size="md" />
            <AiStatusBadge aiEnabled={lead.aiEnabled} />
          </div>

          {/* Info rápida */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-zinc-500 mb-0.5">Fuente</p>
              <p className="text-zinc-200 capitalize">{lead.source}</p>
            </div>
            <div>
              <p className="text-zinc-500 mb-0.5">Alta</p>
              <p className="text-zinc-200">{formatMessageTime(lead.createdAt)}</p>
            </div>
            <div>
              <p className="text-zinc-500 mb-0.5">Último mensaje</p>
              <p className="text-zinc-200">
                {lead.lastMessageAt ? formatMessageTime(lead.lastMessageAt) : '—'}
              </p>
            </div>
            {lead.takeoverBy && (
              <div>
                <p className="text-zinc-500 mb-0.5">Control tomado por</p>
                <p className="text-zinc-200 truncate">{lead.takeoverBy}</p>
              </div>
            )}
          </div>

          <hr className="border-zinc-800" />

          {/* Form: nombre */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400">Nombre</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={lead.phone}
              className="
                rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2
                text-sm text-zinc-100 placeholder-zinc-500
                focus:outline-none focus:border-violet-500/50 transition-colors
              "
            />
          </div>

          {/* Form: estado */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400">Estado</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as LeadStatus)}
              className="
                rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2
                text-sm text-zinc-100
                focus:outline-none focus:border-violet-500/50 transition-colors
              "
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Form: etiquetas */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-400">
              Etiquetas
              <span className="text-zinc-600 font-normal ml-1">(separadas por coma)</span>
            </label>
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="interesado, apartamento, zona norte"
              className="
                rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2
                text-sm text-zinc-100 placeholder-zinc-500
                focus:outline-none focus:border-violet-500/50 transition-colors
              "
            />
            {/* Preview etiquetas */}
            {tagInput.trim() && (
              <div className="flex flex-wrap gap-1 mt-1">
                {tagInput.split(',').map((t) => t.trim()).filter(Boolean).map((tag) => (
                  <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-300">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {/* Botón guardar */}
          <Button
            onClick={handleSave}
            disabled={!isDirty || saving}
            loading={saving}
            className="w-full"
          >
            {saved ? '✓ Guardado' : 'Guardar cambios'}
          </Button>

          <hr className="border-zinc-800" />

          {/* Control IA */}
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-zinc-400">Control de IA</p>
            <button
              onClick={handleToggleAi}
              disabled={toggling}
              className={`
                flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-xs font-medium
                border transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                ${lead.aiEnabled
                  ? 'border-orange-500/30 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20'
                  : 'border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20'
                }
              `}
            >
              {toggling
                ? 'Actualizando...'
                : lead.aiEnabled
                  ? '⏸ Pausar IA'
                  : '▶ Activar IA'
              }
            </button>
          </div>

          <hr className="border-zinc-800" />

          {/* Ir a conversación */}
          <button
            onClick={() => {
              onClose();
              navigate('/dashboard/inbox');
            }}
            className="
              flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-xs font-medium
              border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors
            "
          >
            💬 Ver conversación
          </button>
        </div>
      </div>
    </div>
  );
}
