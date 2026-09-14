import { getFunctions, httpsCallable } from '@react-native-firebase/functions';

const functionsInstance = getFunctions(undefined, 'us-central1');
const callable = <TInput, TResult>(name: string) =>
  httpsCallable<TInput, TResult>(functionsInstance, name);

export type AdvisorWhatsappStatus =
  | 'configuration_required'
  | 'disconnected'
  | 'qr_pending'
  | 'connected'
  | 'stale'
  | 'error';

export interface AdvisorWhatsappConnection {
  advisorId: string;
  status: AdvisorWhatsappStatus;
  phone: string | null;
  displayName: string | null;
  lastSeenAt: number | null;
  qrExpiresAt: number | null;
  error: string | null;
  updatedAt: number | null;
}

export interface AdvisorWhatsappQrResult {
  status: AdvisorWhatsappStatus;
  configured: boolean;
  qrCode?: string;
  qrCodeDataUrl?: string;
  phone?: string;
  displayName?: string;
  lastSeenAt?: string;
  expiresAt?: string;
  message?: string;
  error?: string;
}

export async function listAdvisorWhatsappConnections(
  companyId: string,
  advisorId?: string
): Promise<AdvisorWhatsappConnection[]> {
  const result = await callable<{ companyId: string; advisorId?: string }, { connections: AdvisorWhatsappConnection[] }>('listAdvisorWhatsappConnections')({ companyId, advisorId });
  return result.data.connections;
}

export async function requestAdvisorWhatsappQr(
  companyId: string,
  advisorId?: string
): Promise<AdvisorWhatsappQrResult> {
  const result = await callable<{ companyId: string; advisorId?: string }, AdvisorWhatsappQrResult>('requestAdvisorWhatsappQr')({ companyId, advisorId });
  return result.data;
}

export async function disconnectAdvisorWhatsapp(companyId: string, advisorId?: string): Promise<void> {
  await callable<{ companyId: string; advisorId?: string }, { ok: boolean }>('disconnectAdvisorWhatsapp')({ companyId, advisorId });
}
