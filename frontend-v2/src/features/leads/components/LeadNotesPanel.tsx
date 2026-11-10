import { useState } from 'react';
import {
  Bell, Check, Clock3, Plus, StickyNote, Trash2, ClipboardList,
  Phone, Mail, Video, Home, MessageSquare, ChevronDown, ChevronUp,
  UserCheck, Compass,
  Handshake,
} from 'lucide-react';
import { formatMessageTime, formatFullDateTime } from '@/shared/utils/date';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { isAdminRole } from '@/features/auth/types';
import {
  addLeadNote, deleteLeadNote, setReminderDone, useLeadNotes,
  type LeadNoteKind, type LeadNote,
} from '../services/leadNotes.service';

interface LeadNotesPanelProps {
  companyId: string;
  leadId: string;
  onOpenNewFicha?: () => void;
}

function noteErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code;
  const message = (err as { message?: string })?.message?.replace(/^FirebaseError:\s*/, '');

  if (code === 'functions/internal' || message === 'INTERNAL') {
    return 'No se pudo guardar la nota. Inténtalo de nuevo en unos segundos.';
  }
  if (code === 'functions/permission-denied') {
    return 'No tienes permiso para gestionar notas de este lead.';
  }
  if (code === 'functions/invalid-argument') {
    return message || 'Revisa el texto de la nota e inténtalo de nuevo.';
  }
  if (code === 'functions/unauthenticated') {
    return 'Tu sesión expiró. Vuelve a iniciar sesión.';
  }

  return message || 'No se pudo guardar.';
}

const ACTION_MAP: Record<string, { label: string; icon: any; color: string; border: string; bg: string }> = {
  envio_informacion: { label: 'Envío de Información', icon: Mail, color: 'text-sky-300', border: 'border-sky-500/30', bg: 'bg-sky-500/15' },
  llamada: { label: 'Llamada Telefónica', icon: Phone, color: 'text-amber-300', border: 'border-amber-500/30', bg: 'bg-amber-500/15' },
  cita_reunion: { label: 'Cita / Videollamada', icon: Video, color: 'text-indigo-300', border: 'border-indigo-500/30', bg: 'bg-indigo-500/15' },
  visita_terreno: { label: 'Visita Terreno / Sala', icon: Home, color: 'text-emerald-300', border: 'border-emerald-500/30', bg: 'bg-emerald-500/15' },
  seguimiento_general: { label: 'Seguimiento General', icon: MessageSquare, color: 'text-violet-300', border: 'border-violet-500/30', bg: 'bg-violet-500/15' },
  cambio_asesor: { label: 'Cambio de Asesor (Admin)', icon: UserCheck, color: 'text-emerald-300', border: 'border-emerald-500/30', bg: 'bg-emerald-500/15' },
  cambio_fuente: { label: 'Cambio de Fuente (Admin)', icon: Compass, color: 'text-teal-300', border: 'border-teal-500/30', bg: 'bg-teal-500/15' },
};

function parseNoteContent(rawText: string, existingEvidenceUrl?: string | null) {
  let text = (rawText || '').replace(/^📋 FICHA TÉCNICA[^\n]*\n?/i, '').trim();
  let evidenceUrl = existingEvidenceUrl || null;

  // Detectar URLs de imágenes (Firebase Storage u otras) pegadas en el texto
  const urlMatch = text.match(/https?:\/\/[^\s"'<>]+\.(?:jpeg|jpg|png|webp|gif)(?:\?[^\s"'<>]*)?|https?:\/\/firebasestorage\.googleapis\.com\/[^\s"'<>]+/i);
  if (urlMatch) {
    if (!evidenceUrl) {
      evidenceUrl = urlMatch[0];
    }
    // Limpiar del texto la URL y prefijos como "?? Evidencia fotográfica:"
    text = text.replace(/(\?\?|📷|📸)?\s*Evidencia fotogr[áa]fica:?\s*https?:\/\/[^\s]+/gi, '').trim();
    text = text.replace(urlMatch[0], '').trim();
  }

  // Corregir símbolos de interrogación residuales de emojis corrompidos
  text = text.replace(/^\?\?\s*/gm, '').trim();

  return { cleanText: text, evidenceUrl };
}

