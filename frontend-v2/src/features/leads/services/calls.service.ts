import { httpsCallable } from 'firebase/functions';
import type { Timestamp } from 'firebase/firestore';
import { functions }      from '@/config/firebase';

export type CallDirection = 'outbound' | 'inbound';
export type CallProvider  = 'dapta' | 'ycloud_whatsapp';
export type CallStatus =
  | 'initiated'
  | 'ringing'
  | 'connecting'
  | 'in-progress'
  | 'missed'
  | 'rejected'
  | 'completed'
  | 'no-answer'
  | 'voicemail'
  | 'busy'
  | 'failed'
  | 'transferred';

export interface Call {
  id:            string;
  companyId:     string;
  leadId:        string;
  direction:     CallDirection;
  provider:      CallProvider;
  status:        CallStatus;
  summary?:      string;
  transcript?:   string;
  recordingUrl?: string;
  durationSec?:  number;
  outcome?:      string;
  agentName?:    string;
  externalId?:   string;
  triggeredBy?:  string;
  // ── Señalización WebRTC (solo provider = 'ycloud_whatsapp') ────────────────
  sdpOffer?:     string;
  sdpAnswer?:    string;
  phoneId?:      string;
  claimedBy?:    string;
  assignedTo?:   string;
  leadName?:     string;
  leadPhone?:    string;
  createdAt:     Timestamp;
  updatedAt?:    Timestamp;
}

/** Fila del historial global de llamadas (página "Llamadas IA"). */
export interface RecentCall {
  id:            string;
  leadId:        string;
  leadName:      string;
  leadPhone:     string;
  status:        CallStatus;
  summary?:      string;
  transcript?:   string;
  recordingUrl?: string;
  durationSec?:  number;
  outcome?:      string;
  createdAt:     number;  // epoch millis
}

const _startAiCall = httpsCallable<
  { companyId: string; leadId: string },
  { callId: string; status: string }
>(functions, 'startAiCall');

interface CallRefInput { companyId: string; leadId: string; callId: string }

const _startWhatsappCall = httpsCallable<
  { companyId: string; leadId: string; sdpOffer: string },
  { callId: string }
>(functions, 'startWhatsappCall');

/** Inicia una llamada saliente de voz por WhatsApp hacia el lead. */
export async function startWhatsappCall(companyId: string, leadId: string, sdpOffer: string): Promise<string> {
  const r = await _startWhatsappCall({ companyId, leadId, sdpOffer });
  return r.data.callId;
}

const _requestCallPermission = httpsCallable<{ companyId: string; leadId: string }, { ok: true }>(
  functions, 'requestCallPermission'
);

/** Envía al lead una solicitud de permiso para llamarlo por WhatsApp. */
export async function requestCallPermission(companyId: string, leadId: string): Promise<void> {
  await _requestCallPermission({ companyId, leadId });
}

const _preAcceptWhatsappCall = httpsCallable<CallRefInput & { sdpAnswer: string }, { ok: true }>(
  functions, 'preAcceptWhatsappCall'
);
const _acceptWhatsappCall = httpsCallable<CallRefInput, { ok: true }>(functions, 'acceptWhatsappCall');
const _rejectWhatsappCall = httpsCallable<CallRefInput, { ok: true }>(functions, 'rejectWhatsappCall');
const _terminateWhatsappCall = httpsCallable<CallRefInput, { ok: true }>(functions, 'terminateWhatsappCall');

/** Pre-acepta una llamada de WhatsApp entrante (conexión de audio temprana). */
export async function preAcceptWhatsappCall(input: CallRefInput & { sdpAnswer: string }): Promise<void> {
  await _preAcceptWhatsappCall(input);
}

/** Acepta definitivamente una llamada de WhatsApp entrante ya pre-aceptada. */
export async function acceptWhatsappCall(input: CallRefInput): Promise<void> {
  await _acceptWhatsappCall(input);
}

/** Rechaza una llamada de WhatsApp entrante. */
export async function rejectWhatsappCall(input: CallRefInput): Promise<void> {
  await _rejectWhatsappCall(input);
}

/** Termina una llamada de WhatsApp en curso (entrante o saliente). */
export async function terminateWhatsappCall(input: CallRefInput): Promise<void> {
  await _terminateWhatsappCall(input);
}

const _listRecentCalls = httpsCallable<
  { companyId: string; limit?: number },
  { calls: RecentCall[] }
>(functions, 'listRecentCalls');

/** Dispara una llamada con IA (Dapta) hacia el lead. Pasa por Cloud Function. */
export async function startAiCall(companyId: string, leadId: string): Promise<string> {
  const r = await _startAiCall({ companyId, leadId });
  return r.data.callId;
}

/** Historial global de llamadas con IA de la empresa. */
export async function listRecentCalls(companyId: string, limit = 60): Promise<RecentCall[]> {
  const r = await _listRecentCalls({ companyId, limit });
  return r.data.calls;
}
