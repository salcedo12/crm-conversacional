import JSZip from 'jszip';
import type { DealSummary } from '../services/deals.service';
import { referralName } from './paymentPlan';

export interface CommissionRowItem {
  role: 'CAPTACIÓN' | 'LINEA' | 'CIERRE' | 'DIRECTOR';
  ratePct: string;  // p. ej. "1.5 %"
  name: string;     // nombre del asesor/director
  value: string;    // p. ej. "$ 16.863.750"
}

export interface DealSalesReportFormValues {
  dateStr: string;
  clientName: string;
  documentNumber: string;
  lotValue: string;        // Formateado p. ej. "$ 1.124.250.000"
  deposit: string;         // Formateado p. ej. "$ 50.000.000"
  paymentTerms: string;    // p. ej. "40 meses"
  lotNumber: string;       // p. ej. "16"
  sectorStage: string;     // p. ej. "SAN ANTONIO"
  projectName: string;     // p. ej. "Llano Grande"
  area: string;            // p. ej. "1.000 m²"
  discount: string;        // p. ej. "$ 50.000.000"
  referralApplies: 'SI' | 'NO';
  referralName: string;    // p. ej. "JAVIER BUITRAGO" o "NO APLICA"
  saleType: string;        // p. ej. "DIRECTA"
  commissions: CommissionRowItem[];
}

const PROJECT_MAP: Record<string, string> = {
  'rio-claro': 'Río Claro',
  'cañon-arizona': 'Cañón de Arizona',
  'arizona-1': 'Arizona 1',
  'arizona-2': 'Arizona 2',
  'gran-arizona': 'Gran Arizona',
  'laguna-mar': 'Laguna Mar',
  'sobre-montañas': 'Sobre Montañas',
  'llano-grande': 'Llano Grande',
};

export function formatCopCurrency(val: number): string {
  return `$ ${Math.round(val || 0).toLocaleString('es-CO')}`;
}

