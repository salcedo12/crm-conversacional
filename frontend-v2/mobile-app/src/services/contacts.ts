import { getFunctions, httpsCallable } from '@react-native-firebase/functions';

export interface CountryPrefixOption {
  iso: string;
  code: string;
  name: string;
  minDigits: number;
  maxDigits: number;
  placeholder: string;
  featured?: boolean;
}

export function isoToFlagEmoji(iso: string): string {
  const code = iso.trim().toUpperCase();
  if (code.length !== 2) return '🌎';
  return String.fromCodePoint(
    code.charCodeAt(0) - 65 + 0x1f1e6,
    code.charCodeAt(1) - 65 + 0x1f1e6
  );
}

export const COUNTRY_PREFIX_OPTIONS: CountryPrefixOption[] = [
  { iso: 'co', code: '+57',   name: 'Colombia',                 minDigits: 10, maxDigits: 10, placeholder: '310 123 4567', featured: true },
  { iso: 'us', code: '+1',    name: 'Estados Unidos',           minDigits: 10, maxDigits: 10, placeholder: '305 555 1234', featured: true },
  { iso: 'ca', code: '+1',    name: 'Canadá',                   minDigits: 10, maxDigits: 10, placeholder: '416 555 1234', featured: true },
  { iso: 'es', code: '+34',   name: 'España',                   minDigits: 9,  maxDigits: 9,  placeholder: '641 357 991',  featured: true },
  { iso: 'mx', code: '+52',   name: 'México',                   minDigits: 10, maxDigits: 10, placeholder: '55 1234 5678', featured: true },
  { iso: 'pa', code: '+507',  name: 'Panamá',                   minDigits: 7,  maxDigits: 8,  placeholder: '6123 4567',    featured: true },
  { iso: 'cl', code: '+56',   name: 'Chile',                    minDigits: 9,  maxDigits: 9,  placeholder: '9 8765 4321',  featured: true },
  { iso: 'ec', code: '+593',  name: 'Ecuador',                  minDigits: 9,  maxDigits: 9,  placeholder: '99 123 4567',  featured: true },
  { iso: 'pe', code: '+51',   name: 'Perú',                     minDigits: 9,  maxDigits: 9,  placeholder: '987 654 321',  featured: true },
  { iso: 'ar', code: '+54',   name: 'Argentina',                minDigits: 10, maxDigits: 11, placeholder: '9 11 1234 5678', featured: true },
  { iso: 'cr', code: '+506',  name: 'Costa Rica',               minDigits: 8,  maxDigits: 8,  placeholder: '8765 4321',    featured: true },
  { iso: 'br', code: '+55',   name: 'Brasil',                   minDigits: 10, maxDigits: 11, placeholder: '11 98765 4321', featured: true },
  { iso: 'gb', code: '+44',   name: 'Reino Unido',              minDigits: 10, maxDigits: 10, placeholder: '7700 900077',  featured: true },
  { iso: 'fr', code: '+33',   name: 'Francia',                  minDigits: 9,  maxDigits: 9,  placeholder: '6 12 34 56 78', featured: true },
  { iso: 'de', code: '+49',   name: 'Alemania',                 minDigits: 9,  maxDigits: 11, placeholder: '1512 3456789', featured: true },
  { iso: 'it', code: '+39',   name: 'Italia',                   minDigits: 9,  maxDigits: 10, placeholder: '312 345 6789', featured: true },
  { iso: 'ch', code: '+41',   name: 'Suiza',                    minDigits: 9,  maxDigits: 9,  placeholder: '78 123 45 67', featured: true },
  { iso: 'au', code: '+61',   name: 'Australia',                minDigits: 9,  maxDigits: 9,  placeholder: '412 345 678',  featured: true },
  { iso: 'ae', code: '+971',  name: 'Emiratos Árabes Unidos',   minDigits: 9,  maxDigits: 9,  placeholder: '50 123 4567',  featured: true },
  { iso: 'bo', code: '+591',  name: 'Bolivia',                  minDigits: 8,  maxDigits: 8,  placeholder: '71234567' },
  { iso: 'do', code: '+1809', name: 'República Dominicana',     minDigits: 7,  maxDigits: 7,  placeholder: '234 5678' },
  { iso: 'sv', code: '+503',  name: 'El Salvador',              minDigits: 8,  maxDigits: 8,  placeholder: '7012 3456' },
  { iso: 'gt', code: '+502',  name: 'Guatemala',                minDigits: 8,  maxDigits: 8,  placeholder: '5123 4567' },
  { iso: 'hn', code: '+504',  name: 'Honduras',                 minDigits: 8,  maxDigits: 8,  placeholder: '9123 4567' },
  { iso: 'ni', code: '+505',  name: 'Nicaragua',                minDigits: 8,  maxDigits: 8,  placeholder: '8123 4567' },
  { iso: 'nl', code: '+31',   name: 'Países Bajos (Holanda)',   minDigits: 9,  maxDigits: 9,  placeholder: '6 12345678' },
  { iso: 'pt', code: '+351',  name: 'Portugal',                 minDigits: 9,  maxDigits: 9,  placeholder: '912 345 678' },
  { iso: 'pr', code: '+1787', name: 'Puerto Rico',              minDigits: 7,  maxDigits: 7,  placeholder: '234 5678' },
  { iso: 'py', code: '+595',  name: 'Paraguay',                 minDigits: 9,  maxDigits: 9,  placeholder: '961 456789' },
  { iso: 'uy', code: '+598',  name: 'Uruguay',                  minDigits: 8,  maxDigits: 8,  placeholder: '94 231 234' },
  { iso: 've', code: '+58',   name: 'Venezuela',                minDigits: 10, maxDigits: 10, placeholder: '412 1234567' },
];

