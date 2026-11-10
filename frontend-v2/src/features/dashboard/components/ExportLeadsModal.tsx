import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  getDocs,
  getCountFromServer,
  query,
  where,
  Timestamp,
  type DocumentData,
  type Query,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { Spinner } from '@/shared/components/Spinner';

interface ExportLeadsModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
}

interface RawLeadDoc {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  city?: string;
  status?: string;
  source?: string;
  inbox?: string;
  fuenteUbicacion?: string;
  assignedTo?: string | null;
  projectInterest?: string | string[];
  reactivationCount?: number;
  isArchived?: boolean;
  lastMessageText?: string;
  createdAt?: { toMillis?: () => number; seconds?: number; _seconds?: number } | string | number;
  lastMessageAt?: { toMillis?: () => number; seconds?: number; _seconds?: number } | string | number;
  lastInboundAt?: { toMillis?: () => number; seconds?: number; _seconds?: number } | string | number;
  firstTouch?: {
    source?: string;
    campaign?: string;
    adName?: string;
    adSet?: string;
    medium?: string;
    gclid?: string;
    fbclid?: string;
    project?: string;
    at?: unknown;
  };
  lastTouch?: {
    source?: string;
    campaign?: string;
    adName?: string;
    adSet?: string;
    medium?: string;
    gclid?: string;
    fbclid?: string;
    project?: string;
    at?: unknown;
  };
  metadata?: Record<string, unknown>;
  customFields?: Record<string, string>;
  aiAnalysis?: {
    score?: number;
    temperature?: 'hot' | 'warm' | 'cold';
    lossCategory?: string;
    lossReason?: string;
    summary?: string;
  };
}

interface LeadSourceItem {
  id: string;
  name: string;
  active: boolean;
  leadCount?: number;
}

const BASE_CHANNELS = [
  { value: 'all',              label: 'Todas las fuentes' },
  { value: 'meta_ads',         label: 'Meta Ads (Facebook / Instagram Ads)' },
  { value: 'google_ads',       label: 'Google Ads' },
  { value: 'web',              label: 'Sitio Web (Formulario / Mapa)' },
  { value: 'whatsapp',         label: 'WhatsApp Orgánico (Línea 317)' },
  { value: 'advisor_whatsapp', label: 'WhatsApp Directo Asesor' },
  { value: 'facebook',         label: 'Facebook Messenger' },
  { value: 'instagram',        label: 'Instagram DM' },
  { value: 'manual',           label: 'Manual' },
];

const SOURCE_LABELS: Record<string, string> = {
  meta_ads:         'Meta Ads',
  google_ads:       'Google Ads',
  web:              'Sitio Web',
  whatsapp:         'WhatsApp Orgánico (317)',
  advisor_whatsapp: 'WhatsApp Directo Asesor',
  facebook:         'Facebook Messenger',
  instagram:        'Instagram DM',
  manual:           'Manual',
};

const STATUS_OPTIONS = [
  { value: 'all',       label: 'Todos los estados' },
  { value: 'new',       label: 'Nuevo' },
  { value: 'active',    label: 'Activo' },
  { value: 'qualified', label: 'Calificado' },
  { value: 'scheduled', label: 'Agendado' },
  { value: 'closed',    label: 'Vendido / Cerrado' },
  { value: 'lost',      label: 'Perdido' },
];

const STATUS_LABELS: Record<string, string> = {
  new:       'Nuevo',
  active:    'Activo',
  qualified: 'Calificado',
  scheduled: 'Agendado',
  closed:    'Vendido',
  lost:      'Perdido',
};

const MONTH_OPTIONS = [
  { value: 'all', label: 'Todos los meses' },
  { value: '1',   label: '01 - Enero' },
  { value: '2',   label: '02 - Febrero' },
  { value: '3',   label: '03 - Marzo' },
  { value: '4',   label: '04 - Abril' },
  { value: '5',   label: '05 - Mayo' },
  { value: '6',   label: '06 - Junio' },
  { value: '7',   label: '07 - Julio' },
  { value: '8',   label: '08 - Agosto' },
  { value: '9',   label: '09 - Septiembre' },
  { value: '10',  label: '10 - Octubre' },
  { value: '11',  label: '11 - Noviembre' },
  { value: '12',  label: '12 - Diciembre' },
];

const PROJECT_LIST = [
  'Laguna Mar (Melgar, Tolima)',
  'Cañón de Arizona',
  'Río Claro',
  'Llano Grande',
  'Sobre Montañas',
  'Arizona 1',
  'Arizona 2',
  'Gran Arizona',
];

function toMillis(val: unknown): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const t = Date.parse(val);
    return Number.isFinite(t) ? t : 0;
  }
  const obj = val as { toMillis?: () => number; seconds?: number; _seconds?: number };
  if (typeof obj.toMillis === 'function') return obj.toMillis();
  if (typeof obj.seconds === 'number') return obj.seconds * 1000;
  if (typeof obj._seconds === 'number') return obj._seconds * 1000;
  return 0;
}

