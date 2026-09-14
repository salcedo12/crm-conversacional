import { useEffect, useState } from 'react';
import firestore from '@react-native-firebase/firestore';
import type { LibraryItem } from '../types';

/** Escucha en tiempo real los portafolios (biblioteca) de la empresa. */
export function useLibrary(companyId: string | null) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    return firestore()
      .collection('companies').doc(companyId)
      .collection('library')
      .orderBy('createdAt', 'desc')
      .onSnapshot((snapshot) => {
        setItems(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as LibraryItem)));
        setLoading(false);
      }, () => setLoading(false));
  }, [companyId]);

  return { items, loading };
}
