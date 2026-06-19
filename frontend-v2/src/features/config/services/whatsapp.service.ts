import { httpsCallable } from 'firebase/functions';
import { functions }     from '@/config/firebase';

interface ExchangeCodeInput  { companyId: string; codeOrToken: string; redirectUri?: string; isCode?: boolean }
interface ExchangeCodeResult { phoneNumber: string; displayName: string; wabaId: string }

interface ConnectionResult {
  connected:    boolean;
  phoneNumber?: string;
  displayName?: string;
  wabaId?:      string;
  connectedAt?: number;
}

const _exchange    = httpsCallable<ExchangeCodeInput, ExchangeCodeResult>(functions, 'exchangeWhatsappCode');
const _getConn     = httpsCallable<{ companyId: string }, ConnectionResult>(functions, 'getWhatsappConnection');
const _disconnect  = httpsCallable<{ companyId: string }, { ok: boolean }>(functions, 'disconnectWhatsapp');

export async function exchangeWhatsappCode(
  companyId:    string,
  codeOrToken:  string,
  redirectUri?: string,
  isCode?:      boolean
): Promise<ExchangeCodeResult> {
  const r = await _exchange({ companyId, codeOrToken, redirectUri, isCode });
  return r.data;
}

export async function getWhatsappConnection(companyId: string): Promise<ConnectionResult> {
  const r = await _getConn({ companyId });
  return r.data;
}

export async function disconnectWhatsapp(companyId: string): Promise<void> {
  await _disconnect({ companyId });
}