function getBogotaParts(ms: number): { year: number; month: number; formatted: string; monthName: string } {
  if (!ms) return { year: 0, month: 0, formatted: '', monthName: '' };
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const map: Record<string, string> = {};
  parts.forEach((p) => { map[p.type] = p.value; });
  const year = Number(map.year || 0);
  const month = Number(map.month || 0);
  const monthNames = [
    '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];
  return {
    year,
    month,
    formatted: `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}`,
    monthName: monthNames[month] || '',
  };
}

function extractLeadProject(lead: RawLeadDoc): string {
  if (Array.isArray(lead.projectInterest) && lead.projectInterest.length > 0) {
    return String(lead.projectInterest[0] || '').trim();
  }
  if (typeof lead.projectInterest === 'string' && lead.projectInterest.trim()) {
    return lead.projectInterest.trim();
  }
  const customProj = lead.customFields?.proyecto;
  if (customProj && String(customProj).trim()) return String(customProj).trim();
  const ftProj = lead.firstTouch?.project || lead.lastTouch?.project;
  if (ftProj && String(ftProj).trim()) return String(ftProj).trim();
  const meta = lead.metadata || {};
  const metaProj = (meta.project || meta.webProject || meta.webArea || '') as string;
  return String(metaProj || '').trim();
}

function resolveLeadInbox(lead: RawLeadDoc): 'central_317' | 'advisor_direct' {
  if (lead.inbox === 'advisor_direct') return 'advisor_direct';
  if (lead.source === 'advisor_whatsapp') return 'advisor_direct';
  if (lead.metadata?.advisorWhatsappMirror === 'true' || lead.metadata?.advisorWhatsappMirror === true) {
    return 'advisor_direct';
  }
  return 'central_317';
}

function escapeXml(val: unknown): string {
  return String(val ?? '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colLetter(colIndex: number): string {
  let n = colIndex + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function buildWorksheetXml(headers: string[], rows: (string | number)[][], isActiveSheet = false): string {
  const lastCol = colLetter(Math.max(headers.length - 1, 0));
  const totalRows = rows.length + 1;

  const colsXml = headers
    .map((h, i) => {
      const width = Math.min(Math.max(h.length + 6, 16), 38);
      return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`;
    })
    .join('');

  const headerCells = headers
    .map((h, cIdx) => {
      const ref = `${colLetter(cIdx)}1`;
      return `<c r="${ref}" s="1" t="inlineStr"><is><t xml:space="preserve">${escapeXml(h)}</t></is></c>`;
    })
    .join('');

  const bodyRows = rows
    .map((row, rIdx) => {
      const rowNum = rIdx + 2;
      const cells = row
        .map((cellVal, cIdx) => {
          const ref = `${colLetter(cIdx)}${rowNum}`;
          if (typeof cellVal === 'number' && Number.isFinite(cellVal)) {
            return `<c r="${ref}" s="2"><v>${cellVal}</v></c>`;
          }
          return `<c r="${ref}" s="2" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cellVal)}</t></is></c>`;
        })
        .join('');
      return `<row r="${rowNum}" ht="19" customHeight="1">${cells}</row>`;
    })
    .join('');

  const tabSelAttr = isActiveSheet ? ' tabSelected="1"' : '';

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${lastCol}${totalRows}"/>` +
    `<sheetViews><sheetView${tabSelAttr} workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${colsXml}</cols>` +
    `<sheetData>` +
    `<row r="1" ht="24" customHeight="1">${headerCells}</row>` +
    bodyRows +
    `</sheetData>` +
    `<autoFilter ref="A1:${lastCol}${totalRows}"/>` +
    `</worksheet>`
  );
}

async function generateMultiSheetXlsxBlob(
  sheet1: { headers: string[]; rows: (string | number)[][] },
  sheet2: { headers: string[]; rows: (string | number)[][] },
): Promise<Blob> {
  const JSZipMod = await import('jszip');
  const JSZip = JSZipMod.default || (JSZipMod as unknown as typeof import('jszip'));
  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `</Types>`,
  );

  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
  );

  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>` +
      `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`,
  );

  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="14400" activeTab="0"/></bookViews>` +
      `<sheets>` +
      `<sheet name="Leads Filtrados" sheetId="1" r:id="rId1"/>` +
      `<sheet name="Resumen del Filtro" sheetId="2" r:id="rId2"/>` +
      `</sheets>` +
      `</workbook>`,
  );

  zip.file(
    'xl/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="2">` +
      `<font><sz val="10"/><color rgb="FF18181B"/><name val="Calibri"/></font>` +
      `<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` +
      `</fonts>` +
      `<fills count="3">` +
      `<fill><patternFill patternType="none"/></fill>` +
      `<fill><patternFill patternType="gray125"/></fill>` +
      `<fill><patternFill patternType="solid"><fgColor rgb="FF111827"/></patternFill></fill>` +
      `</fills>` +
      `<borders count="2">` +
      `<border><left/><right/><top/><bottom/><diagonal/></border>` +
      `<border>` +
      `<left style="thin"><color rgb="FFE4E4E7"/></left>` +
      `<right style="thin"><color rgb="FFE4E4E7"/></right>` +
      `<top style="thin"><color rgb="FFE4E4E7"/></top>` +
      `<bottom style="thin"><color rgb="FFE4E4E7"/></bottom>` +
      `<diagonal/>` +
      `</border>` +
      `</borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="3">` +
      `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
      `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center"/></xf>` +
      `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"><alignment vertical="center"/></xf>` +
      `</cellXfs>` +
      `</styleSheet>`,
  );

  zip.file('xl/worksheets/sheet1.xml', buildWorksheetXml(sheet1.headers, sheet1.rows, true));
  zip.file('xl/worksheets/sheet2.xml', buildWorksheetXml(sheet2.headers, sheet2.rows, false));

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function ExportLeadsModal({ isOpen, onClose, companyId }: ExportLeadsModalProps) {
  // Estado de carga liviana (solo metadata inicial: asesores, fuentes, conteo total)
  const [loadingMetadata, setLoadingMetadata] = useState(false);
  const [totalDatabaseCount, setTotalDatabaseCount] = useState<number | null>(null);
  const [advisorsMap, setAdvisorsMap] = useState<Record<string, string>>({});
  const [leadSourcesList, setLeadSourcesList] = useState<LeadSourceItem[]>([]);

  // Estado de consulta bajo demanda (optimización para no quemar lecturas)
  const [queriedLeads, setQueriedLeads] = useState<RawLeadDoc[]>([]);
  const [hasQueried, setHasQueried] = useState<boolean>(false);
  const [querying, setQuerying] = useState<boolean>(false);
  const [querySummary, setQuerySummary] = useState<string>('');
  const [downloading, setDownloading] = useState<boolean>(false);

  // Filtros seleccionables por el usuario
  const [source, setSource] = useState<string>('all');
  const [sourceMatch, setSourceMatch] = useState<'any' | 'firstTouch' | 'lastTouch'>('any');
  const [inbox, setInbox] = useState<'all' | 'central_317' | 'advisor_direct'>('all');
  const [advisorId, setAdvisorId] = useState<string>('all');
  const [year, setYear] = useState<string>('all');
  const [month, setMonth] = useState<string>('all');
  const [dateField, setDateField] = useState<'createdAt' | 'lastMessageAt'>('createdAt');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [status, setStatus] = useState<string>('all');
  const [project, setProject] = useState<string>('all');
  const [temperature, setTemperature] = useState<string>('all');

  // Carga inicial ULTRA LIVIANA: solo usuarios, fuentes y conteo agregado (costo ~75 lecturas vs 13.160)
  useEffect(() => {
    if (!isOpen || !companyId) return;
    let cancelled = false;

    const loadMetadata = async () => {
      setLoadingMetadata(true);
      try {
        const [usersSnap, sourcesSnap, countSnap] = await Promise.all([
          getDocs(collection(db, 'companies', companyId, 'users')),
          getDocs(collection(db, 'companies', companyId, 'leadSources')),
          getCountFromServer(collection(db, 'companies', companyId, 'leads')),
        ]);
        if (cancelled) return;

        const uMap: Record<string, string> = {};
        usersSnap.forEach((docSnap) => {
          const d = docSnap.data() as { displayName?: string; name?: string; email?: string };
          uMap[docSnap.id] = d.displayName || d.name || d.email || docSnap.id;
        });

        const sList: LeadSourceItem[] = sourcesSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<LeadSourceItem, 'id'>),
        }));

        setAdvisorsMap(uMap);
        setLeadSourcesList(sList);
        setTotalDatabaseCount(countSnap.data().count);
      } catch (err) {
        console.error('[ExportLeadsModal] Error cargando metadata inicial:', err);
      } finally {
        if (!cancelled) setLoadingMetadata(false);
      }
    };

    // Reiniciar estado de consulta al abrir
    setHasQueried(false);
    setQueriedLeads([]);
    setQuerySummary('');
    loadMetadata();

    return () => {
      cancelled = true;
    };
  }, [isOpen, companyId]);

  // Lista organizada de Fuentes: Canales Digitales + Fuentes Activas + Fuentes Históricas/Desactivadas
  const sourceGroups = useMemo(() => {
    const active = leadSourcesList
      .filter((s) => s.active)
      .sort((a, b) => (b.leadCount ?? 0) - (a.leadCount ?? 0) || a.name.localeCompare(b.name, 'es'));

    const inactive = leadSourcesList
      .filter((s) => !s.active)
      .sort((a, b) => (b.leadCount ?? 0) - (a.leadCount ?? 0) || a.name.localeCompare(b.name, 'es'));

    return { active, inactive };
  }, [leadSourcesList]);

  // Asesores disponibles
  const advisorOptions = useMemo(() => {
    const list = Object.entries(advisorsMap)
      .map(([uid, name]) => ({
        value: uid,
        label: name,
        name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));

    return [
      { value: 'all', label: 'Todos los asesores', name: 'Todos' },
      { value: '__none__', label: 'Sin asignar', name: 'Sin asignar' },
      ...list,
    ];
  }, [advisorsMap]);

  const yearOptions = useMemo(() => [2027, 2026, 2025, 2024, 2023], []);

  // Función pura de filtrado fino en memoria
  const applyFilters = (leads: RawLeadDoc[]) => {
    const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00-05:00`).getTime() : null;
    const toMs = dateTo ? new Date(`${dateTo}T23:59:59.999-05:00`).getTime() : null;

    let targetSourceName = '';
    let targetSourceSlug = '';
    let isCustomSource = false;
    if (source.startsWith('source:')) {
      isCustomSource = true;
      targetSourceSlug = source.replace('source:', '');
      const found = leadSourcesList.find((s) => s.id === targetSourceSlug);
      targetSourceName = (found?.name || targetSourceSlug).toLowerCase().trim();
    }

    return leads
      .filter((lead) => {
        // 1. Inbox / Canal
        const leadInbox = resolveLeadInbox(lead);
        if (inbox !== 'all' && leadInbox !== inbox) return false;

        // 2. Fuente de captación (Digital o de leadSources)
        if (source !== 'all') {
          if (isCustomSource) {
            const lFuente = String(
              lead.fuenteUbicacion || lead.metadata?.fuenteUbicacion || lead.metadata?.smarthomeFuenteOriginal || ''
            ).toLowerCase().trim();
            const lSource = String(lead.source || '').toLowerCase().trim();
            const matches = lFuente === targetSourceName || lFuente.includes(targetSourceName) || lSource === targetSourceSlug;
            if (!matches) return false;
          } else {
            const ftSource = lead.firstTouch?.source || lead.source || '';
            const ltSource = lead.lastTouch?.source || lead.source || '';
            const curSource = lead.source || '';

            if (sourceMatch === 'firstTouch' && ftSource !== source) return false;
            if (sourceMatch === 'lastTouch' && ltSource !== source) return false;
            if (
              sourceMatch === 'any' &&
              ftSource !== source &&
              ltSource !== source &&
              curSource !== source
            ) {
              return false;
            }
          }
        }

        // 3. Asesor asignado
        if (advisorId !== 'all') {
          if (advisorId === '__none__') {
            if (lead.assignedTo) return false;
          } else if (lead.assignedTo !== advisorId) {
            return false;
          }
        }

        // 4. Estado comercial
        if (status !== 'all' && (lead.status || 'new') !== status) return false;

        // 5. Temperatura IA
        if (temperature !== 'all' && lead.aiAnalysis?.temperature !== temperature) return false;

        // 6. Proyecto / Ubicación
        if (project !== 'all') {
          const leadProj = extractLeadProject(lead).toLowerCase();
          const targetProj = project.toLowerCase();
          if (!leadProj || (!leadProj.includes(targetProj) && !targetProj.includes(leadProj))) {
            return false;
          }
        }

        // 7. Fecha (Año, Mes y Rango Desde/Hasta)
        const targetRawDate =
          dateField === 'lastMessageAt'
            ? lead.lastMessageAt || lead.lastInboundAt || lead.createdAt
            : lead.createdAt || lead.lastMessageAt;
        const ms = toMillis(targetRawDate);

        if (year !== 'all' || month !== 'all' || fromMs !== null || toMs !== null) {
          if (!ms) return false;
          const parts = getBogotaParts(ms);
          if (year !== 'all' && String(parts.year) !== year) return false;
          if (month !== 'all' && String(parts.month) !== month) return false;
          if (fromMs !== null && ms < fromMs) return false;
          if (toMs !== null && ms > toMs) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const msA = toMillis(a.createdAt) || toMillis(a.lastMessageAt);
        const msB = toMillis(b.createdAt) || toMillis(b.lastMessageAt);
        return msB - msA;
      });
  };

  // Leads filtrados en memoria a partir de los datos consultados
  const filteredLeads = useMemo(() => {
    if (!hasQueried) return [];
    return applyFilters(queriedLeads);
  }, [
    hasQueried,
    queriedLeads,
    inbox,
    source,
    sourceMatch,
    advisorId,
    status,
    temperature,
    project,
    dateField,
    year,
    month,
    dateFrom,
    dateTo,
    leadSourcesList,
  ]);

  // Consulta optimizada bajo demanda a Firestore
  const executeSearch = async (): Promise<RawLeadDoc[]> => {
    if (!companyId) return [];
    setQuerying(true);

    try {
      const colRef = collection(db, 'companies', companyId, 'leads');
      let baseQuery: Query<DocumentData> = colRef;
      let strategyDesc = '';

      const hasAnyFilter =
        source !== 'all' ||
        advisorId !== 'all' ||
        status !== 'all' ||
        inbox !== 'all' ||
        year !== 'all' ||
        month !== 'all' ||
        dateFrom !== '' ||
        dateTo !== '' ||
        project !== 'all' ||
        temperature !== 'all';

      // Si no hay ningún filtro, advertir antes de leer los 13k registros
      if (!hasAnyFilter) {
        const countTxt = totalDatabaseCount ? totalDatabaseCount.toLocaleString('es-CO') : '13.160';
        const proceed = confirm(
          `⚠️ Vas a consultar la base completa (${countTxt} registros) sin filtros.\n\nEsto consumirá ${countTxt} operaciones de lectura en Firestore.\n\n¿Deseas continuar?`
        );
        if (!proceed) {
          setQuerying(false);
          return [];
        }
        strategyDesc = 'Base completa (sin filtros)';
      }

      // Estrategia del filtro más selectivo para minimizar lecturas en el servidor:
      // 1. Por Asesor asignado (recorta a ~200-700 lecturas)
      if (advisorId !== 'all' && advisorId !== '__none__') {
        baseQuery = query(colRef, where('assignedTo', '==', advisorId));
        const advName = advisorsMap[advisorId] || 'Asesor';
        strategyDesc = `Filtrado por Asesor: ${advName}`;
      }
      // 2. Leads sin asignar
      else if (advisorId === '__none__') {
        baseQuery = query(colRef, where('assignedTo', '==', null));
        strategyDesc = 'Filtrado por Leads sin asignar';
      }
      // 3. Por Fuente específica de leadSources (recorta a los leads de esa feria o canal)
      else if (source.startsWith('source:')) {
        const srcId = source.replace('source:', '');
        const srcObj = leadSourcesList.find((s) => s.id === srcId);
        const srcName = srcObj?.name || srcId;
        baseQuery = query(colRef, where('fuenteUbicacion', '==', srcName));
        strategyDesc = `Filtrado por Fuente: ${srcName}`;
      }
      // 4. Por Canal nativo digital
      else if (source !== 'all') {
        baseQuery = query(colRef, where('source', '==', source));
        strategyDesc = `Filtrado por Canal: ${SOURCE_LABELS[source] || source}`;
      }
      // 5. Por Estado comercial
      else if (status !== 'all') {
        baseQuery = query(colRef, where('status', '==', status));
        strategyDesc = `Filtrado por Estado: ${STATUS_LABELS[status] || status}`;
      }
      // 6. Por Rango de Fechas de Creación
      else if (dateField === 'createdAt' && (dateFrom || dateTo)) {
        const constraints = [];
        if (dateFrom) {
          const fromDate = new Date(`${dateFrom}T00:00:00-05:00`);
          constraints.push(where('createdAt', '>=', Timestamp.fromDate(fromDate)));
        }
        if (dateTo) {
          const toDate = new Date(`${dateTo}T23:59:59.999-05:00`);
          constraints.push(where('createdAt', '<=', Timestamp.fromDate(toDate)));
        }
        baseQuery = query(colRef, ...constraints);
        strategyDesc = `Filtrado por Rango de Fechas (${dateFrom || 'inicio'} a ${dateTo || 'fin'})`;
      }

      const snap = await getDocs(baseQuery);
      const rawFetched: RawLeadDoc[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<RawLeadDoc, 'id'>),
      }));

      const filtered = applyFilters(rawFetched);

      setQueriedLeads(rawFetched);
      setHasQueried(true);
      setQuerySummary(
        `${filtered.length} coincidencias de ${rawFetched.length} consultados (${strategyDesc || 'Filtro compuesto'})`
      );

      return filtered;
    } catch (err) {
      console.error('[ExportLeadsModal] Error ejecutando consulta optimizada:', err);
      alert('Error consultando datos en Firestore. Verifica los filtros seleccionados.');
      return [];
    } finally {
      setQuerying(false);
    }
  };

  const handleResetFilters = () => {
    setSource('all');
    setSourceMatch('any');
    setInbox('all');
    setAdvisorId('all');
    setYear('all');
    setMonth('all');
    setDateField('createdAt');
    setDateFrom('');
    setDateTo('');
    setStatus('all');
    setProject('all');
    setTemperature('all');
    setHasQueried(false);
    setQueriedLeads([]);
    setQuerySummary('');
  };

  // Generación y descarga directa del Excel desde la memoria (0 lecturas adicionales)
  const handleDownloadExcel = async () => {
    if (downloading) return;

    let leadsToExport = filteredLeads;
    if (!hasQueried) {
      leadsToExport = await executeSearch();
    }

    if (!leadsToExport || leadsToExport.length === 0) {
      alert('No hay leads que coincidan con los filtros seleccionados para exportar.');
      return;
    }

    setDownloading(true);
    try {
      const headers = [
        'ID Lead',
        'Fecha Ingreso (Bogotá)',
        'Año',
        'Mes',
        'Última Interacción (Bogotá)',
        'Nombre Cliente',
        'Teléfono',
        'Correo',
        'Ciudad',
        'Proyecto / Ubicación',
        'Estado Comercial',
        'Asesor Asignado',
        'Canal / Línea de Entrada',
        '1ra Fuente (First Touch)',
        'Campaña Inicial (First Touch)',
        'Anuncio Inicial',
        'Última Fuente (Last Touch)',
        'Última Campaña (Last Touch)',
        'Reactivaciones',
        'GCLID (Google Ads)',
        'FBCLID (Meta Ads)',
        'Score IA',
        'Temperatura IA',
        'Categoría Pérdida IA',
        'Resumen IA',
        'Último Mensaje',
        'Última Bitácora / Seguimiento',
      ];

      const rows: (string | number)[][] = leadsToExport.map((l): (string | number)[] => {
        const createdMs = toMillis(l.createdAt);
        const lastMsgMs = toMillis(l.lastMessageAt || l.lastInboundAt);
        const createdParts = getBogotaParts(createdMs);
        const lastMsgParts = getBogotaParts(lastMsgMs);

        const leadInbox = resolveLeadInbox(l);
        const inboxText =
          leadInbox === 'advisor_direct'
            ? 'WhatsApp Directo Asesor'
            : 'Línea Central 317';

        const ftSourceRaw = String(l.firstTouch?.source || l.source || '');
        const ltSourceRaw = String(l.lastTouch?.source || l.source || '');
        const meta = l.metadata || {};

        const advisorName = l.assignedTo
          ? advisorsMap[l.assignedTo] || l.assignedTo
          : 'Sin asignar';

        const tempMap: Record<string, string> = {
          hot: 'Caliente',
          warm: 'Tibio',
          cold: 'Frío',
        };

        const displayFuente = String(
          l.fuenteUbicacion || l.metadata?.fuenteUbicacion || SOURCE_LABELS[ltSourceRaw] || ltSourceRaw || ''
        );

        const rawBitacoras = Array.isArray((l as any).bitacoras)
          ? (l as any).bitacoras
          : Array.isArray(meta.smarthomeBitacoras)
          ? (meta.smarthomeBitacoras as any[])
          : [];
        const latestBitacoraObj = rawBitacoras.length > 0 ? rawBitacoras[rawBitacoras.length - 1] : null;
        const latestBitacoraText = latestBitacoraObj
          ? `${latestBitacoraObj.fecha || ''} ${latestBitacoraObj.comentario || latestBitacoraObj.text || ''}`.trim()
          : '';

        return [
          String(l.id || ''),
          createdParts.formatted || 'Sin fecha',
          createdParts.year || '',
          createdParts.monthName || '',
          lastMsgParts.formatted || '',
          String(l.name || 'Sin nombre'),
          String(l.phone || ''),
          String(l.email || ''),
          String(l.city || ''),
          extractLeadProject(l) || '',
          STATUS_LABELS[l.status || 'new'] || String(l.status || 'Nuevo'),
          String(advisorName),
          inboxText,
          SOURCE_LABELS[ftSourceRaw] || ftSourceRaw,
          String(l.firstTouch?.campaign || meta.metaCampaignName || meta.webUtmCampaign || ''),
          String(l.firstTouch?.adName || meta.metaAdName || ''),
          displayFuente,
          String(l.lastTouch?.campaign || ''),
          typeof l.reactivationCount === 'number' ? l.reactivationCount : 0,
          String(l.firstTouch?.gclid || l.lastTouch?.gclid || meta.gclid || meta.webGclid || ''),
          String(l.firstTouch?.fbclid || l.lastTouch?.fbclid || meta.fbclid || meta.webFbclid || ''),
          typeof l.aiAnalysis?.score === 'number' ? l.aiAnalysis.score : '',
          l.aiAnalysis?.temperature ? tempMap[l.aiAnalysis.temperature] || String(l.aiAnalysis.temperature) : '',
          String(l.aiAnalysis?.lossCategory || ''),
          Array.from(String(l.aiAnalysis?.summary || '')).slice(0, 250).join(''),
          Array.from(String(l.lastMessageText || '')).slice(0, 250).join(''),
          Array.from(String(latestBitacoraText)).slice(0, 300).join(''),
        ];
      });

      // Hoja 2: Resumen Ejecutivo del Filtro
      const summaryHeaders = ['Dimensión / Concepto', 'Detalle / Categoría', 'Cantidad'];
      const summaryRows: (string | number)[][] = [
        ['FILTRO APLICADO', 'Total Registros Exportados', leadsToExport.length],
        ['FILTRO APLICADO', 'Total Base de Datos', totalDatabaseCount ?? '13.160'],
        ['FILTRO APLICADO', 'Fuente Seleccionada', source === 'all' ? 'Todas' : source],
        ['FILTRO APLICADO', 'Asesor Seleccionado', advisorOptions.find((o) => o.value === advisorId)?.name || advisorId],
        ['FILTRO APLICADO', 'Año', year === 'all' ? 'Todos' : year],
        ['FILTRO APLICADO', 'Mes', MONTH_OPTIONS.find((m) => m.value === month)?.label || month],
        ['FILTRO APLICADO', 'Canal / Línea', inbox === 'all' ? 'Todos' : inbox === 'central_317' ? 'Línea Central 317' : 'WhatsApp Directo Asesor'],
        ['FILTRO APLICADO', 'Proyecto / Ubicación', project === 'all' ? 'Todos' : project],
        ['', '', ''],
      ];

      const byStatus = new Map<string, number>();
      const byAdvisor = new Map<string, number>();

      leadsToExport.forEach((l) => {
        const st = STATUS_LABELS[l.status || 'new'] || l.status || 'Nuevo';
        byStatus.set(st, (byStatus.get(st) ?? 0) + 1);

        const advLbl = l.assignedTo ? advisorsMap[l.assignedTo] || l.assignedTo : 'Sin asignar';
        byAdvisor.set(advLbl, (byAdvisor.get(advLbl) ?? 0) + 1);
      });

      byStatus.forEach((cnt, st) => summaryRows.push(['Por Estado', st, cnt]));
      summaryRows.push(['', '', '']);
      byAdvisor.forEach((cnt, adv) => summaryRows.push(['Por Asesor', adv, cnt]));

      const blob = await generateMultiSheetXlsxBlob(
        { headers, rows },
        { headers: summaryHeaders, rows: summaryRows },
      );

      const partsName = ['Meraki_Leads'];
      if (source !== 'all') partsName.push(source.replace(/[^a-zA-Z0-9]+/g, '_'));
      if (advisorId !== 'all') {
        const advName = (advisorOptions.find((o) => o.value === advisorId)?.name || 'Asesor')
          .replace(/[^a-zA-Z0-9]+/g, '_');
        partsName.push(advName);
      }
      if (month !== 'all') {
        const mLabel = MONTH_OPTIONS.find((m) => m.value === month)?.label.split(' - ')[1] || month;
        partsName.push(mLabel);
      }
      if (year !== 'all') partsName.push(year);
      if (partsName.length === 1) {
        partsName.push(new Date().toISOString().slice(0, 10));
      }

      const fileName = `${partsName.join('_')}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      console.error('[ExportLeadsModal] Error generando Excel:', err);
      alert('Ocurrió un error al generar el archivo Excel.');
    } finally {
      setDownloading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/60">
          <div>
            <h2 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
              <span>📥 Exportador Avanzado de Leads a Excel (.xlsx)</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Consulta bajo demanda: filtra por ferias activas/desactivadas, asesor o fechas sin sobrecargar lecturas en Firestore.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100 px-2.5 py-1 rounded-lg border border-zinc-800 hover:bg-zinc-800 text-xs"
          >
            ✕ Cerrar
          </button>
        </div>

        {/* Body */}
        {loadingMetadata ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Spinner />
            <p className="text-xs text-zinc-400">Cargando opciones de fuentes y asesores de forma liviana...</p>
          </div>
        ) : (
          <div className="p-6 overflow-y-auto space-y-5">
            {/* Grid de 9 filtros */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* 1. Fuente de Captación (Canales + Activas + Históricas) */}
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  1. Fuente de Captación
                </label>
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                >
                  <option value="all">Todas las fuentes</option>

                  <optgroup label="Canales Digitales Base">
                    {BASE_CHANNELS.slice(1).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </optgroup>

                  {sourceGroups.active.length > 0 && (
                    <optgroup label="Fuentes Activas del CRM">
                      {sourceGroups.active.map((s) => (
                        <option key={s.id} value={`source:${s.id}`}>
                          {s.name} {typeof s.leadCount === 'number' ? `(${s.leadCount.toLocaleString('es-CO')})` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}

                  {sourceGroups.inactive.length > 0 && (
                    <optgroup label="Fuentes Históricas / Ferias Anteriores (Desactivadas)">
                      {sourceGroups.inactive.map((s) => (
                        <option key={s.id} value={`source:${s.id}`}>
                          [Histórica] {s.name} {typeof s.leadCount === 'number' ? `(${s.leadCount.toLocaleString('es-CO')})` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              {/* 2. Asesor Asignado */}
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  2. Asesor Asignado
                </label>
                <select
                  value={advisorId}
                  onChange={(e) => setAdvisorId(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                >
                  {advisorOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* 3. Canal / Línea de Entrada */}
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  3. Línea / Canal de Entrada
                </label>
                <select
                  value={inbox}
                  onChange={(e) => setInbox(e.target.value as 'all' | 'central_317' | 'advisor_direct')}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                >
                  <option value="all">Todos los canales (317 + Asesores)</option>
                  <option value="central_317">🏢 Solo Línea Central 317 (Corporativa)</option>
                  <option value="advisor_direct">👤 Solo WhatsApp Directo Asesores</option>
                </select>
              </div>

              {/* 4. Año */}
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  4. Año
                </label>
                <select
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                >
                  <option value="all">Todos los años</option>
                  {yearOptions.map((y) => (
                    <option key={y} value={String(y)}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>

              {/* 5. Mes */}
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  5. Mes
                </label>
                <select
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                >
                  {MONTH_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* 6. Proyecto / Ubicación */}
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  6. Proyecto / Ubicación
                </label>
                <select
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                >
                  <option value="all">Todos los proyectos / ubicaciones</option>
                  {PROJECT_LIST.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              {/* 7. Estado del Lead */}
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  7. Estado del Lead
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* 8. Modo de Fuente */}
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  8. Tipo de Fuente a Evaluar
                </label>
                <select
                  value={sourceMatch}
                  onChange={(e) => setSourceMatch(e.target.value as 'any' | 'firstTouch' | 'lastTouch')}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                >
                  <option value="any">Cualquiera (1ra Fuente o Última Fuente)</option>
                  <option value="firstTouch">Solo 1ra Fuente Histórica (First Touch)</option>
                  <option value="lastTouch">Solo Última Fuente (Last Touch)</option>
                </select>
              </div>

              {/* 9. Temperatura IA */}
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  9. Temperatura IA
                </label>
                <select
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                >
                  <option value="all">Todas las temperaturas</option>
                  <option value="hot">🔥 Caliente (Hot)</option>
                  <option value="warm">🌤️ Tibio (Warm)</option>
                  <option value="cold">❄️ Frío (Cold)</option>
                </select>
              </div>
            </div>

            {/* Rango de fechas opcional */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-zinc-800/80">
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  Evaluar fecha por
                </label>
                <select
                  value={dateField}
                  onChange={(e) => setDateField(e.target.value as 'createdAt' | 'lastMessageAt')}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                >
                  <option value="createdAt">Fecha de ingreso / creación del lead</option>
                  <option value="lastMessageAt">Fecha de última conversación</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  Desde fecha exacta (opcional)
                </label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  Hasta fecha exacta (opcional)
                </label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>

            {/* BARRA DE ACCIÓN Y CONTROL DE CONSUMO */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex-1 min-w-[280px]">
                {!hasQueried ? (
                  <div>
                    <p className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                      ⚡ Modo Optimizado de Firestore (Ahorro de Lecturas)
                    </p>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Configura los filtros arriba y haz clic en <strong>"Consultar y Previsualizar"</strong>. El sistema traerá únicamente los prospectos que coinciden en vez de descargar los {totalDatabaseCount?.toLocaleString('es-CO') ?? '13.160'} registros de la base.
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold text-emerald-400 tabular-nums">
                      {filteredLeads.length.toLocaleString('es-CO')}
                    </span>
                    <div>
                      <p className="text-xs font-medium text-zinc-200">
                        Leads listos para exportar
                      </p>
                      <p className="text-[11px] text-zinc-400">
                        {querySummary || `De ${queriedLeads.length} registros consultados en Firestore`}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="text-xs px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  Limpiar filtros
                </button>
                <button
                  type="button"
                  onClick={executeSearch}
                  disabled={querying}
                  className="text-xs px-4 py-2 rounded-lg border border-amber-500/50 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  {querying ? (
                    <>
                      <Spinner /> Consultando...
                    </>
                  ) : hasQueried ? (
                    '🔄 Actualizar Consulta'
                  ) : (
                    '🔍 Consultar y Previsualizar'
                  )}
                </button>
              </div>
            </div>

            {/* Vista previa de los registros */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-300">
                  Vista previa de registros a exportar {hasQueried ? `(${Math.min(filteredLeads.length, 6)} de ${filteredLeads.length})` : '(esperando consulta)'}
                </span>
                <span className="text-[11px] text-zinc-500">
                  El Excel incluye 26 columnas + Hoja de Resumen
                </span>
              </div>

              {!hasQueried ? (
                <div className="p-8 text-center">
                  <p className="text-xs text-zinc-400">
                    Aún no se han consultado datos para evitar lecturas masivas a Firestore.
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Selecciona tus filtros y pulsa <strong>"🔍 Consultar y Previsualizar"</strong> para revisar los registros antes de descargar.
                  </p>
                </div>
              ) : filteredLeads.length === 0 ? (
                <div className="p-6 text-center text-xs text-zinc-500">
                  No se encontraron prospectos con esta combinación de filtros. Prueba modificando el asesor, mes o fuente.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-zinc-800 text-[11px] text-zinc-400 bg-zinc-900/60">
                        <th className="py-2 px-3">Fecha</th>
                        <th className="py-2 px-3">Cliente</th>
                        <th className="py-2 px-3">Teléfono</th>
                        <th className="py-2 px-3">Fuente</th>
                        <th className="py-2 px-3">Canal</th>
                        <th className="py-2 px-3">Asesor</th>
                        <th className="py-2 px-3">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLeads.slice(0, 6).map((l) => {
                        const ms = toMillis(l.createdAt) || toMillis(l.lastMessageAt);
                        const dateStr = getBogotaParts(ms).formatted || '—';
                        const srcRaw = l.lastTouch?.source || l.source || '';
                        const fuenteShow = String(l.fuenteUbicacion || l.metadata?.fuenteUbicacion || SOURCE_LABELS[srcRaw] || srcRaw || 'Sin fuente');
                        const advName = l.assignedTo ? advisorsMap[l.assignedTo] || l.assignedTo : 'Sin asignar';
                        const leadInbox = resolveLeadInbox(l);
                        return (
                          <tr key={l.id} className="border-b border-zinc-800/60 hover:bg-zinc-900/40">
                            <td className="py-2 px-3 text-zinc-400 whitespace-nowrap">{dateStr}</td>
                            <td className="py-2 px-3 text-zinc-200 font-medium truncate max-w-[160px]">{l.name || 'Sin nombre'}</td>
                            <td className="py-2 px-3 text-zinc-300 whitespace-nowrap">{l.phone || '—'}</td>
                            <td className="py-2 px-3 text-amber-300 whitespace-nowrap truncate max-w-[170px]">{fuenteShow}</td>
                            <td className="py-2 px-3 text-zinc-400 whitespace-nowrap">
                              {leadInbox === 'advisor_direct' ? '👤 Asesor' : '🏢 Línea 317'}
                            </td>
                            <td className="py-2 px-3 text-zinc-300 truncate max-w-[150px]">{advName}</td>
                            <td className="py-2 px-3 text-zinc-300">{STATUS_LABELS[l.status || 'new'] || l.status}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800 bg-zinc-900/60">
          <div className="text-[11px] text-zinc-500 hidden sm:block">
            {totalDatabaseCount ? (
              <span>Total en base: <strong>{totalDatabaseCount.toLocaleString('es-CO')}</strong> leads</span>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="text-xs px-4 py-2 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleDownloadExcel}
              disabled={downloading || loadingMetadata || (hasQueried && filteredLeads.length === 0)}
              className="text-xs px-5 py-2 rounded-lg border border-emerald-600 bg-emerald-600 text-white font-semibold hover:bg-emerald-500 disabled:opacity-40 transition-colors flex items-center gap-2"
            >
              {downloading ? (
                <>
                  <Spinner /> Generando archivo Excel...
                </>
              ) : hasQueried ? (
                `📥 Descargar Excel (${filteredLeads.length.toLocaleString('es-CO')} registros)`
              ) : (
                '📥 Consultar y Descargar Excel'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
