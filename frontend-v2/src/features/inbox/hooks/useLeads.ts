import { useEffect, useRef, useState } from 'react';
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
 * Optimizaciones de costo (lecturas Firestore):
 * - limit(maxLeads) evita cargar todos los leads en memoria.
 * - orderBy('lastMessageAt', 'desc') muestra primero los mas activos.
 * - Se SUSPENDE el listener cuando la pestana esta oculta (document.hidden)
 *   y se RECONECTA al volver. Asi, tener la Bandeja abierta todo el dia sin
 *   mirarla no sigue cobrando lecturas por cada mensaje que entra.
 */
export function useLeads(
  companyId: string | null,
  maxLeads = 50,
  scope?: { uid: string | null; role: UserRole | null }
) {
  const [leads,   setLeads]   = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  // Evita el parpadeo del spinner al reconectar: solo mostramos "cargando"
  // en la primera carga, no cuando ya teniamos datos y volvemos a la pestana.
  const hasLoaded = useRef(false);

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

    let unsub: (() => void) | null = null;

    const subscribe = () => {
      if (unsub) return; // ya suscrito
      if (!hasLoaded.current) setLoading(true);
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

      unsub = onSnapshot(
        q,
        (snap) => {
          setLeads(
            snap.docs.map((d: QueryDocumentSnapshot) => ({ id: d.id, ...d.data() } as Lead))
          );
          hasLoaded.current = true;
          setLoading(false);
        },
        (err) => {
          console.error('[useLeads]', err);
          // Si falla por indice, intentar sin orderBy
          setError('Error cargando leads.');
          setLoading(false);
        }
      );
    };

    const unsubscribe = () => {
      if (unsub) {
        unsub();
        unsub = null;
      }
    };

    // Al ocultar la pestana desconectamos el listener (deja de cobrar lecturas
    // por el goteo de mensajes); al volver a mostrarla lo reconectamos.
    const handleVisibility = () => {
      if (document.hidden) unsubscribe();
      else subscribe();
    };

    if (!document.hidden) subscribe();
    else setLoading(false);

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      unsubscribe();
    };
  }, [companyId, maxLeads, scope?.role, scope?.uid]);

  return { leads, loading, error };
}
