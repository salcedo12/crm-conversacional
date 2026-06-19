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
import type { Lead } from '../types';

/**
 * Escucha en tiempo real los últimos 50 leads de una empresa.
 * Ruta: companies/{companyId}/leads
 *
 * Optimizaciones:
 * - limit(50) evita cargar todos los leads en memoria.
 * - orderBy('lastMessageAt', 'desc') muestra primero los más activos.
 */
export function useLeads(companyId: string | null) {
  const [leads,   setLeads]   = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const q = query(
      collection(db, 'companies', companyId, 'leads'),
      orderBy('lastMessageAt', 'desc'),
      limit(50)
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
  }, [companyId]);

  return { leads, loading, error };
}
