import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';

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
  /** Código de 8 caracteres para "Vincular con el número de teléfono". */
  pairingCode?: string;
  pairingPhone?: string;
  phone?: string;
  displayName?: string;
  lastSeenAt?: string;
  expiresAt?: string;
  message?: string;
  error?: string;
}

const _listConnections = httpsCallable<
  { companyId: string; advisorId?: string },
  { connections: AdvisorWhatsappConnection[] }
>(functions, 'listAdvisorWhatsappConnections');

const _requestQr = httpsCallable<
  { companyId: string; advisorId?: string; pairingPhone?: string },
  AdvisorWhatsappQrResult
>(functions, 'requestAdvisorWhatsappQr');

const _disconnect = httpsCallable<
  { companyId: string; advisorId?: string },
  { ok: boolean }
>(functions, 'disconnectAdvisorWhatsapp');

/** Línea de coexistencia (YCloud) del asesor: su propio número por la API oficial. */
export interface AdvisorMessagingLine {
  number: string;
  wabaId?: string;
}

const _getLine = httpsCallable<
  { companyId: string; advisorId?: string },
  { line: AdvisorMessagingLine | null }
>(functions, 'getMyMessagingLine');

export async function getMyMessagingLine(
  companyId: string,
  advisorId?: string
): Promise<AdvisorMessagingLine | null> {
  return (await _getLine({ companyId, advisorId })).data.line;
}

export async function listAdvisorWhatsappConnections(
  companyId: string,
  advisorId?: string
): Promise<AdvisorWhatsappConnection[]> {
  return (await _listConnections({ companyId, advisorId })).data.connections;
}

export async function requestAdvisorWhatsappQr(
  companyId: string,
  advisorId?: string
): Promise<AdvisorWhatsappQrResult> {
  return (await _requestQr({ companyId, advisorId })).data;
}

/**
 * Pide un código de vinculación (en vez del QR). El asesor lo escribe en
 * WhatsApp → Dispositivos vinculados → Vincular con el número de teléfono.
 * `phone` con indicativo de país (57300...).
 */
export async function requestAdvisorWhatsappPairingCode(
  companyId: string,
  advisorId: string,
  phone: string
): Promise<AdvisorWhatsappQrResult> {
  return (await _requestQr({ companyId, advisorId, pairingPhone: phone })).data;
}

/** Formato legible del código: ABCD-1234. */
export function formatPairingCode(code: string): string {
  const clean = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

export async function disconnectAdvisorWhatsapp(companyId: string, advisorId?: string): Promise<void> {
  await _disconnect({ companyId, advisorId });
}