export function parseCopCurrency(val: string | number): number {
  if (typeof val === 'number') return val;
  const digits = String(val || '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

export function defaultProjectName(projectId?: string): string {
  if (!projectId) return 'Proyecto sin definir';
  return PROJECT_MAP[projectId] || projectId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Extrae los valores iniciales del reporte automáticamente desde el negocio.
 */
export function extractDealSalesReportInitialValues(deal: DealSummary): DealSalesReportFormValues {
  const today = new Date().toLocaleDateString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const buyerNames = deal.buyerProfiles?.length
    ? deal.buyerProfiles.map((b) => `${b.firstNames || ''} ${b.lastNames || ''}`.trim()).filter(Boolean).join(' / ')
    : deal.buyerNames?.join(' / ') || deal.leadName || '';

  const documentNumbers = deal.buyerProfiles?.length
    ? deal.buyerProfiles
        .map((b) => `${b.identificationKind ? `${b.identificationKind} ` : ''}${b.identificationNumber || ''}`.trim())
        .filter(Boolean)
        .join(' / ')
    : '';

  const rawLandValue = deal.plan?.landValue || 0;
  const rawDeposit =
    deal.plan?.simple?.separationTotal ||
    deal.plan?.rows?.filter((r) => r.kind === 'separacion').reduce((sum, r) => sum + r.count * r.amount, 0) ||
    0;

  const rawBenefit = deal.plan?.benefit || 0;
  const hasReferral = Boolean(referralName(deal.plan?.referredBy));
  const refName = hasReferral ? referralName(deal.plan?.referredBy) : 'NO APLICA';

  const areaStr = deal.lot?.areaM2
    ? `${deal.lot.areaM2.toLocaleString('es-CO', { maximumFractionDigits: 2 })} m²`
    : '';

  const paymentTermsStr = deal.plan?.termMonths
    ? `${deal.plan.termMonths} meses`
    : deal.plan
    ? 'De contado'
    : '24 meses';

  // Tasas sugeridas por defecto para Meraki
  const captacionPct = 1.0;
  const lineaPct = 0.5;
  const cierrePct = 0.5;
  const directorPct = 0.5;

  const commissions: CommissionRowItem[] = [
    {
      role: 'CAPTACIÓN',
      ratePct: '1.0 %',
      name: '',
      value: formatCopCurrency(rawLandValue * (captacionPct / 100)),
    },
    {
      role: 'LINEA',
      ratePct: '0.5 %',
      name: '',
      value: formatCopCurrency(rawLandValue * (lineaPct / 100)),
    },
    {
      role: 'CIERRE',
      ratePct: '0.5 %',
      name: deal.advisorName || '',
      value: formatCopCurrency(rawLandValue * (cierrePct / 100)),
    },
    {
      role: 'DIRECTOR',
      ratePct: '0.5 %',
      name: 'Claudia Patricia Bolaños Vega',
      value: formatCopCurrency(rawLandValue * (directorPct / 100)),
    },
  ];

  return {
    dateStr: today,
    clientName: buyerNames,
    documentNumber: documentNumbers,
    lotValue: formatCopCurrency(rawLandValue),
    deposit: formatCopCurrency(rawDeposit),
    paymentTerms: paymentTermsStr,
    lotNumber: deal.lot?.lotNumber || '',
    sectorStage: deal.lot?.sector || '',
    projectName: defaultProjectName(deal.lot?.projectId),
    area: areaStr,
    discount: rawBenefit ? formatCopCurrency(rawBenefit) : '$ 0',
    referralApplies: hasReferral ? 'SI' : 'NO',
    referralName: refName,
    saleType: 'DIRECTA',
    commissions,
  };
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

function replacePlaceholdersInWordXml(xml: string, replacements: Record<string, string>): string {
  let result = xml;
  for (const [key, value] of Object.entries(replacements)) {
    const escapedVal = escapeXml(value);
    result = result.split(`«${key}»`).join(escapedVal);
    result = result.split(`{{${key}}}`).join(escapedVal);
  }

  // Manejo de fragmentación de tags en párrafos
  result = result.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (para) => {
    let pContent = para;
    for (const [key, value] of Object.entries(replacements)) {
      const pattern = new RegExp(`«\\s*${key}\\s*»`, 'gi');
      if (pattern.test(pContent)) {
        pContent = pContent.replace(pattern, escapeXml(value));
      }
    }
    return pContent;
  });

  return result;
}

/**
 * Genera el archivo Word (.docx) a partir de la plantilla y los datos completados del reporte de venta.
 */
export async function generateDealSalesReportDocx(values: DealSalesReportFormValues): Promise<Blob> {
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

  // Construir filas de comisiones según lo editado por el usuario
  const commMap = new Map(values.commissions.map((c) => [c.role, c]));
  const cap = commMap.get('CAPTACIÓN') || { role: 'CAPTACIÓN', ratePct: '', name: 'N/A', value: '$ 0' };
  const lin = commMap.get('LINEA') || { role: 'LINEA', ratePct: '', name: 'N/A', value: '$ 0' };
  const cie = commMap.get('CIERRE') || { role: 'CIERRE', ratePct: '', name: 'N/A', value: '$ 0' };
  const dir = commMap.get('DIRECTOR') || { role: 'DIRECTOR', ratePct: '', name: 'N/A', value: '$ 0' };

  const dynamicCommissionRowsXml =
    buildCommissionRowXml('CAPTACIÓN', cap.ratePct, cap.name || 'N/A', cap.value || '$ 0') +
    buildCommissionRowXml('LINEA', lin.ratePct, lin.name || 'N/A', lin.value || '$ 0') +
    buildCommissionRowXml('CIERRE', cie.ratePct, cie.name || 'N/A', cie.value || '$ 0') +
    buildCommissionRowXml('DIRECTOR', dir.ratePct, dir.name || 'N/A', dir.value || '$ 0');

  // Reemplazar el bloque de comisiones en ambas copias del documento
  const commissionBlockRegex = /<w:tr\b[^>]*>(?:(?!<w:tr\b)[\s\S])*?<w:t>CAPTACIÓN<\/w:t>[\s\S]*?<w:tr\b[^>]*>(?:(?!<w:tr\b)[\s\S])*?MICRO DIRECTOR[\s\S]*?<\/w:tr>/g;
  const xmlWithDynamicTable = xmlText.replace(commissionBlockRegex, dynamicCommissionRowsXml);

  const replacements: Record<string, string> = {
    FechaElaboración: values.dateStr,
    FechaElaboracion: values.dateStr,
    NombrePropietario: values.clientName || 'N/A',
    NumeroDocumento: values.documentNumber || 'N/A',
    ValorLote: values.lotValue || '$ 0',
    ValorSeparación: values.deposit || '$ 0',
    ValorSeparacion: values.deposit || '$ 0',
    PlazoPagos: values.paymentTerms || '24',
    NoLote: values.lotNumber || 'N/A',
    SectorEtapa: values.sectorStage || 'N/A',
    NombreProyecto: values.projectName || 'Proyecto Campestre',
    ÁreaLote: values.area || 'N/A',
    AreaLote: values.area || 'N/A',
    BonoDescuento: values.discount || '$ 0',
    'Referido/AplicaóNoAplica': values.referralApplies || 'NO',
    'Referido/AplicaoNoAplica': values.referralApplies || 'NO',
    NombreReferido: values.referralApplies === 'SI' ? values.referralName || 'N/A' : 'NO APLICA',
    FuenteDeCaptación: values.saleType || 'DIRECTA',
    FuenteDeCaptacion: values.saleType || 'DIRECTA',
  };

  const modifiedXml = replacePlaceholdersInWordXml(xmlWithDynamicTable, replacements);
  zip.file('word/document.xml', modifiedXml);

  return await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

export function downloadBlobAsFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
