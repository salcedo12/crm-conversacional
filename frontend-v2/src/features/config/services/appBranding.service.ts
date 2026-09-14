import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';

export interface AppBranding {
  appName: string;
  tagline: string;
  logoUrl: string;
  primaryColor: string;
  updatedAt?: number | null;
}

export type AppBrandingDraft = Omit<AppBranding, 'updatedAt'>;

export const DEFAULT_APP_BRANDING: AppBrandingDraft = {
  appName: 'Meraki CRM',
  tagline: 'Conversacional',
  logoUrl: '/meraki-logo.png',
  primaryColor: '#7c3aed',
};

const _getAppBranding = httpsCallable<{ companyId: string }, AppBranding>(functions, 'getAppBranding');
const _saveAppBranding = httpsCallable<{ companyId: string } & AppBrandingDraft, { ok: boolean }>(functions, 'saveAppBranding');

export async function fetchAppBranding(companyId: string): Promise<AppBranding> {
  const result = await _getAppBranding({ companyId });
  return result.data;
}

export async function persistAppBranding(companyId: string, draft: AppBrandingDraft): Promise<void> {
  await _saveAppBranding({ companyId, ...draft });
}
