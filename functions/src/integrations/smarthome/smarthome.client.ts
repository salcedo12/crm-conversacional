import { env } from '../../config/env';
import { logger } from '../../utils/logger';

export interface SmartHomeUser {
  userId:       string;
  firstName:    string;
  lastName:     string;
  email:        string;
  mobileNumber?: string;
}

export interface SmartHomeProject {
  projectId?: string;
  code:       string;
  name?:      string;
}

export interface SmartHomeSaleRecord {
  prospectId?:     string;
  customerId?:     string;
  ownerId?:        string;
  userId?:         string;
  sellerId?:       string;
  advisorId?:      string;
  firstName?:      string;
  lastName?:       string;
  email?:          string;
  mobileNumber?:   string;
  secondPhoneNumber?: string;
  phoneNumber?:    string;
  telephone?:      string;
  cellPhone?:      string;
  ownerName?:      string;
  sellerName?:     string;
  advisorName?:    string;
  moduleName?:     string;
  projectName?:    string;
  stageName?:      string;
  saleCycleName?:  string;
  locationSource?: string;
  [key: string]:   unknown;
}

interface SmartHomeCompanyRecord {
  companyId?: string;
}

export interface AddCustomerPayload {
  moduleId:             string;   // unidad de interés (cupo1)
  locationSourceId:     string;   // fuente (WHATSAPP IA)
  origin?:              string;   // origen / Atendido En cuando SmartHome lo soporte
  ownerId:              string;   // asesor responsable (userId SmartHome)
  firstName:            string;
  lastName:             string;
  mobileNumber:         string;
  email?:               string;
  identificationNumber?: string;
  phoneNumber?:         string;
  city?:                string;
}

export interface AddCustomerResult {
  ok:         boolean;
  status:     number;
  returnCode?: string;
  customerId?: string;
  prospectId?: string;
  raw?:       unknown;
}

export interface UpdateProspectPayload {
  prospectId:   string;
  userId:       string;
  firstName?:   string;
  lastName?:    string;
  email?:       string;
  phoneNumber?: string;
  mobileNumber?: string;
  origin?:      string;
  comment?:     string;
}

export interface PostSmartHomeEventPayload {
  projectCode:    string;
  prospectId:     string;
  userId:         string;
  eventContent:   string;
  actionId?:      string | null;
  isAnEvent?:     boolean;
  scheduledDate?: string;
}

// ─── Cache de asesores (getUsers) ──────────────────────────────────────────────
let _usersCache: { at: number; users: SmartHomeUser[] } | null = null;
const USERS_TTL_MS = 10 * 60 * 1000;
let _projectsCache: { at: number; projects: SmartHomeProject[] } | null = null;
let _salesCache: { at: number; sales: SmartHomeSaleRecord[]; projectCode?: string } | null = null;
let _companyIdCache: { at: number; companyId: string } | null = null;
const SALES_TTL_MS = 5 * 60 * 1000;
const PHONE_FIELDS = ['mobileNumber', 'secondPhoneNumber', 'phoneNumber', 'telephone', 'cellPhone', 'phone', 'mobile', 'Celular', 'Telefono'];

