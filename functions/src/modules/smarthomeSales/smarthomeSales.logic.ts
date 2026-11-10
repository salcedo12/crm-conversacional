import type { SmartHomeProspect, SmartHomeUnit } from '../../integrations/smarthome/smarthome.client';

/**
 * Lotes VENDIDOS en SmartHome, repartidos a los proyectos del CRM.
 *
 * SmartHome tiene 3 proyectos; Llano Grande y Sobre Montañas viven dentro de
 * Cañón de Arizona y solo se distinguen por el sector / nombre del lote. Ojo:
 * hay lotes de Llano Grande cuyo sector dice solo "VALLE DE ABURRÁ", por eso se
 * mira también el nombre ("LOTE 02 SECTOR VALLE DE ABURRA … - LLANO GRANDE").
 */

export const SMARTHOME_SALES_PROJECTS: Array<{ code: string; crmProjectId: string }> = [
  { code: '48c9266a', crmProjectId: 'laguna-mar' },
  { code: '17c89d4e', crmProjectId: 'cañon-arizona' },
  { code: '5ad1b166', crmProjectId: 'rio-claro' },
];

/** 3 Vendido, 5 Escriturado (ver GetUnits en la doc de SmartHome). */
export const SOLD_UNIT_STATUSES: Record<number, string> = { 3: 'Vendido', 5: 'Escriturado' };

/**
 * Ventas de prueba que quedaron en SmartHome como vendidas. Se ocultan por
 * defecto; un admin puede mostrarlas u ocultar otras (campo `ignored` del doc).
 */
export const DEFAULT_IGNORED_PROSPECT_IDS = new Set([
  '4a8f4248-a440-4496-8587-5e84f8516686', // CRISITA — Aldea 1 Gavilán, Sobre Montañas
  '6a79ea7c-ca55-46d9-aafb-4ee580a3493b', // CHESPIRITO GONZALEZ — Lote 02 Valle de Aburrá, Llano Grande
]);

export interface SmartHomeSaleDoc {
  moduleId:             string;
  smartHomeProjectCode: string;
  smartHomeProjectId:   string;
  crmProjectId:         string;
  sector:               string;
  lotNumber:            string;
  lotName:              string;
  areaM2:               number;
  unitStatus:           number;
  unitStatusLabel:      string;
  prospectId:           string;
  customerId:           string;
  buyerName:            string;
  identificationNumber: string;
  mobileNumber:         string;
  email:                string;
  city:                 string;
  value:                number;
  deposit:              number;
  saleCycleName:        string;
  stageName:            string;
  ownerId:              string;
  advisorName:          string;
  createdDate:          string | null;
  closeDate:            string | null;
  /**
   * Archivos del cliente. Si el lote no tiene propios pero el mismo comprador
   * subió soportes en otro de sus lotes, se muestran esos: `prospectId` es el
   * registro que los tiene (para descargarlos) y `fromLot` de qué lote vienen.
   */
  files:                SmartHomeSaleFile[];
  /** Estado del mismo lote en la disponibilidad (VENDIDO, DISPONIBLE, TRAMITE…); null si no está. */
  inventoryStatus?:     string | null;
  inventoryMatch?:      InventoryMatch;
}

// ─── Cruce con la disponibilidad ──────────────────────────────────────────────
// Se empareja por sector + número de lote: los códigos no sirven (Laguna y Río
// Claro no lo traen en SmartHome y Arizona 1/2 usan códigos cortos repetidos).

const SECTOR_ALIAS: Record<string, string> = { HTAMARINDO: 'HATICOTAMARINDO' };

function sectorKey(sector: unknown): string {
  const key = plain(sector)
    .replace(/-\s*(LLANO GRANDE|GRAND ARIZONA|CANON DE ARIZONA)\s*$/, '')
    .replace(/\s+ARIZONA\s*[12]\s*$/, '')
    .replace(/[^A-Z]/g, '');
  return SECTOR_ALIAS[key] ?? key;
}

/** "07B" → "7B" (el 7 y el 7B son lotes distintos). */
function lotNumberKey(value: unknown): string {
  return plain(value).replace(/[^0-9A-Z]/g, '').replace(/^0+(?=\d)/, '');
}

/**
 * Clave común entre los dos sistemas. Sobre Montañas va solo por número: sus
 * sectores se escriben distinto en cada lado ("AVEJA CACATUA"…).
 */
export function inventoryKey(sector: unknown, number: unknown): string {
  const sec = sectorKey(sector);
  return `${sec === 'SOBREMONTANAS' ? 'SOBREMONTANAS' : sec}|${lotNumberKey(number)}`;
}

