import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@/config/firebase';

export type CompanyEnvironment = 'demo' | 'production';
export type ChannelProvider = 'ycloud' | 'dapta' | 'twilio' | 'messenger' | 'instagram' | 'meta';

export interface ChannelRoute {
  id: string;
  provider: ChannelProvider;
  identifier: string;
  companyId: string;
  label: string;
  active: boolean;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface PlatformCompany {
  id: string;
  name: string;
  environment: CompanyEnvironment;
  active: boolean;
  smartHomeEnabled: boolean;
  createdAt: number | null;
  updatedAt: number | null;
  channelRoutes: ChannelRoute[];
}

const _listCompanies = httpsCallable<void, { companies: PlatformCompany[] }>(
  functions,
  'listPlatformCompanies'
);

const _saveCompany = httpsCallable<{
  companyId: string;
  name: string;
  environment: CompanyEnvironment;
  active: boolean;
  smartHomeEnabled: boolean;
}, { companyId: string }>(functions, 'savePlatformCompany');

const _saveRoute = httpsCallable<{
  companyId: string;
  provider: ChannelProvider;
  identifier: string;
  label?: string;
  active: boolean;
}, { route: ChannelRoute }>(functions, 'saveChannelRoute');

async function refreshCurrentToken(): Promise<void> {
  await auth.currentUser?.getIdToken(true);
}

export async function listPlatformCompanies(): Promise<PlatformCompany[]> {
  await refreshCurrentToken();
  return (await _listCompanies()).data.companies;
}

export async function savePlatformCompany(input: {
  companyId: string;
  name: string;
  environment: CompanyEnvironment;
  active: boolean;
  smartHomeEnabled: boolean;
}): Promise<string> {
  await refreshCurrentToken();
  return (await _saveCompany(input)).data.companyId;
}

export async function saveChannelRoute(input: {
  companyId: string;
  provider: ChannelProvider;
  identifier: string;
  label?: string;
  active: boolean;
}): Promise<ChannelRoute> {
  await refreshCurrentToken();
  return (await _saveRoute(input)).data.route;
}
