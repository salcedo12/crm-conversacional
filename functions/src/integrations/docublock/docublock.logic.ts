import type { ClientProfile, SignatureStatus } from '../../modules/deals/deals.types';

/**
 * Reglas puras de la firma con DocuBlock (sin red), para poder probarlas.
 *
 * Lo que se ve en los documentos que ya envía SmartHome (GET /api/documents/{id}):
 *   - `signatureProgress`: 1 = en firma, 3 = firmado por todos.
 *   - `endorsement[].checked`: 1 = ese firmante ya firmó; `order` = su turno (iteración).
 *   - `versions[0].expirationSign`: vence el link de firma (~5 días).
 */

export const DOCUBLOCK_ORGANIZATION_ID = '68276a30ec9007c33d6f9b97'; // GRUPO CONSTRUCTOR MERAKI S.A.S. ZOMAC
const COMPLETED_PROGRESS = 3;

/** Firmante tal como lo pide `create-pdf-base64` (endorsementInput). */
export interface EndorsementInput {
  firstName:          string;
  lastName:           string;
  identification:     string;
  reqDocument:        boolean;
  expeditionDate:     string;
  expeditionCity:     string;
  identificationKind: string;
  email:              string;
  city:               string;
  country:            string;
  cellphone:          string;
  principalSigner:    boolean;
  typeSign:           string;
  iteration:          number;
  kindPerson:         string;
}

/** Usuario de DocuBlock (administrativos de Meraki) tal como llega de /api/users/get-all. */
export interface DocuBlockUser {
  _id:                 string;
  names?:              string;
  surNames?:           string;
  email?:              string;
  phone?:              string;
  identificationType?: string | { _id?: string; abbreviation?: string; name?: string };
  identification?:     string;
  expeditionDate?:     string;
  expeditionCity?:     string | { _id?: string; name?: string };
  city?:               string | { _id?: string; name?: string };
  country?:            string | { _id?: string; name?: string; abbreviation?: string };
  organizations?:      Array<{ organization?: string | { _id?: string }; role?: string | { name?: string } }>;
}

export interface DocuBlockEndorsement {
  _id?:      string;
  checked?:  number;
  order?:    number;
  typeSign?: string;
  identity?: { _id?: string; signer?: { _id?: string; firstName?: string; lastName?: string; email?: string } };
}

export interface DocuBlockDocument {
  _id:                string;
  name?:              string;
  path?:              string;
  state?:             number;
  signatureProgress?: number;
  currentOrder?:      number;
  endorsement?:       DocuBlockEndorsement[];
  versions?:          Array<{
    path?: string;
    expirationSign?: string;
    signatureProgress?: string;
    _doc?: { path?: string; expirationSign?: string; signatureProgress?: string };
  }>;
}

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** '+573022911626' → '3022911626' (DocuBlock pide el celular sin indicativo, como en su ejemplo). */
export function localCellphone(mobile: string): string {
  const digits = String(mobile ?? '').replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('57') ? digits.slice(2) : digits;
}

/** Fecha 'YYYY-MM-DD' (DocuBlock la guarda así); acepta ISO completo. */
const isoDate = (value: unknown) => clean(value).slice(0, 10);

export function buyerEndorsement(
  client: ClientProfile,
  opts: { typeSign: string; iteration: number; principal: boolean; requirePhoto: boolean },
): EndorsementInput {
  return {
    firstName: clean(client.firstNames),
    lastName: clean(client.lastNames),
    identification: clean(client.identificationNumber),
    reqDocument: opts.requirePhoto,
    expeditionDate: isoDate(client.expeditionDate),
    expeditionCity: clean(client.expeditionCity),
    identificationKind: client.identificationKind,
    email: clean(client.email).toLowerCase(),
    city: clean(client.residenceCity),
    country: clean(client.residenceCountry) || 'Colombia',
    cellphone: localCellphone(client.mobile),
    principalSigner: opts.principal,
    typeSign: opts.typeSign,
    iteration: opts.iteration,
    kindPerson: client.personKind === 'juridica' ? 'Persona Juridica' : 'Persona Natural',
  };
}