export function inventoryKeyForUnit(unit: Pick<SmartHomeUnit, 'unit' | 'name' | 'code'>): string {
  const name = clean(unit.name);
  const match = /^(?:LOTE|ALDEA)\s+(\w+)/i.exec(name) || /-\s*(\w+)\s*$/.exec(name) || /(\d+[A-Z]?)\s*$/i.exec(name);
  return inventoryKey(unit.unit, match?.[1] ?? unit.code);
}

export interface InventoryLotRef {
  project: string;
  sector:  string;
  number:  string;
  status:  string;
}

/** Índice de la disponibilidad: { proyecto → { lotId → {sec, n, s} } } → clave común → lote. */
export function buildInventoryIndex(summaries: Record<string, Record<string, { sec?: string; n?: string; s?: string }>>): Map<string, InventoryLotRef> {
  const index = new Map<string, InventoryLotRef>();
  for (const [project, lots] of Object.entries(summaries)) {
    for (const lot of Object.values(lots ?? {})) {
      const sector = project === 'sobre-montañas' ? 'SOBRE MONTAÑAS' : String(lot.sec ?? '');
      index.set(inventoryKey(sector, lot.n), {
        project,
        sector: clean(lot.sec),
        number: clean(lot.n),
        status: clean(lot.s).toUpperCase() || 'DISPONIBLE',
      });
    }
  }
  return index;
}

export function inventoryMatchFor(lot: InventoryLotRef | undefined): { inventoryStatus: string | null; inventoryMatch: InventoryMatch } {
  if (!lot) return { inventoryStatus: null, inventoryMatch: 'missing' };
  return { inventoryStatus: lot.status, inventoryMatch: lot.status === 'VENDIDO' ? 'ok' : 'mismatch' };
}

/** Lote que la disponibilidad da por vendido pero en SmartHome sigue sin vender. */
export interface InventoryOnlySale {
  crmProjectId:   string;
  sector:         string;
  lotNumber:      string;
  lotName:        string;
  smartHomeStatus: string;
}

const UNIT_STATUS_LABELS: Record<number, string> = { 1: 'Disponible', 2: 'Separado', 4: 'Reservado', 6: 'Canje', 7: 'Arrendado' };

export function inventoryOnlySales(
  project: { code: string; crmProjectId: string },
  units: SmartHomeUnit[],
  index: Map<string, InventoryLotRef>,
): InventoryOnlySale[] {
  return units
    .filter((unit) => !SOLD_UNIT_STATUSES[unit.status] && !isPlaceholderUnit(unit))
    .filter((unit) => index.get(inventoryKeyForUnit(unit))?.status === 'VENDIDO')
    .map((unit) => ({
      crmProjectId:    crmProjectFor(project.crmProjectId, unit),
      sector:          cleanSector(unit),
      lotNumber:       clean(unit.code),
      lotName:         clean(unit.name),
      smartHomeStatus: UNIT_STATUS_LABELS[unit.status] ?? `Estado ${unit.status}`,
    }));
}

/** Cómo quedó el lote frente a la disponibilidad (inventario de tour-meraki). */
export type InventoryMatch = 'ok' | 'mismatch' | 'missing';

