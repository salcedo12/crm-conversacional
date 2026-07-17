import { useEffect, useState } from 'react';
import {
  collectionGroup,
  query,
  where,
  onSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import type { Call } from '@/features/leads/services/calls.service';

/**
 * Escucha en tiempo real llamadas de WhatsApp entrantes ('ringing') de toda la
 * empresa (collectionGroup sobre companies/*\/leads/*\/calls). Se filtra en
 * cliente a las asignadas al asesor actual o sin asignar, para mostrar el
 * banner de "llamada entrante" sin importar en qué página esté.
 */
export function useRingingCalls(companyId: string | null, uid: string | null, isAdmin: boolean) {
  const [calls, setCalls] = useState<Call[]>([]);

  useEffect(() => {
    if (!companyId) {
      setCalls([]);
      return;
    }

    const q = query(
      collectionGroup(db, 'calls'),
      where('companyId', '==', companyId),
      where('status', '==', 'ringing')
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const all = snap.docs.map((d: QueryDocumentSnapshot) => ({ id: d.id, ...d.data() } as Call));
        const mine = all.filter((c) => isAdmin || !c.assignedTo || c.assignedTo === uid);
        setCalls(mine);
      },
      (err) => console.error('[useRingingCalls]', err)
    );

    return unsub;
  }, [companyId, uid, isAdmin]);

  return calls;
}