/** Extrae nombre/texto de un campo que en la API puede venir como string u objeto poblado de Mongoose. */
function fieldText(v: unknown, preferAbbrev = false): string {
  if (typeof v === 'string') return clean(v);
  if (v && typeof v === 'object') {
    const obj = v as { abbreviation?: string; name?: string; _id?: string };
    return clean(preferAbbrev ? (obj.abbreviation ?? obj.name ?? obj._id) : (obj.name ?? obj.abbreviation ?? obj._id));
  }
  return '';
}

const VALID_ID_KINDS = new Set(['CC', 'CE', 'NIT', 'PAS', 'PA', 'PPT', 'TI', 'RUT']);

function normalizeUserIdKind(v: unknown): string {
  const raw = fieldText(v, true).toUpperCase();
  if (VALID_ID_KINDS.has(raw)) return raw === 'PA' ? 'PAS' : raw;
  if (raw.includes('EXTRANJER')) return 'CE';
  if (raw.includes('PASAPORT')) return 'PAS';
  if (raw.includes('NIT')) return 'NIT';
  // Si viene como ObjectId (ej. 661a27059d979c2242a463a5 = CC en DocuBlock) o vacío, usar 'CC'.
  return 'CC';
}

export function userEndorsement(user: DocuBlockUser, opts: { typeSign: string; iteration: number }): EndorsementInput {
  const city = fieldText(user.city);
  const expCity = fieldText(user.expeditionCity) || city;
  return {
    firstName: clean(user.names),
    lastName: clean(user.surNames),
    identification: clean(user.identification),
    reqDocument: false,
    expeditionDate: isoDate(user.expeditionDate),
    expeditionCity: expCity,
    identificationKind: normalizeUserIdKind(user.identificationType),
    email: clean(user.email).toLowerCase(),
    city,
    country: fieldText(user.country) || 'Colombia',
    cellphone: localCellphone(user.phone ?? ''),
    principalSigner: false,
    typeSign: opts.typeSign,
    iteration: opts.iteration,
    kindPerson: 'Persona Natural',
  };
}

/** Qué le falta a un firmante para que DocuBlock lo acepte (se avisa antes de enviar). */
export function missingSignerData(signer: EndorsementInput): string[] {
  const missing: string[] = [];
  if (!signer.firstName || !signer.lastName) missing.push('nombre completo');
  if (!signer.identification) missing.push('número de documento');
  if (!signer.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(signer.email)) missing.push('correo');
  if (!signer.cellphone) missing.push('celular');
  if (!signer.typeSign) missing.push('tipo de firmante');
  return missing;
}

export const userFullName = (user: DocuBlockUser) => clean(`${user.names ?? ''} ${user.surNames ?? ''}`);

export function userRoleName(user: DocuBlockUser): string {
  const membership = (user.organizations ?? []).find((o) => (typeof o.organization === 'string' ? o.organization : o.organization?._id) === DOCUBLOCK_ORGANIZATION_ID);
  const role = membership?.role;
  return clean(typeof role === 'string' ? role : role?.name);
}

export const isMerakiUser = (user: DocuBlockUser) =>
  (user.organizations ?? []).some((o) => (typeof o.organization === 'string' ? o.organization : o.organization?._id) === DOCUBLOCK_ORGANIZATION_ID);

export interface SignerProgress {
  endorsementId: string;
  name:          string;
  email:         string;
  typeSign:      string;
  order:         number;
  signed:        boolean;
}

export interface DocumentProgress {
  status:   SignatureStatus;
  signers:  SignerProgress[];
  /** Archivo del documento en DocuBlock (al terminar, el PDF firmado). */
  fileUrl:  string | null;
  expiresAt: string | null;
}

