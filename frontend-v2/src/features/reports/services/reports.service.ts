import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import type { LeadStatus } from '@/features/inbox/types';

export interface AdvisorReport {
  advisorId:         string;
  name:              string;
  leads:             number;
  byStatus:          Record<LeadStatus, number>;
  conversionRate:    number;
  closedRate:        number;
  appts:             { total: number; completed: number; upcoming: number; canceled: number };
  avgScore:          number;
  advisorMsgs:       number;
  handled:           number;
  responseSamples:   number;
  avgResponseMin:    number | null;
  medianResponseMin: number | null;
  within1hRate:      number | null;
  waiting:           number;
  stale:             number;
  reassignmentsLost: number;
  reassignmentsReceived: number;
}

export interface ReassignmentReportItem {
  leadId: string;
  leadName: string;
  leadPhone: string;
  previousAdvisorId: string | null;
  previousAdvisorName: string;
  newAdvisorId: string | null;
  newAdvisorName: string;
  reason: string;
  reassignedAt: number;
}

export type AttentionReason = 'no_first_contact' | 'waiting_reply' | 'stale';

export interface AttentionItem {
  leadId:      string;
  name:        string;
  phone:       string;
  status:      LeadStatus;
  advisorId:   string;
  advisorName: string;
  reason:      AttentionReason;
  waitingMin?: number;
  staleDays?:  number;
  night:       boolean;
  createdHour: number;
  lastText:    string;
  advisorMsgs: number;
}

export interface AdvisorReports {
  rangeDays:   number;
  generatedAt: number;
  team: {
    advisors:       number;
    totalLeads:     number;
    conversionRate: number;
    closedRate:     number;
    avgResponseMin: number | null;
    waiting:        number;
    stale:          number;
    reassignmentsLost: number;
  };
  advisors: AdvisorReport[];
  attention: {
    counts: { noFirstContact: number; waitingReply: number; stale: number; night: number };
    items:  AttentionItem[];
  };
  reassignments: {
    total: number;
    recent: ReassignmentReportItem[];
  };
}

export type WeeklyFollowUpReason =
  | 'missing_smarthome_bitacora'
  | 'advisor_mismatch'
  | 'crm_activity_without_smarthome'
  | 'stale_follow_up'
  | 'no_smarthome_match';

export interface WeeklyFollowUpItem {
  leadId: string;
  name: string;
  phone: string;
  crmAdvisor: string;
  smartHomeAdvisor: string;
  crmStatus: string;
  smartHomeStage: string;
  lastConversationAt: number | null;
  lastSmartHomeLogAt: number | null;
  hasBitacoraThisWeek: boolean;
  needsFollowUp: boolean;
  alertReason: string;
  reasons: WeeklyFollowUpReason[];
  lastCrmSummary: string;
  nextAction: string;
}

export interface WeeklyFollowUpReport {
  weekId: string;
  rangeStart: number;
  rangeEnd: number;
  generatedAt: number;
  totals: {
    clients: number;
    needsFollowUp: number;
    missingBitacora: number;
    advisorMismatch: number;
    crmWithoutSmartHome: number;
    staleFollowUp: number;
    noSmartHomeMatch: number;
    estimatedReads: number;
  };
  items: WeeklyFollowUpItem[];
}

export interface SalesCommissionItem {
  saleId: string;
  prospectId?: string;
  customerId?: string;
  clientName: string;
  documentNumber: string;
  phone: string;
  email: string;
  project: string;
  projectCode: string;
  module: string;
  lotNumber: string;
  sectorStage: string;
  area: number;
  offerPrice: number;
  totalValue: number;
  discount: number;
  deposit: number;
  stage: string;
  cycle: string;
  closeDate: string | null;
  closeMonth: string;
  advisorName: string;
  advisorId: string;
  source: string;

  advisorMonthlySalesCount: number;
  captacionRate: number;
  lineaRate: number;
  cierreRate: number;
  directorRate: number;
  captacionValue: number;
  lineaValue: number;
  cierreValue: number;
  directorValue: number;
  totalCommissionValue: number;

  agentCr: string;
  agentLinea: string;
  agentCierre: string;
  director: string;
  paymentTerms: string;
  referralApplies: string;
  referralName: string;