export function getCountryByIso(iso: string): CountryPrefixOption {
  const lower = iso.toLowerCase();
  return (
    COUNTRY_PREFIX_OPTIONS.find((o) => o.iso.toLowerCase() === lower) ||
    COUNTRY_PREFIX_OPTIONS[0]
  );
}

export function detectCountryFromInput(
  rawInput: string,
  currentIso: string
): { iso: string; localDigits: string } {
  const trimmed = rawInput.trim();
  const currentOpt = getCountryByIso(currentIso);

  if (!trimmed.startsWith('+') && !trimmed.startsWith('00')) {
    return {
      iso: currentOpt.iso,
      localDigits: rawInput.replace(/\D/g, '').slice(0, currentOpt.maxDigits + 3),
    };
  }

  const normalizedPlus = trimmed.startsWith('00') ? `+${trimmed.slice(2).trim()}` : trimmed;
  const digitsWithPlus = `+${normalizedPlus.replace(/\D/g, '')}`;
  const sorted = [...COUNTRY_PREFIX_OPTIONS].sort((a, b) => b.code.length - a.code.length);

  for (const opt of sorted) {
    if (digitsWithPlus.startsWith(opt.code) && digitsWithPlus.length > opt.code.length + 4) {
      const restDigits = digitsWithPlus.slice(opt.code.length).slice(0, opt.maxDigits);
      return { iso: opt.iso, localDigits: restDigits };
    }
  }

  return {
    iso: currentOpt.iso,
    localDigits: rawInput.replace(/\D/g, '').slice(0, currentOpt.maxDigits),
  };
}

export function buildInternationalPhone(
  isoOrCode: string,
  localValue: string
): { fullPhone: string; isValidLength: boolean; digitsCount: number; country: CountryPrefixOption } {
  const opt =
    COUNTRY_PREFIX_OPTIONS.find(
      (o) => o.iso.toLowerCase() === isoOrCode.toLowerCase() || o.code === isoOrCode
    ) || COUNTRY_PREFIX_OPTIONS[0];

  const cleanDigits = localValue.replace(/\D/g, '');
  const prefixDigits = opt.code.replace(/\D/g, '');
  let nationalDigits = cleanDigits;

  if (
    nationalDigits.startsWith(prefixDigits) &&
    nationalDigits.length >= prefixDigits.length + opt.minDigits &&
    nationalDigits.length <= prefixDigits.length + opt.maxDigits
  ) {
    nationalDigits = nationalDigits.slice(prefixDigits.length);
  }

  nationalDigits = nationalDigits.slice(0, opt.maxDigits);
  const fullDigits = `${prefixDigits}${nationalDigits}`;

  return {
    fullPhone: nationalDigits ? `+${fullDigits}` : '',
    isValidLength:
      nationalDigits.length >= opt.minDigits &&
      nationalDigits.length <= opt.maxDigits &&
      fullDigits.length >= 8 &&
      fullDigits.length <= 15,
    digitsCount: nationalDigits.length,
    country: opt,
  };
}

