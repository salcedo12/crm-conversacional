import { useEffect, useRef, useState } from 'react';
import {
  collection,
  query,
  orderBy,
  limitToLast,
  onSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import type { Message } from '../types';

const MESSAGES_LIMIT = 50;

/**
 * Escucha en tiempo real los últimos 50 mensajes de un lead.
 * Ruta: companies/{companyId}/leads/{leadId}/messages
 *
 * Optimizaciones:
 * - limitToLast(50): solo los mensajes más recientes.
 * - El listener se cancela automáticamente al cambiar de lead.
 */
export function useMessages(companyId: string | null, leadId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading,  setLoading]  = useState(false);
  const prevLeadId = useRef<string | null>(null);

  useEffect(() => {
    if (!companyId || !leadId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    // Limpiar mensajes anteriores al cambiar de lead
    if (prevLeadId.current !== leadId) {
      setMessages([]);
      prevLeadId.current = leadId;
    }

    setLoading(true);

    const q = query(
      collection(db, 'companies', companyId, 'leads', leadId, 'messages'),
      orderBy('createdAt', 'asc'),
      limitToLast(MESSAGES_LIMIT)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setMessages(
          snap.docs.map((d: QueryDocumentSnapshot) => ({ id: d.id, ...d.data() } as Message))
        );
        setLoading(false);
      },
      (err) => {
        console.error('[useMessages]', err);
        setLoading(false);
      }
    );

    return unsub;
  }, [companyId, leadId]);

  return { messages, loading };
}
