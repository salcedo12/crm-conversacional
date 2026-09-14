import { useEffect, useState } from 'react';
import firestore from '@react-native-firebase/firestore';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';

const functionsInstance = getFunctions(undefined, 'us-central1');
const callable = <TInput, TResult>(name: string) =>
  httpsCallable<TInput, TResult>(functionsInstance, name);

export interface EvidenceAttachment {
  downloadUrl: string;
  storagePath: string;
  contentType?: string;
  fileName?: string;
}

export interface LeadEvidence {
  id:             string;
  downloadUrl:    string;
  storagePath:    string;
  contentType:    string;
  fileName:       string;
  note?:          string;
  uploadedByName: string;
}

const _bitacoraAccess = callable<
  { companyId: string; leadId: string },
  { allowed: boolean; message: string }
>('getSmartHomeLeadBitacoraAccess');

const _postBitacora = callable<
  {
    companyId: string;
    leadId: string;
    userId?: string;
    actionId?: string | null;
    actionLabel?: string;
    context?: string;
    eventContent: string;
    isAnEvent: boolean;
    scheduledDate?: string;
  },
  { ok: boolean; reason: string }
>('postSmartHomeLeadBitacora');

export async function getSmartHomeLeadBitacoraAccess(
  companyId: string,
  leadId: string
): Promise<{ allowed: boolean; message: string }> {
  const result = await _bitacoraAccess({ companyId, leadId });
  return result.data;
}

export async function postSmartHomeLeadBitacora(input: {
  companyId: string;
  leadId: string;
  userId?: string;
  actionLabel?: string;
  context?: string;
  eventContent: string;
  isAnEvent: boolean;
  scheduledDate?: string;
}): Promise<void> {
  await _postBitacora({ ...input, actionId: null });
}

const _postEvidence = callable<
  {
    companyId: string;
    leadId: string;
    note?: string;
    actionLabel?: string;
    context?: string;
    attachments: EvidenceAttachment[];
  },
  { savedToCrm: boolean; sentToSmartHome: boolean; reason: string }
>('postSmartHomeLeadEvidence');

export async function postSmartHomeLeadEvidence(input: {
  companyId: string;
  leadId: string;
  note?: string;
  actionLabel?: string;
  context?: string;
  attachments: EvidenceAttachment[];
}): Promise<{ savedToCrm: boolean; sentToSmartHome: boolean; reason: string }> {
  const result = await _postEvidence(input);
  return result.data;
}

/** Escucha en tiempo real la evidencia fotográfica guardada de un lead (más reciente primero). */
export function useLeadEvidence(companyId: string | null, leadId: string) {
  const [evidence, setEvidence] = useState<LeadEvidence[]>([]);

  useEffect(() => {
    if (!companyId || !leadId) return;
    return firestore()
      .collection('companies').doc(companyId)
      .collection('leads').doc(leadId)
      .collection('evidence')
      .orderBy('createdAt', 'desc')
      .onSnapshot(
        (snapshot) => {
          setEvidence(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as LeadEvidence)));
        },
        (err) => console.warn('[useLeadEvidence]', err)
      );
  }, [companyId, leadId]);

  return evidence;
}