export interface SmartHomeSaleFile {
  id:          string;
  title:       string;
  prospectId?: string;
  fromLot?:    string;
}

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const plain = (value: unknown) => clean(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

export function crmProjectFor(defaultProjectId: string, unit: Pick<SmartHomeUnit, 'unit' | 'name'>): string {
  if (defaultProjectId !== 'cañon-arizona') return defaultProjectId;
  const text = `${plain(unit.unit)} ${plain(unit.name)}`;
  if (text.includes('LLANO GRANDE')) return 'llano-grande';
  if (text.includes('SOBRE MONTANA')) return 'sobre-montañas';
  return defaultProjectId;
}

/** "SAN ANTONIO - LLANO GRANDE" → "SAN ANTONIO"; "VALLE DE ABURRÁ- LLANO GRANDE" → "VALLE DE ABURRÁ". */
export function cleanSector(unit: Pick<SmartHomeUnit, 'unit'>): string {
  const sector = clean(unit.unit).toUpperCase().replace(/\s*-\s*LLANO GRANDE$/, '').trim();
  return sector || 'SIN SECTOR';
}

/**
 * Si un lote tiene varios prospectos, el comprador es el que está en CIERRE (no
 * un lead de CAPTACION), luego el de mayor probabilidad y el más reciente.
 */
export function pickBuyer(prospects: SmartHomeProspect[]): SmartHomeProspect | null {
  const score = (p: SmartHomeProspect) => [
    plain(p.saleCycleName) === 'CIERRE' ? 1 : 0,
    Number(p.probability ?? 0),
    Date.parse(String(p.closeDate ?? p.createdDate ?? '')) || 0,
  ];
  return [...prospects].sort((a, b) => {
    const [sa, sb] = [score(a), score(b)];
    for (let i = 0; i < sa.length; i += 1) if (sa[i] !== sb[i]) return sb[i] - sa[i];
    return 0;
  })[0] ?? null;
}

/**
 * Unidades comodín de SmartHome que no son lotes: "cupo1"/"CUPO 1" (donde se cuelgan
 * los leads) y unidades sin sector ni nombre. Algunas figuran "vendidas".
 */
export function isPlaceholderUnit(unit: Pick<SmartHomeUnit, 'unit' | 'name' | 'code'>): boolean {
  if (/^\s*cupo\s*\d*\s*$/i.test(String(unit.name ?? '')) || /^\s*cupo/i.test(String(unit.code ?? ''))) return true;
  return !clean(unit.unit) && !clean(unit.name);
}

export function buildSaleDocs(
  project: { code: string; crmProjectId: string },
  units: SmartHomeUnit[],
  prospects: SmartHomeProspect[],
  advisorNames: Map<string, string>,
  /** Disponibilidad; sin ella (no se pudo leer) el lote queda sin estado de cruce. */
  inventory?: Map<string, InventoryLotRef>,
): SmartHomeSaleDoc[] {
  const byModule = new Map<string, SmartHomeProspect[]>();
  for (const prospect of prospects) {
    if (!prospect.moduleId) continue;
    const list = byModule.get(prospect.moduleId) ?? [];
    list.push(prospect);
    byModule.set(prospect.moduleId, list);
  }

  return units
    .filter((unit) => unit.moduleId && SOLD_UNIT_STATUSES[unit.status] && !isPlaceholderUnit(unit))
    .map((unit) => {
      const buyer = pickBuyer(byModule.get(unit.moduleId) ?? []);
      const ownerId = clean(buyer?.ownerId);
      return {
        moduleId:             unit.moduleId,
        smartHomeProjectCode: project.code,
        smartHomeProjectId:   clean(buyer?.projectId),
        crmProjectId:         crmProjectFor(project.crmProjectId, unit),
        sector:               cleanSector(unit),
        lotNumber:            clean(unit.code),
        lotName:              clean(unit.name),
        areaM2:               Number(unit.lotArea ?? 0) || 0,
        unitStatus:           unit.status,
        unitStatusLabel:      SOLD_UNIT_STATUSES[unit.status],
        prospectId:           clean(buyer?.prospectId),
        customerId:           clean(buyer?.customerId),
        buyerName:            clean(`${buyer?.firstName ?? ''} ${buyer?.lastName ?? ''}`),
        identificationNumber: clean(buyer?.identificationNumber),
        mobileNumber:         clean(buyer?.mobileNumber || buyer?.phoneNumber),
        email:                clean(buyer?.email).toLowerCase(),
        city:                 clean(buyer?.city),
        value:                Number(buyer?.totalValue ?? buyer?.offerPrice ?? unit.totalPrice ?? 0) || 0,
        deposit:              Number(buyer?.deposit ?? 0) || 0,
        saleCycleName:        clean(buyer?.saleCycleName),
        stageName:            clean(buyer?.stageName),
        ownerId,
        advisorName:          advisorNames.get(ownerId) ?? '',
        createdDate:          buyer?.createdDate ? String(buyer.createdDate) : null,
        closeDate:            buyer?.closeDate ? String(buyer.closeDate) : null,
        files:                (buyer?.files ?? [])
          .filter((file) => file?.prospectFileId)
          .map((file) => ({ id: file.prospectFileId, title: clean(file.title) || 'Archivo' })),
        ...(inventory ? inventoryMatchFor(inventory.get(inventoryKeyForUnit(unit))) : {}),
      };
    });
}

/**
 * Comprador con varios lotes que subió los soportes en uno solo: a sus lotes sin
 * archivos les asigna los de sus otros lotes (marcados con `fromLot`).
 */
export function attachSiblingFiles(docs: SmartHomeSaleDoc[]): SmartHomeSaleDoc[] {
  const byCustomer = new Map<string, SmartHomeSaleDoc[]>();
  for (const doc of docs) {
    if (!doc.customerId) continue;
    const list = byCustomer.get(doc.customerId) ?? [];
    list.push(doc);
    byCustomer.set(doc.customerId, list);
  }
  return docs.map((doc) => {
    if (doc.files.length || !doc.customerId) return doc;
    const seen = new Set<string>();
    const shared = (byCustomer.get(doc.customerId) ?? [])
      .filter((other) => other.moduleId !== doc.moduleId)
      .flatMap((other) => other.files
        .filter((file) => !file.fromLot)
        .map((file) => ({ ...file, prospectId: other.prospectId, fromLot: `${other.sector} · Lote ${other.lotNumber}` })))
      .filter((file) => !seen.has(file.id) && seen.add(file.id));
    return shared.length ? { ...doc, files: shared } : doc;
  });
}
