import { useEffect, useState } from 'react';
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import type { UserRole } from '@/features/auth/types';
import type { Lead } from '../types';

/**
 * Escucha en tiempo real los leads recientes de una empresa.
 * Ruta: companies/{companyId}/leads
 *
 * Optimizaciones:
 * - limit(maxLeads) evita cargar todos los leads en memoria.
 * - orderBy('lastMessageAt', 'desc') muestra primero los más activos.
 */
export function useLeads(
  companyId: string | null,
  maxLeads = 50,
  scope?: { uid: string | null; role: UserRole | null }
) {
  const [leads,   setLeads]   = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setLoading(false);
      return;
    }

    if (scope?.role === 'advisor' && !scope.uid) {
      setLeads([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const leadCol = collection(db, 'companies', companyId, 'leads');
    const q = scope?.role === 'advisor' && scope.uid
      ? query(
          leadCol,
          where('assignedTo', '==', scope.uid),
          orderBy('lastMessageAt', 'desc'),
          limit(maxLeads)
        )
      : query(
          leadCol,
          orderBy('lastMessageAt', 'desc'),
          limit(maxLeads)
        );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setLeads(
          snap.docs.map((d: QueryDocumentSnapshot) => ({ id: d.id, ...d.data() } as Lead))
        );
        setLoading(false);
      },
      (err) => {
        console.error('[useLeads]', err);
        // Si falla por índice, intentar sin orderBy
        setError('Error cargando leads.');
        setLoading(false);
      }
    );

    return unsub;
  }, [companyId, maxLeads, scope?.role, scope?.uid]);

  return { leads, loading, error };
}
