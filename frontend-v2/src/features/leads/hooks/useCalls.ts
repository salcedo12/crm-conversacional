import { useEffect, useState } from 'react';
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import type { Call } from '../services/calls.service';

const CALLS_LIMIT = 30;

/**
 * Escucha en tiempo real el historial de llamadas con IA de un lead.
 * Ruta: companies/{companyId}/leads/{leadId}/calls
 */
export function useCalls(companyId: string | null, leadId: string | null) {
  const [calls, setCalls]     = useState<Call[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!companyId || !leadId) {
      setCalls([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(
      collection(db, 'companies', companyId, 'leads', leadId, 'calls'),
      orderBy('createdAt', 'desc'),
      limit(CALLS_LIMIT)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setCalls(snap.docs.map((d: QueryDocumentSnapshot) => ({ id: d.id, ...d.data() } as Call)));
        setLoading(false);
      },
      (err) => {
        console.error('[useCalls]', err);
        setLoading(false);
      }
    );

    return unsub;
  }, [companyId, leadId]);

  return { calls, loading };
}
