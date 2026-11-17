import firestore, { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';

export interface AdvisorLeadFollowUpHistoryItem {
  id?: string;
  fecha: string;
  action: string;
  description: string;
  asesor: string;
}

export interface AdvisorLeadDetailItem {
  leadId: string;
  clientName: string;
  phone: string;
  phoneRaw?: string;
  advisorId: string;
  advisorName: string;
  createdAt: number;
  createdAtFormatted: string;
  project?: string;
  source?: string;
  status: string;
  hasFollowUp: boolean;
  hasPeriodFollowUp: boolean;
  hasMonthFollowUp: boolean;
  lastFollowUpAt?: number;
  lastFollowUpFormatted?: string;
  lastFollowUpSummary?: string;
  lastFollowUpAuthor?: string;
  allBitacoras: AdvisorLeadFollowUpHistoryItem[];
  isPeriodCreated: boolean;
  isMonthCreated: boolean;
  fromTransfer?: boolean;
  transferReason?: string;
}

export interface AdvisorReportRow {
  advisorId: string;
  advisorName: string;
  captSemana: number;
  captMes: number;
  avanceMesPct: number;
  ventasSemana: number;
  ventasMes: number;
  clientesConSeguimiento: number;
  leadsSemConSeguimiento: number;
  leadsSemSinSeguimiento: number;
  clientesAnteriores: number;
  coberturaPct: number;
  periodLeads: AdvisorLeadDetailItem[];
  monthLeads: AdvisorLeadDetailItem[];
  managedLeads?: AdvisorLeadDetailItem[];
}

export interface CommercialExecutiveReportData {
  title: string;
  periodType: 'current_week' | 'previous_week' | 'month' | 'today' | 'custom';
  startDate: number;
  endDate: number;
  periodLabel: string;
  monthLabel: string;
  preparedBy: string;
  forRecipient: string;
  date: string;
  isIndividualReport: boolean;
  targetAdvisorName?: string;
  targetAdvisorId?: string;
  kpis: {
    captacionesPeriodo: number;
    ventasPeriodo: number;
    ventasMes: number;
    clientesGestionadosPeriodo: number;
    coberturaLeadsPeriodoPct: number;
    leadsPeriodoConSeguimiento: number;
    leadsPeriodoSinSeguimiento: number;
    captacionesMes: number;
  };
  summaryBullets: {
    referencia: string;
    captacion: string;
    ventas: string;
    seguimiento: string;
  };
  advisorRows: AdvisorReportRow[];
  allPeriodLeads: AdvisorLeadDetailItem[];
  allMonthLeads: AdvisorLeadDetailItem[];
  allManagedPeriodLeads?: AdvisorLeadDetailItem[];
  allAdvisorsList?: { id: string; name: string }[];
}

export const MERAKI_OFFICIAL_ADVISORS = [
  'Alexander Zuluaga Santacruz',
  'Edwin Mauricio Ramirez Vega',
  'Luis Carlos Machado Tovar',
  'Isabel Betancourth',
  'Karen Ramirez',
  'Oscar Eduardo Narvaez Rojas',
  'Claudia Patricia Bolaños Vega',
  'Juana María Ávila Rojas',
  'Luisa Fernanda Zuluaga Mejia',
  'Adriana Montaña Cortez',
  'Adriana Garzón Osorio',
  'Ildre Chona Conde',
];

const IGNORED_ADVISOR_TOKENS = new Set([
  'pruebas',
  'prueba',
  'test',
  'testing',
  'marketing',
  'sistemas',
  'admin',
  'administrador',
  'gerencia',
  'bot',
  'ia',
  'ai',
  'sin asignar',
  'unassigned',
  'ninguno',
  'system',
  'sistema',
  'general',
  'recepcion',
  'meraki',
  'grupo meraki',
  'servidor meraki',
]);

function formatAdvisorDisplayName(rawName: string): string {
  const cleaned = String(rawName || '')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';

  for (const official of MERAKI_OFFICIAL_ADVISORS) {
    if (normalizeStr(official) === normalizeStr(cleaned)) {
      return official;
    }
  }

  return cleaned
    .split(' ')
    .map((word) => {
      if (!word) return '';
      const lower = word.toLowerCase();
      if (['de', 'del', 'la', 'las', 'los', 'y'].includes(lower)) return lower;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

function isExcludedNonAdvisorUser(u: Record<string, any>, docId: string): boolean {
  if (docId === 'H69G8PsEzReNuU1yowJNnlCHgie2') return true;
  const role = String(u.role || '').toLowerCase().trim();
  if (role === 'admin' || role === 'viewer' || role === 'superadmin' || role === 'marketing') {
    return true;
  }
  const rawName = String(u.displayName || u.name || '').trim();
  const normName = normalizeStr(rawName);
  const email = String(u.email || '').toLowerCase().trim();

  if (!normName || IGNORED_ADVISOR_TOKENS.has(normName)) return true;
  if (normName.includes('prueba') || normName.includes('test') || normName.includes('servidor')) return true;
  if (email.includes('servidor.meraki') || email.includes('test') || email.includes('prueba')) return true;
  return false;
}

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const DAYS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const FULL_DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export function normalizeStr(s: string): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isAdvisorMatch(rawA?: unknown, rawB?: unknown): boolean {
  if (!rawA || !rawB) return false;
  const a = normalizeStr(String(rawA));
  const b = normalizeStr(String(rawB));
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;

  const stopWords = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'san', 'santa']);
  const wordsA = a.split(' ').filter((w) => w.length > 2 && !stopWords.has(w));
  const wordsB = b.split(' ').filter((w) => w.length > 2 && !stopWords.has(w));
  if (wordsA.length === 0 || wordsB.length === 0) return false;

  if (wordsA[0] === wordsB[0]) {
    const restA = wordsA.slice(1);
    const restB = wordsB.slice(1);
    const hasSurnameMatch = restA.some((wa) => restB.includes(wa));
    if (hasSurnameMatch) return true;
  }
  return false;
}

export function parseAnyDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val?.toMillis === 'function') return new Date(val.toMillis());
  if (typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'string') {
    const clean = val.replace(' ', 'T');
    const d = new Date(clean);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

export function cleanDigits(val: unknown): string {
  const s = String(val ?? '').replace(/\D/g, '');
  if (s.length === 10) return s;
  if (s.length === 12 && s.startsWith('57')) return s.slice(2);
  if (s.length > 10 && s.startsWith('57')) return s.slice(-10);
  return s;
}

export function formatBogotaDate(date: Date): string {
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

export function formatDateTimeBogota(date: Date): string {
  const dName = DAYS_ES[date.getDay()] || '';
  const dNum = String(date.getDate()).padStart(2, '0');
  const mName = MONTH_NAMES[date.getMonth()] ? MONTH_NAMES[date.getMonth()].slice(0, 3) : '';
  const hours = date.getHours();
  const mins = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'p. m.' : 'a. m.';
  const h12 = hours % 12 || 12;
  return `${dName} ${dNum} ${mName} - ${String(h12).padStart(2, '0')}:${mins} ${ampm}`;
}

/**
 * Bitácora que deja el sistema al aprobar un traslado de prospecto
 * ("Traslado Aprobado / Gestión Comercial", "traslado_comercial", "Traslado comercial: <motivo>").
 * No es una gestión del asesor.
 */
export function isTransferBitacora(action?: string | null, text?: string | null): boolean {
  const clean = (s: unknown) =>
    String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const a = clean(action);
  const t = clean(text);
  return (
    a.includes('traslado') ||
    a.includes('reasignacion') ||
    t.includes('traslado') ||
    t.includes('reasignacion') ||
    t.includes('solicitud de traslado') ||
    // Auditorías de administrador (cambio de asesor o de fuente): no son gestión del asesor
    a.includes('cambio de asesor') ||
    a.includes('cambio_asesor') ||
    a.includes('actualizacion de fuente') ||
    a.includes('cambio_fuente') ||
    t.includes('asesor reasignado por el administrador') ||
    t.includes('actualizado por el administrador')
  );
}

export function isRealCommercialFollowUp(action?: string | null, text?: string | null): boolean {
  const rawAction = String(action ?? '').trim();
  const rawText = String(text ?? '').trim();
  if (!rawAction && !rawText) return false;

  // El traslado aprobado no cuenta como seguimiento del asesor que recibe el prospecto.
  if (isTransferBitacora(rawAction, rawText)) return false;

  const aNorm = normalizeStr(rawAction);
  const dNorm = normalizeStr(rawText);

  const isAdvisorEventInSystem =
    (aNorm === 'evento del sistema' || aNorm === 'captacion') &&
    (dNorm.includes('registrado por:') ||
      dNorm.includes('cliente asiste') ||
      dNorm.includes('cliente no asiste') ||
      dNorm.includes('cita programada') ||
      dNorm.includes('ofrece servicio') ||
      dNorm.includes('agendo cita') ||
      dNorm.includes('se agendo'));

  if (!isAdvisorEventInSystem) {
    if (
      aNorm === 'evento del sistema' ||
      aNorm === 'creacion de prospecto' ||
      aNorm === 'creacion' ||
      aNorm === 'asignacion' ||
      aNorm === 'reasignacion' ||
      aNorm === 'sistema' ||
      aNorm === 'system' ||
      aNorm === 'auto' ||
      aNorm === 'webhook' ||
      aNorm === 'importacion'
    ) {
      return false;
    }
  }

  if (
    dNorm.includes('webhook') ||
    dNorm.includes('sincronizado automaticamente') ||
    dNorm.includes('lead importado') ||
    dNorm.includes('cambio de estado automatico') ||
    dNorm.includes('asignado por sistema')
  ) {
    return false;
  }

  return true;
}

export type CommercialPeriodShortcut = 'current_week' | 'previous_week' | 'month' | 'today' | 'custom';

export interface CommercialPeriodRange {
  startDate: Date;
  endDate: Date;
  startMonthDate: Date;
  endMonthDate: Date;
  periodLabel: string;
  monthLabel: string;
}

/**
 * Calcula el rango de fechas comercial de Grupo Meraki:
 * Semana comercial: inicia Viernes 00:00:00 y finaliza Jueves 23:59:59.
 */
export function getCommercialPeriodRange(
  shortcut: CommercialPeriodShortcut,
  customStart?: Date,
  customEnd?: Date
): CommercialPeriodRange {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const startMonthDate = new Date(currentYear, currentMonth, 1, 0, 0, 0, 0);
  const endMonthDate = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);
  const monthLabel = `${MONTH_NAMES[currentMonth]} ${currentYear}`;

  if (shortcut === 'custom' && customStart && customEnd) {
    const s = new Date(customStart);
    s.setHours(0, 0, 0, 0);
    const e = new Date(customEnd);
    e.setHours(23, 59, 59, 999);

    const sDay = FULL_DAY_NAMES[s.getDay()];
    const eDay = FULL_DAY_NAMES[e.getDay()];
    const label = `${sDay}, ${s.getDate()} de ${MONTH_NAMES[s.getMonth()]} al ${eDay}, ${e.getDate()} de ${MONTH_NAMES[e.getMonth()]} de ${e.getFullYear()} (11:59 p. m.)`;
    return { startDate: s, endDate: e, startMonthDate, endMonthDate, periodLabel: label, monthLabel };
  }

  if (shortcut === 'today') {
    const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const dayName = FULL_DAY_NAMES[now.getDay()];
    const label = `${dayName}, ${now.getDate()} de ${MONTH_NAMES[now.getMonth()]} al ${dayName}, ${now.getDate()} de ${MONTH_NAMES[now.getMonth()]} de ${now.getFullYear()} (11:59 p. m.)`;
    return { startDate, endDate, startMonthDate, endMonthDate, periodLabel: label, monthLabel };
  }

  if (shortcut === 'month') {
    const label = `1 de ${MONTH_NAMES[currentMonth]} al ${endMonthDate.getDate()} de ${MONTH_NAMES[currentMonth]} de ${currentYear} (11:59 p. m.)`;
    return {
      startDate: startMonthDate,
      endDate: endMonthDate,
      startMonthDate,
      endMonthDate,
      periodLabel: label,
      monthLabel,
    };
  }

  // Determinar el viernes más reciente (inicio de la semana comercial)
  const currentDayOfWeek = now.getDay(); // 0: Dom, 1: Lun, 2: Mar, 3: Mié, 4: Jue, 5: Vie, 6: Sáb
  const rawDiff = (currentDayOfWeek + 2) % 7;
  let daysSinceFriday = rawDiff === 0 ? 7 : rawDiff;

  if (shortcut === 'previous_week') {
    daysSinceFriday += 7;
  }

  const startFriday = new Date(now);
  startFriday.setDate(now.getDate() - daysSinceFriday);
  startFriday.setHours(0, 0, 0, 0);

  const endThursday = new Date(startFriday);
  endThursday.setDate(startFriday.getDate() + 6);
  endThursday.setHours(23, 59, 59, 999);

  // Si es la semana en curso y hoy es antes del jueves, el límite es hoy a fin de día
  const effectiveEnd = shortcut === 'current_week' && now < endThursday ? now : endThursday;

  const startDayName = FULL_DAY_NAMES[startFriday.getDay()];
  const endDayName = FULL_DAY_NAMES[effectiveEnd.getDay()];
  const label = `${startDayName}, ${startFriday.getDate()} de ${MONTH_NAMES[startFriday.getMonth()]} al ${endDayName}, ${effectiveEnd.getDate()} de ${MONTH_NAMES[effectiveEnd.getMonth()]} de ${effectiveEnd.getFullYear()} (11:59 p. m.)`;

  return {
    startDate: startFriday,
    endDate: effectiveEnd,
    startMonthDate,
    endMonthDate,
    periodLabel: label,
    monthLabel,
  };
}

export async function compileMobileCommercialReport(
  companyId: string,
  options: {
    shortcut: CommercialPeriodShortcut;
    customStartDate?: Date;
    customEndDate?: Date;
    isUserAdmin: boolean;
    currentUserId: string;
    currentUserName: string;
    targetAdvisorFilter?: string; // 'all' or advisorId or officialName
  }
): Promise<CommercialExecutiveReportData> {
  const {
    shortcut,
    customStartDate,
    customEndDate,
    isUserAdmin,
    currentUserId,
    currentUserName,
    targetAdvisorFilter = 'all',
  } = options;

  const range = getCommercialPeriodRange(shortcut, customStartDate, customEndDate);

  const startTs = firestore.Timestamp.fromDate(range.startDate);
  const endTs = firestore.Timestamp.fromDate(range.endDate);
  const startMonthTs = firestore.Timestamp.fromDate(range.startMonthDate);

  // 1. Cargar Usuarios dinámicamente desde Firestore para mapear asesores activos y en rotación
  interface AdvisorMeta {
    id: string;
    name: string;
    normName: string;
    email: string;
    active: boolean;
    disabled: boolean;
    receiveLeads: boolean;
    excludeFromLeadAssignment: boolean;
    role: string;
    createdAtMs: number;
    isOfficial: boolean;
  }

  const advisorsMap = new Map<string, AdvisorMeta>();

  try {
    const usersSnap = await firestore()
      .collection('companies')
      .doc(companyId)
      .collection('users')
      .get();

    usersSnap.docs.forEach((doc) => {
      const u = doc.data() || {};
      if (isExcludedNonAdvisorUser(u, doc.id)) return;

      const rawName = (u.displayName as string) || (u.name as string) || (u.email as string) || doc.id;
      const cleanName = formatAdvisorDisplayName(rawName);
      if (!cleanName) return;

      const normName = normalizeStr(cleanName);
      const isOfficial = MERAKI_OFFICIAL_ADVISORS.some((off) => isAdvisorMatch(off, cleanName));
      const cDate = parseAnyDate(u.createdAt || u.invitedAt);

      advisorsMap.set(doc.id, {
        id: doc.id,
        name: cleanName,
        normName,
        email: (u.email as string) || '',
        active: u.active !== false,
        disabled: Boolean(u.disabled),
        receiveLeads: u.receiveLeads !== false,
        excludeFromLeadAssignment: Boolean(u.excludeFromLeadAssignment),
        role: String(u.role || 'advisor'),
        createdAtMs: cDate ? cDate.getTime() : 0,
        isOfficial,
      });
    });
  } catch (err) {
    console.warn('[CommercialReports] Error consultando users, usando fallback oficial:', err);
  }

  // Fallback si la consulta de usuarios falló por completo
  if (advisorsMap.size === 0) {
    MERAKI_OFFICIAL_ADVISORS.forEach((officialName) => {
      const normOfficial = normalizeStr(officialName);
      const matchedId = `official_${normOfficial.replace(/\s+/g, '_')}`;
      advisorsMap.set(matchedId, {
        id: matchedId,
        name: officialName,
        normName: normOfficial,
        email: '',
        active: true,
        disabled: false,
        receiveLeads: true,
        excludeFromLeadAssignment: false,
        role: 'advisor',
        createdAtMs: 0,
        isOfficial: true,
      });
    });
  }

  const resolveAdvisor = (assignedVal?: string | null): { id: string; name: string } => {
    if (!assignedVal) return { id: 'unassigned', name: 'Sin Asignar' };
    const direct = advisorsMap.get(assignedVal);
    if (direct) return { id: direct.id, name: direct.name };

    // Buscar por match inteligente
    for (const [id, adv] of advisorsMap.entries()) {
      if (isAdvisorMatch(assignedVal, adv.name) || isAdvisorMatch(assignedVal, adv.normName)) {
        return { id, name: adv.name };
      }
    }
    return { id: assignedVal, name: assignedVal };
  };

  // 2. Consultas a Firestore: Leads creados en el período, en el mes y con seguimiento en el período
  // Para asesores van con assignedTo == uid (índices compuestos assignedTo + createdAt /
  // lastFollowUpAt en firestore.indexes.json).
  let periodDocs: FirebaseFirestoreTypes.QueryDocumentSnapshot[] = [];
  let monthDocs: FirebaseFirestoreTypes.QueryDocumentSnapshot[] = [];
  let followUpDocs: FirebaseFirestoreTypes.QueryDocumentSnapshot[] = [];

  // Seguridad (R05): un asesor solo consulta sus leads asignados; las reglas
  // rechazan cualquier consulta que pueda devolver leads de otros asesores.
  // (Requiere los índices assignedTo + createdAt / lastFollowUpAt.)
  const leadsQuery = (): FirebaseFirestoreTypes.Query => {
    const col = firestore().collection('companies').doc(companyId).collection('leads');
    return !isUserAdmin && currentUserId ? col.where('assignedTo', '==', currentUserId) : col;
  };

  try {
    const [periodSnap, monthSnap, followUpSnap] = await Promise.all([
      leadsQuery()
        .where('createdAt', '>=', startTs)
        .where('createdAt', '<=', endTs)
        .get(),
      leadsQuery()
        .where('createdAt', '>=', startMonthTs)
        .where('createdAt', '<=', endTs)
        .get(),
      leadsQuery()
        .where('lastFollowUpAt', '>=', startTs)
        .where('lastFollowUpAt', '<=', endTs)
        .get()
        .catch(() => ({ docs: [] as FirebaseFirestoreTypes.QueryDocumentSnapshot[] })),
    ]);

    periodDocs = periodSnap.docs;
    monthDocs = monthSnap.docs;
    followUpDocs = followUpSnap.docs;
  } catch (err) {
    console.warn('[CommercialReports] Fallback consultando leads por rango:', err);
    // Fallback: cargar los últimos 300 leads y filtrar en memoria
    try {
      const fallbackSnap = await leadsQuery()
        .orderBy('createdAt', 'desc')
        .limit(300)
        .get();

      fallbackSnap.docs.forEach((doc) => {
        const d = doc.data();
        const cDate = parseAnyDate(d.createdAt);
        if (cDate) {
          if (cDate >= range.startDate && cDate <= range.endDate) periodDocs.push(doc);
          if (cDate >= range.startMonthDate && cDate <= range.endDate) monthDocs.push(doc);
        }
        const fDate = parseAnyDate(d.lastFollowUpAt);
        if (fDate && fDate >= range.startDate && fDate <= range.endDate) {
          followUpDocs.push(doc);
        }
      });
    } catch (fbErr) {
      console.error('[CommercialReports] Fallback error:', fbErr);
    }
  }

  // Mapa de prospectos únicos para evaluación
  const uniqueDocsMap = new Map<string, FirebaseFirestoreTypes.QueryDocumentSnapshot>();
  periodDocs.forEach((d) => uniqueDocsMap.set(d.id, d));
  monthDocs.forEach((d) => {
    if (!uniqueDocsMap.has(d.id)) uniqueDocsMap.set(d.id, d);
  });
  followUpDocs.forEach((d) => {
    if (!uniqueDocsMap.has(d.id)) uniqueDocsMap.set(d.id, d);
  });

  // 2.5 Consultar transferRequests aprobadas en el período para capturar traslados
  const transfersMap = new Map<
    string,
    {
      isTrPeriod: boolean;
      isTrMonth: boolean;
      reason: string;
      date: Date;
      recipient?: string;
      recipientId?: string;
    }
  >();

  try {
    const transferSnap = await firestore()
      .collection('companies')
      .doc(companyId)
      .collection('transferRequests')
      .where('status', '==', 'approved')
      .limit(200)
      .get();

    for (const tDoc of transferSnap.docs) {
      const tr = tDoc.data();
      const resDate = parseAnyDate(tr.resolvedAt || tr.createdAt || tr.updatedAt);
      if (resDate && tr.leadId) {
        const isTrPeriod = resDate >= range.startDate && resDate <= range.endDate;
        const isTrMonth = resDate >= range.startMonthDate && resDate <= range.endDate;

        if (isTrPeriod || isTrMonth) {
          transfersMap.set(tr.leadId, {
            isTrPeriod,
            isTrMonth,
            reason: tr.reason || 'Traslado comercial',
            date: resDate,
            recipient: tr.finalAssignedName || tr.targetAdvisorName || tr.requesterName,
            recipientId: tr.finalAssignedTo || tr.targetAdvisorId || tr.requesterId,
          });
        }
      }
    }
  } catch (trErr) {
    console.warn('[CommercialReports] Error consultando transferRequests:', trErr);
  }

  // Traer leads de transferencias que no estaban en periodDocs o monthDocs
  const missingTransferLeadIds = Array.from(transfersMap.keys()).filter((id) => !uniqueDocsMap.has(id));
  if (missingTransferLeadIds.length > 0) {
    await Promise.all(
      missingTransferLeadIds.slice(0, 50).map(async (leadId) => {
        try {
          const lDoc = await firestore()
            .collection('companies')
            .doc(companyId)
            .collection('leads')
            .doc(leadId)
            .get();
          const exists = typeof (lDoc as any).exists === 'function' ? (lDoc as any).exists() : Boolean((lDoc as any).exists);
          if (exists) {
            uniqueDocsMap.set(leadId, lDoc as any);
          }
        } catch {}
      })
    );
  }

  const periodDocIds = new Set(periodDocs.map((d) => d.id));
  const monthDocIds = new Set(monthDocs.map((d) => d.id));

  // 3. Procesar y mapear cada prospecto a AdvisorLeadDetailItem
  const allPeriodLeads: AdvisorLeadDetailItem[] = [];
  const allMonthLeads: AdvisorLeadDetailItem[] = [];
  const allManagedPeriodLeads: AdvisorLeadDetailItem[] = [];
  const leadsByAdvisorPeriod = new Map<string, AdvisorLeadDetailItem[]>();
  const leadsByAdvisorMonth = new Map<string, AdvisorLeadDetailItem[]>();
  const managedLeadsByAdvisor = new Map<string, AdvisorLeadDetailItem[]>();
  const advisorManagedClientKeys = new Map<string, Set<string>>();

  let totalVentasPeriodo = 0;
  let totalVentasMes = 0;
  const managedPeriodClientKeys = new Set<string>();

  for (const docSnap of uniqueDocsMap.values()) {
    const data = docSnap.data() || {};
    const transferInfo = transfersMap.get(docSnap.id);
    const assignedRef = transferInfo?.recipientId || transferInfo?.recipient || data.assignedTo || data.smartHomeAdvisorName;
    const adv = resolveAdvisor(assignedRef);

    // Si NO es admin, verificamos pertenencia estricta para confidencialidad
    if (!isUserAdmin) {
      const isMine =
        data.assignedTo === currentUserId ||
        (transferInfo && (transferInfo.recipientId === currentUserId || isAdvisorMatch(transferInfo.recipient, currentUserName))) ||
        isAdvisorMatch(adv.name, currentUserName) ||
        isAdvisorMatch(data.assignedToName || '', currentUserName);
      if (!isMine) continue;
    }

    const leadCreated = parseAnyDate(data.createdAt);
    const assignedDate = parseAnyDate(data.advisorAssignedAt);
    const trDate = transferInfo?.date || parseAnyDate(data.transferDate);

    const createdAtMs = leadCreated ? leadCreated.getTime() : (assignedDate ? assignedDate.getTime() : Date.now());
    const createdAtFormatted = leadCreated ? formatDateTimeBogota(leadCreated) : (assignedDate ? formatDateTimeBogota(assignedDate) : 'Fecha N/D');

    const fromTransfer = !!transferInfo || !!data.fromTransfer;
    const transferReason = transferInfo?.reason || data.transferReason;

    const isPeriodCreated =
      periodDocIds.has(docSnap.id) ||
      (leadCreated ? leadCreated >= range.startDate && leadCreated <= range.endDate : false) ||
      (assignedDate ? assignedDate >= range.startDate && assignedDate <= range.endDate : false) ||
      (trDate ? trDate >= range.startDate && trDate <= range.endDate : false) ||
      !!transferInfo?.isTrPeriod ||
      !!data.isPeriodAssigned;

    const isMonthCreated =
      monthDocIds.has(docSnap.id) ||
      (leadCreated ? leadCreated >= range.startMonthDate && leadCreated <= range.endDate : false) ||
      (assignedDate ? assignedDate >= range.startMonthDate && assignedDate <= range.endDate : false) ||
      (trDate ? trDate >= range.startMonthDate && trDate <= range.endDate : false) ||
      !!transferInfo?.isTrMonth ||
      !!data.isMonthAssigned;

    // Extraer y procesar bitácoras (incluyendo bitácoras raíz y SmartHome)
    const rawBitacoras = [
      ...(Array.isArray(data.bitacoras) ? data.bitacoras : []),
      ...(Array.isArray(data.metadata?.smarthomeBitacoras) ? data.metadata.smarthomeBitacoras : []),
      ...(Array.isArray(data.smarthomeBitacoras) ? data.smarthomeBitacoras : []),
    ];

    const allBitacoras: AdvisorLeadFollowUpHistoryItem[] = [];
    const seenBit = new Set<string>();
    let hadPeriodFollowUp = false;
    let hadMonthFollowUp = false;
    let latestFollowUpDate: Date | null = null;
    let latestFollowUpSummary = '';
    let latestFollowUpAuthor = '';

    const endPeriodWithTolerance = new Date(range.endDate.getTime() + 6 * 3600 * 1000);
    const endMonthWithTolerance = new Date(range.endMonthDate.getTime() + 6 * 3600 * 1000);

    for (const b of rawBitacoras) {
      const bDate = parseAnyDate(b.fecha || b.lastDate || b.date);
      const desc = String(b.description || b.action || '').trim();
      const action = String(b.action || 'Bitácora').trim();
      const asesor = String(b.asesor || adv.name).trim();
      const bKey = `${action}_${desc}_${bDate ? bDate.getTime() : ''}`;

      if (!seenBit.has(bKey)) {
        seenBit.add(bKey);
        allBitacoras.push({
          id: b.id || bKey,
          fecha: bDate ? formatDateTimeBogota(bDate) : b.fecha || 'Fecha N/D',
          action,
          description: desc,
          asesor,
        });
      }

      if (bDate && isRealCommercialFollowUp(action, desc)) {
        if (bDate >= range.startMonthDate && bDate <= endMonthWithTolerance) {
          hadMonthFollowUp = true;
        }
        if (bDate >= range.startDate && bDate <= endPeriodWithTolerance) {
          hadPeriodFollowUp = true;
        }
        if (!latestFollowUpDate || bDate > latestFollowUpDate) {
          latestFollowUpDate = bDate;
          latestFollowUpSummary = desc;
          latestFollowUpAuthor = asesor;
        }
      }
    }

    // Verificar también lastFollowUpAt o smartHomeLastBitacoraAt
    if (!hadPeriodFollowUp && (data.lastFollowUpAt || data.smartHomeLastBitacoraAt)) {
      const lfu = parseAnyDate(data.lastFollowUpAt || data.smartHomeLastBitacoraAt);
      if (lfu && lfu >= range.startDate && lfu <= endPeriodWithTolerance) {
        const action = data.lastFollowUpAction || data.smartHomeLastActionLabel || 'seguimiento_crm';
        const desc = data.lastFollowUpSummary || data.smartHomeLastBitacoraText || action;
        if (isRealCommercialFollowUp(action, desc)) {
          hadPeriodFollowUp = true;
          hadMonthFollowUp = true;
          if (!latestFollowUpDate || lfu > latestFollowUpDate) {
            latestFollowUpDate = lfu;
            latestFollowUpSummary = desc;
            latestFollowUpAuthor = data.lastFollowUpAuthor || data.smartHomeLastBitacoraByName || adv.name;
          }
        }
      }
    }

    // Comprobar ventas
    const isClosed = data.status === 'closed' || data.pipelineStage === 'firma' || data.pipelineStage === 'cierre';
    if (isClosed) {
      if (isPeriodCreated) totalVentasPeriodo++;
      if (isMonthCreated) totalVentasMes++;
    }

    const rawPhone = cleanDigits(data.phone || data.normalizedPhone);
    const clientKey = rawPhone || docSnap.id;

    if (hadPeriodFollowUp) {
      managedPeriodClientKeys.add(clientKey);
      if (!advisorManagedClientKeys.has(adv.id)) {
        advisorManagedClientKeys.set(adv.id, new Set<string>());
      }
      advisorManagedClientKeys.get(adv.id)!.add(clientKey);
    }

    const item: AdvisorLeadDetailItem = {
      leadId: docSnap.id,
      clientName: data.name || data.clientName || data.fullName || (rawPhone ? `+57 ${rawPhone}` : 'Prospecto sin nombre'),
      phone: data.phone || data.normalizedPhone || (rawPhone ? `+57 ${rawPhone}` : 'Sin teléfono'),
      phoneRaw: rawPhone,
      advisorId: adv.id,
      advisorName: adv.name,
      createdAt: createdAtMs,
      createdAtFormatted,
      project: data.project || data.metadata?.project || 'Sin proyecto',
      source: data.source || data.metadata?.source || data.metadata?.fuente || 'meta_ads',
      status: data.status || 'new',
      hasFollowUp: hadPeriodFollowUp || hadMonthFollowUp || allBitacoras.length > 0,
      hasPeriodFollowUp: hadPeriodFollowUp,
      hasMonthFollowUp: hadMonthFollowUp,
      lastFollowUpAt: latestFollowUpDate ? latestFollowUpDate.getTime() : undefined,
      lastFollowUpFormatted: latestFollowUpDate ? formatDateTimeBogota(latestFollowUpDate) : undefined,
      lastFollowUpSummary: latestFollowUpSummary || (allBitacoras[0]?.description || undefined),
      lastFollowUpAuthor: latestFollowUpAuthor || (allBitacoras[0]?.asesor || undefined),
      allBitacoras,
      isPeriodCreated,
      isMonthCreated,
      fromTransfer,
      transferReason,
    };

    if (isPeriodCreated) {
      allPeriodLeads.push(item);
      if (!leadsByAdvisorPeriod.has(adv.id)) leadsByAdvisorPeriod.set(adv.id, []);
      leadsByAdvisorPeriod.get(adv.id)!.push(item);
    }

    if (isMonthCreated) {
      allMonthLeads.push(item);
      if (!leadsByAdvisorMonth.has(adv.id)) leadsByAdvisorMonth.set(adv.id, []);
      leadsByAdvisorMonth.get(adv.id)!.push(item);
    }

    if (hadPeriodFollowUp) {
      allManagedPeriodLeads.push(item);
      if (!managedLeadsByAdvisor.has(adv.id)) managedLeadsByAdvisor.set(adv.id, []);
      managedLeadsByAdvisor.get(adv.id)!.push(item);
    }
  }

  allPeriodLeads.sort((a, b) => b.createdAt - a.createdAt);
  allMonthLeads.sort((a, b) => b.createdAt - a.createdAt);
  allManagedPeriodLeads.sort((a, b) => (b.lastFollowUpAt || b.createdAt) - (a.lastFollowUpAt || a.createdAt));

  // 4. Construir filas de asesores comerciales dinámicamente (Idéntico a Web)
  const isIndividual = !isUserAdmin || (targetAdvisorFilter !== 'all' && targetAdvisorFilter !== '');
  const targetAdvisorName = isIndividual
    ? !isUserAdmin
      ? currentUserName
      : advisorsMap.get(targetAdvisorFilter)?.name || targetAdvisorFilter
    : undefined;
  const targetAdvisorId = isIndividual ? (!isUserAdmin ? currentUserId : targetAdvisorFilter) : undefined;

  const advisorRows: AdvisorReportRow[] = [];

  for (const [advId, adv] of advisorsMap.entries()) {
    const isTargetIndividual =
      isIndividual &&
      (advId === targetAdvisorId || (targetAdvisorName && isAdvisorMatch(adv.name, targetAdvisorName)));

    // Confidencialidad estricta: Si es vista individual, SOLO construir la fila del asesor logueado / filtrado
    if (isIndividual && !isTargetIndividual) {
      continue;
    }

    const periodLeads = allPeriodLeads.filter(
      (l) => l.advisorId === advId || isAdvisorMatch(l.advisorName, adv.name)
    );
    const monthLeads = allMonthLeads.filter(
      (l) => l.advisorId === advId || isAdvisorMatch(l.advisorName, adv.name)
    );
    const managedLeads = allManagedPeriodLeads.filter(
      (l) => l.advisorId === advId || isAdvisorMatch(l.advisorName, adv.name)
    );

    const captSemana = periodLeads.length;
    const captMes = monthLeads.length;
    const leadsSemConSeguimiento = periodLeads.filter((l) => l.hasPeriodFollowUp).length;
    const leadsSemSinSeguimiento = Math.max(0, captSemana - leadsSemConSeguimiento);
    const coberturaPct = captSemana > 0 ? Math.round((leadsSemConSeguimiento / captSemana) * 100) : 0;

    const managedSet = new Set<string>(
      periodLeads.filter((l) => l.hasPeriodFollowUp).map((l) => l.phoneRaw || l.leadId)
    );
    const extraManaged = advisorManagedClientKeys.get(advId);
    if (extraManaged) {
      extraManaged.forEach((k) => managedSet.add(k));
    }

    const clientesConSeguimiento = Math.max(managedSet.size, leadsSemConSeguimiento);
    const clientesAnteriores = Math.max(0, clientesConSeguimiento - leadsSemConSeguimiento);
    const ventasSemana = periodLeads.filter((l) => l.status === 'closed').length;
    const ventasMes = monthLeads.filter((l) => l.status === 'closed').length;

    const isActiveLeadReceiver =
      adv.active && !adv.disabled && adv.receiveLeads && !adv.excludeFromLeadAssignment;
    const hasActivity =
      captSemana > 0 ||
      clientesConSeguimiento > 0 ||
      ventasSemana > 0 ||
      ventasMes > 0 ||
      (shortcut === 'month' && captMes > 0);
    const isRecentlyCreatedActive =
      adv.active &&
      !adv.disabled &&
      adv.createdAtMs >= Math.min(range.startMonthDate.getTime(), range.startDate.getTime());

    if (!isIndividual && !isActiveLeadReceiver && !hasActivity && !isRecentlyCreatedActive) {
      continue;
    }

    advisorRows.push({
      advisorId: advId,
      advisorName: adv.name,
      captSemana,
      captMes,
      avanceMesPct: Math.min(100, Math.round((captMes / 100) * 100)),
      ventasSemana,
      ventasMes,
      clientesConSeguimiento,
      leadsSemConSeguimiento,
      leadsSemSinSeguimiento,
      clientesAnteriores,
      coberturaPct,
      periodLeads,
      monthLeads,
      managedLeads,
    });
  }

  // Fallback si es asesor individual y no estaba en advisorsMap con esa llave exacta
  if (isIndividual && advisorRows.length === 0) {
    const fallbackName = formatAdvisorDisplayName(targetAdvisorName || currentUserName) || 'Asesor Comercial';
    const fallbackId = targetAdvisorId || currentUserId || fallbackName;
    const periodLeads = allPeriodLeads;
    const monthLeads = allMonthLeads;
    const managedLeads = allManagedPeriodLeads;
    const captSemana = periodLeads.length;
    const captMes = monthLeads.length;
    const leadsSemConSeguimiento = periodLeads.filter((l) => l.hasPeriodFollowUp).length;
    const leadsSemSinSeguimiento = Math.max(0, captSemana - leadsSemConSeguimiento);
    const coberturaPct = captSemana > 0 ? Math.round((leadsSemConSeguimiento / captSemana) * 100) : 0;
    const managedSet = new Set<string>(
      managedLeads.map((l) => l.phoneRaw || l.leadId)
    );
    const clientesConSeguimiento = Math.max(managedSet.size, leadsSemConSeguimiento);
    const clientesAnteriores = Math.max(0, clientesConSeguimiento - leadsSemConSeguimiento);
    const ventasSemana = periodLeads.filter((l) => l.status === 'closed').length;
    const ventasMes = monthLeads.filter((l) => l.status === 'closed').length;

    advisorRows.push({
      advisorId: fallbackId,
      advisorName: fallbackName,
      captSemana,
      captMes,
      avanceMesPct: Math.min(100, Math.round((captMes / 100) * 100)),
      ventasSemana,
      ventasMes,
      clientesConSeguimiento,
      leadsSemConSeguimiento,
      leadsSemSinSeguimiento,
      clientesAnteriores,
      coberturaPct,
      periodLeads,
      monthLeads,
      managedLeads,
    });
  }

  // Si por duplicidad de nombres quedaron más de 1 fila en vista individual, unificar o dejar la principal
  if (isIndividual && advisorRows.length > 1) {
    advisorRows.sort((a, b) => b.captMes - a.captMes || b.captSemana - a.captSemana);
    advisorRows.splice(1);
  }

  // Ordenar la tabla de asesores por captaciones del período, seguimientos y luego captaciones del mes
  advisorRows.sort(
    (a, b) =>
      b.captSemana - a.captSemana ||
      b.clientesConSeguimiento - a.clientesConSeguimiento ||
      b.captMes - a.captMes
  );

  const allAdvisorsList = Array.from(advisorsMap.values())
    .filter((adv) => {
      const hasRow = advisorRows.some((r) => r.advisorId === adv.id);
      return (adv.active && !adv.disabled) || hasRow;
    })
    .map((a) => ({ id: a.id, name: a.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // 5. KPIs Consolidados o Individuales
  let activePeriodLeads = allPeriodLeads;
  let activeMonthLeads = allMonthLeads;
  let activeManagedLeads = allManagedPeriodLeads;

  if (isIndividual && targetAdvisorName) {
    activePeriodLeads = allPeriodLeads.filter(
      (l) => isAdvisorMatch(l.advisorName, targetAdvisorName) || l.advisorId === targetAdvisorId
    );
    activeMonthLeads = allMonthLeads.filter(
      (l) => isAdvisorMatch(l.advisorName, targetAdvisorName) || l.advisorId === targetAdvisorId
    );
    activeManagedLeads = allManagedPeriodLeads.filter(
      (l) => isAdvisorMatch(l.advisorName, targetAdvisorName) || l.advisorId === targetAdvisorId
    );
  }

  const captacionesPeriodo = activePeriodLeads.length;
  const captacionesMes = activeMonthLeads.length;
  const leadsPeriodoConSeguimiento = activePeriodLeads.filter((l) => l.hasPeriodFollowUp).length;
  const leadsPeriodoSinSeguimiento = Math.max(0, captacionesPeriodo - leadsPeriodoConSeguimiento);
  const coberturaLeadsPeriodoPct =
    captacionesPeriodo > 0 ? Math.round((leadsPeriodoConSeguimiento / captacionesPeriodo) * 100) : 0;
  const clientesGestionadosPeriodo = isIndividual
    ? Math.max(
        advisorRows[0]?.clientesConSeguimiento || 0,
        new Set(activeManagedLeads.map((l) => l.phoneRaw || l.leadId)).size,
        leadsPeriodoConSeguimiento
      )
    : managedPeriodClientKeys.size;
  const clientesAnterioresTotal = Math.max(0, clientesGestionadosPeriodo - leadsPeriodoConSeguimiento);

  // 6. Resumen de Análisis Textual (summaryBullets)
  const isMonthly = shortcut === 'month';
  const effectiveAdvLabel = targetAdvisorName || currentUserName;

  const summaryBullets = isIndividual
    ? {
        referencia: isMonthly
          ? `Meta mensual de 100 captaciones y 3 ventas por asesor. Tu avance registrado en el mes es de ${captacionesMes} captaciones y ${totalVentasMes} ventas.`
          : `Meta semanal de 25 captaciones y mensual de 100 captaciones y 3 ventas. Tu avance registrado en la semana es de ${captacionesPeriodo} captaciones y ${totalVentasPeriodo} ventas.`,
        captacion: isMonthly
          ? `Registras ${captacionesMes} captaciones en el mes acumulado.`
          : `Registras ${captacionesPeriodo} leads captados en la semana (${captacionesMes} en el acumulado del mes).`,
        ventas: isMonthly
          ? `Registras ${totalVentasMes} ventas confirmadas en el mes.`
          : `Registras ${totalVentasPeriodo} ventas confirmadas en la semana (${totalVentasMes} en el mes).`,
        seguimiento: isMonthly
          ? `Registras ${clientesGestionadosPeriodo} clientes con gestión comercial en el mes (${leadsPeriodoConSeguimiento} del mes con ${coberturaLeadsPeriodoPct}% de cobertura).`
          : `Registras ${clientesGestionadosPeriodo} clientes con gestión real: ${leadsPeriodoConSeguimiento} son leads de la semana (${coberturaLeadsPeriodoPct}% de cobertura) y ${clientesAnterioresTotal} de meses anteriores. Te quedan ${leadsPeriodoSinSeguimiento} prospectos nuevos pendientes por gestionar.`,
      }
    : {
        referencia: isMonthly
          ? `Meta mensual consolidada de 100 captaciones y 3 ventas por asesor. Total equipo registrado: ${captacionesMes} captaciones y ${totalVentasMes} ventas.`
          : `Meta semanal de 25 captaciones y 3 ventas al mes por asesor comercial. En el período evaluado el equipo suma ${captacionesPeriodo} captaciones.`,
        captacion: isMonthly
          ? `Total de ${captacionesMes} captaciones acumuladas en el mes para el equipo.`
          : `${captacionesPeriodo} leads nuevos captados en la semana (acumulado del mes: ${captacionesMes}).`,
        ventas: isMonthly
          ? `En el mes se confirman ${totalVentasMes} ventas cerradas por el equipo comercial.`
          : `${totalVentasPeriodo} ventas confirmadas en la semana (${totalVentasMes} en el mes).`,
        seguimiento: isMonthly
          ? `${clientesGestionadosPeriodo} clientes con gestión comercial real en el mes. Cobertura comercial: ${coberturaLeadsPeriodoPct}%.`
          : `${clientesGestionadosPeriodo} clientes con gestión real: ${leadsPeriodoConSeguimiento} son leads de la semana y ${clientesAnterioresTotal} de meses anteriores. Quedan ${leadsPeriodoSinSeguimiento} prospectos de la semana sin gestión registrada.`,
      };

  const title = isIndividual
    ? `INFORME SEMANAL DE GESTIÓN COMERCIAL — ${effectiveAdvLabel.toUpperCase()}`
    : `INFORME SEMANAL DE GESTIÓN COMERCIAL — ASESORES`;

  const preparedBy = isIndividual
    ? `${effectiveAdvLabel} - Asesor Comercial`
    : `${currentUserName ? currentUserName : 'Luis Eduardo Salcedo Aya'} - Sistemas`;

  return {
    title,
    periodType: shortcut,
    startDate: range.startDate.getTime(),
    endDate: range.endDate.getTime(),
    periodLabel: range.periodLabel,
    monthLabel: range.monthLabel,
    preparedBy,
    forRecipient: 'Gerencia',
    date: formatBogotaDate(new Date()),
    isIndividualReport: isIndividual,
    targetAdvisorName,
    targetAdvisorId,
    kpis: {
      captacionesPeriodo,
      ventasPeriodo: totalVentasPeriodo,
      ventasMes: totalVentasMes,
      clientesGestionadosPeriodo,
      coberturaLeadsPeriodoPct,
      leadsPeriodoConSeguimiento,
      leadsPeriodoSinSeguimiento,
      captacionesMes,
    },
    summaryBullets,
    advisorRows,
    allPeriodLeads: isIndividual ? activePeriodLeads : allPeriodLeads,
    allMonthLeads: isIndividual ? activeMonthLeads : allMonthLeads,
    allManagedPeriodLeads: isIndividual ? activeManagedLeads : allManagedPeriodLeads,
    allAdvisorsList: isIndividual ? [] : allAdvisorsList,
  };
}