/** Estado del documento para el CRM a partir de la respuesta de DocuBlock. */
export function documentProgress(doc: DocuBlockDocument, now = new Date()): DocumentProgress {
  const signers: SignerProgress[] = (doc.endorsement ?? []).map((e) => ({
    endorsementId: e.identity?.signer?._id ?? e._id ?? '',
    name: clean(`${e.identity?.signer?.firstName ?? ''} ${e.identity?.signer?.lastName ?? ''}`),
    email: clean(e.identity?.signer?.email),
    typeSign: clean(e.typeSign),
    order: e.order ?? 1,
    signed: e.checked === 1,
  }));
  const version = doc.versions?.[doc.versions.length - 1];
  const expiresAt = version?.expirationSign ?? version?._doc?.expirationSign ?? null;
  const allSigned = signers.length > 0 && signers.every((s) => s.signed);

  let status: SignatureStatus;
  if (doc.signatureProgress === COMPLETED_PROGRESS || allSigned) status = 'firmado';
  else if (expiresAt && new Date(expiresAt).getTime() < now.getTime()) status = 'vencido';
  else if (signers.some((s) => s.signed)) status = 'firmado_parcial';
  else status = 'en_firma';

  return { status, signers, fileUrl: version?.path ?? version?._doc?.path ?? doc.path ?? null, expiresAt };
}

// ─── Ciudades y países: deben ir escritos EXACTAMENTE como en DocuBlock ───────
// (SmartHome fallaba con "Ibague" frente a "Ibagué"). Se busca sin tildes ni mayúsculas
// y se envía el nombre de DocuBlock.

export const COLOMBIA_ID = '661a1fb2a0e9e20423fe6cc8';

export interface DocuBlockCity { _id: string; name: string; country: string | { _id?: string } }
export interface DocuBlockCountry { _id: string; name: string; abbreviation?: string }

export const placeKey = (value: unknown) =>
  String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const cityCountryId = (city: DocuBlockCity) => (typeof city.country === 'string' ? city.country : city.country?._id ?? '');

export interface PlaceMatch { city: string; country: string }

/**
 * Código del país como lo exige create-pdf-base64 en producción: la abreviatura ("CO").
 * Con el nombre ("Colombia") o el id responde "Pais de X no encontrado" (probado 2026-10-29).
 */
export function countryCode(countryName: string | undefined, countries: DocuBlockCountry[]): string {
  const found = countries.find((c) => placeKey(c.name) === placeKey(countryName || 'Colombia'));
  return found?.abbreviation || (countries.find((c) => c._id === COLOMBIA_ID)?.abbreviation ?? 'CO');
}

/**
 * Ciudad de la ficha → nombre exacto de DocuBlock (primero en Colombia). Con nombres
 * repetidos (p. ej. "Sahagun"/"Sahagún") se prefiere el que lleva tilde.
 */
export function matchCity(name: string, cities: DocuBlockCity[], countries: DocuBlockCountry[], countryName?: string): PlaceMatch | null {
  const cleanId = String(name ?? '').trim();
  const byId = /^[a-f0-9]{24}$/i.test(cleanId) ? cities.find((c) => c._id === cleanId) : undefined;
  if (byId) {
    const cid = cityCountryId(byId);
    const country = countries.find((c) => c._id === cid)?.name ?? 'Colombia';
    return { city: byId.name, country };
  }
  const key = placeKey(name);
  if (!key) return null;
  const same = cities.filter((c) => placeKey(c.name) === key);
  if (!same.length) return null;
  const accented = (c: DocuBlockCity) => Number(/[^\u0000-\u007f]/.test(c.name));
  const pick = (list: DocuBlockCity[]) => [...list].sort((a, b) => accented(b) - accented(a))[0];
  // Primero en el país de la ficha (por defecto Colombia), luego en cualquiera.
  const countryId = countries.find((c) => placeKey(c.name) === placeKey(countryName || 'Colombia'))?._id ?? COLOMBIA_ID;
  const inCountry = same.filter((c) => cityCountryId(c) === countryId);
  const city = pick(inCountry.length ? inCountry : same)!;
  const country = countries.find((c) => c._id === cityCountryId(city))?.name ?? 'Colombia';
  return { city: city.name, country };
}

/** Hasta 3 nombres parecidos de DocuBlock para sugerir cuando no hay coincidencia. */
export function suggestCities(name: string, cities: DocuBlockCity[]): string[] {
  const key = placeKey(name);
  if (!key) return [];
  const colombian = cities.filter((c) => cityCountryId(c) === COLOMBIA_ID);
  const hits = colombian.filter((c) => { const k = placeKey(c.name); return k.includes(key) || key.includes(k); });
  return [...new Set(hits.map((c) => c.name))].slice(0, 3);
}
