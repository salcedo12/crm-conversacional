import { useEffect, useMemo, useState } from 'react';
import firestore from '@react-native-firebase/firestore';
import type { Lead, LeadNote, RecentCall } from '../types';

export function useLeadDoc(companyId: string | null, leadId: string, initial: Lead) {
  const [lead, setLead] = useState<Lead>(initial);

  useEffect(() => {
    if (!companyId) return;
    return firestore()
      .collection('companies').doc(companyId)
      .collection('leads').doc(leadId)
      .onSnapshot((snapshot) => {
        if (snapshot.exists()) setLead({ id: snapshot.id, ...snapshot.data() } as Lead);
      });
  }, [companyId, leadId]);

  return lead;
}

export function useLeadNotes(companyId: string | null, leadId: string) {
  const [notes, setNotes] = useState<LeadNote[]>([]);

  useEffect(() => {
    if (!companyId) return;
    return firestore()
      .collection('companies').doc(companyId)
      .collection('leads').doc(leadId)
      .collection('notes')
      .orderBy('createdAt', 'desc')
      .onSnapshot((snapshot) => {
        setNotes(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as LeadNote)));
      });
  }, [companyId, leadId]);

  return notes;
}

export function useLeadCalls(companyId: string | null, leadId: string) {
  const [calls, setCalls] = useState<RecentCall[]>([]);

  useEffect(() => {
    if (!companyId) return;
    return firestore()
      .collection('companies').doc(companyId)
      .collection('leads').doc(leadId)
      .collection('calls')
      .orderBy('createdAt', 'desc')
      .limit(20)
      .onSnapshot((snapshot) => {
        setCalls(snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            leadId,
            leadName: '',
            leadPhone: '',
            status: String(data.status ?? ''),
            summary: data.summary,
            transcript: data.transcript,
            recordingUrl: data.recordingUrl,
            durationSec: data.durationSec,
            outcome: data.outcome,
            createdAt: data.createdAt?.toMillis?.() ?? 0,
          };
        }));
      });
  }, [companyId, leadId]);

  return useMemo(() => calls, [calls]);
}
