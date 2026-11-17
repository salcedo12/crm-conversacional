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

/**
 * Pide un código de vinculación en vez del QR (sirve aunque el CRM esté
 * abierto en el mismo celular). `phone` con indicativo de país (57300...).
 */
export async function requestAdvisorWhatsappPairingCode(
  companyId: string,
  advisorId: string,
  phone: string
): Promise<AdvisorWhatsappQrResult> {
  const result = await callable<
    { companyId: string; advisorId?: string; pairingPhone?: string },
    AdvisorWhatsappQrResult
  >('requestAdvisorWhatsappQr')({ companyId, advisorId, pairingPhone: phone });
  return result.data;
}

/** Formato legible del código: ABCD-1234. */
export function formatPairingCode(code: string): string {
  const clean = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

/** Dígitos con indicativo; un celular colombiano de 10 dígitos recibe el 57. */
export function pairingPhoneDigits(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('3')) return `57${digits}`;
  return digits;
}

export async function disconnectAdvisorWhatsapp(companyId: string, advisorId?: string): Promise<void> {
  await callable<{ companyId: string; advisorId?: string }, { ok: boolean }>('disconnectAdvisorWhatsapp')({ companyId, advisorId });
}
