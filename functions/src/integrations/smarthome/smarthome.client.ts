import { env } from '../../config/env';
import { logger } from '../../utils/logger';

/**
 * fetch con timeout duro (AbortController). Evita que una llamada colgada o muy
 * lenta de SmartHome arrastre a toda la Cloud Function hasta su timeout de request
 * (p. ej. tumbar el envío de un mensaje manual de WhatsApp). Al abortar, `fetch`
 * lanza y lo captura el try/catch de cada función → se registra y se sigue.
 */
const SMARTHOME_FETCH_TIMEOUT_MS = 10_000;
async function shFetch(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SMARTHOME_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

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

export interface SmartHomeSaleCycleStage {
  stageId:   string;
  name:      string;
  probability?: number;
  cycleId?:  string;
  cycleName?: string;
  [key: string]: unknown;
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
  stageId?:     string;
  firstName?:   string;
  lastName?:    string;
  email?:       string;
  phoneNumber?: string;
  mobileNumber?: string;
  probability?: number;
  moduleId?:    string;
  ownerId?:     string;
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
    const res  = await shFetch(url);
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
    const res = await shFetch(url);
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
    const res = await shFetch(url);
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

function collectSaleCycleStages(value: unknown, out: SmartHomeSaleCycleStage[] = [], context: { cycleId?: string; cycleName?: string } = {}, depth = 0): SmartHomeSaleCycleStage[] {
  if (depth > 6 || value == null) return out;
  if (Array.isArray(value)) {
    value.forEach((item) => collectSaleCycleStages(item, out, context, depth + 1));
    return out;
  }

  const record = asRecord(value);
  if (!record) return out;

  const cycleId = shStr(record.saleCycleId) ?? shStr(record.cycleId) ?? shStr(record.id) ?? context.cycleId;
  const cycleName = shStr(record.saleCycleName) ?? shStr(record.cycleName) ?? shStr(record.name) ?? context.cycleName;
  const stageId = shStr(record.stageId) ?? shStr(record.saleCycleStageId) ?? shStr(record.idStage);
  const stageName = shStr(record.stageName) ?? shStr(record.nameStage) ?? shStr(record.stage) ?? (stageId ? shStr(record.name) : undefined);

  if (stageId && stageName) {
    out.push({ ...record, stageId, name: stageName, probability: shNum(record.probability), cycleId, cycleName });
  }

  for (const key of ['stages', 'saleCycleStages', 'steps', 'data', 'items', 'saleCycles', 'cycles']) {
    if (key in record) collectSaleCycleStages(record[key], out, { cycleId, cycleName }, depth + 1);
  }
  return out;
}

/** Etapas de ciclos de venta de SmartHome. La forma del JSON cambia por cuenta, por eso se parsea de forma tolerante. */
export async function getSmartHomeSaleCycleStages(projectCode = env.smartHomeProject()): Promise<SmartHomeSaleCycleStage[] | null> {
  const candidates = [
    `${env.smartHomeApiBase()}/api/v1/GetSaleCycle/${env.smartHomeCompany()}/`,
    `${env.smartHomeApiBase()}/api/v1/getSaleCycle/${env.smartHomeCompany()}/`,
    `${env.smartHomeApiBase()}/api/v1/GetSaleCycle/${env.smartHomeCompany()}`,
    `${env.smartHomeApiBase()}/api/v1/getSaleCycle/${env.smartHomeCompany()}`,
    `${env.smartHomeApiBase()}/api/v1/GetSaleCycles/${env.smartHomeCompany()}/${projectCode}`,
    `${env.smartHomeApiBase()}/api/v1/getSaleCycles/${env.smartHomeCompany()}/${projectCode}`,
    `${env.smartHomeApiBase()}/api/v1/GetSaleCycles/${env.smartHomeCompany()}/`,
    `${env.smartHomeApiBase()}/api/v1/getSaleCycles/${env.smartHomeCompany()}/`,
  ];

  for (const url of candidates) {
    try {
      const res = await shFetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const returnCode = asRecord(data)?.returnCode;
      if (returnCode && returnCode !== 'SUCCESS') continue;
      const stages = collectSaleCycleStages(data);
      if (stages.length > 0) {
        const seen = new Set<string>();
        return stages.filter((stage) => {
          if (seen.has(stage.stageId)) return false;
          seen.add(stage.stageId);
          return true;
        });
      }
    } catch (err) {
      logger.warn('[smartHome] Error consultando GetSaleCycle', {
        url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.error('[smartHome] GetSaleCycle no devolvio etapas validas', { projectCode });
  return null;
}

/** Prospectos/ventas de un proyecto en SmartHome (cacheados 5 min). null ante error. */
export async function getSmartHomeSales(projectCode = env.smartHomeProject(), force = false): Promise<SmartHomeSaleRecord[] | null> {
  if (!force && _salesCache && _salesCache.projectCode === projectCode && Date.now() - _salesCache.at < SALES_TTL_MS) {
    return _salesCache.sales;
  }
  const url = `${env.smartHomeApiBase()}/api/v1/getSales/${env.smartHomeCompany()}/${projectCode}`;
  try {
    const res = await shFetch(url);
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
  if (biMatches && biMatches.length > 0) return biMatches;
  if (biMatches) return [];

  // Barrido secundario por getSales (trae TODAS las ventas de cada proyecto: es
  // pesado y puede exceder el timeout). El BI es la fuente autoritativa de
  // duplicados; si ya respondió (aunque vacío), la lentitud/caída de getSales NO
  // debe bloquear la creación → lo tratamos como "mejor esfuerzo". Solo cuando el
  // BI TAMBIÉN falló (biMatches === null) un getSales caído significa
  // "no se pudo validar" (null) y se aborta la creación para no crear duplicados.
  const sales = await getAllSmartHomeSales();
  if (!sales) return biMatches === null ? null : [];
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
      const res = await shFetch(url);
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

/** Busca varios telefonos en el BI de SmartHome con un solo barrido de paginas. */
export async function findSmartHomeBiProspectsByPhones(phones: string[]): Promise<Map<string, SmartHomeSaleRecord[]> | null> {
  const targets = new Set(phones.map(phoneKey).filter(Boolean));
  const matchesByPhone = new Map<string, SmartHomeSaleRecord[]>();
  for (const target of targets) matchesByPhone.set(target, []);
  if (targets.size === 0) return matchesByPhone;

  const userKey = await getSmartHomeBiUserKey();
  if (!userKey) return null;

  const recordsPerPage = 1000;
  const createdDate = '2020-01-01';
  let totalPages = 1;
  let pending = new Set(targets);

  for (let page = 1; page <= totalPages && page <= 50 && pending.size > 0; page += 1) {
    const url = `${env.smartHomeBiBase()}/api/bi/getProspectDetail/${userKey}/?page=${page}&records=${recordsPerPage}&createdDate=${createdDate}`;
    try {
      const res = await shFetch(url);
      const data = (await res.json()) as { records?: SmartHomeSaleRecord[]; pages?: number; status?: string; message?: string };
      if (!res.ok || !Array.isArray(data.records)) {
        logger.error('[smartHome] getProspectDetail BI bulk respuesta invalida', {
          status: res.status,
          page,
          message: data.message ?? data.status,
        });
        return null;
      }
      totalPages = Number(data.pages || totalPages || 1);

      for (const record of data.records) {
        const recordPhones = PHONE_FIELDS.map((field) => phoneKey(record[field])).filter(Boolean);
        for (const key of recordPhones) {
          if (!pending.has(key)) continue;
          matchesByPhone.get(key)?.push(record);
        }
      }

      pending = new Set([...pending].filter((key) => (matchesByPhone.get(key)?.length ?? 0) === 0));
    } catch (err) {
      logger.error('[smartHome] Error consultando getProspectDetail BI bulk', {
        page,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  for (const [key, records] of matchesByPhone) {
    matchesByPhone.set(key, dedupeSales(records));
  }
  return matchesByPhone;
}

/** Una entrada de la bitácora/seguimiento de un prospecto en SmartHome. */
export interface SmartHomeEvent {
  date:    string;   // ISO
  content: string;   // texto de la nota
  action:  string;   // "Llamada", "Visita Sala de Negocios", "Evento del Sistema", …
  /** true = evento automático del sistema (no una nota que escribió el asesor). */
  system:  boolean;
  userId?: string;   // quién lo registró (userId SmartHome)
}

/** Resumen del seguimiento comercial de un prospecto en SmartHome (para la radiografía por cliente). */
export interface SmartHomeProspectSummary {
  found:       boolean;
  prospectId?: string;
  name?:       string;
  advisor?:    string;   // Asesor responsable en SmartHome
  seller?:     string;   // Vendedor
  stage?:      string;   // Etapa_del_Ciclo (ej. "Contactado", "Lead Digital")
  saleCycle?:  string;   // Ciclo_de_Venta (ej. "CAPTACION")
  followUps:   number;   // nº de seguimientos registrados (campo "Seguimiento")
  score?:      number;   // Score_del_Cliente
  probability?: number;  // Probabilidad
  source?:     string;   // Fuente de ubicación del cliente/prospecto
  createdDate?: string;
  closeDate?:  string;
  /** Desglose de acciones registradas por el asesor (Llamada, WhatsApp, Visita, …). */
  actions:     { label: string; count: number }[];
  /** Medios de atención usados. */
  channels:    { label: string; count: number }[];
  /** Bitácora real (texto de cada nota), más reciente primero. Vacío si no hay o no se pudo leer. */
  events:      SmartHomeEvent[];
  /** Nº de notas escritas por un asesor (excluye eventos automáticos del sistema). */
  advisorNotes: number;
}

function shNum(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
function shStr(value: unknown): string | undefined {
  const s = String(value ?? '').trim();
  return s || undefined;
}

const MAX_EVENTS = 30;   // tope de entradas de bitácora que se devuelven

function pickCountsFromRecord(rec: Record<string, unknown>, prefix: string) {
  return Object.entries(rec)
    .filter(([k, v]) => k.trim().startsWith(prefix) && (shNum(v) ?? 0) > 0)
    .map(([k, v]) => ({ label: k.trim().slice(prefix.length).trim(), count: shNum(v)! }))
    .sort((a, b) => b.count - a.count);
}

function codeHintForRecord(rec: Record<string, unknown>, projects: SmartHomeProject[] | null): string | undefined {
  const projName = shStr(rec.Proyecto);
  return projects?.find((p) => p.name && projName && p.name.trim() === projName.trim())?.code;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function summaryFromBiRecord(rec: Record<string, unknown>, projects: SmartHomeProject[] | null): Promise<SmartHomeProspectSummary> {
  const prospectId = shStr(rec.ProspectId);
  const codeHint = codeHintForRecord(rec, projects);
  const events = prospectId ? (await getSmartHomeProspectEvents(prospectId, codeHint)) ?? [] : [];

  return {
    found:       true,
    prospectId,
    name:        shStr(rec.Nombre_del_Cliente) ?? shStr(rec.Nombre) ?? shStr(rec.firstName),
    advisor:     shStr(rec.Asesor) ?? shStr(rec.advisorName) ?? shStr(rec.ownerName) ?? shStr(rec.Asesor_Asignado) ?? shStr(rec.Vendedor) ?? shStr(rec.sellerName),
    seller:      shStr(rec.Vendedor) ?? shStr(rec.sellerName),
    stage:       shStr(rec.Etapa_del_Ciclo) ?? shStr(rec.stageName) ?? shStr(rec.Etapa),
    saleCycle:   shStr(rec.Ciclo_de_Venta) ?? shStr(rec.saleCycleName),
    followUps:   shNum(rec.Seguimiento) ?? 0,
    score:       shNum(rec.Score_del_Cliente) ?? shNum(rec.score),
    probability: shNum(rec.Probabilidad),
    source:      shStr(rec.Fuente_de_Ubicacion_Cliente) ?? shStr(rec.Fuente_de_Ubicacion_Prospecto),
    createdDate: shStr(rec.Fecha_de_Creacion),
    closeDate:   shStr(rec.Fecha_de_Cierre),
    actions:     pickCountsFromRecord(rec, 'Accion:'),
    channels:    pickCountsFromRecord(rec, 'Medio de atencion:'),
    events,
    advisorNotes: events.filter((e) => !e.system).length,
  };
}

function parseEvents(raw: unknown): SmartHomeEvent[] {
  const events = asRecord(raw)?.events;
  if (!Array.isArray(events)) return [];
  return events
    .map((e) => {
      const r = asRecord(e) ?? {};
      const action = shStr(r.action) ?? '';
      return {
        date:    shStr(r.date) ?? '',
        content: (shStr(r.content) ?? '').slice(0, 400),
        action,
        system:  /evento del sistema/i.test(action),
        userId:  shStr(r.userId),
      } as SmartHomeEvent;
    })
    .filter((e) => e.content || e.action);
}

/**
 * Bitácora (eventos/seguimientos con su TEXTO) de un prospecto, vía
 * `getProspectEvents/{company}/{projectCode}/{prospectId}`. El projectCode importa
 * (uno equivocado devuelve 0 eventos), así que se prueba el sugerido y, si no hay
 * eventos, el resto de proyectos (solo son 3). Devuelve null solo ante error de red.
 */
export async function getSmartHomeProspectEvents(prospectId: string, projectCodeHint?: string): Promise<SmartHomeEvent[] | null> {
  const projects = await getSmartHomeProjects();
  const codes = [projectCodeHint, ...(projects ?? []).map((p) => p.code)]
    .filter((c, i, arr): c is string => !!c && arr.indexOf(c) === i);
  if (codes.length === 0) codes.push(env.smartHomeProject());

  let sawError = false;
  for (const code of codes) {
    const url = `${env.smartHomeApiBase()}/api/v1/getProspectEvents/${env.smartHomeCompany()}/${code}/${prospectId}`;
    try {
      const res = await shFetch(url);
      if (!res.ok) { sawError = true; continue; }
      const events = parseEvents(await res.json());
      if (events.length > 0) {
        return events.sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_EVENTS);
      }
    } catch (err) {
      sawError = true;
      logger.error('[smartHome] Error consultando getProspectEvents', {
        code, error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return sawError ? null : [];
}

function parseBiDate(val: unknown): number {
  if (!val) return 0;
  const s = String(val).trim();
  if (!s) return 0;

  const ddmmyyyy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (ddmmyyyy) {
    const [, day, month, year, hour = '0', min = '0', sec = '0'] = ddmmyyyy;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(min), Number(sec)).getTime();
  }

  const t = Date.parse(s);
  return isNaN(t) ? 0 : t;
}

export function resolveLiveAdvisorFromEvents(
  events: SmartHomeEvent[],
  users: SmartHomeUser[] | null,
  fallbackAdvisor?: string
): string | undefined {
  if (!events || events.length === 0) return fallbackAdvisor;

  // 1. Buscar en el texto de los eventos más recientes si hubo un cambio o reasignación de asesor
  for (const event of events) {
    const text = (event.content || '').trim();
    if (!text) continue;

    const changeMatch = text.match(/(?:cambiado\s+(?:el\s+)?asesor(?:\s+comercial)?|reasignado(?:\s+el\s+prospecto)?)\s+(?:de\s+.+?\s+)?a\s+([A-Za-zÁÉÍÓÚáéíóúñÑ\s]+?)(?:\s+desde\s+el\s+API|\.|$)/i)
      || text.match(/asesor\s+asignado(?:\s+es)?(?:\s*:)?\s+([A-Za-zÁÉÍÓÚáéíóúñÑ\s]+?)(?:\.|$)/i)
      || text.match(/(?:se\s+ha\s+asignado|asignado)(?:\s+el\s+asesor\s+comercial)?\s+a\s+([A-Za-zÁÉÍÓÚáéíóúñÑ\s]+?)(?:\s+desde\s+el\s+API|\.|$)/i);

    if (changeMatch && changeMatch[1]?.trim()) {
      const candidateName = changeMatch[1].trim();
      if (!/^(?:desde|por|en|el|la|un|una|modulo|sistema)\b/i.test(candidateName)) {
        if (users && users.length > 0) {
          const u = users.find((x) => {
            const full = `${x.firstName || ''} ${x.lastName || ''}`.trim().toLowerCase();
            return full === candidateName.toLowerCase() || (x.firstName && candidateName.toLowerCase().includes(x.firstName.toLowerCase()) && x.lastName && candidateName.toLowerCase().includes(x.lastName.toLowerCase()));
          });
          if (u) {
            return `${u.firstName || ''} ${u.lastName || ''}`.trim();
          }
        }
        return candidateName;
      }
    }
  }

  // 2. Si el evento más reciente es de asignación/activación de prospecto con userId
  for (const event of events) {
    if (event.userId && users && users.length > 0) {
      if (/cliente asignado|se ha activado el prospecto|inicia el seguimiento|cambiado el asesor|reasignado/i.test(event.content || '')) {
        const u = users.find((x) => x.userId === event.userId);
        if (u) {
          const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim();
          if (fullName && !['Administrador Smarthome', 'administrador usuarios meraki', ''].includes(fullName.toLowerCase())) {
            return fullName;
          }
        }
      }
    }
  }

  return fallbackAdvisor;
}

/**
 * Cruza un lead del CRM con SmartHome por teléfono y devuelve un resumen del
 * seguimiento que allí se le ha dado: cuántos seguimientos, qué acciones
 * (llamadas/WhatsApp/visitas), etapa, asesor, score y la BITÁCORA real (texto de
 * cada nota). Se apoya en el endpoint BI (getProspectDetail) para el resumen y en
 * getProspectEvents para la bitácora.
 *
 * Devuelve null SOLO si hubo un error consultando SmartHome (para poder avisar en
 * la UI). Si el cliente no existe allí, devuelve { found: false }.
 */
export async function getSmartHomeProspectSummary(phone: string): Promise<SmartHomeProspectSummary | null> {
  const matches = await findSmartHomeBiProspectsByPhone(phone);
  if (matches === null) return null;                       // error de consulta
  if (matches.length === 0) return { found: false, followUps: 0, actions: [], channels: [], events: [], advisorNotes: 0 };

  const projects = await getSmartHomeProjects();
  const users = await getSmartHomeUsers();

  // Ordenar priorizando prospectos activos y luego la fecha más reciente
  const isInactive = (rec: Record<string, unknown>) => {
    const stage = String(rec.Etapa_del_Ciclo || rec.stageName || rec.Etapa || '').toLowerCase();
    const cycle = String(rec.Ciclo_de_Venta || rec.saleCycleName || '').toLowerCase();
    return stage.includes('no interesado') || cycle.includes('cancelado') || stage.includes('descartado');
  };

  const sortedMatches = matches
    .slice()
    .sort((a, b) => {
      const aInactive = isInactive(a as Record<string, unknown>) ? 1 : 0;
      const bInactive = isInactive(b as Record<string, unknown>) ? 1 : 0;
      if (aInactive !== bInactive) return aInactive - bInactive;
      return parseBiDate(b.Fecha_de_Creacion) - parseBiDate(a.Fecha_de_Creacion);
    });

  // Buscar el prospecto más relevante que no esté en la papelera
  let targetRec = sortedMatches[0] as Record<string, unknown>;
  let targetEvents: SmartHomeEvent[] = [];

  for (const item of sortedMatches) {
    const recItem = item as Record<string, unknown>;
    const pId = shStr(recItem.ProspectId);
    const pName = shStr(recItem.Proyecto);
    const codeHint = projects?.find((p) => p.name && pName && p.name.trim() === pName.trim())?.code;
    const evts = pId ? (await getSmartHomeProspectEvents(pId, codeHint)) ?? [] : [];

    const isTrash = evts.some((e) => /trasladado a la papelera/i.test(e.content));
    if (!isTrash || sortedMatches.length === 1) {
      targetRec = recItem;
      targetEvents = evts;
      break;
    }
  }

  if (targetEvents.length === 0 && targetRec.ProspectId) {
    const pId = shStr(targetRec.ProspectId);
    const pName = shStr(targetRec.Proyecto);
    const codeHint = projects?.find((p) => p.name && pName && p.name.trim() === pName.trim())?.code;
    targetEvents = pId ? (await getSmartHomeProspectEvents(pId, codeHint)) ?? [] : [];
  }

  const pickCounts = (prefix: string) => Object.entries(targetRec)
    .filter(([k, v]) => k.trim().startsWith(prefix) && (shNum(v) ?? 0) > 0)
    .map(([k, v]) => ({ label: k.trim().slice(prefix.length).trim(), count: shNum(v)! }))
    .sort((a, b) => b.count - a.count);

  const prospectId = shStr(targetRec.ProspectId);
  const biAdvisor = shStr(targetRec.Asesor) ?? shStr(targetRec.advisorName) ?? shStr(targetRec.ownerName) ?? shStr(targetRec.Asesor_Asignado) ?? shStr(targetRec.Vendedor) ?? shStr(targetRec.sellerName);
  const liveAdvisor = resolveLiveAdvisorFromEvents(targetEvents, users, biAdvisor) || biAdvisor;

  return {
    found:       true,
    prospectId,
    name:        shStr(targetRec.Nombre_del_Cliente) ?? shStr(targetRec.Nombre) ?? shStr(targetRec.firstName),
    advisor:     liveAdvisor,
    seller:      shStr(targetRec.Vendedor) ?? shStr(targetRec.sellerName),
    stage:       shStr(targetRec.Etapa_del_Ciclo) ?? shStr(targetRec.stageName) ?? shStr(targetRec.Etapa),
    saleCycle:   shStr(targetRec.Ciclo_de_Venta) ?? shStr(targetRec.saleCycleName),
    followUps:   shNum(targetRec.Seguimiento) ?? 0,
    score:       shNum(targetRec.Score_del_Cliente) ?? shNum(targetRec.score),
    probability: shNum(targetRec.Probabilidad),
    source:      shStr(targetRec.Fuente_de_Ubicacion_Cliente) ?? shStr(targetRec.Fuente_de_Ubicacion_Prospecto),
    createdDate: shStr(targetRec.Fecha_de_Creacion),
    closeDate:   shStr(targetRec.Fecha_de_Cierre),
    actions:     pickCounts('Accion:'),
    channels:    pickCounts('Medio de atencion:'),
    events:      targetEvents,
    advisorNotes: targetEvents.filter((e) => !e.system).length,
  };
}

/** Resumen de SmartHome para varios telefonos usando un solo barrido BI. */
export async function getSmartHomeProspectSummariesByPhones(phones: string[]): Promise<Map<string, SmartHomeProspectSummary> | null> {
  const matchesByPhone = await findSmartHomeBiProspectsByPhones(phones);
  if (matchesByPhone === null) return null;

  const projects = await getSmartHomeProjects();
  const entries = [...matchesByPhone.entries()];
  const summaries = await mapWithConcurrency(entries, 8, async ([key, matches]) => {
    if (matches.length === 0) {
      return [key, { found: false, followUps: 0, actions: [], channels: [], events: [], advisorNotes: 0 } as SmartHomeProspectSummary] as const;
    }
    const rec = matches
      .slice()
      .sort((a, b) => String(b.Fecha_de_Creacion ?? '').localeCompare(String(a.Fecha_de_Creacion ?? '')))[0] as Record<string, unknown>;
    return [key, await summaryFromBiRecord(rec, projects)] as const;
  });

  return new Map(summaries);
}

/**
 * Crea un cliente/prospecto en SmartHome, asignado al asesor (ownerId), bajo la
 * unidad (moduleId) y con la fuente (locationSourceId). No lanza: devuelve el
 * resultado con ok/status para que el llamador decida.
 */
export async function addSmartHomeCustomer(payload: AddCustomerPayload): Promise<AddCustomerResult> {
  const url = `${env.smartHomeApiBase()}/api/v1/addCustomer/${env.smartHomeCompany()}/${env.smartHomeProject()}`;
  try {
    const res  = await shFetch(url, {
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
    const res  = await shFetch(url, {
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

export async function changeSmartHomeProspectUser(
  projectCode: string,
  prospectId: string,
  userId: string
): Promise<AddCustomerResult> {
  const url = `${env.smartHomeApiBase()}/api/v1/ChangeProspectUser/${env.smartHomeCompany()}/${projectCode}/${prospectId}/${userId}`;
  try {
    const res = await shFetch(url);
    let data: Record<string, unknown> = {};
    try { data = (await res.json()) as Record<string, unknown>; } catch { /* respuesta no-JSON */ }

    const returnCode = typeof data.returnCode === 'string' ? data.returnCode : undefined;
    const ok = res.ok && (returnCode === undefined || returnCode === 'SUCCESS');
    if (!ok) {
      logger.error('[smartHome] ChangeProspectUser rechazado', { status: res.status, returnCode, raw: data });
    }
    return { ok, status: res.status, returnCode, raw: data };
  } catch (err) {
    logger.error('[smartHome] Error en ChangeProspectUser', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, status: 0 };
  }
}

export async function changeSmartHomeProspectSaleCycleStage(
  projectCode: string,
  prospectId: string,
  stageId: string
): Promise<AddCustomerResult> {
  const url = `${env.smartHomeApiBase()}/api/v1/changeProspectSaleCycleStage/${env.smartHomeCompany()}/${projectCode}/${prospectId}/${stageId}`;
  try {
    const res = await shFetch(url);
    let data: Record<string, unknown> = {};
    try { data = (await res.json()) as Record<string, unknown>; } catch { /* respuesta no-JSON */ }

    const returnCode = typeof data.returnCode === 'string' ? data.returnCode : undefined;
    const ok = res.ok && (returnCode === undefined || returnCode === 'SUCCESS');
    if (!ok) {
      logger.error('[smartHome] changeProspectSaleCycleStage rechazado', { status: res.status, returnCode, raw: data });
    }
    return { ok, status: res.status, returnCode, raw: data };
  } catch (err) {
    logger.error('[smartHome] Error en changeProspectSaleCycleStage', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, status: 0 };
  }
}

/** Crea una bitacora o tarea en el seguimiento de un prospecto. */
export async function postSmartHomeEvent(payload: PostSmartHomeEventPayload): Promise<AddCustomerResult> {
  const url = `${env.smartHomeApiBase()}/api/v1/postEvent/${env.smartHomeCompany()}/${payload.projectCode}/${payload.prospectId}/`;
  try {
    const res = await shFetch(url, {
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
