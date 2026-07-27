import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, type Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';

export type LeadNoteKind = 'note' | 'reminder';

export interface LeadNote {
  id:         string;
  kind:       LeadNoteKind;
  text:       string;
  authorId:   string;
  authorName: string;
  createdAt:  Timestamp;
  dueAt?:     Timestamp;
  done?:      boolean;
}

const _add  = httpsCallable<{ companyId: string; leadId: string; kind: LeadNoteKind; text: string; dueAt?: number }, { noteId: string }>(functions, 'addLeadNote');
const _del  = httpsCallable<{ companyId: string; leadId: string; noteId: string }, { ok: true }>(functions, 'deleteLeadNote');
const _done = httpsCallable<{ companyId: string; leadId: string; noteId: string; done: boolean }, { ok: true }>(functions, 'setReminderDone');

export async function addLeadNote(
  companyId: string, leadId: string, kind: LeadNoteKind, text: string, dueAtMillis?: number
): Promise<void> {
  await _add({ companyId, leadId, kind, text, dueAt: dueAtMillis });
}

export async function deleteLeadNote(companyId: string, leadId: string, noteId: string): Promise<void> {
  await _del({ companyId, leadId, noteId });
}

export async function setReminderDone(companyId: string, leadId: string, noteId: string, done: boolean): Promise<void> {
  await _done({ companyId, leadId, noteId, done });
}

/** Escucha en tiempo real las notas/recordatorios de un lead (más recientes primero). */
export function useLeadNotes(companyId: string, leadId: string) {
  const [notes, setNotes]     = useState<LeadNote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId || !leadId) { setLoading(false); return; }
    setLoading(true);
    const q = query(
      collection(db, 'companies', companyId, 'leads', leadId, 'notes'),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => { setNotes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LeadNote))); setLoading(false); },
      (err) => { console.error('[useLeadNotes]', err); setLoading(false); }
    );
    return unsub;
  }, [companyId, leadId]);

  return { notes, loading };
}
