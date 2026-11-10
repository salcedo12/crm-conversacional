import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import firestore, { type FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import { isAdminRole, type Lead, type UserRole } from '../types';

export function useLeads(
  companyId: string | null,
  advisorId: string | null,
  role?: UserRole | null,
  limitSize: number = 50,
  platformAdmin: boolean = false
) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId || !advisorId) {
      setLeads([]);
      setLoading(false);
      return;
    }

    const canSeeAllLeads = platformAdmin || isAdminRole(role);
    let unsubscribe: (() => void) | undefined;

    const connect = () => {
      if (unsubscribe) return;

      let query: FirebaseFirestoreTypes.Query = firestore()
        .collection('companies')
        .doc(companyId)
        .collection('leads');

      if (!canSeeAllLeads) {
        query = query.where('assignedTo', '==', advisorId);
      }

      query = query.orderBy('lastMessageAt', 'desc').limit(limitSize);

      unsubscribe = query.onSnapshot(
        (snapshot) => {
          setLeads(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Lead)));
          setLoading(false);
          setError(null);
        },
        (reason) => {
          console.warn(reason);
          setError(
            canSeeAllLeads
              ? 'No se pudieron cargar las conversaciones.'
              : 'No se pudieron cargar tus conversaciones.'
          );
          setLoading(false);
        }
      );
    };

    const disconnect = () => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = undefined;
      }
    };

    connect();

    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        connect();
      } else {
        disconnect();
      }
    });

    return () => {
      disconnect();
      subscription.remove();
    };
  }, [companyId, advisorId, role, limitSize, platformAdmin]);

  return { leads, loading, error };
}