export interface CreateContactFullInput {
  companyId: string;
  name?: string;
  phone: string;
  email?: string;
  company?: string;
  project?: string;
  tags?: string[];
  assignedTo?: string;
  notes?: string;
  fuenteUbicacion?: string;
}

export interface CreateContactFullResult {
  leadId: string;
  existed: boolean;
  reclaimed?: boolean;
}

export interface PhoneAvailabilityResult {
  status: 'invalid' | 'available' | 'own' | 'reclaimable' | 'locked_by_other';
  normalizedPhone?: string;
  message?: string;
  leadId?: string;
  leadName?: string;
  advisorId?: string | null;
  advisorName?: string;
  daysSinceActivity?: number | null;
  project?: string;
  fuenteUbicacion?: string;
  hasPendingRequest?: boolean;
}

export interface LeadTransferRequestItem {
  id: string;
  leadId: string;
  leadName: string;
  leadPhone: string;
  leadProject: string;
  leadSource: string;
  requesterId: string;
  requesterName: string;
  currentAdvisorId: string | null;
  currentAdvisorName: string;
  lastFollowUpMillis: number | null;
  daysSinceFollowUp: number | null;
  lastFollowUpSummary: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAtMillis: number;
  resolvedAtMillis: number | null;
  resolvedByName: string;
  adminNote: string;
}

const fn = getFunctions(undefined, 'us-central1');
const createCall = httpsCallable<CreateContactFullInput, CreateContactFullResult>(fn, 'createContact');
const checkPhoneCall = httpsCallable<{ companyId: string; phone: string }, PhoneAvailabilityResult>(fn, 'checkPhoneAvailability');
const requestTransferCall = httpsCallable<
  { companyId: string; leadId?: string; phone?: string; reason?: string },
  { requestId: string; alreadyPending: boolean }
>(fn, 'requestLeadTransfer');
const listTransfersCall = httpsCallable<
  { companyId: string; status?: 'pending' | 'approved' | 'rejected' | 'all' },
  { requests: LeadTransferRequestItem[] }
>(fn, 'listLeadTransferRequests');
const resolveTransferCall = httpsCallable<
  { companyId: string; requestId: string; decision: 'approve' | 'reject'; adminNote?: string },
  { ok: boolean; status: 'approved' | 'reject'; leadId: string }
>(fn, 'resolveLeadTransferRequest');

export async function createContactFull(input: CreateContactFullInput): Promise<CreateContactFullResult> {
  return (await createCall(input)).data;
}

export async function checkPhoneAvailability(companyId: string, phone: string): Promise<PhoneAvailabilityResult> {
  return (await checkPhoneCall({ companyId, phone })).data;
}

export async function requestLeadTransfer(input: {
  companyId: string;
  leadId?: string;
  phone?: string;
  reason?: string;
}): Promise<{ requestId: string; alreadyPending: boolean }> {
  return (await requestTransferCall(input)).data;
}

export async function listLeadTransferRequests(
  companyId: string,
  status: 'pending' | 'approved' | 'rejected' | 'all' = 'all'
): Promise<LeadTransferRequestItem[]> {
  return (await listTransfersCall({ companyId, status })).data.requests || [];
}

export async function resolveLeadTransferRequest(input: {
  companyId: string;
  requestId: string;
  decision: 'approve' | 'reject';
  adminNote?: string;
}) {
  return (await resolveTransferCall(input)).data;
}