export function LeadNotesPanel({
  companyId,
  leadId,
  onOpenNewFicha,
}: LeadNotesPanelProps) {
  const { role, platformAdmin } = useAuth();
  const isAdmin = platformAdmin || isAdminRole(role);
  const { notes, loading } = useLeadNotes(companyId, leadId);
  const [filter, setFilter] = useState<'all' | 'fichas' | 'deals' | 'reminders' | 'notes'>('all');
  const [showQuickForm, setShowQuickForm] = useState(false);
  const [kind, setKind] = useState<LeadNoteKind>('note');
  const [text, setText] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAdd = text.trim().length > 0 && (kind === 'note' || dueAt) && !busy;

  const handleAdd = async () => {
    if (!canAdd) return;
    setBusy(true);
    setError(null);
    try {
      const dueMillis = kind === 'reminder' && dueAt ? new Date(dueAt).getTime() : undefined;
      await addLeadNote(companyId, leadId, kind, text.trim(), dueMillis);
      setText('');
      setDueAt('');
      setKind('note');
      setShowQuickForm(false);
    } catch (err) {
      console.error('[Notes] add', err);
      setError(noteErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleToggleDone = async (note: LeadNote) => {
    try { await setReminderDone(companyId, leadId, note.id, !note.done); }
    catch (err) { console.error('[Notes] toggle done', err); }
  };

  const handleDelete = async (noteId: string) => {
    if (!isAdmin) return;
    if (!window.confirm('¿Deseas eliminar este registro de seguimiento del historial? (Acción exclusiva de Administrador)')) return;
    try { await deleteLeadNote(companyId, leadId, noteId); }
    catch (err) { console.error('[Notes] delete', err); }
  };

  // Contadores para filtros
  const fichasCount = notes.filter((n) => n.type === 'ficha_tecnica' || n.text?.includes('FICHA TÉCNICA')).length;
  const remindersCount = notes.filter((n) => n.kind === 'reminder').length;
  const dealsCount = notes.filter((n) => n.type === 'deal_activity').length;
  const rawNotesCount = notes.filter((n) => n.kind === 'note' && n.type !== 'ficha_tecnica' && n.type !== 'deal_activity' && !n.text?.includes('FICHA TÉCNICA')).length;
  const totalCount = notes.length;

  // Filtrado de notas de Firestore
  const filteredNotes = notes.filter((n) => {
    if (filter === 'fichas') return n.type === 'ficha_tecnica' || n.text?.includes('FICHA TÉCNICA');
    if (filter === 'deals') return n.type === 'deal_activity';
    if (filter === 'reminders') return n.kind === 'reminder';
    if (filter === 'notes') return n.kind === 'note' && n.type !== 'ficha_tecnica' && n.type !== 'deal_activity' && !n.text?.includes('FICHA TÉCNICA');
    return true;
  });

  return (
    <div className="space-y-3">
      {/* Botones de acción principales */}
      <div className="flex items-center gap-2 flex-wrap">
        {onOpenNewFicha && (
          <button
            type="button"
            onClick={onOpenNewFicha}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 py-2 px-3 text-xs font-bold text-emerald-300 hover:bg-emerald-500/25 transition-colors shadow-sm cursor-pointer"
          >
            <ClipboardList size={14} />
            <span>📝 Diligenciar Ficha</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowQuickForm(!showQuickForm)}
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 py-2 px-3 text-xs font-medium text-zinc-300 hover:bg-zinc-700 transition-colors cursor-pointer"
        >
          <Plus size={13} />
          <span>Nota / Recordatorio</span>
          {showQuickForm ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {/* Formulario rápido desplegable */}
      {showQuickForm && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-800/40 p-3 space-y-2">
          <div className="flex gap-1">
            {(['note', 'reminder'] as LeadNoteKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                  kind === k ? 'bg-violet-600/20 text-violet-200 border border-violet-500/30' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {k === 'note' ? <StickyNote size={12} /> : <Bell size={12} />}
                {k === 'note' ? 'Nota interna' : 'Recordatorio'}
              </button>
            ))}
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={kind === 'note' ? 'Escribe una nota interna…' : 'Ej: Llamar para confirmar visita o enviar cotización'}
            rows={2}
            className="w-full resize-y rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-violet-500/60"
          />
          {kind === 'reminder' && (
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-xs text-zinc-100 outline-none focus:border-violet-500/60"
            />
          )}
          <button
            onClick={handleAdd}
            disabled={!canAdd}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-violet-600 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
          >
            <Plus size={13} /> {kind === 'note' ? 'Guardar nota' : 'Programar recordatorio'}
          </button>
          {error && <p className="text-[11px] text-red-300">{error}</p>}
        </div>
      )}

      {/* Barra de Filtros */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 text-[10px] scrollbar-none">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`px-2.5 py-1 rounded-full font-medium whitespace-nowrap transition-colors cursor-pointer ${
            filter === 'all'
              ? 'bg-zinc-200 text-zinc-900 font-bold'
              : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Todos ({totalCount})
        </button>
        {fichasCount > 0 && (
          <button
            type="button"
            onClick={() => setFilter('fichas')}
            className={`px-2.5 py-1 rounded-full font-medium whitespace-nowrap transition-colors cursor-pointer ${
              filter === 'fichas'
                ? 'bg-emerald-500 text-zinc-950 font-bold'
                : 'bg-zinc-800 text-emerald-400 hover:bg-zinc-700'
            }`}
          >
            📝 Fichas ({fichasCount})
          </button>
        )}
        {dealsCount > 0 && (
          <button
            type="button"
            onClick={() => setFilter('deals')}
            className={`px-2.5 py-1 rounded-full font-medium whitespace-nowrap transition-colors cursor-pointer ${
              filter === 'deals'
                ? 'bg-emerald-500 text-zinc-950 font-bold'
                : 'bg-zinc-800 text-emerald-400 hover:bg-zinc-700'
            }`}
          >
            🤝 Negocio ({dealsCount})
          </button>
        )}
        {remindersCount > 0 && (
          <button
            type="button"
            onClick={() => setFilter('reminders')}
            className={`px-2.5 py-1 rounded-full font-medium whitespace-nowrap transition-colors cursor-pointer ${
              filter === 'reminders'
                ? 'bg-amber-500 text-zinc-950 font-bold'
                : 'bg-zinc-800 text-amber-400 hover:bg-zinc-700'
            }`}
          >
            ⏰ Recordatorios ({remindersCount})
          </button>
        )}
        {rawNotesCount > 0 && (
          <button
            type="button"
            onClick={() => setFilter('notes')}
            className={`px-2.5 py-1 rounded-full font-medium whitespace-nowrap transition-colors cursor-pointer ${
              filter === 'notes'
                ? 'bg-violet-500 text-zinc-950 font-bold'
                : 'bg-zinc-800 text-violet-400 hover:bg-zinc-700'
            }`}
          >
            💬 Notas ({rawNotesCount})
          </button>
        )}
      </div>

      {/* Lista cronológica */}
      <div className="space-y-2.5">
        {loading && <p className="text-xs text-zinc-500 py-3 text-center">Cargando bitácora de seguimientos…</p>}

        {!loading && filteredNotes.length === 0 && (
          <div className="rounded-xl border border-dashed border-zinc-800 py-6 text-center text-zinc-500">
            <p className="text-xl mb-1">📜</p>
            <p className="text-xs font-medium">Aún no hay seguimientos registrados.</p>
            <p className="text-[11px] text-zinc-600 mt-0.5">Diligencia la primera ficha o agrega una nota interna.</p>
          </div>
        )}

        {/* Fichas y notas de Firestore */}
        {filteredNotes.map((note) => {
          const isFicha = note.type === 'ficha_tecnica' || note.text?.includes('FICHA TÉCNICA');
          const isDealActivity = note.type === 'deal_activity';
          const isReminder = note.kind === 'reminder';
          const { cleanText } = parseNoteContent(note.text, note.evidenceUrl);

          if (isDealActivity) {
            return (
              <div
                key={note.id}
                className="group rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 space-y-2 hover:border-emerald-500/40 transition-colors shadow-sm overflow-hidden"
              >
                <div className="flex items-center justify-between flex-wrap gap-1">
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
                    <Handshake size={11} /> Actividad del negocio
                  </span>
                  <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                    <span className="text-zinc-400 font-medium">{note.authorName}</span>
                    <span>· {formatFullDateTime(note.createdAt)}</span>
                    {isAdmin && (
                      <button
                        onClick={() => handleDelete(note.id)}
                        title="Eliminar registro (Solo Administradores)"
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 transition-opacity ml-1 cursor-pointer"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-zinc-200 leading-relaxed whitespace-pre-wrap bg-zinc-950/30 p-2.5 rounded-lg border border-emerald-500/10 break-words [overflow-wrap:anywhere]">
                  {cleanText}
                </p>
              </div>
            );
          }

          if (isFicha) {
            const aType = note.actionType || 'seguimiento_general';
            const cfg = ACTION_MAP[aType] || ACTION_MAP.seguimiento_general;
            const Icon = cfg.icon;

            return (
              <div
                key={note.id}
                className="group rounded-xl border border-zinc-800 bg-zinc-900/80 p-3 space-y-2 hover:border-zinc-700 transition-colors shadow-sm overflow-hidden"
              >
                {/* Header de la Ficha */}
                <div className="flex items-center justify-between flex-wrap gap-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                      <Icon size={11} /> {cfg.label}
                    </span>
                    {note.result && (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-zinc-800 text-zinc-300 border border-zinc-700">
                        {note.result}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                    <span className="text-zinc-400 font-medium">{note.authorName}</span>
                    <span>· {formatFullDateTime(note.createdAt)}</span>
                    {isAdmin && (
                      <button
                        onClick={() => handleDelete(note.id)}
                        title="Eliminar registro (Solo Administradores)"
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 transition-opacity ml-1 cursor-pointer"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Texto de observaciones con soporte break-words */}
                {cleanText && (
                  <p className="text-xs text-zinc-200 leading-relaxed whitespace-pre-wrap bg-zinc-950/40 p-2.5 rounded-lg border border-zinc-800/60 break-words [overflow-wrap:anywhere]">
                    {cleanText}
                  </p>
                )}

                {/* Próximo paso */}
                {note.nextAction && (
                  <div className="flex items-center gap-1.5 text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/25 px-2.5 py-1 rounded-lg">
                    <span>🎯 Próximo paso:</span>
                    <span className="font-semibold text-amber-200">{note.nextAction}</span>
                    {note.nextActionDate && (
                      <span className="text-zinc-400 text-[10px] font-mono ml-auto">
                        📅 {note.nextActionDate}
                      </span>
                    )}
                  </div>
                )}

              </div>
            );
          }

          // Render normal de recordatorio o nota interna
          const overdue = isReminder && !note.done && note.dueAt && note.dueAt.toMillis() < Date.now();

          return (
            <div
              key={note.id}
              className={`group rounded-xl border px-3 py-2.5 transition-colors overflow-hidden ${
                isReminder
                  ? note.done
                    ? 'border-zinc-800 bg-zinc-800/20'
                    : overdue
                      ? 'border-red-500/30 bg-red-500/5'
                      : 'border-amber-500/25 bg-amber-500/5'
                  : 'border-zinc-800 bg-zinc-800/40'
              }`}
            >
              <div className="flex items-start gap-2">
                {isReminder ? (
                  <button
                    onClick={() => handleToggleDone(note)}
                    title={note.done ? 'Marcar pendiente' : 'Marcar hecho'}
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors cursor-pointer ${
                      note.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-zinc-600 hover:border-emerald-500'
                    }`}
                  >
                    {note.done && <Check size={11} />}
                  </button>
                ) : (
                  <StickyNote size={13} className="mt-0.5 shrink-0 text-violet-400" />
                )}
                <div className="min-w-0 flex-1">
                  <p className={`text-xs break-words [overflow-wrap:anywhere] ${note.done ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}>
                    {cleanText}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-500">
                    {isReminder && note.dueAt && (
                      <span className={`inline-flex items-center gap-1 font-semibold ${overdue ? 'text-red-400' : 'text-amber-300'}`}>
                        <Clock3 size={10} /> {formatMessageTime(note.dueAt)}{overdue ? ' · VENCIDO' : ''}
                      </span>
                    )}
                    <span>{note.authorName}</span>
                    <span>· {formatFullDateTime(note.createdAt)}</span>
                  </div>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => handleDelete(note.id)}
                    title="Eliminar registro (Solo Administradores)"
                    className="shrink-0 text-zinc-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100 cursor-pointer"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