function phoneKey(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length > 10 && digits.startsWith('57') ? digits.slice(-10) : digits.slice(-10);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function collectSalesRecords(value: unknown, out: SmartHomeSaleRecord[] = [], depth = 0): SmartHomeSaleRecord[] {
  if (depth > 6 || value == null) return out;
  if (Array.isArray(value)) {
    value.forEach((item) => collectSalesRecords(item, out, depth + 1));
    return out;
  }

  const record = asRecord(value);
  if (!record) return out;

  const hasPhone = PHONE_FIELDS.some((field) => phoneKey(record[field]));
  const hasLeadIdentity = ['prospectId', 'customerId', 'firstName', 'lastName', 'email'].some((field) => record[field]);
  if (hasPhone && hasLeadIdentity) out.push(record as SmartHomeSaleRecord);

  for (const key of ['prospects', 'sales', 'records', 'customers', 'data', 'items']) {
    if (key in record) collectSalesRecords(record[key], out, depth + 1);
  }
  return out;
}

function dedupeSales(records: SmartHomeSaleRecord[]): SmartHomeSaleRecord[] {
  const seen = new Set<string>();
  return records.filter((record, index) => {
    const key = String(record.prospectId ?? record.customerId ?? `${record.mobileNumber ?? ''}-${record.phoneNumber ?? ''}-${index}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Lista de usuarios/asesores de SmartHome (cacheada 10 min). null ante error. */
export async function getSmartHomeUsers(force = false): Promise<SmartHomeUser[] | null> {
  if (!force && _usersCache && Date.now() - _usersCache.at < USERS_TTL_MS) {
    return _usersCache.users;
  }
  const url = `${env.smartHomeApiBase()}/api/v1/getUsers/${env.smartHomeCompany()}/`;
  try {
    const res  = await fetch(url);
    const data = (await res.json()) as { returnCode?: string; users?: SmartHomeUser[] };
    if (!res.ok || data.returnCode !== 'SUCCESS' || !Array.isArray(data.users)) {
      logger.error('[smartHome] getUsers respuesta inválida', { status: res.status, returnCode: data.returnCode });
      return null;
    }
    _usersCache = { at: Date.now(), users: data.users };
    return data.users;
  } catch (err) {
    logger.error('[smartHome] Error consultando getUsers', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function getSmartHomeCompanyId(force = false): Promise<string | null> {
  if (!force && _companyIdCache && Date.now() - _companyIdCache.at < USERS_TTL_MS) {
    return _companyIdCache.companyId;
  }
  const url = `${env.smartHomeApiBase()}/api/v1/getCompany/${env.smartHomeCompany()}`;
  try {
    const res = await fetch(url);
    const data = (await res.json()) as { returnCode?: string; company?: SmartHomeCompanyRecord[] };
    const companyId = data.company?.[0]?.companyId;
    if (!res.ok || data.returnCode !== 'SUCCESS' || !companyId) {
      logger.error('[smartHome] getCompany respuesta invalida', { status: res.status, returnCode: data.returnCode });
      return null;
    }
    _companyIdCache = { at: Date.now(), companyId };
    return companyId;
  } catch (err) {
    logger.error('[smartHome] Error consultando getCompany', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function getSmartHomeBiUserKey(): Promise<string | null> {
  const companyId = await getSmartHomeCompanyId();
  if (!companyId) return null;
  return Buffer.from(`${companyId};${env.smartHomeBiUserId()}`, 'utf8').toString('base64');
}

/** Lista de proyectos de SmartHome (cacheada 5 min). null ante error. */
export async function getSmartHomeProjects(force = false): Promise<SmartHomeProject[] | null> {
  if (!force && _projectsCache && Date.now() - _projectsCache.at < SALES_TTL_MS) {
    return _projectsCache.projects;
  }
  const url = `${env.smartHomeApiBase()}/api/v1/getProjects/${env.smartHomeCompany()}/`;
  try {
    const res = await fetch(url);
    const data = (await res.json()) as { returnCode?: string; project?: SmartHomeProject[] };
    if (!res.ok || data.returnCode !== 'SUCCESS' || !Array.isArray(data.project)) {
      logger.error('[smartHome] getProjects respuesta invalida', { status: res.status, returnCode: data.returnCode });
      return null;
    }
    const projects = data.project.filter((project) => project.code);
    _projectsCache = { at: Date.now(), projects };
    return projects;
  } catch (err) {
    logger.error('[smartHome] Error consultando getProjects', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Prospectos/ventas de un proyecto en SmartHome (cacheados 5 min). null ante error. */
export async function getSmartHomeSales(projectCode = env.smartHomeProject(), force = false): Promise<SmartHomeSaleRecord[] | null> {
  if (!force && _salesCache && _salesCache.projectCode === projectCode && Date.now() - _salesCache.at < SALES_TTL_MS) {
    return _salesCache.sales;
  }
  const url = `${env.smartHomeApiBase()}/api/v1/getSales/${env.smartHomeCompany()}/${projectCode}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const records = dedupeSales(collectSalesRecords(data));
    const returnCode = asRecord(data)?.returnCode;
    if (!res.ok || (returnCode && returnCode !== 'SUCCESS')) {
      logger.error('[smartHome] getSales respuesta invalida', { status: res.status, returnCode });
      return null;
    }
    _salesCache = { at: Date.now(), sales: records, projectCode };
    return records;
  } catch (err) {
    logger.error('[smartHome] Error consultando getSales', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Prospectos/ventas de todos los proyectos visibles de SmartHome. */
export async function getAllSmartHomeSales(force = false): Promise<SmartHomeSaleRecord[] | null> {
  const projects = await getSmartHomeProjects(force);
  if (!projects) return null;

  const batches = await Promise.all(projects.map((project) => getSmartHomeSales(project.code, force)));
  if (batches.some((batch) => batch === null)) return null;

  return dedupeSales(batches.flatMap((batch) => batch ?? []));
}

/** Busca prospectos existentes por celular antes de crear, para respetar el bloqueo anti-duplicado de SmartHome UI. */
export async function findSmartHomeProspectsByPhone(phone: string): Promise<SmartHomeSaleRecord[] | null> {
  const target = phoneKey(phone);
  if (!target) return [];

  const biMatches = await findSmartHomeBiProspectsByPhone(phone);
  if (biMatches === null) return null;
  if (biMatches.length > 0) return biMatches;

  const sales = await getAllSmartHomeSales();
  if (!sales) return null;
  return sales.filter((record) =>
    PHONE_FIELDS.some((field) => phoneKey(record[field]) === target)
  );
}

/** Busca prospectos en el endpoint BI, que coincide mejor con la busqueda visible en la UI de SmartHome. */
export async function findSmartHomeBiProspectsByPhone(phone: string): Promise<SmartHomeSaleRecord[] | null> {
  const target = phoneKey(phone);
  if (!target) return [];

  const userKey = await getSmartHomeBiUserKey();
  if (!userKey) return null;

  const matches: SmartHomeSaleRecord[] = [];
  const recordsPerPage = 1000;
  const createdDate = '2020-01-01';
  let totalPages = 1;

  for (let page = 1; page <= totalPages && page <= 50; page += 1) {
    const url = `${env.smartHomeBiBase()}/api/bi/getProspectDetail/${userKey}/?page=${page}&records=${recordsPerPage}&createdDate=${createdDate}`;
    try {
      const res = await fetch(url);
      const data = (await res.json()) as { records?: SmartHomeSaleRecord[]; pages?: number; status?: string; message?: string };
      if (!res.ok || !Array.isArray(data.records)) {
        logger.error('[smartHome] getProspectDetail BI respuesta invalida', {
          status: res.status,
          page,
          message: data.message ?? data.status,
        });
        return null;
      }
      totalPages = Number(data.pages || totalPages || 1);
      matches.push(...data.records.filter((record) =>
        PHONE_FIELDS.some((field) => phoneKey(record[field]) === target)
      ));
      if (matches.length > 0) break;
    } catch (err) {
      logger.error('[smartHome] Error consultando getProspectDetail BI', {
        page,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  return dedupeSales(matches);
}

/**
 * Crea un cliente/prospecto en SmartHome, asignado al asesor (ownerId), bajo la
 * unidad (moduleId) y con la fuente (locationSourceId). No lanza: devuelve el
 * resultado con ok/status para que el llamador decida.
 */
export async function addSmartHomeCustomer(payload: AddCustomerPayload): Promise<AddCustomerResult> {
  const url = `${env.smartHomeApiBase()}/api/v1/addCustomer/${env.smartHomeCompany()}/${env.smartHomeProject()}`;
  try {
    const res  = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    let data: Record<string, unknown> = {};
    try { data = (await res.json()) as Record<string, unknown>; } catch { /* respuesta no-JSON */ }

    const returnCode = typeof data.returnCode === 'string' ? data.returnCode : undefined;
    const firstProspect = Array.isArray(data.prospects) ? data.prospects[0] as Record<string, unknown> | undefined : undefined;
    const customerId = (
      data.customerId || data.customerID || data.id || firstProspect?.customerId
    ) as string | undefined;
    const prospectId = (
      data.prospectId || firstProspect?.prospectId
    ) as string | undefined;
    const ok = res.ok && (returnCode === undefined || returnCode === 'SUCCESS');

    if (!ok) {
      logger.error('[smartHome] addCustomer rechazado', { status: res.status, returnCode, raw: data });
    }
    return { ok, status: res.status, returnCode, customerId, prospectId, raw: data };
  } catch (err) {
    logger.error('[smartHome] Error en addCustomer', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, status: 0 };
  }
}

/**
 * Actualiza un prospecto existente. Lo usamos justo después de addCustomer para
 * poblar `origin`, que en la UI corresponde a "Atendido En" y no forma parte
 * del body documentado de addCustomer.
 */
export async function updateSmartHomeProspect(payload: UpdateProspectPayload): Promise<AddCustomerResult> {
  const url = `${env.smartHomeApiBase()}/api/v1/updateProspect/${env.smartHomeCompany()}/`;
  try {
    const res  = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    let data: Record<string, unknown> = {};
    try { data = (await res.json()) as Record<string, unknown>; } catch { /* respuesta no-JSON */ }

    const returnCode = typeof data.returnCode === 'string' ? data.returnCode : undefined;
    const ok = res.ok && (returnCode === undefined || returnCode === 'SUCCESS');

    if (!ok) {
      logger.error('[smartHome] updateProspect rechazado', { status: res.status, returnCode, raw: data });
    }
    return { ok, status: res.status, returnCode, raw: data };
  } catch (err) {
    logger.error('[smartHome] Error en updateProspect', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, status: 0 };
  }
}

/** Crea una bitacora o tarea en el seguimiento de un prospecto. */
export async function postSmartHomeEvent(payload: PostSmartHomeEventPayload): Promise<AddCustomerResult> {
  const url = `${env.smartHomeApiBase()}/api/v1/postEvent/${env.smartHomeCompany()}/${payload.projectCode}/${payload.prospectId}/`;
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        userId:       payload.userId,
        actionId:     payload.actionId ?? null,
        eventContent: payload.eventContent,
        isAnEvent:    payload.isAnEvent ?? false,
        ...(payload.scheduledDate ? { scheduledDate: payload.scheduledDate } : {}),
      }),
    });
    let data: Record<string, unknown> = {};
    try { data = (await res.json()) as Record<string, unknown>; } catch { /* respuesta no-JSON */ }

    const returnCode = typeof data.returnCode === 'string' ? data.returnCode : undefined;
    const ok = res.ok && (returnCode === undefined || returnCode === 'SUCCESS');
    if (!ok) {
      logger.error('[smartHome] postEvent rechazado', { status: res.status, returnCode, raw: data });
    }
    return { ok, status: res.status, returnCode, raw: data };
  } catch (err) {
    logger.error('[smartHome] Error en postEvent', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, status: 0 };
  }
}