  documentGenerated: boolean;
  documentGeneratedAt: number | null;
  documentGeneratedDateStr: string | null;
  documentUrl: string | null;
  history?: SalesReportDocumentVersion[];
}

export interface SalesReportDocumentVersion {
  id: string;
  clientName: string;
  documentNumber: string;
  deposit: number;
  paymentTerms: string;
  source: string;
  agentCr: string;
  agentLinea: string;
  agentCierre: string;
  director: string;
  referralApplies: string;
  referralName: string;
  createdAt: number;
  createdDateStr: string;
  createdByUid: string;
  createdByName: string;
}

export interface SalesCommissionReportResponse {
  monthKey: string;
  totalSales: number;
  totalVolume: number;
  totalCommissions: number;
  generatedAt: number;
  items: SalesCommissionItem[];
  sales: SalesCommissionItem[];
}

export interface SalesReportSavePayload {
  companyId: string;
  saleId: string;
  monthKey?: string;
  module?: string;
  clientName?: string;
  documentNumber?: string;
  deposit?: number;
  paymentTerms?: string | number;
  source?: string;
  agentCr?: string;
  agentLinea?: string;
  agentCierre?: string;
  director?: string;
  referralApplies?: string;
  referralName?: string;
  createdByName?: string;
  documentUrl?: string | null;
}

const _get = httpsCallable<{ companyId: string; rangeDays?: number; startDate?: number; endDate?: number; refresh?: boolean }, AdvisorReports>(functions, 'getAdvisorReports');
const _getWeeklyFollowUp = httpsCallable<
  { companyId: string; weekOffset?: number; startDate?: number; endDate?: number; refresh?: boolean; search?: string },
  WeeklyFollowUpReport
>(functions, 'getWeeklyFollowUpReport');
const _getSalesCommissionReport = httpsCallable<
  { companyId: string; monthKey?: string; refresh?: boolean },
  SalesCommissionReportResponse
>(functions, 'getSalesCommissionReport');
const _saveSalesReportDocument = httpsCallable<
  SalesReportSavePayload,
  {
    ok: boolean;
    saleId: string;
    version: SalesReportDocumentVersion;
    history: SalesReportDocumentVersion[];
    documentGeneratedAt: number;
    documentGeneratedDateStr: string;
  }
>(functions, 'saveSalesReportDocument');
const _deleteSalesReportVersion = httpsCallable<
  { companyId: string; saleId: string; versionId: string },
  {
    ok: boolean;
    saleId: string;
    history: SalesReportDocumentVersion[];
    documentGenerated: boolean;
    documentGeneratedAt: number | null;
    documentGeneratedDateStr: string | null;
  }
>(functions, 'deleteSalesReportVersion');

export async function getAdvisorReports(
  companyId: string,
  rangeDays = 30,
  startDate?: number,
  endDate?: number,
  refresh = false,
): Promise<AdvisorReports> {
  const r = await _get({ companyId, rangeDays, startDate, endDate, refresh });
  return r.data;
}

export async function getWeeklyFollowUpReport(
  companyId: string,
  weekOffset = 0,
  refresh = false,
  search = '',
  startDate?: number,
  endDate?: number,
): Promise<WeeklyFollowUpReport> {
  const r = await _getWeeklyFollowUp({ companyId, weekOffset, refresh, search, startDate, endDate });
  return r.data;
}

export async function getSalesCommissionReport(
  companyId: string,
  monthKey = 'all',
  refresh = false,
): Promise<SalesCommissionReportResponse> {
  const r = await _getSalesCommissionReport({ companyId, monthKey, refresh });
  const raw = (r.data || {}) as any;
  const items: SalesCommissionItem[] = Array.isArray(raw.items)
    ? raw.items
    : Array.isArray(raw.sales)
    ? raw.sales
    : [];
  return {
    monthKey: raw.monthKey || monthKey,
    totalSales: typeof raw.totalSales === 'number' ? raw.totalSales : items.length,
    totalVolume: typeof raw.totalVolume === 'number' ? raw.totalVolume : 0,
    totalCommissions: typeof raw.totalCommissions === 'number' ? raw.totalCommissions : 0,
    generatedAt: typeof raw.generatedAt === 'number' ? raw.generatedAt : Date.now(),
    items,
    sales: items,
  };
}

