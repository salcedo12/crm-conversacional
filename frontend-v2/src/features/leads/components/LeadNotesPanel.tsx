import { useState } from 'react';
import { Bell, Check, Clock3, Plus, StickyNote, Trash2 } from 'lucide-react';
import { formatMessageTime } from '@/shared/utils/date';
import {
  addLeadNote, deleteLeadNote, setReminderDone, useLeadNotes,
  type LeadNoteKind, type LeadNote,
} from '../services/leadNotes.service';

interface LeadNotesPanelProps {
  companyId: string;
  leadId:    string;
}

export function LeadNotesPanel({ companyId, leadId }: LeadNotesPanelProps) {
  const { notes, loading } = useLeadNotes(companyId, leadId);
  const [kind, setKind]   = useState<LeadNoteKind>('note');
  const [text, setText]   = useState('');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy]   = useState(false);
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
    } catch (err) {
      setError((err as { message?: string })?.message || 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleDone = async (note: LeadNote) => {
    try { await setReminderDone(companyId, leadId, note.id, !note.done); }
    catch (err) { console.error('[Notes] toggle done', err); }
  };

  const handleDelete = async (noteId: string) => {
    try { await deleteLeadNote(companyId, leadId, noteId); }
    catch (err) { console.error('[Notes] delete', err); }
  };

  return (
    <div>
      {/* Selector nota / recordatorio */}
      <div className="mb-2 flex gap-1">
        {(['note', 'reminder'] as LeadNoteKind[]).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
              kind === k ? 'bg-violet-600/20 text-violet-200' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {k === 'note' ? <StickyNote size={12} /> : <Bell size={12} />}
            {k === 'note' ? 'Nota' : 'Recordatorio'}
          </button>
        ))}
      </div>

      {/* Formulario */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={kind === 'note' ? 'Escribe una nota interna…' : 'Ej: llamar para confirmar visita'}
        rows={2}
        className="w-full resize-y rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-violet-500/60"
      />
      {kind === 'reminder' && (
        <input
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          className="mt-2 h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 outline-none focus:border-violet-500/60"
        />
      )}
      <button
        onClick={handleAdd}
        disabled={!canAdd}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-violet-600 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus size={14} /> {kind === 'note' ? 'Agregar nota' : 'Agregar recordatorio'}
      </button>
      {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}

      {/* Lista */}
      <div className="mt-4 space-y-2">
        {loading && <p className="text-[11px] text-zinc-600">Cargando…</p>}
        {!loading && notes.length === 0 && (
          <p className="text-[11px] text-zinc-600">Aún no hay notas ni recordatorios.</p>
        )}
        {notes.map((note) => (
          <NoteItem key={note.id} note={note} onToggleDone={handleToggleDone} onDelete={handleDelete} />
        ))}
      </div>
    </div>
  );
}

function NoteItem({
  note, onToggleDone, onDelete,
}: {
  note: LeadNote;
  onToggleDone: (note: LeadNote) => void;
  onDelete: (noteId: string) => void;
}) {
  const isReminder = note.kind === 'reminder';
  const overdue = isReminder && !note.done && note.dueAt && note.dueAt.toMillis() < Date.now();

  return (
    <div className={`group rounded-md border px-3 py-2 ${
      isReminder
        ? note.done
          ? 'border-zinc-800 bg-zinc-800/30'
          : overdue
            ? 'border-red-500/30 bg-red-500/5'
            : 'border-amber-500/25 bg-amber-500/5'
        : 'border-zinc-800 bg-zinc-800/40'
    }`}>
      <div className="flex items-start gap-2">
        {isReminder && (
          <button
            onClick={() => onToggleDone(note)}
            title={note.done ? 'Marcar pendiente' : 'Marcar hecho'}
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
              note.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-zinc-600 hover:border-emerald-500'
            }`}
          >
            {note.done && <Check size={11} />}
          </button>
        )}
        {!isReminder && <StickyNote size={13} className="mt-0.5 shrink-0 text-zinc-500" />}
        <div className="min-w-0 flex-1">
          <p className={`text-xs ${note.done ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}>{note.text}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-500">
            {isReminder && note.dueAt && (
              <span className={`inline-flex items-center gap-1 ${overdue ? 'text-red-300' : 'text-amber-300/80'}`}>
                <Clock3 size={10} /> {formatMessageTime(note.dueAt)}{overdue ? ' · vencido' : ''}
              </span>
            )}
            <span>{note.authorName}</span>
            <span>· {formatMessageTime(note.createdAt)}</span>
          </div>
        </div>
        <button
          onClick={() => onDelete(note.id)}
          title="Eliminar"
          className="shrink-0 text-zinc-600 opacity-0 transition-opacity hover:text-red-300 group-hover:opacity-100"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
