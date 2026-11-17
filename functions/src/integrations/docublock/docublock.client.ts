import { logger } from '../../utils/logger';
import type { DocuBlockCity, DocuBlockCountry, DocuBlockDocument, DocuBlockUser, EndorsementInput } from './docublock.logic';

/**
 * Cliente de la API de DocuBlock (bridge). Misma organización y API Key que SmartHome
 * (secreto DOCUBLOCK_API_KEY): no regenerarla sin actualizarla allá.
 * Docs: https://documenter.getpostman.com/view/31094055/2sA3e2gpwM
 */

const BASE_URL = process.env.DOCUBLOCK_BASE_URL || 'https://bridge.docublock.co';
const TIMEOUT_MS = 60_000;

export class DocuBlockError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const key = process.env.DOCUBLOCK_API_KEY;
  if (!key) throw new DocuBlockError('La firma con DocuBlock no está configurada.', 0);
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    // Nunca registrar el cuerpo enviado (lleva el PDF y datos de los firmantes).
    logger.error('[DocuBlock] Error de la API', { path, status: res.status, body: text.slice(0, 400) });
    let message = `DocuBlock respondió ${res.status}`;
    try { const j = JSON.parse(text) as { message?: string | string[] }; if (j.message) message = Array.isArray(j.message) ? j.message.join('; ') : j.message; } catch { /* texto plano */ }
    throw new DocuBlockError(message, res.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export interface DocuBlockTemplate {
  _id:         string;
  name:        string;
  directory?:  string;
  state?:      number;
  typeSigners?: Array<{ name: string; principal: boolean; type: string }>;
}

export interface DocuBlockDirectory { _id: string; name: string }

export async function listTemplates(): Promise<DocuBlockTemplate[]> {
  const res = await call<{ templates?: DocuBlockTemplate[] }>('POST', '/api/templates/get-all');
  return res.templates ?? [];
}

export async function listDirectories(): Promise<DocuBlockDirectory[]> {
  const res = await call<{ directories?: DocuBlockDirectory[] }>('POST', '/api/directories/get-all');
  return res.directories ?? [];
}

/** Usuarios, de a 10 por página: la página va en el cuerpo ({ page }); `?page=` se ignora. */
export async function listUsers(): Promise<DocuBlockUser[]> {
  const users = new Map<string, DocuBlockUser>();
  for (let page = 1; page <= 20; page += 1) {
    const res = await call<{ user?: DocuBlockUser[]; totalPages?: number | null }>('POST', '/api/users/get-all', { page });
    for (const user of res.user ?? []) users.set(user._id, user);
    if (!res.user?.length || page >= (res.totalPages ?? 1)) break;
  }
  return [...users.values()];
}

export interface CreatePdfDocumentInput {
  name:             string;
  filename:         string;
  baseFile:         string;   // PDF en base64
  template:         string;
  directory:        string;
  endorsementInput: EndorsementInput[];
  relatedInfo:      Record<string, string>;
  /** Responsable del documento: _id del usuario de DocuBlock (sin él queda el dueño de la API Key). */
  user?:            string;
}

export async function createPdfDocument(input: CreatePdfDocumentInput): Promise<{ id: string }> {
  const { user, ...rest } = input;
  const res = await call<unknown>('POST', '/api/documents/create-pdf-base64', {
    ...rest,
    ...(user ? { user } : {}),
    kind: 'API',
    pattern: '',
    metaObject: [],
  });
  // En producción responde una lista con el documento creado ([{ _id, … }]).
  const first = (Array.isArray(res) ? res[0] : res) as Record<string, unknown> | undefined;
  const doc = (first?.document ?? first?.data ?? first) as { _id?: string; id?: string } | undefined;
  let id = doc?._id ?? doc?.id;
  if (!id) {
    // Se creó pero la respuesta vino en otra forma: se busca por los datos del CRM para no duplicarlo.
    logger.error('[DocuBlock] Respuesta sin id de documento', { shape: Array.isArray(res) ? 'array' : typeof res, keys: first ? Object.keys(first) : [] });
    id = (await findDocumentByRelatedInfo(input.relatedInfo))?._id;
  }
  if (!id) throw new DocuBlockError('DocuBlock no devolvió el id del documento.', 0);
  return { id: String(id) };
}

/** Documento creado hace poco con estos datos del CRM (relatedInfo), en las primeras páginas. */
export async function findDocumentByRelatedInfo(info: Record<string, string>): Promise<DocuBlockDocument | null> {
  const recent = Date.now() - 30 * 60 * 1000;
  for (let page = 1; page <= 2; page += 1) {
    const res = await call<{ documents?: Array<DocuBlockDocument & { relatedInfo?: Record<string, string>; createdAt?: string }> }>('POST', '/api/documents/get-all', { page });
    const hit = (res.documents ?? []).find((d) => d.relatedInfo
      && Object.entries(info).every(([k, v]) => d.relatedInfo?.[k] === v)
      && new Date(d.createdAt ?? 0).getTime() >= recent);
    if (hit) return hit;
  }
  return null;
}

export async function getDocument(id: string): Promise<DocuBlockDocument> {
  return call<DocuBlockDocument>('GET', `/api/documents/${encodeURIComponent(id)}`);
}

export async function resendEndorsement(idDocument: string, idSigner: string): Promise<void> {
  await call('POST', '/api/documents/resend-endorsement-document', { idDocument, idSigner });
}

/**
 * Ciudades y países de DocuBlock (`get-all` trae la lista completa: ~11 mil ciudades).
 * Se guardan en memoria 6 h para no descargarlas en cada envío.
 */
const PLACES_TTL_MS = 6 * 60 * 60 * 1000;
let placesCache: { at: number; cities: DocuBlockCity[]; countries: DocuBlockCountry[] } | null = null;

async function fetchAllPages<T>(path: string, pickList: (res: Record<string, unknown>) => T[], maxPages = 50): Promise<T[]> {
  const first = await call<Record<string, unknown>>('POST', path, { page: 1 });
  const items = [...pickList(first)];
  const totalPages = Math.min(Number(first?.totalPages ?? 1) || 1, maxPages);
  if (totalPages > 1) {
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) => call<Record<string, unknown>>('POST', path, { page: i + 2 })),
    );
    for (const r of rest) items.push(...pickList(r));
  }
  return items;
}

export async function listPlaces(): Promise<{ cities: DocuBlockCity[]; countries: DocuBlockCountry[] }> {
  if (placesCache && placesCache.cities.length > 0 && Date.now() - placesCache.at < PLACES_TTL_MS) return placesCache;
  const pickCities = (res: Record<string, unknown>) => (Array.isArray(res) ? res : (res?.cities ?? res?.data ?? [])) as DocuBlockCity[];
  const pickCountries = (res: Record<string, unknown>) => (Array.isArray(res) ? res : (res?.countrydto ?? res?.countries ?? res?.data ?? [])) as DocuBlockCountry[];
  const [rawCities, rawCountries] = await Promise.all([
    fetchAllPages('/api/cities/get-all', pickCities),
    fetchAllPages('/api/countries/get-all', pickCountries),
  ]);
  const parsed = {
    at: Date.now(),
    cities: rawCities.map((c) => ({ _id: c._id, name: c.name, country: typeof c.country === 'string' ? c.country : c.country?._id ?? '' })),
    countries: rawCountries.map((c) => ({ _id: c._id, name: c.name, abbreviation: c.abbreviation })),
  };
  logger.info('[DocuBlock] listPlaces cargado', { cities: parsed.cities.length, countries: parsed.countries.length });
  if (parsed.cities.length > 0) placesCache = parsed;
  return parsed;
}