export async function saveSalesReportDocument(
  payload: SalesReportSavePayload,
): Promise<{
  ok: boolean;
  saleId: string;
  version: SalesReportDocumentVersion;
  history: SalesReportDocumentVersion[];
  documentGeneratedAt: number;
  documentGeneratedDateStr: string;
}> {
  const r = await _saveSalesReportDocument(payload);
  return r.data;
}

export async function deleteSalesReportVersion(
  companyId: string,
  saleId: string,
  versionId: string,
): Promise<{
  ok: boolean;
  saleId: string;
  history: SalesReportDocumentVersion[];
  documentGenerated: boolean;
  documentGeneratedAt: number | null;
  documentGeneratedDateStr: string | null;
}> {
  const r = await _deleteSalesReportVersion({ companyId, saleId, versionId });
  return r.data;
}

/**
 * Reemplaza variables en el XML de Word respetando tags divididos por Word
 */
function replacePlaceholdersInWordXml(xml: string, replacements: Record<string, string>): string {
  // 1. Reemplazo directo para variables no divididas
  let result = xml;
  for (const [key, value] of Object.entries(replacements)) {
    const escapedVal = String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
    
    // Variantes: «Key», {{Key}}, MERGEFIELD Key
    result = result.split(`«${key}»`).join(escapedVal);
    result = result.split(`{{${key}}}`).join(escapedVal);
  }

  // 2. Manejo de párrafos donde Word fragmentó «...» en múltiples <w:t>
  // Reemplazamos párrafo por párrafo buscando si contiene «
  result = result.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (para) => {
    let pContent = para;
    for (const [key, value] of Object.entries(replacements)) {
      const pattern = new RegExp(`«\\s*${key}\\s*»`, 'gi');
      if (pattern.test(pContent)) {
        const escapedVal = String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        pContent = pContent.replace(pattern, escapedVal);
      }
    }
    return pContent;
  });

  return result;
}

function escapeXml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildCommissionRowXml(label: string, pctStr: string, nameStr: string, valStr: string): string {
  return (
    `<w:tr w:rsidR="00BD399B" w:rsidTr="00930493">` +
    `<w:tc><w:tcPr><w:tcW w:w="2046" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2" w:themeFill="background1" w:themeFillShade="F2"/></w:tcPr>` +
    `<w:p><w:pPr><w:rPr><w:b/><w:bCs/></w:rPr></w:pPr><w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t>${escapeXml(label)}</w:t></w:r></w:p></w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="1519" w:type="dxa"/></w:tcPr>` +
    `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>${escapeXml(pctStr)}</w:t></w:r></w:p></w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="4941" w:type="dxa"/><w:gridSpan w:val="2"/></w:tcPr>` +
    `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>${escapeXml(nameStr)}</w:t></w:r></w:p></w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="2268" w:type="dxa"/></w:tcPr>` +
    `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>${escapeXml(valStr)}</w:t></w:r></w:p></w:tc>` +
    `</w:tr>`
  );
}

