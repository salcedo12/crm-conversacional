import { useEffect, useState } from 'react';
import firestore from '@react-native-firebase/firestore';
import type { Message } from '../types';

export function useMessages(companyId: string | null, leadId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    return firestore()
      .collection('companies').doc(companyId)
      .collection('leads').doc(leadId)
      .collection('messages')
      .orderBy('createdAt', 'desc')
      .limit(80)
      .onSnapshot((snapshot) => {
        setMessages(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Message)).reverse());
        setLoading(false);
      }, () => setLoading(false));
  }, [companyId, leadId]);

  return { messages, loading };
}
