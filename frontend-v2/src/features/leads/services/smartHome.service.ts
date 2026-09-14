import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, type Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';

export interface SmartHomeAdvisor {
  userId: string;
  name:   string;
  email:  string;
}

export interface SmartHomeStage {
  stageId:   string;
  name:      string;
  cycleId:   string;
  cycleName: string;
}

const _listAdvisors = httpsCallable<{ companyId: string }, { advisors: SmartHomeAdvisor[] }>(
  functions,
  'listSmartHomeAdvisors'
);
const _listStages = httpsCallable<{ companyId: string }, { stages: SmartHomeStage[] }>(
  functions,
  'listSmartHomeStages'
);
const _changeAdvisor = httpsCallable<
  { companyId: string; leadId: string; advisorId: string },
  { ok: boolean; reason: string }
>(functions, 'changeSmartHomeLeadAdvisor');
const _changeStage = httpsCallable<
  { companyId: string; leadId: string; stageId: string },
  { ok: boolean; reason: string }
>(functions, 'changeSmartHomeLeadStage');
const _bitacoraAccess = httpsCallable<
  { companyId: string; leadId: string },
  { allowed: boolean; message: string }
>(functions, 'getSmartHomeLeadBitacoraAccess');
const _postBitacora = httpsCallable<
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
>(functions, 'postSmartHomeLeadBitacora');

export async function listSmartHomeAdvisors(companyId: string): Promise<SmartHomeAdvisor[]> {
  return (await _listAdvisors({ companyId })).data.advisors;
}

export async function listSmartHomeStages(companyId: string): Promise<SmartHomeStage[]> {
  return (await _listStages({ companyId })).data.stages;
}

export async function changeSmartHomeLeadAdvisor(companyId: string, leadId: string, advisorId: string): Promise<void> {
  await _changeAdvisor({ companyId, leadId, advisorId });
}

export async function changeSmartHomeLeadStage(companyId: string, leadId: string, stageId: string): Promise<void> {
  await _changeStage({ companyId, leadId, stageId });
}

export async function getSmartHomeLeadBitacoraAccess(companyId: string, leadId: string): Promise<{ allowed: boolean; message: string }> {
  return (await _bitacoraAccess({ companyId, leadId })).data;
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

export interface EvidenceAttachment {
  downloadUrl: string;
  storagePath: string;
  contentType?: string;
  fileName?: string;
}

const _postEvidence = httpsCallable<
  {
    companyId: string;
    leadId: string;
    note?: string;
    actionLabel?: string;
    context?: string;
    attachments: EvidenceAttachment[];
  },
  { savedToCrm: boolean; sentToSmartHome: boolean; reason: string }
>(functions, 'postSmartHomeLeadEvidence');

export async function postSmartHomeLeadEvidence(input: {
  companyId: string;
  leadId: string;
  note?: string;
  actionLabel?: string;
  context?: string;
  attachments: EvidenceAttachment[];
}): Promise<{ savedToCrm: boolean; sentToSmartHome: boolean; reason: string }> {
  return (await _postEvidence(input)).data;
}

export interface LeadEvidence {
  id:             string;
  downloadUrl:    string;
  storagePath:    string;
  contentType:    string;
  fileName:       string;
  note?:          string;
  uploadedBy:     string;
  uploadedByName: string;
  createdAt?:     Timestamp;
}

/** Escucha en tiempo real la evidencia fotográfica guardada de un lead (más reciente primero). */
export function useLeadEvidence(companyId: string, leadId: string) {
  const [evidence, setEvidence] = useState<LeadEvidence[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!companyId || !leadId) { setLoading(false); return; }
    setLoading(true);
    const q = query(
      collection(db, 'companies', companyId, 'leads', leadId, 'evidence'),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => { setEvidence(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LeadEvidence))); setLoading(false); },
      (err) => { console.error('[useLeadEvidence]', err); setLoading(false); }
    );
    return unsub;
  }, [companyId, leadId]);

  return { evidence, loading };
}
