import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';

/** Lotes vendidos en SmartHome (copia diaria en el CRM; ver syncSmartHomeSales en functions). */

export interface SmartHomeSale {
  id: string;                    // moduleId de SmartHome
  smartHomeProjectCode: string;
  smartHomeProjectId: string;
  crmProjectId: string;          // laguna-mar, cañon-arizona, llano-grande, sobre-montañas, rio-claro
  sector: string;
  lotNumber: string;
  lotName: string;
  areaM2: number;
  unitStatusLabel: string;
  prospectId: string;
  buyerName: string;
  identificationNumber: string;
  mobileNumber: string;
  email: string;
  city: string;
  value: number;
  deposit: number;
  saleCycleName: string;
  stageName: string;
  ownerId: string;
  advisorName: string;
  createdDate: string | null;
  closeDate: string | null;
  /**
   * copied = ya hay copia en el Storage del CRM (se descarga sin SmartHome).
   * missing = SmartHome lo lista pero el archivo ya no existe allá (no se puede recuperar).
   * fromLot = el archivo se subió en otro lote del mismo comprador.
   */
  files: Array<{ id: string; title: string; copied: boolean; missing?: boolean; fromLot?: string }>;
  ignored: boolean;
  syncedAt: number | null;
  /** Estado del mismo lote en la disponibilidad (VENDIDO, DISPONIBLE, TRAMITE…); null si no está. */
  inventoryStatus?: string | null;
  /** ok = vendido en ambos · mismatch = la disponibilidad no lo da por vendido · missing = no está en la disponibilidad. */
  inventoryMatch?: 'ok' | 'mismatch' | 'missing';
}

/** Lote que la disponibilidad da por vendido pero en SmartHome sigue sin vender. */
export interface InventoryOnlySale {
  crmProjectId: string;
  sector: string;
  lotNumber: string;
  lotName: string;
  smartHomeStatus: string;
}

export interface SmartHomeSalesResult {
  enabled: boolean;
  sales: SmartHomeSale[];
  lastSyncAt: number | null;
  inventoryCheckedAt: number | null;
  inventoryOnly: InventoryOnlySale[];
}

const _list = httpsCallable<{ companyId: string }, SmartHomeSalesResult>(functions, 'listSmartHomeSales');
export interface SmartHomeSyncResult {
  total: number;
  removed: number;
  /** Proyectos que SmartHome no respondió (sus ventas quedan como estaban). */
  failedProjects: string[];
  files: { copied: number; failed: number; remaining: number };
}

// La sync puede tardar varios minutos (SmartHome lento + copia de archivos): el
// SDK corta a los 70 s por defecto.
const _sync = httpsCallable<{ companyId: string }, SmartHomeSyncResult>(functions, 'syncSmartHomeSalesNow', { timeout: 540_000 });
const _download = httpsCallable<
  { companyId: string; fileId: string },
  { fileName: string; contentType: string; base64: string }
>(functions, 'downloadSmartHomeFile');
const _ignore = httpsCallable<{ companyId: string; moduleId: string; ignored: boolean }, { ok: true }>(functions, 'setSmartHomeSaleIgnored');

export async function listSmartHomeSales(companyId: string): Promise<SmartHomeSalesResult> {
  return (await _list({ companyId })).data;
}

export async function syncSmartHomeSalesNow(companyId: string): Promise<SmartHomeSyncResult> {
  return (await _sync({ companyId })).data;
}

export interface SmartHomeFileBlob {
  blob: Blob;
  fileName: string;
  contentType: string;
  /** image = se ve en <img>, pdf = en <iframe>; other = solo descarga. */
  kind: 'image' | 'pdf' | 'other';
}

const IMAGE_EXT = /\.(jpe?g|jfif|png|gif|webp|bmp|heic)$/i;

function previewKind(contentType: string, fileName: string): SmartHomeFileBlob['kind'] {
  if (contentType === 'application/pdf' || /\.pdf$/i.test(fileName)) return 'pdf';
  if (contentType.startsWith('image/') || IMAGE_EXT.test(fileName)) return 'image';
  return 'other';
}

/** Trae la copia del CRM de un archivo de SmartHome (para verla o descargarla). */
export async function fetchSmartHomeFile(companyId: string, fileId: string): Promise<SmartHomeFileBlob> {
  const { fileName, contentType, base64 } = (await _download({ companyId, fileId })).data;
  const kind = previewKind(contentType, fileName);
  // Los .jfif llegan a veces con un tipo genérico: el navegador solo los muestra como image/jpeg.
  const type = kind === 'image' && !contentType.startsWith('image/') ? 'image/jpeg' : kind === 'pdf' ? 'application/pdf' : contentType;
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return { blob: new Blob([bytes], { type }), fileName, contentType: type, kind };
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Descarga la copia del CRM de un archivo de SmartHome. */
export async function downloadSmartHomeFile(companyId: string, fileId: string): Promise<void> {
  const file = await fetchSmartHomeFile(companyId, fileId);
  saveBlob(file.blob, file.fileName);
}

export async function setSmartHomeSaleIgnored(companyId: string, moduleId: string, ignored: boolean): Promise<void> {
  await _ignore({ companyId, moduleId, ignored });
}

/** Gestor de archivos del cliente en SmartHome (requiere sesión iniciada en SmartHome). */
export function smartHomeFilesUrl(sale: Pick<SmartHomeSale, 'smartHomeProjectId' | 'prospectId'>): string {
  return `https://smart-home.com.co/FileManagerModal.aspx?projectId=${encodeURIComponent(sale.smartHomeProjectId)}&prospectId=${encodeURIComponent(sale.prospectId)}`;
}