export async function generateAndDownloadSalesWordDoc(
  item: SalesCommissionItem,
  formValues: {
    clientName: string;
    documentNumber: string;
    deposit: number;
    paymentTerms: string | number;
    source: string;
    agentCr: string;
    agentLinea: string;
    agentCierre: string;
    director: string;
    referralApplies: string;
    referralName: string;
  },
): Promise<Blob> {
  const JSZip = (await import('jszip')).default;

  // Cargar plantilla base
  const templateRes = await fetch('/templates/reporte_venta_template.docx');
  if (!templateRes.ok) {
    throw new Error('No se pudo cargar la plantilla Word desde /templates/reporte_venta_template.docx');
  }
  const arrayBuffer = await templateRes.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  const documentXmlFile = zip.file('word/document.xml');
  if (!documentXmlFile) {
    throw new Error('Archivo document.xml no encontrado en la plantilla Word.');
  }

  const xmlText = await documentXmlFile.async('text');

  const fmtMoney = (val: number) => `$ ${Math.round(val || 0).toLocaleString('es-CO')}`;

  const todayStr = new Date().toLocaleDateString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  // Construir filas de comisiones dinámicas respetando las 4 columnas de la tabla:
  // ESTADO | PORCENTAJE | NOMBRE | VALOR COMISIÓN
  const captacionPct = `${(item.captacionRate * 100).toFixed(2).replace(/\.?0+$/, '')} %`;
  const lineaPct = `${(item.lineaRate * 100).toFixed(3).replace(/\.?0+$/, '')} %`;
  const cierrePct = `${(item.cierreRate * 100).toFixed(3).replace(/\.?0+$/, '')} %`;
  const directorPct = `0.5 %`;

  const captacionName = formValues.agentCr || item.agentCr || 'N/A';
  const lineaName = formValues.agentLinea || item.agentLinea || 'N/A';
  const cierreName = formValues.agentCierre || item.agentCierre || 'N/A';
  const directorName = formValues.director || item.director || 'N/A';

  const captacionVal = fmtMoney(item.captacionValue);
  const lineaVal = fmtMoney(item.lineaValue);
  const cierreVal = fmtMoney(item.cierreValue);
  const directorVal = fmtMoney(item.directorValue);

  const dynamicCommissionRowsXml =
    buildCommissionRowXml('CAPTACIÓN', captacionPct, captacionName, captacionVal) +
    buildCommissionRowXml('LINEA', lineaPct, lineaName, lineaVal) +
    buildCommissionRowXml('CIERRE', cierrePct, cierreName, cierreVal) +
    buildCommissionRowXml('DIRECTOR', directorPct, directorName, directorVal);

  // Reemplazar únicamente el bloque de filas de comisiones (desde la fila de CAPTACIÓN hasta el final de la fila de MICRO DIRECTOR, excluyendo LIDER)
  const commissionBlockRegex = /<w:tr\b[^>]*>(?:(?!<w:tr\b)[\s\S])*?<w:t>CAPTACIÓN<\/w:t>[\s\S]*?<w:tr\b[^>]*>(?:(?!<w:tr\b)[\s\S])*?MICRO DIRECTOR[\s\S]*?<\/w:tr>/g;
  const xmlWithDynamicTable = xmlText.replace(commissionBlockRegex, dynamicCommissionRowsXml);

  const replacements: Record<string, string> = {
    FechaElaboración: todayStr,
    FechaElaboracion: todayStr,
    NombrePropietario: formValues.clientName || item.clientName || 'N/A',
    NumeroDocumento: formValues.documentNumber || item.documentNumber || 'N/A',
    ValorLote: fmtMoney(item.totalValue),
    ValorSeparación: fmtMoney(formValues.deposit ?? item.deposit),
    ValorSeparacion: fmtMoney(formValues.deposit ?? item.deposit),
    PlazoPagos: String(formValues.paymentTerms || item.paymentTerms || '24'),
    NoLote: item.lotNumber || item.module || 'N/A',
    SectorEtapa: item.sectorStage || item.module || 'N/A',
    NombreProyecto: item.project || 'Ciudad Country Laguna Mar',
    ÁreaLote: item.area > 0 ? `${item.area} m²` : 'N/A',
    AreaLote: item.area > 0 ? `${item.area} m²` : 'N/A',
    BonoDescuento: item.discount > 0 ? fmtMoney(item.discount) : '$ 0',
    'Referido/AplicaóNoAplica': formValues.referralApplies || item.referralApplies || 'N/A',
    'Referido/AplicaoNoAplica': formValues.referralApplies || item.referralApplies || 'N/A',
    NombreReferido: formValues.referralName || item.referralName || 'N/A',
    FuenteDeCaptación: formValues.source || item.source || 'CORFERIAS AGOSTO 2026',
    FuenteDeCaptacion: formValues.source || item.source || 'CORFERIAS AGOSTO 2026',
  };

  const modifiedXml = replacePlaceholdersInWordXml(xmlWithDynamicTable, replacements);
  zip.file('word/document.xml', modifiedXml);

  const outBlob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

  // Disparar descarga en navegador
  const url = URL.createObjectURL(outBlob);
  const a = document.createElement('a');
  a.href = url;
  const safeMod = (item.module || item.lotNumber || 'LOTE').replace(/[^a-zA-Z0-9_-]+/g, '_');
  const monthName = item.closeDate
    ? new Date(item.closeDate).toLocaleString('es-CO', { month: 'long', year: 'numeric' })
    : '2026';
  a.download = `REPORTE VENTA ${monthName} - ${safeMod}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return outBlob;
}

