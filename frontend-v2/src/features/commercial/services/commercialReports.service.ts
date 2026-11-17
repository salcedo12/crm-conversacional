import {
  collection,
  getDocs,
  getDoc,
  doc,
  query,
  where,
  Timestamp,
  limit,
  orderBy,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import type {
  CommercialExecutiveReportData,
  CommercialReportKPIs,
  AdvisorReportRow,
  AdvisorReportTotals,
  AdvisorLeadDetailItem,
  AdvisorLeadFollowUpHistoryItem,
  SaleReportItem,
  AttentionPointItem,
  CaptacionDayItem,
  CaptacionProjectItem,
  CaptacionSourceItem,
  DataQualityMetrics,
  ReportPeriodType,
  DailyActivityItem,
  MarketingAdvisorAssignment,
  MarketingCampaignReportItem,
  MarketingPeriodReportData,
  CancelledLeadItem,
  AdvisorCancellationSummary,
  CancellationsReportData,
  AppointmentVisitReportItem,
  AdvisorVisitsSummary,
  VisitsAppointmentsReportData,
} from '../types/commercialReports.types';

// Meses en español
const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const DAYS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const FULL_DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function normalizeStr(s: string): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDateAny(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (val instanceof Timestamp) return val.toDate();
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

function formatDateBogota(date: Date): string {
  return date.toLocaleDateString('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatDateBogotaTime(date: Date): string {
  const dayName = DAYS_ES[date.getDay()] || '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = MONTH_NAMES[date.getMonth()] ? MONTH_NAMES[date.getMonth()].slice(0, 3) : '';
  const timeStr = date.toLocaleTimeString('es-CO', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return `${dayName} ${day} ${month} · ${timeStr}`;
}

/**
 * Bitácora o nota que deja el sistema al aprobar o registrar un traslado de prospecto
 * ("Traslado Aprobado", "traslado_comercial", "Traslado comercial: <motivo>", "Reasignación").
 * No representa una llamada, contacto ni gestión comercial del nuevo asesor.
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
    t.includes('solicitud de traslado')
  );
}

/**
 * Determina si una bitácora, ficha técnica o registro corresponde a una gestión
 * comercial REAL realizada por un asesor (llamada, WhatsApp, ficha técnica, cita, etc.)
 * y descarta eventos de creación, registros API, actualizaciones automáticas de sistema y bots.
 */
export function isRealCommercialFollowUp(action?: string | null, text?: string | null): boolean {
  const rawAction = String(action ?? '').trim();
  const rawText = String(text ?? '').trim();

  if (!rawAction && !rawText) return false;

  // Un traslado aprobado o solicitud de traslado es un evento administrativo, no una gestión del asesor
  if (isTransferBitacora(rawAction, rawText)) {
    return false;
  }

  const aNorm = normalizeStr(rawAction);
  const dNorm = normalizeStr(rawText);

  // Excepción importante: Eventos que SmartHome rotuló genéricamente como "Evento del Sistema" o "CAPTACIÓN"
  // pero cuyo contenido es una anotación comercial escrita por un asesor (ej. "Registrado por: ...", "Cliente asiste/no asiste...", etc.)
  const isAdvisorEventInSystem =
    (aNorm === 'evento del sistema' || aNorm === 'captacion') &&
    (dNorm.includes('registrado por:') ||
      dNorm.includes('cliente asiste') ||
      dNorm.includes('cliente no asiste') ||
      dNorm.includes('cita programada') ||
      dNorm.includes('ofrece servicio') ||
      dNorm.includes('agendo cita') ||
      dNorm.includes('se agendo'));

  // 1. Descartar acciones de creación o sistema si no contienen anotación comercial de asesor
  if (!isAdvisorEventInSystem) {
    if (
      aNorm === 'evento del sistema' ||
      aNorm === 'captacion' ||
      aNorm === 'sistema' ||
      aNorm === 'registro api' ||
      aNorm === 'cargue masivo' ||
      aNorm === 'asignacion automatica' ||
      aNorm === 'actualizacion automatica'
    ) {
      return false;
    }
  }

  // 2. Si el texto tiene menos de 4 caracteres o es vacío
  if (!dNorm || dNorm.length < 4) return false;

  // Excepción prioritaria: Cualquier descarte comercial, no interesado, cancelación o conclusión registrada
  // por un asesor es una gestión comercial válida y deliberada que debe contabilizarse siempre
  const isExplicitDisqualification =
    aNorm.includes('no interesado') ||
    aNorm.includes('cancelado') ||
    aNorm.includes('descarte') ||
    aNorm.includes('desistimiento') ||
    dNorm.includes('no interesado') ||
    dNorm.includes('no le interesa') ||
    dNorm.includes('cancelado') ||
    dNorm.includes('descarte') ||
    dNorm.includes('desistimiento') ||
    dNorm.includes('numero equivocado') ||
    dNorm.includes('sin presupuesto') ||
    dNorm.includes('no contesta') ||
    dNorm.includes('sin proximo contacto');

  if (isExplicitDisqualification) {
    return true;
  }

  // 3. Descartar textos automáticos generados por el sistema o por la creación del prospecto
  if (
    dNorm.includes('se agrega el cliente al sistema') ||
    dNorm.includes('se agrega el prospecto al sistema') ||
    dNorm.includes('se inicia el seguimiento para el modulo') ||
    dNorm.includes('registro api') ||
    dNorm.includes('registro automatico enviado desde crm') ||
    dNorm.includes('se ha actualizado la informacion') ||
    dNorm.includes('atendido en whatsapp') ||
    dNorm.includes('se ha actualizado el detalle de la oportunidad') ||
    dNorm.includes('se ha cambiado el ciclo de venta') ||
    dNorm.includes('se ha cambiado la probabilidad') ||
    dNorm.includes('se ha actualizado el valor') ||
    dNorm.includes('la empresa razon social cambio') ||
    dNorm.includes('la empresa cambio de') ||
    dNorm.includes('la ciudad cambio') ||
    dNorm.includes('el nombre cambio') ||
    dNorm.includes('el apellido cambio') ||
    dNorm.includes('actualizacion automatica') ||
    dNorm.includes('cargue masivo') ||
    dNorm.includes('asignacion automatica') ||
    dNorm.includes('webhook') ||
    dNorm.includes('infile') ||
    dNorm.includes('arkdia')
  ) {
    return false;
  }

  // 4. Si la acción o texto es sólo el nombre del proyecto sin observación de gestión comercial
  if (
    (aNorm === 'canon de arizona' || aNorm === 'llano grande' || aNorm === 'laguna mar' || aNorm === 'rio claro') &&
    (dNorm.includes('se agrega el cliente') || dNorm.includes('modulo') || dNorm.length < 15)
  ) {
    return false;
  }

  return true;
}

/**
 * Emparejador inteligente de nombres de asesores para conciliar
 * variantes entre SmartHome, bitácoras y cuentas del CRM.
 * (e.g. 'Karen Kristy Ramirez Toloza' <=> 'Karen Ramirez',
 *  'Isabel Betancourt' <=> 'Isabel Betancourth', etc.)
 */
export function isAdvisorMatch(rawA?: unknown, rawB?: unknown): boolean {
  if (!rawA || !rawB) return false;
  const a = normalizeStr(String(rawA));
  const b = normalizeStr(String(rawB));
  if (!a || !b) return false;

  // 1. Coincidencia exacta o inclusión de cadena directa
  if (a === b || a.includes(b) || b.includes(a)) return true;

  // 2. Desglose por tokens ignorando conectores
  const stopWords = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'san', 'santa']);
  const wordsA = a.split(' ').filter((w) => w.length > 2 && !stopWords.has(w));
  const wordsB = b.split(' ').filter((w) => w.length > 2 && !stopWords.has(w));
  if (wordsA.length === 0 || wordsB.length === 0) return false;

  // Si el primer nombre coincide:
  if (wordsA[0] === wordsB[0]) {
    const restA = wordsA.slice(1);
    const restB = wordsB.slice(1);
    const hasSurnameMatch = restA.some((wa) => restB.includes(wa));
    if (hasSurnameMatch) return true;
  }

  // Si coinciden en al menos 2 palabras significativas
  const common = wordsA.filter((wa) => wordsB.includes(wa));
  if (common.length >= 2) return true;

  // Caso especial para Betancourth / Betancourt (diferencia de 'h' final)
  if (a.includes('betancour') && b.includes('betancour') && (a.includes('isabel') || b.includes('isabel'))) {
    return true;
  }

  // Caso especial para Karen Ramirez / Karen Kristy Ramirez Toloza
  if (a.includes('karen') && b.includes('karen') && (a.includes('ramirez') || b.includes('ramirez') || a.includes('toloza') || b.includes('toloza'))) {
    return true;
  }

  return false;
}

/**
 * Lista base de respaldo de asesores comerciales de Grupo Meraki
 * (se usa únicamente como fallback si no hay conexión al catálogo de usuarios).
 */
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

const TEST_USER_IDS = new Set(['H69G8PsEzReNuU1yowJNnlCHgie2']);
const TEST_USER_EMAILS = new Set([
  'servidor.meraki@gmail.com',
  'google.tester@grupoconstructormeraki.com.co',
]);
const NON_ADVISOR_NORM_NAMES = new Set([
  'pruebas',
  'prueba',
  'marketing',
  'sistemas',
  'gerencia',
]);
const IGNORED_ADVISOR_TOKENS = new Set([
  'asesor',
  'desconocido',
  'sin asignar',
  'unassigned',
  'sistema',
  'system',
  'bot',
  'victoria',
  'ia',
]);

function formatAdvisorDisplayName(raw: string): string {
  const cleaned = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  // Si coincide con un nombre oficial conocido con tildes, preservar su grafía exacta
  const matchOfficial = MERAKI_OFFICIAL_ADVISORS.find((off) => normalizeStr(off) === normalizeStr(cleaned));
  if (matchOfficial) return matchOfficial;

  const lowerConnectors = new Set(['de', 'del', 'la', 'las', 'los', 'y']);
  return cleaned
    .split(' ')
    .map((word, idx) => {
      const lower = word.toLowerCase();
      if (idx > 0 && lowerConnectors.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function isExcludedNonAdvisorUser(id: string, u: any): boolean {
  if (!u) return true;
  if (u.isTestUser === true) return true;
  if (TEST_USER_IDS.has(id)) return true;
  const role = String(u.role || 'advisor').toLowerCase();
  if (role === 'admin' || role === 'viewer') return true;
  const email = String(u.email || '').trim().toLowerCase();
  if (TEST_USER_EMAILS.has(email)) return true;
  const rawName = String(u.displayName || u.name || u.email || '').trim();
  const norm = normalizeStr(rawName);
  if (!norm || NON_ADVISOR_NORM_NAMES.has(norm)) return true;
  return false;
}

/**
 * Normaliza y clasifica el motivo de descarte / cancelación en categorías
 * ejecutivas estandarizadas para el informe comercial Meraki.
 */
export function cleanCancellationReason(act?: string, desc?: string, stage?: string, motivo?: string): string {
  const combined = `${act || ''} ${desc || ''} ${stage || ''} ${motivo || ''}`.toLowerCase();
  if (
    combined.includes('presupuesto') ||
    combined.includes('dinero') ||
    combined.includes('costo') ||
    combined.includes('caro') ||
    combined.includes('no_interesado_dinero')
  ) {
    return 'Fuera de Presupuesto';
  }
  if (
    combined.includes('ubicacion') ||
    combined.includes('ubicación') ||
    combined.includes('lejos') ||
    combined.includes('zona') ||
    combined.includes('no_interesado_ubicacion')
  ) {
    return 'No le Interesa la Ubicación';
  }
  if (combined.includes('proveedor') || combined.includes('ofreciendo servicio') || combined.includes('ofrecer servicio')) {
    return 'Proveedor Ofreciendo Servicios';
  }
  if (combined.includes('trabajo') || combined.includes('empleo') || combined.includes('hoja de vida')) {
    return 'Solicitud de Empleo';
  }
  if (
    combined.includes('no solicito') ||
    combined.includes('no solicitó') ||
    combined.includes('equivocad') ||
    combined.includes('no solicito informacion')
  ) {
    return 'No Solicitó Información / Equivocado';
  }
  if (combined.includes('otra area') || combined.includes('otra área') || combined.includes('diferente a comercial')) {
    return 'Contacto para Otra Área (No Comercial)';
  }
  if (
    combined.includes('no contesta') ||
    combined.includes('no responde') ||
    combined.includes('buzon') ||
    combined.includes('dejo de contestar') ||
    combined.includes('deja de responder')
  ) {
    return 'No Contesta tras Seguimiento';
  }
  if (combined.includes('desist')) {
    return 'Desistimiento Personal';
  }
  if (act && act.includes('[NO INTERESADO]')) {
    const after = act.split('[NO INTERESADO]')[1].replace(/[\]_]/g, '').trim();
    if (after) {
      return after.charAt(0).toUpperCase() + after.slice(1).toLowerCase();
    }
  }
  if (motivo && motivo.trim() && !motivo.toLowerCase().includes('se agrega')) {
    return motivo.trim();
  }
  return 'Descarte Comercial General';
}

/**
 * Limpia y extrae la nota u observación real que escribió el asesor comercial
 * retirando textos automáticos de sistema o marcadores de plantilla.
 */
export function cleanAdvisorWrittenNote(raw?: string): string {
  if (!raw) return 'Descarte registrado sin comentarios adicionales.';
  let cleaned = raw
    .replace(/—\s*Próximo paso:\s*Sin Próximo Contacto.*$/i, '')
    .replace(/Próximo paso:\s*Sin Próximo Contacto.*$/i, '')
    .replace(/^Seguimiento Comercial:\s*\[NO INTERESADO\][^:]*:\s*/i, '')
    .replace(/^Seguimiento Comercial:\s*[^:]*:\s*/i, '')
    .replace(/^CITA PROGRAMADA IA:\s*Comercial\s*/i, '')
    .replace(/^Movido a No Interesado:\s*/i, '')
    .replace(/Se ha actualizado la información del prospecto\.\s*Atendido En:\s*WhatsApp/i, '')
    .trim();

  if (!cleaned || cleaned.toLowerCase() === 'cliente no interesado.') {
    return raw.trim() || 'Descarte registrado (Sin Próximo Contacto).';
  }
  return cleaned;
}

/**
 * Separa la nota u observación redactada por el asesor del próximo paso agendado
 * (evita que un recordatorio o cita a futuro contamine la clasificación de la gestión actual).
 */
export function extractMainGestionNote(text?: string): { mainNote: string; nextStep: string } {
  if (!text) return { mainNote: '', nextStep: '' };
  const splitRegex = /\s*—?\s*(?:Próximo paso|Proximo paso|Next step):\s*/i;
  const parts = text.split(splitRegex);
  return {
    mainNote: (parts[0] || '').trim(),
    nextStep: (parts[1] || '').trim(),
  };
}

/**
 * Valida de forma estricta e inteligente si una gestión o bitácora
 * corresponde a una VISITA REAL Y CONFIRMADA (a Terreno o Sala de Ventas)
 * que efectivamente se llevó a cabo en el período, excluyendo llamadas,
 * recordatorios, invitaciones y visitas agendadas a futuro.
 */
export function isConfirmedRealizedVisit(
  actionRaw?: string,
  descRaw?: string,
  dateMillis?: number
): { isConfirmed: boolean; visitType: 'terreno' | 'sala'; cleanNote: string } {
  const act = (actionRaw || '').trim();
  const desc = (descRaw || '').trim();
  const { mainNote, nextStep: _nextStep } = extractMainGestionNote(desc);

  const actLower = act.toLowerCase();
  const mainLower = mainNote.toLowerCase();

  // 1. Excluir si la fecha es futura (no se ha realizado aún)
  if (dateMillis && dateMillis > Date.now() + 5 * 60 * 1000) {
    return { isConfirmed: false, visitType: 'terreno', cleanNote: '' };
  }

  // 2. Excluir explícitamente no asistió (No-Show), cancelaciones, reprogramaciones
  const isNegative =
    actLower.includes('no asist') ||
    actLower.includes('no-show') ||
    actLower.includes('cancel') ||
    actLower.includes('reprogram') ||
    mainLower.includes('no asist') ||
    mainLower.includes('no-show') ||
    mainLower.includes('canceló') ||
    mainLower.includes('cancelo') ||
    mainLower.includes('reprogramó');

  if (isNegative) {
    return { isConfirmed: false, visitType: 'terreno', cleanNote: '' };
  }

  // 3. Criterio A: Acción explícita de visita realizada en Ficha Técnica CRM
  // En Meraki FichaTecnica: actionType === 'visita_terreno' registra "Visita a Terreno: Asistió a sala de ventas / terreno"
  const isExplicitVisitAction =
    (actLower.includes('visita a terreno') ||
      actLower.includes('visita sala') ||
      actLower.includes('visita terreno') ||
      actLower.includes('visita_terreno') ||
      (actLower.startsWith('visita') && !actLower.includes('agend') && !actLower.includes('program')));

  // 4. Criterio B: La nota u observación redactada por el asesor (SIN el próximo paso) confirma asistencia presencial
  const hasPhysicalPresenceKeywords =
    mainLower.includes('asistió a la visita') ||
    mainLower.includes('asistio a la visita') ||
    mainLower.includes('asistió a sala') ||
    mainLower.includes('asistio a sala') ||
    mainLower.includes('asistió al terreno') ||
    mainLower.includes('asistio al terreno') ||
    mainLower.includes('visitó la sala') ||
    mainLower.includes('visito la sala') ||
    mainLower.includes('visitó el terreno') ||
    mainLower.includes('visito el terreno') ||
    mainLower.includes('visitó el proyecto') ||
    mainLower.includes('visito el proyecto') ||
    mainLower.includes('recorrido en terreno') ||
    mainLower.includes('recorrido del terreno') ||
    mainLower.includes('recorrió el lote') ||
    mainLower.includes('recorrio el lote') ||
    mainLower.includes('estuvo en la sala') ||
    mainLower.includes('estuvo en el terreno') ||
    mainLower.includes('vino a la sala') ||
    mainLower.includes('vino a conocer') ||
    mainLower.includes('se atendió en sala') ||
    mainLower.includes('se atendio en sala') ||
    mainLower.includes('se atendió en terreno') ||
    mainLower.includes('se atendio en terreno') ||
    mainLower.includes('recorrimos el proyecto') ||
    mainLower.includes('recorrido con el cliente');

  // Si la nota solo indica invitación, propuesta, o llamada para agendar: NO es visita confirmada
  const isFutureOrInvitationOnly =
    mainLower.includes('se invita') ||
    mainLower.includes('invita al evento') ||
    mainLower.includes('se agend') ||
    mainLower.includes('se program') ||
    mainLower.includes('llamada de seguimiento') ||
    mainLower.includes('llamada telefonica') ||
    mainLower.includes('llamada telefónica') ||
    mainLower.includes('se llama al cliente') ||
    mainLower.includes('se contacta');

  // Si es acción explícita de visita realizada O tiene confirmación física y NO es solo llamada/invitación
  const isConfirmed =
    (isExplicitVisitAction && !isFutureOrInvitationOnly) ||
    (!isExplicitVisitAction && hasPhysicalPresenceKeywords && !isFutureOrInvitationOnly);

  if (!isConfirmed) {
    return { isConfirmed: false, visitType: 'terreno', cleanNote: '' };
  }

  const isSala = actLower.includes('sala') || mainLower.includes('sala');
  const visitType: 'terreno' | 'sala' = isSala ? 'sala' : 'terreno';

  const cleanNote = mainNote || cleanAdvisorWrittenNote(desc || act);
  return { isConfirmed: true, visitType, cleanNote };
}

/**
 * Parsea el campo description estructurado de una cita o recordatorio
 * para extraer las notas escritas por el asesor, el proyecto y la acción.
 */
export function parseAppointmentDescription(desc?: string): { notes: string; project?: string; action?: string } {
  let notes = '';
  let project = '';
  let action = '';
  if (!desc) return { notes, project, action };

  const notesMatch = desc.match(/📝\s*Notas:\s*([\s\S]*?)(?=\nAsesor responsable:|\n\nAgendado|$)/i);
  if (notesMatch) notes = notesMatch[1].trim();

  const projMatch = desc.match(/🏢\s*Proyecto:\s*(.*?)(?=\n|$)/i);
  if (projMatch) project = projMatch[1].trim();

  const actMatch = desc.match(/🎯\s*Acción:\s*(.*?)(?=\n|$)/i);
  if (actMatch) action = actMatch[1].trim();

  if (!notes) {
    notes = desc.replace(/Agendado desde CRM.*$/i, '').trim();
  }
  return { notes, project, action };
}

export interface CompileReportOptions {
  periodType: ReportPeriodType;
  startDate: number;
  endDate: number;
  periodLabel?: string;
  preparedBy?: string;
  forRecipient?: string;
  targetMonthlyCaptaciones?: number;
  targetMonthlyVentas?: number;
  advisorId?: string;
  advisorName?: string;
}

export async function compileCommercialReportData(
  companyId: string,
  options: CompileReportOptions
): Promise<CommercialExecutiveReportData> {
  const {
    periodType,
    startDate,
    endDate,
    periodLabel,
    preparedBy = 'Luis Eduardo Salcedo Aya – Sistemas',
    forRecipient = 'Gerencia',
    targetMonthlyCaptaciones = 100,
    targetMonthlyVentas = 3,
  } = options;

  const startPeriod = new Date(startDate);
  const endPeriod = new Date(endDate);
  const startTs = Timestamp.fromDate(startPeriod);
  const endTs = Timestamp.fromDate(endPeriod);

  // Calcular inicio del mes correspondiente
  const currentMonth = endPeriod.getMonth();
  const currentYear = endPeriod.getFullYear();
  const startOfMonth = new Date(currentYear, currentMonth, 1, 0, 0, 0, 0);
  const endOfMonth = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);
  const startMonthTs = Timestamp.fromDate(startOfMonth);

  // Proporción esperada del mes al día de corte
  const dayOfMonth = endPeriod.getDate();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const monthProgressFraction = Math.min(1, dayOfMonth / daysInMonth);
  // Metas oficiales Grupo Meraki: 25 captaciones/semana y 100 captaciones/mes por asesor
  const expectedFraction = monthProgressFraction;
  const expectedMonthlyCaptaciones = Math.max(1, Math.round(targetMonthlyCaptaciones * expectedFraction));
  const expectedMonthlyVentas = Math.max(1, Math.round(targetMonthlyVentas * monthProgressFraction));

  // 1. Cargar dinámicamente todos los asesores comerciales desde Firestore
  const usersSnap = await getDocs(collection(db, 'companies', companyId, 'users'));

  interface DynamicAdvisorEntry {
    id: string;
    name: string;
    normName: string;
    email: string;
    role?: string;
    active: boolean;
    receiveLeads: boolean;
    createdAt: Date | null;
  }

  const excludedUserIds = new Set<string>(TEST_USER_IDS);
  const advisorsMap = new Map<string, DynamicAdvisorEntry>();

  usersSnap.docs.forEach((d) => {
    const u = d.data();
    if (isExcludedNonAdvisorUser(d.id, u)) {
      excludedUserIds.add(d.id);
      return;
    }

    const rawName = (u.displayName as string) || (u.name as string) || (u.email as string) || d.id;
    const cleanName = formatAdvisorDisplayName(rawName);
    const norm = normalizeStr(cleanName);
    const isActiveUser = u.active !== false && !u.disabled;
    const receivesLeads = isActiveUser && u.receiveLeads !== false && u.excludeFromLeadAssignment !== true;
    const userCreatedAt = parseDateAny(u.createdAt || u.invitedAt);

    advisorsMap.set(d.id, {
      id: d.id,
      name: cleanName,
      normName: norm,
      email: (u.email as string) || '',
      role: u.role || 'advisor',
      active: isActiveUser,
      receiveLeads: receivesLeads,
      createdAt: userCreatedAt,
    });
  });

  // Fallback únicamente si la colección de usuarios estuvo vacía
  if (advisorsMap.size === 0) {
    MERAKI_OFFICIAL_ADVISORS.forEach((officialName) => {
      const normOfficial = normalizeStr(officialName);
      const advId = `official_${normOfficial.replace(/\s+/g, '_')}`;
      advisorsMap.set(advId, {
        id: advId,
        name: officialName,
        normName: normOfficial,
        email: '',
        role: 'advisor',
        active: true,
        receiveLeads: true,
        createdAt: null,
      });
    });
  }

  const advisorsList = Array.from(advisorsMap.values());

  const resolveAdvisor = (val?: string | null): { id: string; name: string } | null => {
    if (!val) return null;
    const trimmed = String(val).trim();
    if (!trimmed || excludedUserIds.has(trimmed)) return null;

    // 1. Coincidencia directa por ID en advisorsMap
    const byId = advisorsMap.get(trimmed);
    if (byId) return { id: byId.id, name: byId.name };

    const normVal = normalizeStr(trimmed);
    if (!normVal || IGNORED_ADVISOR_TOKENS.has(normVal) || NON_ADVISOR_NORM_NAMES.has(normVal)) {
      return null;
    }

    // 2. Por coincidencia de texto (nombre que viene de SmartHome, bitácoras o ventas)
    const match = advisorsList.find((a) => isAdvisorMatch(trimmed, a.normName) || isAdvisorMatch(trimmed, a.name));
    if (match) return { id: match.id, name: match.name };
    return null;
  };

  // Detección de asesor objetivo si el reporte se genera en modo individual (rol asesor o filtro de administrador)
  let targetOfficialAdvisor: { id: string; name: string; normName: string } | null = null;
  const rawTargetAdv = options.advisorId || (options.advisorName && !options.advisorId ? options.advisorName : undefined);

  if (rawTargetAdv && rawTargetAdv !== 'all') {
    const res = resolveAdvisor(options.advisorId) || (options.advisorName ? resolveAdvisor(options.advisorName) : null);
    if (res) {
      const off = advisorsMap.get(res.id);
      targetOfficialAdvisor = off
        ? { id: off.id, name: off.name, normName: off.normName }
        : { id: res.id, name: res.name, normName: normalizeStr(res.name) };
    } else {
      for (const a of advisorsList) {
        if (a.id === rawTargetAdv || isAdvisorMatch(a.name, rawTargetAdv) || isAdvisorMatch(a.normName, rawTargetAdv)) {
          targetOfficialAdvisor = a;
          break;
        }
      }
    }
  }

  const isIndividual = !!targetOfficialAdvisor;
  const targetAdvisorName = targetOfficialAdvisor?.name || '';
  const targetAdvisorId = targetOfficialAdvisor?.id || '';

  // 2. Inicializar mapa de actividad diaria para todos los días entre startPeriod y endPeriod
  const dailyActivityMap = new Map<string, DailyActivityItem>();
  const curDay = new Date(startPeriod);
  curDay.setHours(0, 0, 0, 0);
  const endLimitDay = new Date(endPeriod);
  endLimitDay.setHours(23, 59, 59, 999);

  while (curDay <= endLimitDay) {
    const yyyy = curDay.getFullYear();
    const mm = String(curDay.getMonth() + 1).padStart(2, '0');
    const dd = String(curDay.getDate()).padStart(2, '0');
    const dateK = `${yyyy}-${mm}-${dd}`;
    const dName = FULL_DAY_NAMES[curDay.getDay()];
    const dFormatted = `${curDay.getDate()} de ${MONTH_NAMES[curDay.getMonth()]}`;
    const sDate = `${DAYS_ES[curDay.getDay()]} ${curDay.getDate()}`;

    dailyActivityMap.set(dateK, {
      dateKey: dateK,
      dayName: dName,
      dateFormatted: dFormatted,
      shortDate: sDate,
      timestamp: curDay.getTime(),
      captacionesCount: 0,
      bitacorasCount: 0,
      ventasCount: 0,
      advisorsActive: [],
      sales: [],
    });

    curDay.setDate(curDay.getDate() + 1);
  }

  // 3. Consultar Leads creados en el período (Captaciones del periodo)
  const leadsPeriodSnap = await getDocs(
    query(
      collection(db, 'companies', companyId, 'leads'),
      where('createdAt', '>=', startTs),
      where('createdAt', '<=', endTs)
    )
  );

  // 4. Consultar Leads creados en el mes completo (Captaciones acumuladas del mes)
  const leadsMonthSnap = await getDocs(
    query(
      collection(db, 'companies', companyId, 'leads'),
      where('createdAt', '>=', startMonthTs),
      where('createdAt', '<=', endTs)
    )
  );

  // 4b. Consultar Leads asignados o reasignados en el período (Traslados, outbound propio, etc.)
  let leadsAssignedPeriodSnap: any = { docs: [] };
  try {
    leadsAssignedPeriodSnap = await getDocs(
      query(
        collection(db, 'companies', companyId, 'leads'),
        where('advisorAssignedAt', '>=', startTs),
        where('advisorAssignedAt', '<=', endTs)
      )
    );
  } catch (err) {
    console.warn('[CommercialReports] Fallback consultando leads advisorAssignedAt período:', err);
  }

  // 4c. Consultar Leads asignados o reasignados en el mes
  let leadsAssignedMonthSnap: any = { docs: [] };
  try {
    leadsAssignedMonthSnap = await getDocs(
      query(
        collection(db, 'companies', companyId, 'leads'),
        where('advisorAssignedAt', '>=', startMonthTs),
        where('advisorAssignedAt', '<=', endTs)
      )
    );
  } catch (err) {
    console.warn('[CommercialReports] Fallback consultando leads advisorAssignedAt mes:', err);
  }

  // 5. Consultar Leads con seguimiento en el período
  let leadsFollowUpSnap: any = { docs: [] };
  try {
    leadsFollowUpSnap = await getDocs(
      query(
        collection(db, 'companies', companyId, 'leads'),
        where('lastFollowUpAt', '>=', startTs),
        where('lastFollowUpAt', '<=', endTs)
      )
    );
  } catch (err) {
    console.warn('[CommercialReports] Fallback consultando leads lastFollowUpAt:', err);
  }

  // 5b. Consultar Solicitudes de Traslado (transferRequests) para auditar traslados aprobados
  let transferRequestsSnap: any = { docs: [] };
  try {
    transferRequestsSnap = await getDocs(collection(db, 'companies', companyId, 'transferRequests'));
  } catch (err) {
    console.warn('[CommercialReports] Fallback consultando transferRequests:', err);
  }

  // Combinar todos los leads únicos para el análisis completo de bitácoras, ingresos y seguimientos
  const uniqueLeadsMap = new Map<string, any>();
  leadsPeriodSnap.docs.forEach((docSnap) => {
    uniqueLeadsMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data(), isPeriodCreated: true, isMonthCreated: true });
  });
  leadsMonthSnap.docs.forEach((docSnap) => {
    if (!uniqueLeadsMap.has(docSnap.id)) {
      uniqueLeadsMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data(), isPeriodCreated: false, isMonthCreated: true });
    } else {
      uniqueLeadsMap.get(docSnap.id).isMonthCreated = true;
    }
  });
  leadsAssignedPeriodSnap.docs.forEach((docSnap: any) => {
    if (!uniqueLeadsMap.has(docSnap.id)) {
      uniqueLeadsMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data(), isPeriodCreated: false, isMonthCreated: true, isPeriodAssigned: true, isMonthAssigned: true });
    } else {
      const ex = uniqueLeadsMap.get(docSnap.id);
      ex.isPeriodAssigned = true;
      ex.isMonthAssigned = true;
    }
  });
  leadsAssignedMonthSnap.docs.forEach((docSnap: any) => {
    if (!uniqueLeadsMap.has(docSnap.id)) {
      uniqueLeadsMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data(), isPeriodCreated: false, isMonthCreated: true, isPeriodAssigned: false, isMonthAssigned: true });
    } else {
      uniqueLeadsMap.get(docSnap.id).isMonthAssigned = true;
    }
  });
  leadsFollowUpSnap.docs.forEach((docSnap: any) => {
    if (!uniqueLeadsMap.has(docSnap.id)) {
      uniqueLeadsMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data(), isPeriodCreated: false, isMonthCreated: false });
    }
  });

  // Procesar transferRequests aprobadas en el período para capturar gestiones comerciales y traslados de base anterior
  const approvedTransfersInPeriod: any[] = [];
  transferRequestsSnap.docs.forEach((docSnap: any) => {
    const tr = docSnap.data();
    if (tr.status === 'approved') {
      const resDate = parseDateAny(tr.resolvedAt || tr.createdAt);
      if (resDate && resDate >= startPeriod && resDate <= endPeriod) {
        approvedTransfersInPeriod.push({ id: docSnap.id, ...tr, resolvedDate: resDate });
      }
    }
  });

  for (const tr of approvedTransfersInPeriod) {
    if (tr.leadId && !uniqueLeadsMap.has(tr.leadId)) {
      try {
        const ldSnap = await getDoc(doc(db, 'companies', companyId, 'leads', tr.leadId));
        if (ldSnap.exists()) {
          uniqueLeadsMap.set(tr.leadId, {
            id: tr.leadId,
            ...ldSnap.data(),
            isPeriodAssigned: true,
            isMonthAssigned: true,
            fromTransfer: true,
            transferReason: tr.reason,
            transferDate: tr.resolvedDate,
            transferRecipient: tr.finalAssignedName || tr.targetAdvisorName || tr.requesterName,
            transferRecipientId: tr.finalAssignedTo || tr.targetAdvisorId || tr.requesterId,
          });
        }
      } catch {}
    } else if (tr.leadId && uniqueLeadsMap.has(tr.leadId)) {
      const ex = uniqueLeadsMap.get(tr.leadId);
      ex.isPeriodAssigned = true;
      ex.isMonthAssigned = true;
      ex.fromTransfer = true;
      ex.transferReason = tr.reason;
      ex.transferDate = tr.resolvedDate;
      ex.transferRecipient = tr.finalAssignedName || tr.targetAdvisorName || tr.requesterName;
      ex.transferRecipientId = tr.finalAssignedTo || tr.targetAdvisorId || tr.requesterId;
    }
  }

  // Mapear captaciones por asesor deduplicando prospectos con el mismo teléfono
  const captSemanaMap = new Map<string, number>();
  const captMesMap = new Map<string, number>();
  const leadsPeriodByAdvisor = new Map<string, Set<string>>();
  const leadsMonthByAdvisor = new Map<string, Set<string>>();

  const cleanDigits = (val: unknown): string => {
    const s = String(val ?? '').replace(/\D/g, '');
    if (s.length === 10) return s;
    if (s.length === 12 && s.startsWith('57')) return s.slice(2);
    if (s.length > 10 && s.startsWith('57')) return s.slice(-10);
    return s;
  };

  const seenPeriodPhonesByAdvisor = new Map<string, Set<string>>();
  const seenMonthPhonesByAdvisor = new Map<string, Set<string>>();

  // Para estadísticas de captación
  const dailyCaptacionMap = new Map<string, number>();
  const projectCaptacionMap = new Map<string, number>();
  const sourceCaptacionMap = new Map<string, number>();

  let withPhone = 0;
  let withEmail = 0;
  let withId = 0;
  let withCity = 0;
  let withStage = 0;

  for (const [docId, l] of uniqueLeadsMap.entries()) {
    const cDate = parseDateAny(l.createdAt);
    const aDate = parseDateAny(l.advisorAssignedAt);

    // Criterio de ingreso en el período: creado en el período O asignado/trasladado al asesor en el período
    const isPeriodEntry =
      (cDate && cDate >= startPeriod && cDate <= endPeriod) ||
      (aDate && aDate >= startPeriod && aDate <= endPeriod) ||
      l.isPeriodCreated ||
      l.isPeriodAssigned;

    // Criterio de ingreso en el mes
    const isMonthEntry =
      (cDate && cDate >= startMonthTs.toDate() && cDate <= endOfMonth) ||
      (aDate && aDate >= startMonthTs.toDate() && aDate <= endOfMonth) ||
      l.isMonthCreated ||
      l.isMonthAssigned;

    const advisorRef = l.transferRecipientId || l.assignedTo || l.smartHomeAdvisorName;
    const resolvedAdv = resolveAdvisor(advisorRef);
    const advId = resolvedAdv ? resolvedAdv.id : (advisorRef || 'unassigned');
    const advName = resolvedAdv ? resolvedAdv.name : (l.transferRecipient || l.smartHomeAdvisorName || 'Sin Asignar');

    const rawPhoneDigits = cleanDigits(l.phone || l.normalizedPhone);
    const phoneKey = rawPhoneDigits || `doc_${docId}`;

    if (isPeriodEntry) {
      if (!seenPeriodPhonesByAdvisor.has(advId)) {
        seenPeriodPhonesByAdvisor.set(advId, new Set());
      }
      const advPhones = seenPeriodPhonesByAdvisor.get(advId)!;
      if (!advPhones.has(phoneKey)) {
        advPhones.add(phoneKey);
        captSemanaMap.set(advId, (captSemanaMap.get(advId) || 0) + 1);

        if (!leadsPeriodByAdvisor.has(advId)) {
          leadsPeriodByAdvisor.set(advId, new Set());
        }
        leadsPeriodByAdvisor.get(advId)!.add(docId);

        // Métricas de captación por día
        const effectiveDate = (cDate && cDate >= startPeriod && cDate <= endPeriod) ? cDate : (aDate || cDate || startPeriod);
        if (effectiveDate) {
          const dayKey = `${DAYS_ES[effectiveDate.getDay()]} ${effectiveDate.getDate()}`;
          dailyCaptacionMap.set(dayKey, (dailyCaptacionMap.get(dayKey) || 0) + 1);

          const yyyy = effectiveDate.getFullYear();
          const mm = String(effectiveDate.getMonth() + 1).padStart(2, '0');
          const dd = String(effectiveDate.getDate()).padStart(2, '0');
          const dateK = `${yyyy}-${mm}-${dd}`;
          const dItem = dailyActivityMap.get(dateK);
          if (dItem) {
            dItem.captacionesCount++;
            let advWork = dItem.advisorsActive.find((a) => a.advisorId === advId);
            if (!advWork) {
              advWork = { advisorId: advId, advisorName: advName, captaciones: 0, bitacoras: 0, actions: [], sampleNotes: [] };
              dItem.advisorsActive.push(advWork);
            }
            advWork.captaciones++;
          }
        }

        // Por proyecto
        const proj = l.project || l.metadata?.['¿qué_proyecto_te_interesa_más?'] || l.metadata?.loteInteres || 'Sin Proyecto';
        projectCaptacionMap.set(proj, (projectCaptacionMap.get(proj) || 0) + 1);

        // Por fuente
        const src = l.source || l.metadata?.fuente || (l.fromTransfer ? 'Traslado Comercial' : 'Sin Fuente');
        sourceCaptacionMap.set(src, (sourceCaptacionMap.get(src) || 0) + 1);

        // Calidad de datos
        if (l.phone || l.normalizedPhone) withPhone++;
        if (l.email || l.metadata?.correo_electrónico) withEmail++;
        if (l.documentNumber || l.cedula) withId++;
        if (l.city || l.metadata?.ciudad) withCity++;
        if (l.pipelineStage || l.stage) withStage++;
      }
    }

    if (isMonthEntry) {
      if (!seenMonthPhonesByAdvisor.has(advId)) {
        seenMonthPhonesByAdvisor.set(advId, new Set());
      }
      const advPhones = seenMonthPhonesByAdvisor.get(advId)!;
      if (!advPhones.has(phoneKey)) {
        advPhones.add(phoneKey);
        captMesMap.set(advId, (captMesMap.get(advId) || 0) + 1);

        if (!leadsMonthByAdvisor.has(advId)) {
          leadsMonthByAdvisor.set(advId, new Set());
        }
        leadsMonthByAdvisor.get(advId)!.add(docId);
      }
    }
  }

  // 6. Analizar Bitácoras, Fichas Técnicas y Seguimiento SmartHome + CRM
  const advisorManagedClientsMap = new Map<string, Set<string>>(); // advId -> Set de clientKeys gestionados
  const advisorNewLeadsManagedMap = new Map<string, Set<string>>(); // advId -> Set de clientKeys del período gestionados
  const advisorOldClientsManagedMap = new Map<string, Set<string>>(); // advId -> Set de clientKeys anteriores gestionados
  const advisorManagedDocIdsMap = new Map<string, Map<string, string>>(); // advId -> Map<clientUniqueKey, docId>
  const advisorNewDocIdsMap = new Map<string, Map<string, string>>(); // advId -> Map<clientUniqueKey, docId>
  const advisorOldDocIdsMap = new Map<string, Map<string, string>>(); // advId -> Map<clientUniqueKey, docId>
  const advisorNotesObservations = new Map<string, string[]>(); // advId -> textos de notas reales
  const allManagedClientIds = new Set<string>();
  const pendingNotesCheck: Array<{ leadId: string; lead: any; clientUniqueKey: string }> = [];

  const leadFollowUpDetailsMap = new Map<
    string,
    {
      hadPeriodFollowUp: boolean;
      hadMonthFollowUp: boolean;
      latestFollowUpDate: Date | null;
      latestFollowUpSummary: string;
      latestFollowUpAuthor: string;
    }
  >();

  for (const [leadId, lead] of uniqueLeadsMap.entries()) {
    const createdAt = parseDateAny(lead.createdAt);
    const aDate = parseDateAny(lead.advisorAssignedAt);
    const trDate = parseDateAny(lead.transferDate);
    const isNew =
      (createdAt && createdAt >= startPeriod && createdAt <= endPeriod) ||
      (aDate && aDate >= startPeriod && aDate <= endPeriod) ||
      (trDate && trDate >= startPeriod && trDate <= endPeriod) ||
      !!lead.isPeriodCreated ||
      !!lead.isPeriodAssigned;

    // Clave unificada del cliente (si tiene teléfono se agrupan los duplicados)
    const clientPhoneDigits = cleanDigits(lead.phone || lead.normalizedPhone);
    const clientUniqueKey = clientPhoneDigits ? `phone_${clientPhoneDigits}` : leadId;

    // Combinar bitácoras de ambas fuentes: CRM (lead.bitacoras) y SmartHome (metadata.smarthomeBitacoras)
    const rawBitacoras = [
      ...(Array.isArray(lead.bitacoras) ? lead.bitacoras : []),
      ...(Array.isArray(lead.metadata?.smarthomeBitacoras) ? lead.metadata.smarthomeBitacoras : []),
    ];

    // Deduplicar bitácoras por acción + fecha + texto
    const bitacoras: any[] = [];
    const seenBitKeys = new Set<string>();
    for (const b of rawBitacoras) {
      const bDate = b.fecha || b.lastDate || b.date || '';
      const bKey = `${b.action || ''}_${bDate}_${b.description || ''}`;
      if (!seenBitKeys.has(bKey)) {
        seenBitKeys.add(bKey);
        bitacoras.push(b);
      }
    }
    let hadFollowUp = false;
    let hadPeriodFollowUp = false;
    let hadMonthFollowUp = false;
    let latestFollowUpDate: Date | null = null;
    let latestFollowUpSummary = '';
    let latestFollowUpAuthor = '';
    let followUpAuthor = lead.assignedTo || lead.smartHomeAdvisorName || 'Desconocido';
    let followUpNote = '';

    if (Array.isArray(bitacoras)) {
      for (const b of bitacoras) {
        const bDateStr = b.fecha || b.lastDate || b.date;
        if (!bDateStr) continue;
        const bDate = parseDateAny(bDateStr);
        if (bDate && isRealCommercialFollowUp(b.action, b.description)) {
          const desc = (b.description || b.action || '').trim();
          if (bDate >= startMonthTs.toDate() && bDate <= endOfMonth) {
            hadMonthFollowUp = true;
          }
          if (!latestFollowUpDate || bDate > latestFollowUpDate) {
            latestFollowUpDate = bDate;
            latestFollowUpSummary = desc;
            latestFollowUpAuthor = b.asesor || lead.assignedTo || lead.smartHomeAdvisorName || 'Asesor';
          }
          if (bDate >= startPeriod && bDate <= endPeriod) {
            hadPeriodFollowUp = true;
            hadFollowUp = true;
            if (b.asesor) followUpAuthor = b.asesor;
            followUpNote = desc;
            const followUpAction = b.action || 'bitacora_comercial';

            // Registrar en el desglose día a día
            const yyyy = bDate.getFullYear();
            const mm = String(bDate.getMonth() + 1).padStart(2, '0');
            const dd = String(bDate.getDate()).padStart(2, '0');
            const dateK = `${yyyy}-${mm}-${dd}`;
            const dItem = dailyActivityMap.get(dateK);
            if (dItem) {
              dItem.bitacorasCount++;
              const resolvedAdv =
                resolveAdvisor(b.asesor) ||
                resolveAdvisor(lead.assignedTo) ||
                resolveAdvisor(lead.smartHomeAdvisorName);
              const advId = resolvedAdv ? resolvedAdv.id : (lead.assignedTo || 'unassigned');
              const advName = resolvedAdv ? resolvedAdv.name : (b.asesor || lead.smartHomeAdvisorName || 'Sin Asignar');

              let advWork = dItem.advisorsActive.find((a) => a.advisorId === advId);
              if (!advWork) {
                advWork = { advisorId: advId, advisorName: advName, captaciones: 0, bitacoras: 0, actions: [], sampleNotes: [] };
                dItem.advisorsActive.push(advWork);
              }
              advWork.bitacoras++;
              let act = advWork.actions.find((x) => x.actionType === followUpAction);
              if (!act) {
                act = { actionType: followUpAction, label: followUpAction, count: 0 };
                advWork.actions.push(act);
              }
              act.count++;
              if (desc && advWork.sampleNotes.length < 5 && !advWork.sampleNotes.includes(desc)) {
                advWork.sampleNotes.push(desc);
              }
            }
          }
        }
      }
    }

    // Si no hubo en el array pero tiene lastFollowUpAt en el período
    if (lead.lastFollowUpAt) {
      const lfu = parseDateAny(lead.lastFollowUpAt);
      if (lfu) {
        const action = lead.lastFollowUpAction || '';
        const desc = (lead.lastFollowUpSummary || lead.lastFollowUpAction || '').trim();
        if (isRealCommercialFollowUp(action, desc)) {
          if (lfu >= startMonthTs.toDate() && lfu <= endOfMonth) {
            hadMonthFollowUp = true;
          }
          if (!latestFollowUpDate || lfu > latestFollowUpDate) {
            latestFollowUpDate = lfu;
            latestFollowUpSummary = desc;
            latestFollowUpAuthor = lead.lastFollowUpAuthor || lead.assignedTo || 'Asesor';
          }
          if (!hadFollowUp && lfu >= startPeriod && lfu <= endPeriod) {
            hadPeriodFollowUp = true;
            hadFollowUp = true;
            if (lead.lastFollowUpAuthor) followUpAuthor = lead.lastFollowUpAuthor;
            followUpNote = desc;
            const followUpAction = action || 'seguimiento_crm';

            const yyyy = lfu.getFullYear();
            const mm = String(lfu.getMonth() + 1).padStart(2, '0');
            const dd = String(lfu.getDate()).padStart(2, '0');
            const dateK = `${yyyy}-${mm}-${dd}`;
            const dItem = dailyActivityMap.get(dateK);
            if (dItem) {
              dItem.bitacorasCount++;
              const resolvedAdv =
                resolveAdvisor(followUpAuthor) ||
                resolveAdvisor(lead.assignedTo) ||
                resolveAdvisor(lead.smartHomeAdvisorName);
              const advId = resolvedAdv ? resolvedAdv.id : (lead.assignedTo || 'unassigned');
              const advName = resolvedAdv ? resolvedAdv.name : (followUpAuthor || lead.smartHomeAdvisorName || 'Sin Asignar');

              let advWork = dItem.advisorsActive.find((a) => a.advisorId === advId);
              if (!advWork) {
                advWork = { advisorId: advId, advisorName: advName, captaciones: 0, bitacoras: 0, actions: [], sampleNotes: [] };
                dItem.advisorsActive.push(advWork);
              }
              advWork.bitacoras++;
              let act = advWork.actions.find((x) => x.actionType === followUpAction);
              if (!act) {
                act = { actionType: followUpAction, label: followUpAction, count: 0 };
                advWork.actions.push(act);
              }
              act.count++;
              if (desc && advWork.sampleNotes.length < 5 && !advWork.sampleNotes.includes(desc)) {
                advWork.sampleNotes.push(desc);
              }
            }
          }
        }
      }
    }

    if (hadFollowUp) {
      const resolvedAdv =
        resolveAdvisor(lead.transferRecipientId || lead.assignedTo) ||
        resolveAdvisor(followUpAuthor) ||
        resolveAdvisor(lead.smartHomeAdvisorName);
      const advId = resolvedAdv ? resolvedAdv.id : (lead.assignedTo || 'unassigned');

      allManagedClientIds.add(clientUniqueKey);
      if (!advisorManagedClientsMap.has(advId)) advisorManagedClientsMap.set(advId, new Set());
      advisorManagedClientsMap.get(advId)!.add(clientUniqueKey);

      if (!advisorManagedDocIdsMap.has(advId)) advisorManagedDocIdsMap.set(advId, new Map());
      if (!advisorManagedDocIdsMap.get(advId)!.has(clientUniqueKey)) {
        advisorManagedDocIdsMap.get(advId)!.set(clientUniqueKey, leadId);
      }

      if (isNew) {
        if (!advisorNewLeadsManagedMap.has(advId)) advisorNewLeadsManagedMap.set(advId, new Set());
        advisorNewLeadsManagedMap.get(advId)!.add(clientUniqueKey);

        if (!advisorNewDocIdsMap.has(advId)) advisorNewDocIdsMap.set(advId, new Map());
        if (!advisorNewDocIdsMap.get(advId)!.has(clientUniqueKey)) {
          advisorNewDocIdsMap.get(advId)!.set(clientUniqueKey, leadId);
        }
      } else {
        if (!advisorOldClientsManagedMap.has(advId)) advisorOldClientsManagedMap.set(advId, new Set());
        advisorOldClientsManagedMap.get(advId)!.add(clientUniqueKey);

        if (!advisorOldDocIdsMap.has(advId)) advisorOldDocIdsMap.set(advId, new Map());
        if (!advisorOldDocIdsMap.get(advId)!.has(clientUniqueKey)) {
          advisorOldDocIdsMap.get(advId)!.set(clientUniqueKey, leadId);
        }
      }

      if (followUpNote) {
        if (!advisorNotesObservations.has(advId)) advisorNotesObservations.set(advId, []);
        if (advisorNotesObservations.get(advId)!.length < 15 && !advisorNotesObservations.get(advId)!.includes(followUpNote)) {
          advisorNotesObservations.get(advId)!.push(followUpNote);
        }
      }
    } else {
      pendingNotesCheck.push({ leadId, lead, clientUniqueKey });
    }

    const fuEntry = {
      hadPeriodFollowUp: hadPeriodFollowUp || hadFollowUp,
      hadMonthFollowUp: hadMonthFollowUp || hadPeriodFollowUp || hadFollowUp,
      latestFollowUpDate,
      latestFollowUpSummary: latestFollowUpSummary || followUpNote,
      latestFollowUpAuthor: latestFollowUpAuthor || followUpAuthor,
    };
    leadFollowUpDetailsMap.set(leadId, fuEntry);
    if (clientPhoneDigits) {
      leadFollowUpDetailsMap.set(`phone_${clientPhoneDigits}`, fuEntry);
    }
  }

  // 3ra Fuente de Verificación: Fichas Técnicas guardadas en la subcolección 'notes' del lead (por lotes paralelos)
  const BATCH_SIZE = 25;
  for (let i = 0; i < pendingNotesCheck.length; i += BATCH_SIZE) {
    const batch = pendingNotesCheck.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async ({ leadId, lead, clientUniqueKey }) => {
        try {
          let notesSubSnap;
          try {
            notesSubSnap = await getDocs(
              query(collection(db, 'companies', companyId, 'leads', leadId, 'notes'), orderBy('createdAt', 'desc'), limit(5))
            );
          } catch {
            notesSubSnap = await getDocs(
              query(collection(db, 'companies', companyId, 'leads', leadId, 'notes'), limit(10))
            );
          }
          for (const nd of notesSubSnap.docs) {
            const nData = nd.data();
            const nDate = parseDateAny(nData.createdAt || nData.date);
            if (nDate && nDate >= startPeriod && nDate <= endPeriod) {
              const rawAction = nData.actionType || nData.result || 'nota_ficha_tecnica';
              const rawNote = (nData.content || nData.text || '').trim();
              if (isRealCommercialFollowUp(rawAction, rawNote)) {
                // Las fichas de la IA (authorId 'ai') cuentan como "Victoria IA", no como gestión del asesor.
                const followUpAuthor = nData.authorId === 'ai'
                  ? (nData.authorName || 'Victoria IA')
                  : (nData.authorId || nData.author || nData.authorName || lead.assignedTo || 'Desconocido');
                const followUpAction = rawAction;
                const followUpNote = rawNote;

                const yyyy = nDate.getFullYear();
                const mm = String(nDate.getMonth() + 1).padStart(2, '0');
                const dd = String(nDate.getDate()).padStart(2, '0');
                const dateK = `${yyyy}-${mm}-${dd}`;
                const dItem = dailyActivityMap.get(dateK);
                if (dItem) {
                  dItem.bitacorasCount++;
                  const resolvedAdv =
                    resolveAdvisor(nData.authorId) ||
                    resolveAdvisor(nData.author) ||
                    resolveAdvisor(nData.authorName) ||
                    resolveAdvisor(lead.assignedTo) ||
                    resolveAdvisor(lead.smartHomeAdvisorName);
                  const advId = resolvedAdv ? resolvedAdv.id : (lead.assignedTo || 'unassigned');
                  const advName = resolvedAdv ? resolvedAdv.name : (nData.authorName || followUpAuthor || lead.smartHomeAdvisorName || 'Sin Asignar');

                  let advWork = dItem.advisorsActive.find((a) => a.advisorId === advId);
                  if (!advWork) {
                    advWork = { advisorId: advId, advisorName: advName, captaciones: 0, bitacoras: 0, actions: [], sampleNotes: [] };
                    dItem.advisorsActive.push(advWork);
                  }
                  advWork.bitacoras++;
                  let act = advWork.actions.find((x) => x.actionType === followUpAction);
                  if (!act) {
                    act = { actionType: followUpAction, label: followUpAction, count: 0 };
                    advWork.actions.push(act);
                  }
                  act.count++;
                  if (rawNote && advWork.sampleNotes.length < 5 && !advWork.sampleNotes.includes(rawNote)) {
                    advWork.sampleNotes.push(rawNote);
                  }
                }

                const resolvedAdv =
                  resolveAdvisor(lead.transferRecipientId || lead.assignedTo) ||
                  resolveAdvisor(nData.authorId) ||
                  resolveAdvisor(nData.author) ||
                  resolveAdvisor(nData.authorName) ||
                  resolveAdvisor(lead.smartHomeAdvisorName);
                const advId = resolvedAdv ? resolvedAdv.id : (lead.assignedTo || 'unassigned');

                allManagedClientIds.add(clientUniqueKey);
                if (!advisorManagedClientsMap.has(advId)) advisorManagedClientsMap.set(advId, new Set());
                advisorManagedClientsMap.get(advId)!.add(clientUniqueKey);

                if (!advisorManagedDocIdsMap.has(advId)) advisorManagedDocIdsMap.set(advId, new Map());
                if (!advisorManagedDocIdsMap.get(advId)!.has(clientUniqueKey)) {
                  advisorManagedDocIdsMap.get(advId)!.set(clientUniqueKey, leadId);
                }

                const cDateL = parseDateAny(lead.createdAt);
                const aDateL = parseDateAny(lead.advisorAssignedAt);
                const trDateL = parseDateAny(lead.transferDate);
                const isNewLead =
                  (cDateL && cDateL >= startPeriod && cDateL <= endPeriod) ||
                  (aDateL && aDateL >= startPeriod && aDateL <= endPeriod) ||
                  (trDateL && trDateL >= startPeriod && trDateL <= endPeriod) ||
                  !!lead.isPeriodCreated ||
                  !!lead.isPeriodAssigned;

                if (isNewLead) {
                  if (!advisorNewLeadsManagedMap.has(advId)) advisorNewLeadsManagedMap.set(advId, new Set());
                  advisorNewLeadsManagedMap.get(advId)!.add(clientUniqueKey);

                  if (!advisorNewDocIdsMap.has(advId)) advisorNewDocIdsMap.set(advId, new Map());
                  if (!advisorNewDocIdsMap.get(advId)!.has(clientUniqueKey)) {
                    advisorNewDocIdsMap.get(advId)!.set(clientUniqueKey, leadId);
                  }
                } else {
                  if (!advisorOldClientsManagedMap.has(advId)) advisorOldClientsManagedMap.set(advId, new Set());
                  advisorOldClientsManagedMap.get(advId)!.add(clientUniqueKey);

                  if (!advisorOldDocIdsMap.has(advId)) advisorOldDocIdsMap.set(advId, new Map());
                  if (!advisorOldDocIdsMap.get(advId)!.has(clientUniqueKey)) {
                    advisorOldDocIdsMap.get(advId)!.set(clientUniqueKey, leadId);
                  }
                }

                if (followUpNote) {
                  if (!advisorNotesObservations.has(advId)) advisorNotesObservations.set(advId, []);
                  if (advisorNotesObservations.get(advId)!.length < 15 && !advisorNotesObservations.get(advId)!.includes(followUpNote)) {
                    advisorNotesObservations.get(advId)!.push(followUpNote);
                  }
                }

                const existingFu = leadFollowUpDetailsMap.get(leadId) || {
                  hadPeriodFollowUp: false,
                  hadMonthFollowUp: false,
                  latestFollowUpDate: null,
                  latestFollowUpSummary: '',
                  latestFollowUpAuthor: '',
                };
                existingFu.hadPeriodFollowUp = true;
                existingFu.hadMonthFollowUp = true;
                if (!existingFu.latestFollowUpDate || nDate > existingFu.latestFollowUpDate) {
                  existingFu.latestFollowUpDate = nDate;
                  existingFu.latestFollowUpSummary = rawNote;
                  existingFu.latestFollowUpAuthor = followUpAuthor;
                }
                leadFollowUpDetailsMap.set(leadId, existingFu);
                leadFollowUpDetailsMap.set(clientUniqueKey, existingFu);
                break;
              }
            }
          }
        } catch {
          // ignore
        }
      })
    );
  }

  // Constructor de objeto de detalle para la tabla interactiva de prospectos
  const buildAdvisorLeadDetail = (
    docId: string,
    fallbackAdvId: string,
    fallbackAdvName: string,
    mode: 'period' | 'month'
  ): AdvisorLeadDetailItem => {
    const lead = uniqueLeadsMap.get(docId) || {};
    const resolvedAdv = resolveAdvisor(lead.assignedTo || lead.smartHomeAdvisorName);
    const advId = resolvedAdv ? resolvedAdv.id : fallbackAdvId;
    const advName = resolvedAdv ? resolvedAdv.name : fallbackAdvName;

    const rawDigits = cleanDigits(lead.phone || lead.normalizedPhone);
    const clientUniqueKey = rawDigits ? `phone_${rawDigits}` : docId;

    const fu = leadFollowUpDetailsMap.get(docId) || (rawDigits ? leadFollowUpDetailsMap.get(clientUniqueKey) : undefined);

    const isPeriodManaged = !!(
      advisorNewLeadsManagedMap.get(advId)?.has(clientUniqueKey) ||
      advisorManagedClientsMap.get(advId)?.has(clientUniqueKey) ||
      allManagedClientIds.has(clientUniqueKey) ||
      fu?.hadPeriodFollowUp
    );

    const isMonthManaged = !!(
      isPeriodManaged ||
      fu?.hadMonthFollowUp ||
      advisorManagedClientsMap.get(advId)?.has(clientUniqueKey) ||
      allManagedClientIds.has(clientUniqueKey)
    );

    const cDate = parseDateAny(lead.createdAt);
    const aDate = parseDateAny(lead.advisorAssignedAt);
    const fuDate = fu?.latestFollowUpDate || parseDateAny(lead.lastFollowUpAt);

    const summary =
      fu?.latestFollowUpSummary ||
      lead.lastFollowUpSummary ||
      (Array.isArray(lead.bitacoras) && lead.bitacoras[0]?.description) ||
      undefined;

    // Recopilar historial completo de bitácoras reales
    const rawAllBitacoras = [
      ...(Array.isArray(lead.bitacoras) ? lead.bitacoras : []),
      ...(Array.isArray(lead.metadata?.smarthomeBitacoras) ? lead.metadata.smarthomeBitacoras : []),
    ];
    const bitacorasList: AdvisorLeadFollowUpHistoryItem[] = [];
    const seenBKeys = new Set<string>();
    for (const b of rawAllBitacoras) {
      const bDateStr = b.fecha || b.lastDate || b.date || '';
      const desc = (b.description || b.action || '').trim();
      const bKey = `${b.action || ''}_${bDateStr}_${desc}`;
      if (!seenBKeys.has(bKey) && desc && isRealCommercialFollowUp(b.action, desc)) {
        seenBKeys.add(bKey);
        const bDate = parseDateAny(bDateStr);
        bitacorasList.push({
          date: bDate ? formatDateBogotaTime(bDate) : (bDateStr || 'Sin fecha'),
          action: b.action || 'Gestión comercial',
          description: desc,
          author: b.asesor || lead.assignedTo || advName,
        });
      }
    }
    if (lead.fromTransfer && lead.transferReason) {
      const alreadyHasTr = bitacorasList.some(b => (b.description || '').includes(lead.transferReason));
      if (!alreadyHasTr) {
        bitacorasList.unshift({
          date: lead.transferDate ? formatDateBogotaTime(lead.transferDate) : (fuDate ? formatDateBogotaTime(fuDate) : 'Reciente'),
          action: 'Traslado Aprobado / Gestión Comercial',
          description: `Traslado comercial: ${lead.transferReason}`,
          author: advName,
        });
      }
    }

    if (bitacorasList.length === 0 && (fu?.latestFollowUpSummary || lead.lastFollowUpSummary)) {
      bitacorasList.push({
        date: fuDate ? formatDateBogotaTime(fuDate) : 'Reciente',
        action: lead.lastFollowUpAction || 'Seguimiento CRM',
        description: fu?.latestFollowUpSummary || lead.lastFollowUpSummary,
        author: fu?.latestFollowUpAuthor || lead.lastFollowUpAuthor || advName,
      });
    }

    return {
      leadId: docId,
      clientName: lead.name || lead.fullName || lead.clientName || 'Cliente sin registrar',
      phone: lead.phone || lead.normalizedPhone || 'Sin teléfono',
      phoneRaw: rawDigits,
      advisorId: advId,
      advisorName: advName,
      createdAt: cDate ? cDate.getTime() : 0,
      createdAtFormatted: cDate ? formatDateBogotaTime(cDate) : 'Fecha no reg.',
      project:
        lead.project ||
        lead.metadata?.['¿qué_proyecto_te_interesa_más?'] ||
        lead.metadata?.loteInteres ||
        lead.metadata?.proyecto ||
        'Sin proyecto',
      source: lead.source || lead.metadata?.fuente || lead.metadata?.source || (lead.fromTransfer ? 'Traslado Comercial' : 'WhatsApp / Directo'),
      status: lead.pipelineStage || lead.status || lead.stage || 'nuevo',
      hasFollowUp: mode === 'month' ? isMonthManaged : isPeriodManaged,
      hasPeriodFollowUp: isPeriodManaged,
      hasMonthFollowUp: isMonthManaged,
      lastFollowUpAt: fuDate ? fuDate.getTime() : undefined,
      lastFollowUpFormatted: fuDate ? formatDateBogotaTime(fuDate) : undefined,
      lastFollowUpSummary: summary,
      lastFollowUpAuthor: fu?.latestFollowUpAuthor || lead.lastFollowUpAuthor || advName,
      allBitacoras: bitacorasList,
      isPeriodCreated:
        (cDate && cDate >= startPeriod && cDate <= endPeriod) ||
        (aDate && aDate >= startPeriod && aDate <= endPeriod) ||
        !!lead.isPeriodCreated ||
        !!lead.isPeriodAssigned,
      isMonthCreated:
        (cDate && cDate >= startOfMonth && cDate <= endPeriod) ||
        (aDate && aDate >= startOfMonth && aDate <= endPeriod) ||
        !!lead.isMonthCreated ||
        !!lead.isMonthAssigned,
      fromTransfer: !!lead.fromTransfer,
      transferReason: lead.transferReason || undefined,
    };
  };

  // 7. Cargar Ventas y Cierres (de SmartHome y de CRM)
  const salesList: SaleReportItem[] = [];
  const monthSalesList: SaleReportItem[] = [];
  const salesSemanaByAdvisor = new Map<string, number>();
  const salesMesByAdvisor = new Map<string, number>();

  try {
    let rawSales: any[] = [];
    try {
      const salesSnap = await getDocs(collection(db, 'companies', companyId, 'smarthomeSales'));
      salesSnap.docs.forEach((docSnap) => {
        rawSales.push({ id: docSnap.id, ...docSnap.data() });
      });
    } catch {
      try {
        const getSalesCallable = httpsCallable<{ companyId: string }, { sales: any[] }>(functions, 'listSmartHomeSales');
        const res = await getSalesCallable({ companyId });
        if (res.data?.sales) rawSales = res.data.sales;
      } catch (callErr) {
        console.warn('[CommercialReports] listSmartHomeSales fallback warning:', callErr);
      }
    }

    rawSales.forEach((s) => {
      if (!s.closeDate) return;
      if (s.ignored) return;

      // Exclusión solicitada: Venta de Hilder Daniel Walteros Coca (Canarias 149) corresponde a mes anterior (septiembre)
      const buyerNorm = normalizeStr(s.buyerName || s.clientName || '');
      const lotNorm = normalizeStr(s.lotName || s.property || '');
      if (buyerNorm.includes('walteros') || lotNorm.includes('canarias 149')) {
        return;
      }

      const closedAt = parseDateAny(s.closeDate);
      if (!closedAt) return;

      const resolvedAdv = resolveAdvisor(s.advisorName || s.agentCierre || s.agentCr);
      const advId = resolvedAdv ? resolvedAdv.id : (s.ownerId || 'unassigned');
      const advName = resolvedAdv ? resolvedAdv.name : (s.advisorName || 'Asesor');

      // Venta en el mes
      if (closedAt >= startOfMonth && closedAt <= endOfMonth) {
        salesMesByAdvisor.set(advId, (salesMesByAdvisor.get(advId) || 0) + 1);
        const monthSaleItem: SaleReportItem = {
          id: s.id,
          date: formatDateBogota(closedAt),
          advisorName: advName,
          clientName: s.buyerName || s.clientName || 'Cliente',
          property: s.lotName || s.property || s.crmProjectId || 'Lote / Inmueble',
          amount: Number(s.value || s.dealAmount) || 0,
        };
        monthSalesList.push(monthSaleItem);
      }

      // Venta en el período
      if (closedAt >= startPeriod && closedAt <= endPeriod) {
        salesSemanaByAdvisor.set(advId, (salesSemanaByAdvisor.get(advId) || 0) + 1);
        const saleItem: SaleReportItem = {
          id: s.id,
          date: formatDateBogota(closedAt),
          advisorName: advName,
          clientName: s.buyerName || s.clientName || 'Cliente',
          property: s.lotName || s.property || s.crmProjectId || 'Lote / Inmueble',
          amount: Number(s.value || s.dealAmount) || 0,
        };
        salesList.push(saleItem);

        const yyyy = closedAt.getFullYear();
        const mm = String(closedAt.getMonth() + 1).padStart(2, '0');
        const dd = String(closedAt.getDate()).padStart(2, '0');
        const dateK = `${yyyy}-${mm}-${dd}`;
        const dItem = dailyActivityMap.get(dateK);
        if (dItem) {
          dItem.ventasCount++;
          dItem.sales.push(saleItem);
        }
      }
    });

    // También revisar leads con pipelineStage 'cerrado_ganado' en CRM
    try {
      const closedLeadsSnap = await getDocs(
        query(
          collection(db, 'companies', companyId, 'leads'),
          where('pipelineStage', 'in', ['cerrado_ganado', 'vendido'])
        )
      );
      closedLeadsSnap.docs.forEach((ld) => {
        const lead = ld.data();
        const lNameNorm = normalizeStr(lead.name || '');
        if (lNameNorm.includes('walteros')) return;
        const closedAt = parseDateAny(lead.closedAt || lead.updatedAt || lead.createdAt);
        if (!closedAt) return;
        const resolvedAdv = resolveAdvisor(lead.assignedTo);
        const advId = resolvedAdv ? resolvedAdv.id : (lead.assignedTo || 'unassigned');
        const advName = resolvedAdv ? resolvedAdv.name : 'Asesor';

        const alreadyInList = salesList.some((s) => s.clientName === lead.name);
        if (alreadyInList) return;

        if (closedAt >= startOfMonth && closedAt <= endOfMonth) {
          salesMesByAdvisor.set(advId, (salesMesByAdvisor.get(advId) || 0) + 1);
          const monthSaleItem: SaleReportItem = {
            id: ld.id,
            date: formatDateBogota(closedAt),
            advisorName: advName,
            clientName: lead.name || 'Cliente',
            property: lead.project || lead.metadata?.loteInteres || 'Lote / Inmueble',
            amount: Number(lead.estimatedValue || lead.value) || 0,
          };
          monthSalesList.push(monthSaleItem);
        }
        if (closedAt >= startPeriod && closedAt <= endPeriod) {
          salesSemanaByAdvisor.set(advId, (salesSemanaByAdvisor.get(advId) || 0) + 1);
          const saleItem: SaleReportItem = {
            id: ld.id,
            date: formatDateBogota(closedAt),
            advisorName: advName,
            clientName: lead.name || 'Cliente',
            property: lead.project || lead.metadata?.loteInteres || 'Lote / Inmueble',
            amount: Number(lead.value || lead.dealAmount) || 0,
          };
          salesList.push(saleItem);

          const yyyy = closedAt.getFullYear();
          const mm = String(closedAt.getMonth() + 1).padStart(2, '0');
          const dd = String(closedAt.getDate()).padStart(2, '0');
          const dateK = `${yyyy}-${mm}-${dd}`;
          const dItem = dailyActivityMap.get(dateK);
          if (dItem) {
            dItem.ventasCount++;
            dItem.sales.push(saleItem);
          }
        }
      });
    } catch {
      // Ignorar fallback
    }
  } catch (err) {
    console.warn('[CommercialReports] Error consultando ventas:', err);
  }

  // 8. Construir filas por asesor para la tabla oficial
  const advisorRows: AdvisorReportRow[] = [];
  let totalCaptSemana = 0;
  let totalCaptMes = 0;
  let totalVentasSemana = 0;
  let totalVentasMes = 0;
  let totalClientesConSeguimiento = 0;
  let totalLeadsSemConSeguimiento = 0;
  let totalClientesAnteriores = 0;

  for (const [advId, adv] of advisorsMap.entries()) {
    const captSem = captSemanaMap.get(advId) || 0;
    const captMes = captMesMap.get(advId) || 0;
    const vtasSem = salesSemanaByAdvisor.get(advId) || 0;
    const vtasMes = salesMesByAdvisor.get(advId) || 0;

    const managedClients = advisorManagedClientsMap.get(advId)?.size || 0;
    const newLeadsManaged = advisorNewLeadsManagedMap.get(advId)?.size || 0;
    const oldClientsManaged = advisorOldClientsManagedMap.get(advId)?.size || 0;

    // Inclusión dinámica en la tabla del informe:
    // 1. Asesores activos en la rueda de captación/pauta (receiveLeads = true)
    // 2. Asesores que registran actividad comercial en el período (captación, seguimiento o ventas)
    // 3. Asesores activos creados recientemente (en el mes o período evaluado)
    // 4. Si se está filtrando explícitamente por ese asesor
    const hasActivity =
      captSem > 0 ||
      managedClients > 0 ||
      newLeadsManaged > 0 ||
      oldClientsManaged > 0 ||
      vtasSem > 0 ||
      vtasMes > 0 ||
      (periodType === 'monthly' && captMes > 0);

    const isRecentlyCreatedActive =
      adv.active && !!adv.createdAt && (adv.createdAt >= startOfMonth || adv.createdAt >= startPeriod);

    const isActiveLeadReceiver = adv.active && adv.receiveLeads;
    const isTargetIndividual =
      isIndividual && (advId === targetAdvisorId || isAdvisorMatch(adv.name, targetAdvisorName));

    if (!isActiveLeadReceiver && !hasActivity && !isRecentlyCreatedActive && !isTargetIndividual) {
      continue;
    }

    const coberturaPct = captSem > 0 ? Math.round((newLeadsManaged / captSem) * 100) : 0;
    const avanceMesPct = Math.round((captMes / (targetMonthlyCaptaciones || 100)) * 100);

    // Semáforo Meraki:
    // Reporte mensual: meta 100 captaciones y 3 ventas al mes por asesor
    // Reporte semanal: meta 25 captaciones a la semana
    let statusColor: 'green' | 'yellow' | 'red' = 'yellow';
    if (periodType === 'monthly') {
      if ((captMes >= 100 || avanceMesPct >= Math.round(expectedFraction * 100)) && (vtasMes >= 1 || coberturaPct >= 65)) {
        statusColor = 'green';
      } else if (captMes < 50 || avanceMesPct < 50 || (captMes >= 50 && coberturaPct < 30)) {
        statusColor = 'red';
      } else {
        statusColor = 'yellow';
      }
    } else {
      if (captSem >= 25 && coberturaPct >= 40) {
        statusColor = 'green';
      } else if (captSem < 15 || (captSem >= 20 && coberturaPct < 25)) {
        statusColor = 'red';
      } else {
        statusColor = 'yellow';
      }
    }

    const observations = advisorNotesObservations.get(advId) || [];

    // Detección de patrones repetitivos en las notas
    let patternWarning: string | undefined;
    if (observations.length >= 3) {
      const repeatedWordCounts: Record<string, number> = {};
      observations.forEach((obs) => {
        const words = obs.toLowerCase().split(/\s+/).filter((w) => w.length > 5);
        words.forEach((w) => {
          repeatedWordCounts[w] = (repeatedWordCounts[w] || 0) + 1;
        });
      });
      const mostRepeated = Object.entries(repeatedWordCounts).find(([_, count]) => count >= observations.length * 0.7);
      if (mostRepeated) {
        patternWarning = `Posible uso de plantilla repetida ("${mostRepeated[0]}...")`;
      }
    }

    const periodDocIds = leadsPeriodByAdvisor.get(advId) || new Set<string>();
    const monthDocIds = leadsMonthByAdvisor.get(advId) || new Set<string>();
    const managedDocIds = Array.from(advisorManagedDocIdsMap.get(advId)?.values() || []);
    const oldDocIds = Array.from(advisorOldDocIdsMap.get(advId)?.values() || []);
    const newDocIds = Array.from(advisorNewDocIdsMap.get(advId)?.values() || []);

    const periodLeads = Array.from(periodDocIds)
      .map((docId) => buildAdvisorLeadDetail(docId, advId, adv.name, 'period'))
      .sort((a, b) => b.createdAt - a.createdAt);

    const monthLeads = Array.from(monthDocIds)
      .map((docId) => buildAdvisorLeadDetail(docId, advId, adv.name, 'month'))
      .sort((a, b) => b.createdAt - a.createdAt);

    const managedPeriodLeads = managedDocIds
      .map((docId) => buildAdvisorLeadDetail(docId, advId, adv.name, 'period'))
      .sort((a, b) => (b.lastFollowUpAt || b.createdAt) - (a.lastFollowUpAt || a.createdAt));

    const oldManagedPeriodLeads = oldDocIds
      .map((docId) => buildAdvisorLeadDetail(docId, advId, adv.name, 'period'))
      .sort((a, b) => (b.lastFollowUpAt || b.createdAt) - (a.lastFollowUpAt || a.createdAt));

    const newManagedPeriodLeads = newDocIds
      .map((docId) => buildAdvisorLeadDetail(docId, advId, adv.name, 'period'))
      .sort((a, b) => (b.lastFollowUpAt || b.createdAt) - (a.lastFollowUpAt || a.createdAt));

    advisorRows.push({
      advisorId: advId,
      advisorName: adv.name,
      captSemana: captSem,
      captMes: captMes,
      avanceMesPct,
      ventasSemana: vtasSem,
      ventasMes: vtasMes,
      clientesConSeguimiento: managedClients,
      leadsSemConSeguimiento: newLeadsManaged,
      clientesAnteriores: oldClientsManaged,
      coberturaPct,
      statusColor,
      noteCount: observations.length,
      sampleObservations: observations,
      notePatternWarning: patternWarning,
      periodLeads,
      monthLeads,
      managedPeriodLeads,
      oldManagedPeriodLeads,
      newManagedPeriodLeads,
    });

    totalCaptSemana += captSem;
    totalCaptMes += captMes;
    totalVentasSemana += vtasSem;
    totalVentasMes += vtasMes;
    totalClientesConSeguimiento += managedClients;
    totalLeadsSemConSeguimiento += newLeadsManaged;
    totalClientesAnteriores += oldClientsManaged;
  }

  // Ordenar por captación de la semana descendente, luego captación mes y clientes con seguimiento
  advisorRows.sort(
    (a, b) =>
      b.captSemana - a.captSemana ||
      b.captMes - a.captMes ||
      b.clientesConSeguimiento - a.clientesConSeguimiento
  );

  const allPeriodLeads: AdvisorLeadDetailItem[] = [];
  const allMonthLeads: AdvisorLeadDetailItem[] = [];
  const allManagedPeriodLeads: AdvisorLeadDetailItem[] = [];
  const allOldManagedPeriodLeads: AdvisorLeadDetailItem[] = [];
  const allNewManagedPeriodLeads: AdvisorLeadDetailItem[] = [];
  advisorRows.forEach((r) => {
    if (r.periodLeads) allPeriodLeads.push(...r.periodLeads);
    if (r.monthLeads) allMonthLeads.push(...r.monthLeads);
    if (r.managedPeriodLeads) allManagedPeriodLeads.push(...r.managedPeriodLeads);
    if (r.oldManagedPeriodLeads) allOldManagedPeriodLeads.push(...r.oldManagedPeriodLeads);
    if (r.newManagedPeriodLeads) allNewManagedPeriodLeads.push(...r.newManagedPeriodLeads);
  });
  allPeriodLeads.sort((a, b) => b.createdAt - a.createdAt);
  allMonthLeads.sort((a, b) => b.createdAt - a.createdAt);
  allManagedPeriodLeads.sort((a, b) => (b.lastFollowUpAt || b.createdAt) - (a.lastFollowUpAt || a.createdAt));
  allOldManagedPeriodLeads.sort((a, b) => (b.lastFollowUpAt || b.createdAt) - (a.lastFollowUpAt || a.createdAt));
  allNewManagedPeriodLeads.sort((a, b) => (b.lastFollowUpAt || b.createdAt) - (a.lastFollowUpAt || a.createdAt));

  const totalCoberturaPct =
    totalCaptSemana > 0 ? Math.round((totalLeadsSemConSeguimiento / totalCaptSemana) * 100) : 0;
  const totalAvanceMesPct = Math.round(
    (totalCaptMes / ((targetMonthlyCaptaciones || 100) * (advisorRows.length || 1))) * 100
  );

  const totals: AdvisorReportTotals = {
    captSemana: totalCaptSemana,
    captMes: totalCaptMes,
    avanceMesPct: totalAvanceMesPct,
    expectedMonthPct: Math.round(expectedFraction * 100),
    ventasSemana: totalVentasSemana,
    ventasMes: totalVentasMes,
    clientesConSeguimiento: totalClientesConSeguimiento,
    leadsSemConSeguimiento: totalLeadsSemConSeguimiento,
    clientesAnteriores: totalClientesAnteriores,
    coberturaPct: totalCoberturaPct,
  };

  // 9. Puntos de atención generados mediante análisis cualitativo profundo de fichas y métricas
  const attentionPoints: AttentionPointItem[] = [];

  advisorRows.forEach((row) => {
    const obs = row.sampleObservations || [];
    const hasDetailedNotes = obs.some(
      (o) =>
        o.length > 30 ||
        o.toLowerCase().includes('lote') ||
        o.toLowerCase().includes('propuesta') ||
        o.toLowerCase().includes('visita') ||
        o.toLowerCase().includes('espos') ||
        o.toLowerCase().includes('cita')
    );
    const pendingLeads = Math.max(0, row.captSemana - row.leadsSemConSeguimiento);

    let narrative = '';
    let pType: 'success' | 'warning' | 'danger' | 'info' = 'warning';

    if (row.captSemana === 0 && row.clientesConSeguimiento === 0) {
      narrative = `Sin captaciones ni seguimientos registrados en la semana (${row.captMes} en el acumulado del mes). Requiere activación comercial y acompañamiento para registro de actividad.`;
      pType = 'danger';
    } else if (row.clientesAnteriores >= 10 && row.leadsSemConSeguimiento <= 2) {
      narrative = `Concentró su gestión en reactivar base previa de SmartHome (${row.clientesAnteriores} clientes contactados con llamadas y acuerdos de visita), pero descuidó la entrada fresca: ${row.leadsSemConSeguimiento} de ${row.captSemana} leads nuevos atendidos (${row.coberturaPct}% de cobertura). Tiene ${pendingLeads} prospectos nuevos pendientes de contacto.`;
      pType = 'danger';
    } else if (row.coberturaPct <= 25 && row.captSemana >= 15) {
      narrative = `Baja cobertura en prospectos nuevos (${row.coberturaPct}% con seguimiento, ${row.leadsSemConSeguimiento} de ${row.captSemana}). ${row.clientesAnteriores > 0 ? `Gestionó ${row.clientesAnteriores} clientes antiguos. ` : ''}Quedan ${pendingLeads} prospectos de pauta sin contactar; urge gestión inmediata para evitar que se enfríen.`;
      pType = 'danger';
    } else if (row.coberturaPct >= 70 && row.captSemana >= 5) {
      narrative = `Excelente ritmo de respuesta comercial: ${row.coberturaPct}% de cobertura en leads nuevos (${row.leadsSemConSeguimiento} de ${row.captSemana}). ${hasDetailedNotes ? 'Diligenció fichas con notas de seguimiento individualizadas y oportunas.' : 'Registra bitácoras oportunas de primer contacto.'}`;
      pType = 'success';
    } else if (row.clientesAnteriores >= 20) {
      narrative = `Lideró el volumen de gestión comercial con ${row.clientesConSeguimiento} clientes tocados (${row.clientesAnteriores} de base previa y ${row.leadsSemConSeguimiento} nuevos con ${row.coberturaPct}% de cobertura). Registro continuo de bitácoras por WhatsApp.`;
      pType = 'warning';
    } else if (row.leadsSemConSeguimiento >= 10) {
      narrative = `Buen desempeño en atención a prospectos nuevos: ${row.leadsSemConSeguimiento} leads contactados (${row.coberturaPct}% de cobertura). ${hasDetailedNotes ? 'Fichas técnicas con alto detalle de propuestas comerciales y visitas a terreno.' : 'Seguimiento activo en proceso comercial.'}`;
      pType = 'info';
    } else if (row.coberturaPct >= 30 && row.coberturaPct < 70) {
      narrative = `Avance intermedio con ${row.leadsSemConSeguimiento} de ${row.captSemana} leads nuevos gestionados (${row.coberturaPct}%). ${row.clientesAnteriores > 0 ? `Atendió además ${row.clientesAnteriores} clientes previos. ` : ''}Fichas con notas de seguimiento por llamadas y mensajes; se recomienda acelerar contacto en los ${pendingLeads} restantes.`;
      pType = 'warning';
    } else if (row.captSemana < 5 && row.clientesConSeguimiento > 0) {
      narrative = `Gestión enfocada en ${row.clientesConSeguimiento} clientes de base anterior (${row.clientesAnteriores} clientes con notas de presupuesto y descarte). Baja asignación de leads nuevos (${row.captSemana}) sin seguimiento registrado aún.`;
      pType = 'warning';
    } else {
      narrative = `Registra ${row.captSemana} captaciones y ${row.clientesConSeguimiento} clientes gestionados (${row.coberturaPct}% cobertura). Seguimiento en curso.`;
      pType = 'info';
    }

    if (row.ventasSemana > 0) {
      narrative += ` Aportó ${row.ventasSemana} venta confirmada en la semana (${row.ventasMes} en el mes).`;
    }

    attentionPoints.push({
      advisorName: row.advisorName,
      text: narrative,
      type: pType,
    });
  });

  const periodLabelFinal =
    periodLabel ||
    `${formatDateBogota(startPeriod)} al ${formatDateBogota(endPeriod)} (Corte: ${endPeriod.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })})`;

  const monthLabel = `${MONTH_NAMES[currentMonth]} ${currentYear}`;

  // Resumen bullets
  const topCaptadores = advisorRows
    .filter((a) => a.captSemana >= 25)
    .map((a) => `${a.advisorName} (${a.captSemana})`)
    .join(', ');

  const topVendedores = advisorRows
    .filter((a) => a.ventasSemana > 0)
    .map((a) => `${a.advisorName} (${a.ventasSemana})`)
    .join(', ');

  const topMonthVendedores = advisorRows
    .filter((a) => a.ventasMes > 0)
    .sort((a, b) => b.ventasMes - a.ventasMes)
    .map((a) => `${a.advisorName} (${a.ventasMes})`)
    .join(', ');

  const isMonthlyReport = periodType === 'monthly';

  const summaryBullets = {
    referencia: isMonthlyReport
      ? `Meta mensual de ${targetMonthlyVentas} ventas y ${targetMonthlyCaptaciones} captaciones por asesor (25 captaciones por semana para 100 al mes). Al día ${dayOfMonth} de ${MONTH_NAMES[currentMonth]} lo esperado acumulado es ≈${expectedMonthlyCaptaciones} captaciones y ${expectedMonthlyVentas} ventas.`
      : `Meta mensual de ${targetMonthlyVentas} ventas y ${targetMonthlyCaptaciones} captaciones por asesor ⇒ 25 captaciones por semana (100 al mes). Al día ${dayOfMonth} lo esperado en el mes es ≈${expectedMonthlyCaptaciones} captaciones y ${expectedMonthlyVentas} ventas.`,
    captacion: isMonthlyReport
      ? `${totalCaptSemana} leads únicos captados en el mes de ${MONTH_NAMES[currentMonth]}. ${topCaptadores ? `Mayor captación por asesor: ${topCaptadores}.` : ''}`
      : `${totalCaptSemana} leads nuevos en la semana (acumulado del mes: ${totalCaptMes}). ${topCaptadores ? `Superan las 25 semanales: ${topCaptadores}.` : 'Ningún asesor superó la meta semanal de 25.'}`,
    ventas: isMonthlyReport
      ? `En el mes de ${MONTH_NAMES[currentMonth]} se confirman ${totalVentasMes} ventas cerradas${topMonthVendedores ? `: ${topMonthVendedores}` : ''}.`
      : `${totalVentasSemana} en la semana${topVendedores ? ` (${topVendedores})` : ''}. En el mes van ${totalVentasMes} confirmadas${topMonthVendedores ? `: ${topMonthVendedores}` : ''}.`,
    seguimiento: isMonthlyReport
      ? `${totalClientesConSeguimiento} clientes con gestión comercial real en el mes: ${totalLeadsSemConSeguimiento} son leads del mes y ${totalClientesAnteriores} de meses anteriores. Cobertura comercial del mes: ${totalCoberturaPct}%.`
      : `${totalClientesConSeguimiento} clientes con gestión real: ${totalLeadsSemConSeguimiento} son leads de la semana y ${totalClientesAnteriores} de meses anteriores. De los ${totalCaptSemana} leads nuevos, ${totalCaptSemana - totalLeadsSemConSeguimiento} (${100 - totalCoberturaPct}%) no tienen gestión registrada.`,
  };

  const capturedTotal = leadsPeriodSnap.size || 1;
  const dataQuality: DataQualityMetrics = {
    phonePct: Math.round((withPhone / capturedTotal) * 100),
    emailPct: Math.round((withEmail / capturedTotal) * 100),
    idPct: Math.round((withId / capturedTotal) * 100),
    cityPct: Math.round((withCity / capturedTotal) * 100),
    stagePct: Math.round((withStage / capturedTotal) * 100),
    totalEvaluated: capturedTotal,
  };

  const capturedByDay: CaptacionDayItem[] = Array.from(dailyCaptacionMap.entries()).map(([day, count]) => ({
    day,
    dateStr: day,
    count,
  }));

  const capturedByProject: CaptacionProjectItem[] = Array.from(projectCaptacionMap.entries())
    .map(([project, count]) => ({
      project,
      count,
      percentage: Math.round((count / capturedTotal) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  const capturedBySource: CaptacionSourceItem[] = Array.from(sourceCaptacionMap.entries())
    .map(([source, count]) => ({
      source,
      count,
      percentage: Math.round((count / capturedTotal) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  const recommendations = [
    `Cerrar y actualizar el resultado de los leads que tienen citas o visitas pendientes sin bitácora.`,
    `Acompañar a los asesores con captación en cero para asegurar el registro oportuno de sus jornadas de campo.`,
    `Reforzar el seguimiento inmediato: ${100 - totalCoberturaPct}% de los prospectos nuevos aún no han sido gestionados tras su captación.`,
    `Fomentar la captura de datos complementarios (ciudad y correo) para las campañas de remarketing.`,
  ];

  const criteriosText = `Periodo: ${periodLabelFinal}. Captaciones = registros de la Base de Datos creados en el periodo (${totalCaptSemana} registros); el acumulado del mes suma del 1 al día de corte (${totalCaptMes}). Seguimiento real = bitácora con texto escrito por el asesor (interés, llamada, WhatsApp, invitación, visita, etc.). NO cuentan: "Se agrega el cliente al sistema...", actualizaciones automáticas, cargue o cambio de archivos, cambios de inmueble/precio/ciclo y documentos generados. El seguimiento se asigna al asesor dueño del cliente. Venta = inmueble pasado a "vendido" o "cerrado_ganado" en el periodo. Detalle completo en el anexo Excel.`;

  const dailyActivities = Array.from(dailyActivityMap.values()).sort((a, b) => a.timestamp - b.timestamp);

  // Análisis heurístico del ritmo día a día
  const peakDay = [...dailyActivities].sort((a, b) => b.captacionesCount - a.captacionesCount)[0];
  const peakBitacorasDay = [...dailyActivities].sort((a, b) => b.bitacorasCount - a.bitacorasCount)[0];

  let cronologiaDraft = `En los ${dailyActivities.length} días del período evaluado se registraron ${totalCaptSemana} captaciones y ${totalClientesConSeguimiento} clientes gestionados.`;
  if (peakDay && peakDay.captacionesCount > 0) {
    cronologiaDraft += ` La mayor concentración de prospectos nuevos ocurrió el ${peakDay.dayName} (${peakDay.captacionesCount} registros).`;
  }
  if (peakBitacorasDay && peakBitacorasDay.bitacorasCount > 0) {
    cronologiaDraft += ` La jornada más activa en seguimiento comercial y bitácoras fue el ${peakBitacorasDay.dayName} con ${peakBitacorasDay.bitacorasCount} gestiones realizadas.`;
  }
  if (totalVentasSemana > 0) {
    cronologiaDraft += ` Se reportaron ${totalVentasSemana} cierres de venta confirmados en las jornadas.`;
  }

  // ── AUDITORÍA Y ATRIBUCIÓN DE MARKETING / PAUTAS ──
  function resolveCommercialAdName(l: any): { title: string; subtitle?: string; isMeta: boolean; canalBadge: string } {
    const sm = l.sourceMeta;
    const rawSrc = String(l.source || l.metadata?.fuente || l.metadata?.source || '').toLowerCase();
    const rawCamp = String(l.campaignName || l.campaign || l.metadata?.campaign_name || l.metadata?.ad_name || '').trim();

    if (sm) {
      const headline = String(sm.headline || '').trim();
      const body = String(sm.body || '').trim();
      const firstLine = body.split('\n')[0].replace(/[🌴🏡📄📲💎🇨🇴✨💰]/g, '').trim();

      const isGenericHeadline =
        !headline ||
        headline.toLowerCase().includes('chatea con nosotros') ||
        headline.toLowerCase().includes('registrate') ||
        headline.toLowerCase().includes('regístrate') ||
        headline.toLowerCase().includes('más información') ||
        headline.toLowerCase().includes('enviar mensaje');

      let title = headline;
      let subtitle = firstLine ? firstLine.slice(0, 100) : undefined;

      if (isGenericHeadline && firstLine) {
        if (firstLine.toLowerCase().includes('escrituracion') || firstLine.toLowerCase().includes('escrituración') || firstLine.toLowerCase().includes('lotes tienen')) {
          title = 'Escrituración Individual Inmediata (Sala de Ventas)';
        } else if (firstLine.toLowerCase().includes('30 de octubre') || firstLine.toLowerCase().includes('sala de ventas')) {
          title = 'Apertura Sala de Ventas Casa Club (30 Octubre)';
        } else if (firstLine.toLowerCase().includes('mariquita') || firstLine.toLowerCase().includes('rio claro') || firstLine.toLowerCase().includes('río claro')) {
          title = 'Terrenos en Mariquita desde $129.9M (Río Claro)';
        } else if (firstLine.toLowerCase().includes('cdt')) {
          title = '¿Tienes un CDT? Alternativas de Inversión';
        } else if (firstLine.toLowerCase().includes('ibague') || firstLine.toLowerCase().includes('ibagué') || firstLine.toLowerCase().includes('jornada')) {
          title = 'Gran Jornada de Inversión Ibagué';
        } else {
          title = firstLine.slice(0, 75);
        }
        subtitle = body.slice(0, 140);
      } else if (headline.toLowerCase().includes('cdt')) {
        title = '¿Tienes un CDT? Alternativas de Inversión en Lotes';
      } else if (headline.toLowerCase().includes('mariquita')) {
        title = 'Terrenos en Mariquita desde $129.9M (Río Claro)';
      } else if (headline.toLowerCase().includes('ibague') || headline.toLowerCase().includes('ibagué')) {
        title = 'Gran Jornada de Inversión Ibagué';
      } else if (headline.toLowerCase().includes('alvarado')) {
        title = 'Agenda tu Visita en Alvarado (Lotes Campestres)';
      } else if (headline.toLowerCase().includes('proximo proyecto') || headline.toLowerCase().includes('próximo proyecto')) {
        title = 'Tu Próximo Proyecto en Colombia (Lotes Campestres)';
      } else if (headline.toLowerCase().includes('un espacio para tus planes')) {
        title = 'Un Espacio para tus Planes en Colombia (Desde 300 m²)';
      }

      return { title, subtitle, isMeta: true, canalBadge: 'Meta Ads' };
    }

    const isMeta = rawSrc.includes('meta') || rawSrc.includes('facebook') || rawSrc.includes('instagram') || rawCamp.includes('meta') || rawCamp.includes('pauta');
    const proj = l.project || l.metadata?.project || l.metadata?.loteInteres;
    const fuenteUbi = l.fuenteUbicacion || l.metadata?.fuenteUbicacion;

    let title = rawCamp || proj || fuenteUbi || rawSrc || 'Captación Directa';
    title = title.replace(/\s+\d{4}-\d{2}-\d{2}-[a-f0-9]{20,}/i, '').replace(/^\{\{product\.name\}\}/i, 'Catálogo Dinámico de Lotes').trim();

    let canalBadge = 'Orgánico';
    if (isMeta) canalBadge = 'Meta Ads';
    else if (rawSrc.includes('smarthome') || rawSrc.includes('manual')) canalBadge = 'Trabajo de Campo';
    else if (rawSrc.includes('whatsapp')) canalBadge = 'WhatsApp Directo';
    else if (rawSrc.includes('web')) canalBadge = 'Página Web';

    return { title, isMeta, canalBadge };
  }

  const campaignGroupMap = new Map<string, {
    campaignKey: string;
    campaignName: string;
    subtitle?: string;
    canalBadge: string;
    source: string;
    isPauta: boolean;
    totalLeads: number;
    advisorsCountMap: Map<string, number>;
    conSeguimientoCount: number;
    sinGestionCount: number;
    noContestaCount: number;
    desistidosCount: number;
    ventasCount: number;
    estadosCount: {
      nuevo: number;
      enSeguimiento: number;
      noContesta: number;
      calificadoOVisita: number;
      desistido: number;
      venta: number;
    };
    sampleLeads: Array<{
      leadId: string;
      clientName: string;
      phone: string;
      advisorName: string;
      status: string;
      hasFollowUp: boolean;
      lastFollowUpSummary?: string;
      createdAtFormatted?: string;
      adExcerpt?: string;
    }>;
  }>();

  let totalPeriodLeadsMarketing = 0;
  let totalPautaLeadsMarketing = 0;
  let totalPautaConSeguimiento = 0;

  leadsPeriodSnap.docs.forEach((docSnap) => {
    const l = docSnap.data();
    if (l.disabled) return;

    totalPeriodLeadsMarketing++;

    const adResolution = resolveCommercialAdName(l);
    const campClean = adResolution.title;
    const isPauta = adResolution.isMeta;
    const rawSrc = l.source || l.metadata?.fuente || l.metadata?.source || 'whatsapp';

    if (isPauta) {
      totalPautaLeadsMarketing++;
    }

    const resolvedAdv = resolveAdvisor(l.assignedTo || l.smartHomeAdvisorName);
    const advName = resolvedAdv ? resolvedAdv.name : (l.smartHomeAdvisorName || 'Sin Asignar');

    // Clave unificada del cliente para verificar seguimiento
    const clientPhoneDigits = cleanDigits(l.phone || l.normalizedPhone);
    const clientUniqueKey = clientPhoneDigits ? `phone_${clientPhoneDigits}` : docSnap.id;
    const hasFollowUp = allManagedClientIds.has(clientUniqueKey) || !!l.lastFollowUpSummary;

    if (isPauta && hasFollowUp) {
      totalPautaConSeguimiento++;
    }

    // Clasificación de estado
    const stRaw = normalizeStr(l.status || l.subEstado || '');
    const notesRaw = normalizeStr(l.lastFollowUpSummary || '');
    const fullStat = `${stRaw} ${notesRaw}`.toLowerCase();

    let stCategory: 'nuevo' | 'enSeguimiento' | 'noContesta' | 'calificadoOVisita' | 'desistido' | 'venta' = 'nuevo';
    if (fullStat.includes('vent') || fullStat.includes('cerrad')) {
      stCategory = 'venta';
    } else if (fullStat.includes('desist') || fullStat.includes('cancel') || fullStat.includes('no_interesado')) {
      stCategory = 'desistido';
    } else if (fullStat.includes('no contesta') || fullStat.includes('no_contesta') || fullStat.includes('buzon')) {
      stCategory = 'noContesta';
    } else if (fullStat.includes('visita') || fullStat.includes('agendad') || fullStat.includes('calific')) {
      stCategory = 'calificadoOVisita';
    } else if (hasFollowUp || fullStat.includes('seguimiento') || fullStat.includes('contact')) {
      stCategory = 'enSeguimiento';
    } else {
      stCategory = 'nuevo';
    }

    const campKey = `${campClean}__${adResolution.canalBadge}`;
    if (!campaignGroupMap.has(campKey)) {
      campaignGroupMap.set(campKey, {
        campaignKey: campKey,
        campaignName: campClean,
        subtitle: adResolution.subtitle,
        canalBadge: adResolution.canalBadge,
        source: rawSrc,
        isPauta,
        totalLeads: 0,
        advisorsCountMap: new Map<string, number>(),
        conSeguimientoCount: 0,
        sinGestionCount: 0,
        noContestaCount: 0,
        desistidosCount: 0,
        ventasCount: 0,
        estadosCount: {
          nuevo: 0,
          enSeguimiento: 0,
          noContesta: 0,
          calificadoOVisita: 0,
          desistido: 0,
          venta: 0,
        },
        sampleLeads: [],
      });
    }

    const campItem = campaignGroupMap.get(campKey)!;
    campItem.totalLeads++;
    campItem.advisorsCountMap.set(advName, (campItem.advisorsCountMap.get(advName) || 0) + 1);

    if (hasFollowUp) {
      campItem.conSeguimientoCount++;
    } else {
      campItem.sinGestionCount++;
    }

    campItem.estadosCount[stCategory]++;
    if (stCategory === 'noContesta') campItem.noContestaCount++;
    if (stCategory === 'desistido') campItem.desistidosCount++;
    if (stCategory === 'venta') campItem.ventasCount++;

    const cDate = parseDateAny(l.createdAt);
    if (campItem.sampleLeads.length < 50) {
      campItem.sampleLeads.push({
        leadId: docSnap.id,
        clientName: l.name || l.fullName || 'Cliente',
        phone: l.phone || l.normalizedPhone || 'Sin tel',
        advisorName: advName,
        status: l.status || l.subEstado || 'nuevo',
        hasFollowUp,
        lastFollowUpSummary: l.lastFollowUpSummary || (Array.isArray(l.bitacoras) ? l.bitacoras[0]?.description : undefined),
        createdAtFormatted: cDate ? `${DAYS_ES[cDate.getDay()]} ${cDate.getDate()} ${MONTH_NAMES[cDate.getMonth()].slice(0, 3)}` : undefined,
        adExcerpt: l.sourceMeta?.headline || l.sourceMeta?.body?.slice(0, 90) || campClean,
      });
    }
  });

  const campaignsArray: MarketingCampaignReportItem[] = Array.from(campaignGroupMap.values())
    .map((c) => {
      const advisorsDistribution: MarketingAdvisorAssignment[] = Array.from(c.advisorsCountMap.entries())
        .map(([name, count]) => {
          const advMatch = advisorsList.find((a) => a.name === name);
          return {
            advisorId: advMatch?.id || name,
            advisorName: name,
            count,
            percentage: c.totalLeads > 0 ? Math.round((count / c.totalLeads) * 100) : 0,
          };
        })
        .sort((a, b) => b.count - a.count);

      return {
        campaignKey: c.campaignKey,
        campaignName: c.campaignName,
        subtitle: c.subtitle,
        canalBadge: c.canalBadge,
        source: c.source,
        isPauta: c.isPauta,
        totalLeads: c.totalLeads,
        percentageOfPeriod: totalPeriodLeadsMarketing > 0 ? Math.round((c.totalLeads / totalPeriodLeadsMarketing) * 100) : 0,
        advisorsDistribution,
        conSeguimientoCount: c.conSeguimientoCount,
        sinGestionCount: c.sinGestionCount,
        coberturaPct: c.totalLeads > 0 ? Math.round((c.conSeguimientoCount / c.totalLeads) * 100) : 0,
        noContestaCount: c.noContestaCount,
        desistidosCount: c.desistidosCount,
        ventasCount: c.ventasCount,
        estadosCount: c.estadosCount,
        sampleLeads: c.sampleLeads,
      };
    })
    .sort((a, b) => b.totalLeads - a.totalLeads);

  const topCampaign = campaignsArray[0]?.campaignName || 'N/A';
  const marketingReport: MarketingPeriodReportData = {
    totalLeadsPeriodo: totalPeriodLeadsMarketing,
    totalPautaLeads: totalPautaLeadsMarketing,
    totalOrganicoLeads: totalPeriodLeadsMarketing - totalPautaLeadsMarketing,
    porcentajePauta: totalPeriodLeadsMarketing > 0 ? Math.round((totalPautaLeadsMarketing / totalPeriodLeadsMarketing) * 100) : 0,
    topCampaignName: topCampaign,
    coberturaSeguimientoPautaPct: totalPautaLeadsMarketing > 0 ? Math.round((totalPautaConSeguimiento / totalPautaLeadsMarketing) * 100) : 0,
    campaigns: campaignsArray,
  };

  // ── 9b. CONSULTAR CITAS Y VISITAS DESDE COLECCIÓN APPOINTMENTS ──
  let appointmentsStartSnap: any = { docs: [] };
  let appointmentsCreatedSnap: any = { docs: [] };
  try {
    appointmentsStartSnap = await getDocs(
      query(
        collection(db, 'companies', companyId, 'appointments'),
        where('startTime', '>=', startTs),
        where('startTime', '<=', endTs)
      )
    );
  } catch (err) {
    console.warn('[CommercialReports] Fallback appointments por startTime:', err);
  }

  try {
    appointmentsCreatedSnap = await getDocs(
      query(
        collection(db, 'companies', companyId, 'appointments'),
        where('createdAt', '>=', startTs),
        where('createdAt', '<=', endTs)
      )
    );
  } catch (err) {
    console.warn('[CommercialReports] Fallback appointments por createdAt:', err);
  }

  const rawAppointmentsMap = new Map<string, any>();
  appointmentsStartSnap.docs.forEach((d: any) => rawAppointmentsMap.set(d.id, { id: d.id, ...d.data() }));
  appointmentsCreatedSnap.docs.forEach((d: any) => {
    if (!rawAppointmentsMap.has(d.id)) {
      rawAppointmentsMap.set(d.id, { id: d.id, ...d.data() });
    }
  });

  const rawVisitsAppointments: AppointmentVisitReportItem[] = [];
  const seenApptKeys = new Set<string>();

  for (const [apptId, appt] of rawAppointmentsMap.entries()) {
    // Descartar recordatorios internos automáticos generados por fichas técnicas
    if (appt.isInternalReminder || appt.source === 'ficha_tecnica') continue;

    const sDate = parseDateAny(appt.startTime) || parseDateAny(appt.createdAt);
    if (!sDate) continue;
    if (sDate < startPeriod || sDate > endPeriod) continue;
    // Si la fecha es futura, no se ha realizado
    if (sDate.getTime() > Date.now() + 5 * 60 * 1000) continue;

    const titleLower = (appt.title || '').toLowerCase();
    const descLower = (appt.description || '').toLowerCase();
    const isVisita =
      appt.modality === 'visita_terreno' ||
      titleLower.includes('visita a terreno') ||
      titleLower.includes('visita sala') ||
      titleLower.includes('visita proyecto') ||
      descLower.includes('visita a terreno');

    if (!isVisita) continue;

    const isCompleted =
      appt.status === 'completed' ||
      titleLower.includes('asistió') ||
      titleLower.includes('asistio') ||
      descLower.includes('asistió') ||
      descLower.includes('asistio') ||
      descLower.includes('realizada');

    if (!isCompleted || appt.status === 'canceled' || titleLower.includes('no asist')) continue;

    const resolvedAdv = resolveAdvisor(appt.advisorId);
    const advId = resolvedAdv ? resolvedAdv.id : (appt.advisorId || 'unassigned');
    const advName = resolvedAdv ? resolvedAdv.name : 'Asesor';

    const parsed = parseAppointmentDescription(appt.description);
    const cleanClientPhone = cleanDigits(appt.leadPhone);
    const clientName = appt.leadName || 'Cliente sin nombre';
    const project = appt.project || parsed.project || 'Proyecto Meraki';

    const isSala = titleLower.includes('sala') || descLower.includes('sala');
    const typeLabel = isSala ? 'Visita Sala de Ventas' : 'Visita a Terreno';

    const apptKey = `${cleanClientPhone || appt.leadId || apptId}_visita_${formatDateBogota(sDate)}`;
    if (seenApptKeys.has(apptKey)) continue;
    seenApptKeys.add(apptKey);

    rawVisitsAppointments.push({
      id: apptId,
      leadId: appt.leadId || apptId,
      clientName,
      phone: appt.leadPhone || 'Sin teléfono',
      phoneRaw: cleanClientPhone,
      advisorId: advId,
      advisorName: advName,
      project,
      type: 'visita',
      typeLabel,
      date: sDate.getTime(),
      dateFormatted: formatDateBogotaTime(sDate),
      status: 'Confirmada / Realizada',
      attended: true,
      notes: parsed.notes || appt.title || 'Visita presencial confirmada',
      result: parsed.action || undefined,
      nextAction: appt.title,
      source: 'Agenda CRM Confirmada',
    });
  }

  // Complementar con bitácoras de los leads únicos
  for (const [leadDocId, lead] of uniqueLeadsMap.entries()) {
    const rawBits = [
      ...(Array.isArray(lead.bitacoras) ? lead.bitacoras : []),
      ...(Array.isArray(lead.metadata?.smarthomeBitacoras) ? lead.metadata.smarthomeBitacoras : []),
    ];

    const cleanLeadPhone = cleanDigits(lead.phone || lead.normalizedPhone);
    const clientName = lead.name || lead.fullName || 'Cliente sin registrar';
    const project =
      lead.project ||
      lead.metadata?.['¿qué_proyecto_te_interesa_más?'] ||
      lead.metadata?.loteInteres ||
      lead.metadata?.proyecto ||
      'Proyecto Meraki';

    for (const b of rawBits) {
      const bDateStr = b.fecha || b.date || b.lastDate;
      if (!bDateStr) continue;
      const bDate = parseDateAny(bDateStr);
      if (!bDate || bDate < startPeriod || bDate > endPeriod) continue;

      const check = isConfirmedRealizedVisit(b.action, b.description, bDate.getTime());
      if (!check.isConfirmed) continue;

      const type: 'visita' | 'cita' = 'visita';
      const typeLabel = check.visitType === 'sala' ? 'Visita Sala de Ventas' : 'Visita a Terreno';

      const apptKey = `${cleanLeadPhone || leadDocId}_visita_${formatDateBogota(bDate)}`;
      if (seenApptKeys.has(apptKey)) continue;
      seenApptKeys.add(apptKey);

      const resolvedAdv = resolveAdvisor(b.asesor || lead.assignedTo || lead.smartHomeAdvisorName);
      const advId = resolvedAdv ? resolvedAdv.id : (lead.assignedTo || 'unassigned');
      const advName = resolvedAdv ? resolvedAdv.name : (b.asesor || 'Asesor');

      rawVisitsAppointments.push({
        id: `bit_${leadDocId}_${bDate.getTime()}`,
        leadId: leadDocId,
        clientName,
        phone: lead.phone || lead.normalizedPhone || 'Sin teléfono',
        phoneRaw: cleanLeadPhone,
        advisorId: advId,
        advisorName: advName,
        project,
        type,
        typeLabel,
        date: bDate.getTime(),
        dateFormatted: formatDateBogotaTime(bDate),
        status: 'Confirmada / Realizada',
        attended: true,
        notes: check.cleanNote,
        result: b.action,
        source: 'Bitácora CRM / Ficha Técnica',
      });
    }
  }

  rawVisitsAppointments.sort((a, b) => b.date - a.date);

  // ── 9c. CONSULTAR CANCELACIONES Y PROSPECTOS DESCARTADOS EN EL PERÍODO ──
  const rawCancellations: CancelledLeadItem[] = [];
  const seenCancelLeadIds = new Set<string>();

  for (const [leadDocId, lead] of uniqueLeadsMap.entries()) {
    const rawBits = [
      ...(Array.isArray(lead.bitacoras) ? lead.bitacoras : []),
      ...(Array.isArray(lead.metadata?.smarthomeBitacoras) ? lead.metadata.smarthomeBitacoras : []),
    ];

    const cleanLeadPhone = cleanDigits(lead.phone || lead.normalizedPhone);
    const clientName = lead.name || lead.fullName || 'Cliente sin registrar';
    const project =
      lead.project ||
      lead.metadata?.['¿qué_proyecto_te_interesa_más?'] ||
      lead.metadata?.loteInteres ||
      lead.metadata?.proyecto ||
      'Proyecto Meraki';
    const source = lead.source || lead.metadata?.fuente || 'Sin Fuente';

    let foundBitacoraCancel = false;

    for (const b of rawBits) {
      const bDateStr = b.fecha || b.date || b.lastDate;
      if (!bDateStr) continue;
      const bDate = parseDateAny(bDateStr);
      if (!bDate || bDate < startPeriod || bDate > endPeriod) continue;

      const bAct = (b.action || '').trim();
      const bDesc = (b.description || '').trim();
      const bActLower = bAct.toLowerCase();
      const bDescLower = bDesc.toLowerCase();

      const isCancelAction =
        bActLower.includes('no interesado') ||
        bActLower.includes('no_interesado') ||
        bActLower.includes('descarte') ||
        bActLower.includes('desist') ||
        bActLower.includes('cancel') ||
        bActLower.includes('no le interesa') ||
        bDescLower.includes('no interesado') ||
        bDescLower.includes('sin próximo contacto (no interesado)') ||
        bDescLower.includes('desist');

      if (!isCancelAction) continue;

      const cancelKey = cleanLeadPhone || leadDocId;
      if (seenCancelLeadIds.has(cancelKey)) continue;
      seenCancelLeadIds.add(cancelKey);

      foundBitacoraCancel = true;
      const resolvedAdv = resolveAdvisor(b.asesor || lead.assignedTo || lead.smartHomeAdvisorName);
      const advId = resolvedAdv ? resolvedAdv.id : (lead.assignedTo || 'unassigned');
      const advName = resolvedAdv ? resolvedAdv.name : (b.asesor || 'Asesor');

      const reason = cleanCancellationReason(bAct, bDesc, lead.pipelineStage, lead.motivoDesistimiento);
      const notes = cleanAdvisorWrittenNote(bDesc || bAct);

      rawCancellations.push({
        leadId: leadDocId,
        clientName,
        phone: lead.phone || lead.normalizedPhone || 'Sin teléfono',
        phoneRaw: cleanLeadPhone,
        advisorId: advId,
        advisorName: advName,
        project,
        source,
        cancelledAt: bDate.getTime(),
        cancelledAtFormatted: formatDateBogotaTime(bDate),
        reason,
        notes,
        statusRaw: bAct,
      });
      break;
    }

    if (!foundBitacoraCancel) {
      const st = String(lead.pipelineStage || lead.status || '').toLowerCase();
      if (st.includes('no_interes') || st.includes('desist') || st.includes('lost') || st.includes('cancel')) {
        const lfu = parseDateAny(lead.lastFollowUpAt || lead.updatedAt);
        if (lfu && lfu >= startPeriod && lfu <= endPeriod) {
          const cancelKey = cleanLeadPhone || leadDocId;
          if (!seenCancelLeadIds.has(cancelKey)) {
            seenCancelLeadIds.add(cancelKey);
            const resolvedAdv = resolveAdvisor(lead.lastFollowUpAuthor || lead.assignedTo || lead.smartHomeAdvisorName);
            const advId = resolvedAdv ? resolvedAdv.id : (lead.assignedTo || 'unassigned');
            const advName = resolvedAdv ? resolvedAdv.name : (lead.lastFollowUpAuthor || 'Asesor');

            const reason = cleanCancellationReason(
              lead.lastFollowUpAction,
              lead.lastFollowUpSummary,
              lead.pipelineStage,
              lead.motivoDesistimiento
            );
            const notes = cleanAdvisorWrittenNote(lead.lastFollowUpSummary || lead.lastFollowUpAction || 'Descarte registrado en ficha');

            rawCancellations.push({
              leadId: leadDocId,
              clientName,
              phone: lead.phone || lead.normalizedPhone || 'Sin teléfono',
              phoneRaw: cleanLeadPhone,
              advisorId: advId,
              advisorName: advName,
              project,
              source,
              cancelledAt: lfu.getTime(),
              cancelledAtFormatted: formatDateBogotaTime(lfu),
              reason,
              notes,
              statusRaw: lead.pipelineStage || lead.status,
            });
          }
        }
      }
    }
  }

  rawCancellations.sort((a, b) => b.cancelledAt - a.cancelledAt);

  // Agrupar Cancelaciones por Asesor
  const cancellationsByAdvisorMap = new Map<string, CancelledLeadItem[]>();
  rawCancellations.forEach((item) => {
    if (!cancellationsByAdvisorMap.has(item.advisorId)) {
      cancellationsByAdvisorMap.set(item.advisorId, []);
    }
    cancellationsByAdvisorMap.get(item.advisorId)!.push(item);
  });

  const cancellationsByAdvisor: AdvisorCancellationSummary[] = advisorRows.map((adv) => {
    const items = cancellationsByAdvisorMap.get(adv.advisorId) || [];
    const reasonCounts: Record<string, number> = {};
    items.forEach((it) => {
      reasonCounts[it.reason] = (reasonCounts[it.reason] || 0) + 1;
    });
    const topReasons = Object.entries(reasonCounts)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    return {
      advisorId: adv.advisorId,
      advisorName: adv.advisorName,
      totalCancelled: items.length,
      items,
      topReasons,
    };
  }).sort((a, b) => b.totalCancelled - a.totalCancelled);

  const allReasonsCount: Record<string, number> = {};
  rawCancellations.forEach((it) => {
    allReasonsCount[it.reason] = (allReasonsCount[it.reason] || 0) + 1;
  });
  const reasonsSummary = Object.entries(allReasonsCount)
    .map(([reason, count]) => ({
      reason,
      count,
      percentage: rawCancellations.length > 0 ? Math.round((count / rawCancellations.length) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const cancellationsReport: CancellationsReportData = {
    totalCancelled: rawCancellations.length,
    items: rawCancellations,
    byAdvisor: cancellationsByAdvisor,
    reasonsSummary,
  };

  // Agrupar Visitas y Citas por Asesor
  const visitsByAdvisorMap = new Map<string, AppointmentVisitReportItem[]>();
  rawVisitsAppointments.forEach((item) => {
    if (!visitsByAdvisorMap.has(item.advisorId)) {
      visitsByAdvisorMap.set(item.advisorId, []);
    }
    visitsByAdvisorMap.get(item.advisorId)!.push(item);
  });

  let totalGlobalTerreno = 0;
  let totalGlobalSala = 0;

  const visitsByAdvisor: AdvisorVisitsSummary[] = advisorRows.map((adv) => {
    const items = visitsByAdvisorMap.get(adv.advisorId) || [];
    const visitasTerreno = items.filter((x) => x.typeLabel.toLowerCase().includes('terreno')).length;
    const visitasSala = items.filter((x) => x.typeLabel.toLowerCase().includes('sala')).length;
    totalGlobalTerreno += visitasTerreno;
    totalGlobalSala += visitasSala;

    return {
      advisorId: adv.advisorId,
      advisorName: adv.advisorName,
      totalVisitas: visitasTerreno,
      totalCitas: visitasSala,
      totalGestiones: items.length,
      items,
    };
  }).sort((a, b) => b.totalGestiones - a.totalGestiones);

  const visitsAppointmentsReport: VisitsAppointmentsReportData = {
    totalVisitas: totalGlobalTerreno,
    totalCitas: totalGlobalSala,
    totalTotal: rawVisitsAppointments.length,
    items: rawVisitsAppointments,
    byAdvisor: visitsByAdvisor,
  };

  // ════════════════════════════════════════════════════════════════════════════
  // FILTRADO ESTRICTO INDIVIDUAL (SI EL REPORTE ES PARA UN ASESOR ESPECÍFICO)
  // ════════════════════════════════════════════════════════════════════════════
  let finalAdvisorRows = advisorRows;
  let finalTotals = totals;
  let finalKpis: CommercialReportKPIs = {
    captacionesPeriodo: totalCaptSemana,
    captacionesMes: totalCaptMes,
    ventasPeriodo: totalVentasSemana,
    ventasMes: totalVentasMes,
    clientesConSeguimiento: totalClientesConSeguimiento,
    leadsPeriodoConSeguimiento: totalLeadsSemConSeguimiento,
    coberturaPeriodoPct: totalCoberturaPct,
  };
  let finalPeriodLeads = allPeriodLeads;
  let finalMonthLeads = allMonthLeads;
  let finalManagedPeriodLeads = allManagedPeriodLeads;
  let finalOldManagedPeriodLeads = allOldManagedPeriodLeads;
  let finalNewManagedPeriodLeads = allNewManagedPeriodLeads;
  let finalSalesList = salesList;
  let finalMonthSalesList = monthSalesList;
  let finalAttentionPoints = attentionPoints;
  let finalSummaryBullets = summaryBullets;
  let finalRecommendations = recommendations;
  let finalCapturedByProject = capturedByProject;
  let finalCapturedBySource = capturedBySource;
  let finalDataQuality = dataQuality;
  let finalDailyActivities = dailyActivities;
  let finalMarketingReport: MarketingPeriodReportData | undefined = marketingReport;
  let finalCancellationsReport = cancellationsReport;
  let finalVisitsAppointmentsReport = visitsAppointmentsReport;

  if (isIndividual) {
    const singleRow = advisorRows.find(
      (r) => r.advisorId === targetAdvisorId || isAdvisorMatch(r.advisorName, targetAdvisorName)
    );

    const activeRow: AdvisorReportRow = singleRow || {
      advisorId: targetAdvisorId,
      advisorName: targetAdvisorName,
      captSemana: captSemanaMap.get(targetAdvisorId) || 0,
      captMes: captMesMap.get(targetAdvisorId) || 0,
      avanceMesPct: 0,
      ventasSemana: salesSemanaByAdvisor.get(targetAdvisorId) || 0,
      ventasMes: salesMesByAdvisor.get(targetAdvisorId) || 0,
      clientesConSeguimiento: advisorManagedClientsMap.get(targetAdvisorId)?.size || 0,
      leadsSemConSeguimiento: advisorNewLeadsManagedMap.get(targetAdvisorId)?.size || 0,
      clientesAnteriores: advisorOldClientsManagedMap.get(targetAdvisorId)?.size || 0,
      coberturaPct: 0,
      statusColor: 'yellow',
      noteCount: 0,
      sampleObservations: [],
      periodLeads: [],
      monthLeads: [],
    };

    finalAdvisorRows = [activeRow];

    finalTotals = {
      captSemana: activeRow.captSemana,
      captMes: activeRow.captMes,
      avanceMesPct: activeRow.avanceMesPct,
      expectedMonthPct: Math.round(expectedFraction * 100),
      ventasSemana: activeRow.ventasSemana,
      ventasMes: activeRow.ventasMes,
      clientesConSeguimiento: activeRow.clientesConSeguimiento,
      leadsSemConSeguimiento: activeRow.leadsSemConSeguimiento,
      clientesAnteriores: activeRow.clientesAnteriores,
      coberturaPct: activeRow.coberturaPct,
    };

    finalKpis = {
      captacionesPeriodo: activeRow.captSemana,
      captacionesMes: activeRow.captMes,
      ventasPeriodo: activeRow.ventasSemana,
      ventasMes: activeRow.ventasMes,
      clientesConSeguimiento: activeRow.clientesConSeguimiento,
      leadsPeriodoConSeguimiento: activeRow.leadsSemConSeguimiento,
      coberturaPeriodoPct: activeRow.coberturaPct,
    };

    finalPeriodLeads = activeRow.periodLeads || [];
    finalMonthLeads = activeRow.monthLeads || [];
    finalManagedPeriodLeads = activeRow.managedPeriodLeads || [];
    finalOldManagedPeriodLeads = activeRow.oldManagedPeriodLeads || [];
    finalNewManagedPeriodLeads = activeRow.newManagedPeriodLeads || [];

    finalSalesList = salesList.filter((s) => isAdvisorMatch(s.advisorName, targetAdvisorName));
    finalMonthSalesList = monthSalesList.filter((s) => isAdvisorMatch(s.advisorName, targetAdvisorName));
    finalAttentionPoints = attentionPoints.filter((p) => isAdvisorMatch(p.advisorName, targetAdvisorName));

    finalSummaryBullets = {
      referencia: isMonthlyReport
        ? `Meta mensual de ${targetMonthlyVentas} ventas y ${targetMonthlyCaptaciones} captaciones (25 captaciones por semana para 100 al mes). Al día ${dayOfMonth} de ${MONTH_NAMES[currentMonth]} tu avance es de ${activeRow.captMes} captaciones (${activeRow.avanceMesPct}%) y ${activeRow.ventasMes} ventas.`
        : `Meta semanal de 25 captaciones y mensual de ${targetMonthlyCaptaciones} captaciones y ${targetMonthlyVentas} ventas. Tu avance registrado en la semana es de ${activeRow.captSemana} captaciones y ${activeRow.ventasSemana} ventas.`,
      captacion: isMonthlyReport
        ? `Registras ${activeRow.captMes} captaciones en el mes de ${MONTH_NAMES[currentMonth]} (${activeRow.captSemana} en la semana evaluada).`
        : `Registras ${activeRow.captSemana} leads captados en la semana (${activeRow.captMes} en el acumulado del mes).`,
      ventas: isMonthlyReport
        ? `Registras ${activeRow.ventasMes} ventas confirmadas en el mes.`
        : `Registras ${activeRow.ventasSemana} ventas confirmadas en la semana (${activeRow.ventasMes} en el mes).`,
      seguimiento: isMonthlyReport
        ? `Registras ${activeRow.clientesConSeguimiento} clientes con gestión comercial en el mes (${activeRow.leadsSemConSeguimiento} del mes con ${activeRow.coberturaPct}% de cobertura comercial).`
        : `Registras ${activeRow.clientesConSeguimiento} clientes con gestión real: ${activeRow.leadsSemConSeguimiento} son leads de la semana (${activeRow.coberturaPct}% de cobertura) y ${activeRow.clientesAnteriores} de meses anteriores. Te quedan ${Math.max(0, activeRow.captSemana - activeRow.leadsSemConSeguimiento)} prospectos nuevos pendientes por gestionar.`,
    };

    finalRecommendations = [
      activeRow.coberturaPct < 70
        ? `Priorizar el primer contacto con los ${Math.max(0, activeRow.captSemana - activeRow.leadsSemConSeguimiento)} prospectos nuevos sin seguimiento en la semana para evitar enfriamiento.`
        : `Excelente ritmo de cobertura (${activeRow.coberturaPct}%): mantener la velocidad de contacto en nuevas captaciones.`,
      activeRow.clientesAnteriores > 0
        ? `Avanzar en el cierre y visitas con los ${activeRow.clientesAnteriores} clientes de base anterior contactados.`
        : `Revisar base anterior de SmartHome para reactivar prospectos interesados en lotes.`,
      `Diligenciar notas claras y oportunas en la ficha técnica tras cada llamada o cita.`,
      `Asegurar que cada contacto cuente con teléfono validado y proyecto de interés definido.`,
    ];

    // Recalcular métricas de captación por proyecto y fuente solo de este asesor
    const indProjMap = new Map<string, number>();
    const indSrcMap = new Map<string, number>();
    let indWithPhone = 0;
    let indWithEmail = 0;
    let indWithId = 0;
    let indWithCity = 0;
    let indWithStage = 0;
    const indTotal = finalPeriodLeads.length || 1;

    finalPeriodLeads.forEach((lead) => {
      const proj = lead.project || 'Sin Proyecto';
      indProjMap.set(proj, (indProjMap.get(proj) || 0) + 1);
      const src = lead.source || 'Sin Fuente';
      indSrcMap.set(src, (indSrcMap.get(src) || 0) + 1);

      if (lead.phone && lead.phone !== 'Sin teléfono') indWithPhone++;
      const rawLead = uniqueLeadsMap.get(lead.leadId);
      if (rawLead?.email || rawLead?.metadata?.correo_electrónico) indWithEmail++;
      if (rawLead?.documentNumber || rawLead?.cedula) indWithId++;
      if (rawLead?.city || rawLead?.metadata?.ciudad) indWithCity++;
      if (lead.status) indWithStage++;
    });

    finalCapturedByProject = Array.from(indProjMap.entries()).map(([project, count]) => ({
      project,
      count,
      percentage: Math.round((count / indTotal) * 100),
    })).sort((a, b) => b.count - a.count);

    finalCapturedBySource = Array.from(indSrcMap.entries()).map(([source, count]) => ({
      source,
      count,
      percentage: Math.round((count / indTotal) * 100),
    })).sort((a, b) => b.count - a.count);

    finalDataQuality = {
      phonePct: Math.round((indWithPhone / indTotal) * 100),
      emailPct: Math.round((indWithEmail / indTotal) * 100),
      idPct: Math.round((indWithId / indTotal) * 100),
      cityPct: Math.round((indWithCity / indTotal) * 100),
      stagePct: Math.round((indWithStage / indTotal) * 100),
      totalEvaluated: finalPeriodLeads.length,
    };

    // Desglose día a día filtrado
    finalDailyActivities = dailyActivities.map((day) => {
      const advWork = day.advisorsActive.find(
        (a) => a.advisorId === targetAdvisorId || isAdvisorMatch(a.advisorName, targetAdvisorName)
      );
      const daySales = day.sales.filter((s) => isAdvisorMatch(s.advisorName, targetAdvisorName));
      return {
        ...day,
        captacionesCount: advWork ? advWork.captaciones : 0,
        bitacorasCount: advWork ? advWork.bitacoras : 0,
        ventasCount: daySales.length,
        advisorsActive: advWork ? [advWork] : [],
        sales: daySales,
      };
    });

    // Marketing filtrado
    if (marketingReport) {
      const indCampaigns = marketingReport.campaigns
        .map((c) => {
          const myAssignment = c.advisorsDistribution.find(
            (a) => a.advisorId === targetAdvisorId || isAdvisorMatch(a.advisorName, targetAdvisorName)
          );
          const mySampleLeads = c.sampleLeads.filter((l) => isAdvisorMatch(l.advisorName, targetAdvisorName));
          const myLeadsCount = myAssignment ? myAssignment.count : mySampleLeads.length;
          if (myLeadsCount === 0) return null;

          const myConSeguimiento = mySampleLeads.filter((l) => l.hasFollowUp).length;
          const mySinGestion = myLeadsCount - myConSeguimiento;
          const myCob = myLeadsCount > 0 ? Math.round((myConSeguimiento / myLeadsCount) * 100) : 0;

          return {
            ...c,
            totalLeads: myLeadsCount,
            percentageOfPeriod: finalTotals.captSemana > 0 ? Math.round((myLeadsCount / finalTotals.captSemana) * 100) : 0,
            advisorsDistribution: myAssignment
              ? [myAssignment]
              : [{ advisorId: targetAdvisorId, advisorName: targetAdvisorName, count: myLeadsCount, percentage: 100 }],
            conSeguimientoCount: myConSeguimiento,
            sinGestionCount: mySinGestion,
            coberturaPct: myCob,
            sampleLeads: mySampleLeads,
          };
        })
        .filter((c): c is MarketingCampaignReportItem => c !== null);

      const indTotalPauta = indCampaigns.filter((c) => c.isPauta).reduce((acc, c) => acc + c.totalLeads, 0);
      const indTotalPeriod = indCampaigns.reduce((acc, c) => acc + c.totalLeads, 0);

      finalMarketingReport = {
        ...marketingReport,
        totalLeadsPeriodo: indTotalPeriod,
        totalPautaLeads: indTotalPauta,
        totalOrganicoLeads: Math.max(0, indTotalPeriod - indTotalPauta),
        porcentajePauta: indTotalPeriod > 0 ? Math.round((indTotalPauta / indTotalPeriod) * 100) : 0,
        topCampaignName: indCampaigns[0]?.campaignName || 'N/A',
        campaigns: indCampaigns,
      };
    }

    // Filtrar cancelaciones para el asesor individual
    const indCancellations = rawCancellations.filter(
      (c) => c.advisorId === targetAdvisorId || isAdvisorMatch(c.advisorName, targetAdvisorName)
    );
    const indReasonsCount: Record<string, number> = {};
    indCancellations.forEach((it) => {
      indReasonsCount[it.reason] = (indReasonsCount[it.reason] || 0) + 1;
    });
    const indReasonsSummary = Object.entries(indReasonsCount)
      .map(([reason, count]) => ({
        reason,
        count,
        percentage: indCancellations.length > 0 ? Math.round((count / indCancellations.length) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    finalCancellationsReport = {
      totalCancelled: indCancellations.length,
      items: indCancellations,
      byAdvisor: [
        {
          advisorId: targetAdvisorId,
          advisorName: targetAdvisorName,
          totalCancelled: indCancellations.length,
          items: indCancellations,
          topReasons: indReasonsSummary.map((x) => ({ reason: x.reason, count: x.count })),
        },
      ],
      reasonsSummary: indReasonsSummary,
    };

    // Filtrar visitas y citas para el asesor individual
    const indVisits = rawVisitsAppointments.filter(
      (v) => v.advisorId === targetAdvisorId || isAdvisorMatch(v.advisorName, targetAdvisorName)
    );
    const indTerrenoCount = indVisits.filter((x) => x.typeLabel.toLowerCase().includes('terreno')).length;
    const indSalaCount = indVisits.filter((x) => x.typeLabel.toLowerCase().includes('sala')).length;

    finalVisitsAppointmentsReport = {
      totalVisitas: indTerrenoCount,
      totalCitas: indSalaCount,
      totalTotal: indVisits.length,
      items: indVisits,
      byAdvisor: [
        {
          advisorId: targetAdvisorId,
          advisorName: targetAdvisorName,
          totalVisitas: indTerrenoCount,
          totalCitas: indSalaCount,
          totalGestiones: indVisits.length,
          items: indVisits,
        },
      ],
    };
  }

  const finalTitle = isIndividual
    ? isMonthlyReport
      ? `INFORME MENSUAL DE GESTIÓN COMERCIAL — ${targetAdvisorName.toUpperCase()}`
      : `INFORME SEMANAL DE GESTIÓN COMERCIAL — ${targetAdvisorName.toUpperCase()}`
    : isMonthlyReport
    ? `INFORME MENSUAL DE GESTIÓN COMERCIAL — ASESORES`
    : `INFORME SEMANAL DE GESTIÓN COMERCIAL — ASESORES`;

  const finalCriteriosText = isIndividual
    ? `Periodo: ${periodLabelFinal}. Captaciones = prospectos asignados a ${targetAdvisorName} en la Base de Datos creados en el periodo (${finalTotals.captSemana} registros); el acumulado del mes suma del 1 al día de corte (${finalTotals.captMes}). Seguimiento real = bitácora con texto escrito por el asesor. Venta = inmueble pasado a "vendido" o "cerrado_ganado" en el periodo.`
    : criteriosText;

  return {
    title: finalTitle,
    reportType: 'advisors',
    periodType,
    periodLabel: periodLabelFinal,
    startDate,
    endDate,
    monthStart: startOfMonth.getTime(),
    monthEnd: endOfMonth.getTime(),
    monthLabel,
    preparedBy,
    forRecipient,
    reportDateStr: formatDateBogota(endPeriod),
    kpis: finalKpis,
    summaryBullets: finalSummaryBullets,
    advisorRows: finalAdvisorRows,
    totals: finalTotals,
    allPeriodLeads: finalPeriodLeads,
    allMonthLeads: finalMonthLeads,
    allManagedLeads: finalManagedPeriodLeads,
    allManagedPeriodLeads: finalManagedPeriodLeads,
    allOldManagedPeriodLeads: finalOldManagedPeriodLeads,
    allNewManagedPeriodLeads: finalNewManagedPeriodLeads,
    salesList: finalSalesList,
    monthSalesList: finalMonthSalesList.sort((a, b) => b.date.localeCompare(a.date)),
    salesAccumulatedSummary: (() => {
      const parts: string[] = [];
      finalAdvisorRows.forEach((r) => {
        if (r.ventasMes > 0) parts.push(`${r.advisorName} (${r.ventasMes} ${r.ventasMes === 1 ? 'venta' : 'ventas'})`);
      });
      const breakdown = parts.length > 0 ? `: ${parts.join(', ')}` : '';
      return `Acumulado del mes (${finalTotals.ventasMes} ventas${breakdown}) · ${finalSalesList.length} en la semana evaluada.`;
    })(),
    attentionPoints: finalAttentionPoints,
    recommendations: finalRecommendations,
    criteriosText: finalCriteriosText,
    dailyActivities: finalDailyActivities,
    cronologiaAi: cronologiaDraft,
    capturedByDay,
    capturedByProject: finalCapturedByProject,
    capturedBySource: finalCapturedBySource,
    dataQuality: finalDataQuality,
    marketingReport: finalMarketingReport,
    cancellationsReport: finalCancellationsReport,
    visitsAppointmentsReport: finalVisitsAppointmentsReport,
    isIndividualReport: isIndividual,
    targetAdvisorName: isIndividual ? targetAdvisorName : undefined,
    allAdvisorsList: (() => {
      const activeIds = new Set(advisorRows.map((r) => r.advisorId));
      return advisorsList
        .filter((a) => a.active || activeIds.has(a.id))
        .map((a) => ({ id: a.id, name: a.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    })(),
  };
}

/**
 * Función que invoca a la IA (OpenAI / Gemini vía Cloud Functions) para leer
 * a fondo las observaciones de las bitácoras y redactar los párrafos ejecutivos
 * y los puntos de atención tal como en el informe oficial de Meraki.
 */
export async function enhanceReportWithAi(
  reportData: CommercialExecutiveReportData
): Promise<CommercialExecutiveReportData> {
  try {
    const generateAiReport = httpsCallable<
      { reportData: CommercialExecutiveReportData },
      {
        summaryBullets: CommercialExecutiveReportData['summaryBullets'];
        cronologiaAi?: string;
        attentionPoints: AttentionPointItem[];
        recommendations: string[];
      }
    >(functions, 'generateExecutiveReportWithAi');

    const result = await generateAiReport({ reportData });
    if (result.data) {
      return {
        ...reportData,
        summaryBullets: result.data.summaryBullets || reportData.summaryBullets,
        cronologiaAi: result.data.cronologiaAi || reportData.cronologiaAi,
        attentionPoints: result.data.attentionPoints || reportData.attentionPoints,
        recommendations: result.data.recommendations || reportData.recommendations,
      };
    }
  } catch (err) {
    console.warn('[CommercialReports] AI endpoint no disponible o falló, usando enriquecedor heurístico avanzado:', err);
  }

  // Fallback inteligente: Enriquecer los puntos de atención analizando las observaciones reales
  const isMonthlyReport = reportData.periodType === 'monthly';

  const enrichedAttentionPoints: AttentionPointItem[] = reportData.advisorRows.map((row, index) => {
    const hasTemplate = !!row.notePatternWarning;

    let narrative = '';
    let type: 'success' | 'warning' | 'danger' = 'warning';

    if (isMonthlyReport) {
      // Diagnósticos objetivos para el Informe Mensual (Metas: 100 captaciones, 3 ventas)
      if (row.captMes >= 100 && row.ventasMes >= 1) {
        type = 'success';
        narrative = `Líder comercial del mes: Superó la meta con ${row.captMes} captaciones (meta 100) y registra ${row.ventasMes} venta(s) cerrada(s). Cobertura comercial del ${row.coberturaPct}%.`;
      } else if (row.captMes >= 100) {
        type = 'warning';
        narrative = `Superó la meta de captación mensual con ${row.captMes} registros (meta 100), pero aún no registra ventas cerradas (meta 3). Requiere priorizar cierre comercial. Cobertura: ${row.coberturaPct}%.`;
      } else if (row.ventasMes >= 2) {
        type = 'success';
        narrative = `Efectividad destacada con ${row.ventasMes} ventas cerradas (a 1 de la meta mensual de 3). Acumula ${row.captMes} captaciones con ${row.coberturaPct}% de cobertura.`;
      } else if (row.ventasMes === 1) {
        type = 'warning';
        narrative = `Registra 1 venta cerrada en el mes y ${row.captMes} captaciones (${row.avanceMesPct}% de la meta mensual). Cobertura comercial: ${row.coberturaPct}%.`;
      } else if (row.captMes >= 70 && row.ventasMes === 0) {
        type = 'warning';
        narrative = `Buen volumen de captación (${row.captMes} leads en el mes), pero sin ventas cerradas a la fecha (meta 3). Cobertura: ${row.coberturaPct}%. Acelerar embudo hacia cierre.`;
      } else if (row.captMes < 50 && row.ventasMes === 0) {
        type = 'danger';
        narrative = `Rendimiento crítico en captación con solo ${row.captMes} leads en el mes (frente a meta 100) y 0 ventas. Cobertura: ${row.coberturaPct}%. Requiere intervención inmediata de coordinación.`;
      } else if (row.coberturaPct < 40) {
        type = 'danger';
        narrative = `Baja cobertura comercial en el mes: de sus ${row.captMes} leads captados, solo el ${row.coberturaPct}% tiene seguimiento real registrado.`;
      } else {
        type = 'warning';
        narrative = `Acumula ${row.captMes} captaciones y ${row.clientesConSeguimiento} clientes gestionados en el mes. Cobertura: ${row.coberturaPct}%.`;
      }

      if (hasTemplate) {
        narrative += ` Advertencia: Notas reiterativas con posible uso de plantilla.`;
      }
    } else {
      // Diagnósticos objetivos para el Informe Semanal (Metas: 25 captaciones/semana, 3 ventas/mes)
      if (index === 0 && row.captSemana >= 25 && row.coberturaPct >= 75) {
        type = 'success';
        narrative = `Líder de la semana: ${row.captSemana} captaciones (supera meta de 25) con ${row.coberturaPct}% de cobertura. Registra seguimiento detallado.`;
      } else if (row.captSemana >= 25) {
        type = 'success';
        narrative = `Cumple la meta semanal con ${row.captSemana} captaciones y ${row.coberturaPct}% de cobertura comercial.`;
      } else if (row.captSemana >= 20 && row.coberturaPct <= 30) {
        type = 'warning';
        narrative = `Buen volumen de captación (${row.captSemana} leads), pero baja cobertura (${row.coberturaPct}% con seguimiento). Atención urgente para no enfriar la base.`;
      } else if (row.clientesAnteriores >= 6) {
        type = 'warning';
        narrative = `Gestionó ${row.clientesConSeguimiento} clientes (${row.clientesAnteriores} reactivados de bases anteriores). Cobertura del ${row.coberturaPct}% en leads nuevos.`;
      } else if (row.captSemana === 0 && row.clientesConSeguimiento === 0) {
        type = 'danger';
        narrative = `Sin captaciones ni bitácoras en el período semanal (${row.captMes} acumuladas en el mes).`;
      } else if (row.coberturaPct < 40) {
        type = 'danger';
        narrative = `Baja cobertura en sus leads de la semana (${row.coberturaPct}% con seguimiento registrado).`;
      } else {
        type = 'warning';
        narrative = `Registra ${row.captSemana} captaciones semanales y ${row.clientesConSeguimiento} clientes gestionados.`;
      }

      if (hasTemplate) {
        narrative += ` Advertencia: Frases cortas y reiterativas en sus observaciones.`;
      }
    }

    return {
      advisorName: row.advisorName,
      text: narrative,
      type,
    };
  });

  return {
    ...reportData,
    attentionPoints: enrichedAttentionPoints,
  };
}

/**
 * Genera el archivo Excel / CSV para el anexo de respaldo.
 */
export function exportReportToCsv(reportData: CommercialExecutiveReportData): void {
  const lines: string[] = [];

  // Título
  lines.push(`"${reportData.title}"`);
  lines.push(`"Periodo: ${reportData.periodLabel}"`);
  lines.push(`"Elaborado por: ${reportData.preparedBy} | Fecha: ${reportData.reportDateStr}"`);
  lines.push('');

  // 1. Resumen
  lines.push('"1. RESUMEN EJECUTIVO"');
  lines.push(`"Captaciones del periodo","${reportData.kpis.captacionesPeriodo}"`);
  lines.push(`"Ventas del periodo","${reportData.kpis.ventasPeriodo}"`);
  lines.push(`"Clientes con seguimiento real","${reportData.kpis.clientesConSeguimiento}"`);
  lines.push(`"Cobertura de leads del periodo","${reportData.kpis.coberturaPeriodoPct}%"`);
  lines.push('');

  // 2. Tabla de Asesores
  lines.push('"2. AVANCE POR ASESOR"');
  lines.push(
    '"Asesor","Capt. periodo","Capt. acum. mes","Avance mes","Ventas periodo","Ventas mes","Clientes con seguim.","Leads periodo con seguim.","Clientes anteriores","Cobertura leads %"'
  );

  reportData.advisorRows.forEach((r) => {
    lines.push(
      `"${r.advisorName}","${r.captSemana}","${r.captMes}","${r.avanceMesPct}%","${r.ventasSemana}","${r.ventasMes}","${r.clientesConSeguimiento}","${r.leadsSemConSeguimiento}","${r.clientesAnteriores}","${r.coberturaPct}%"`
    );
  });

  const tot = reportData.totals;
  lines.push(
    `"TOTAL","${tot.captSemana}","${tot.captMes}","${tot.avanceMesPct}%","${tot.ventasSemana}","${tot.ventasMes}","${tot.clientesConSeguimiento}","${tot.leadsSemConSeguimiento}","${tot.clientesAnteriores}","${tot.coberturaPct}%"`
  );
  lines.push('');

  // 3. Atribución de Marketing y Pautas
  if (reportData.marketingReport && reportData.marketingReport.campaigns.length > 0) {
    lines.push('"3. ATRIBUCIÓN DE MARKETING Y PAUTAS PUBLICITARIAS DEL PERIODO"');
    lines.push(
      '"Pauta / Campaña","Canal / Fuente","Leads Ingresados","% del Periodo","Asesores Asignados","Con Seguimiento","Sin Gestión","Cobertura %","No Contesta"'
    );
    reportData.marketingReport.campaigns.forEach((c) => {
      const advString = c.advisorsDistribution.map((a) => `${a.advisorName} (${a.count})`).join('; ');
      lines.push(
        `"${c.campaignName}","${c.source}","${c.totalLeads}","${c.percentageOfPeriod}%","${advString}","${c.conSeguimientoCount}","${c.sinGestionCount}","${c.coberturaPct}%","${c.noContestaCount}"`
      );
    });
    lines.push('');
  }

  // 4. Ventas
  lines.push('"4. VENTAS DEL PERIODO"');
  lines.push('"Fecha","Asesor","Cliente","Inmueble / Lote"');
  if (reportData.salesList.length === 0) {
    lines.push('"Sin ventas registradas en el período","","",""');
  } else {
    reportData.salesList.forEach((s) => {
      lines.push(`"${s.date}","${s.advisorName}","${s.clientName}","${s.property}"`);
    });
  }
  lines.push('');

  // 5. Puntos de atención
  lines.push('"5. PUNTOS DE ATENCIÓN"');
  reportData.attentionPoints.forEach((p) => {
    lines.push(`"${p.advisorName}","${p.text.replace(/"/g, '""')}"`);
  });
  lines.push('');

  // 6. Cancelaciones y Prospectos Descartados
  if (reportData.cancellationsReport && reportData.cancellationsReport.items.length > 0) {
    lines.push('"6. CANCELACIONES Y PROSPECTOS DESCARTADOS DEL PERIODO"');
    lines.push('"Fecha","Asesor","Cliente","Teléfono","Proyecto","Motivo Descarte","Observaciones / Notas del Asesor"');
    reportData.cancellationsReport.items.forEach((c) => {
      lines.push(
        `"${c.cancelledAtFormatted}","${c.advisorName}","${c.clientName}","${c.phone}","${c.project || 'Sin Proyecto'}","${c.reason}","${c.notes.replace(/"/g, '""')}"`
      );
    });
    lines.push('');
  }

  // 7. Visitas a Terreno y Citas Comerciales
  if (reportData.visitsAppointmentsReport && reportData.visitsAppointmentsReport.items.length > 0) {
    lines.push('"7. VISITAS A TERRENO Y CITAS COMERCIALES DEL PERIODO"');
    lines.push('"Fecha","Asesor","Cliente","Teléfono","Proyecto","Tipo de Gestión","Estado","Lo que Escribió el Asesor en Ficha Técnica"');
    reportData.visitsAppointmentsReport.items.forEach((v) => {
      lines.push(
        `"${v.dateFormatted}","${v.advisorName}","${v.clientName}","${v.phone}","${v.project || 'Sin Proyecto'}","${v.typeLabel}","${v.status}","${v.notes.replace(/"/g, '""')}"`
      );
    });
    lines.push('');
  }

  const csvContent = '\uFEFF' + lines.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Informe_Gestion_Comercial_${reportData.reportDateStr.replace(/\//g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Formatea el informe en texto con emojis para enviar por WhatsApp.
 */
export function formatReportForWhatsApp(reportData: CommercialExecutiveReportData): string {
  const k = reportData.kpis;
  let text = `📊 *${reportData.title}*\n`;
  text += `📅 *Periodo:* ${reportData.periodLabel}\n`;
  text += `👤 *Elaborado por:* ${reportData.preparedBy}\n\n`;

  text += `*1. RESUMEN DE LA SEMANA*\n`;
  text += `▪️ *Captaciones:* ${k.captacionesPeriodo} (Acumulado mes: ${k.captacionesMes})\n`;
  text += `▪️ *Ventas:* ${k.ventasPeriodo} en la semana (${k.ventasMes} en el mes)\n`;
  text += `▪️ *Clientes con seguimiento real:* ${k.clientesConSeguimiento}\n`;
  text += `▪️ *Cobertura leads de la semana:* ${k.coberturaPeriodoPct}%\n\n`;

  text += `*2. AVANCE POR ASESOR (Top Captadores & Ventas)*\n`;
  reportData.advisorRows.slice(0, 6).forEach((r) => {
    const semaforo = r.statusColor === 'green' ? '🟢' : r.statusColor === 'yellow' ? '🟡' : '🔴';
    text += `${semaforo} *${r.advisorName}:* ${r.captSemana} captaciones | ${r.ventasSemana} ventas | ${r.coberturaPct}% cobertura\n`;
  });
  text += `\n`;

  if (reportData.salesList.length > 0) {
    text += `*3. VENTAS DE LA SEMANA*\n`;
    reportData.salesList.forEach((s) => {
      text += `🏡 *${s.advisorName}* → ${s.clientName} (${s.property})\n`;
    });
    text += `\n`;
  }

  if (reportData.marketingReport && reportData.marketingReport.campaigns.length > 0) {
    text += `*PAUTAS & MARKETING DEL PERÍODO*\n`;
    text += `📢 *Total Pauta:* ${reportData.marketingReport.totalPautaLeads} leads (${reportData.marketingReport.porcentajePauta}% del total) | Cobertura: ${reportData.marketingReport.coberturaSeguimientoPautaPct}%\n`;
    reportData.marketingReport.campaigns.slice(0, 3).forEach((c) => {
      text += `🎯 *${c.campaignName}:* ${c.totalLeads} leads → ${c.conSeguimientoCount} con seguimiento (${c.coberturaPct}%)\n`;
    });
    text += `\n`;
  }

  text += `*5. PUNTOS DE ATENCIÓN CLAVE*\n`;
  reportData.attentionPoints.slice(0, 4).forEach((p) => {
    text += `▪️ *${p.advisorName}:* ${p.text}\n`;
  });
  text += `\n`;

  if (reportData.cancellationsReport && reportData.cancellationsReport.totalCancelled > 0) {
    text += `*6. CANCELACIONES & DESCARTES DEL PERÍODO (${reportData.cancellationsReport.totalCancelled})*\n`;
    reportData.cancellationsReport.byAdvisor
      .filter((a) => a.totalCancelled > 0)
      .slice(0, 5)
      .forEach((a) => {
        const topR = a.topReasons[0] ? ` (Motivo: ${a.topReasons[0].reason})` : '';
        text += `❌ *${a.advisorName}:* ${a.totalCancelled} descartados${topR}\n`;
      });
    text += `\n`;
  }

  if (reportData.visitsAppointmentsReport && reportData.visitsAppointmentsReport.totalTotal > 0) {
    const va = reportData.visitsAppointmentsReport;
    text += `*7. VISITAS & CITAS DEL PERÍODO (${va.totalVisitas} visitas a terreno | ${va.totalCitas} citas)*\n`;
    va.byAdvisor
      .filter((a) => a.totalGestiones > 0)
      .slice(0, 5)
      .forEach((a) => {
        text += `🏡 *${a.advisorName}:* ${a.totalVisitas} visitas a terreno / sala | ${a.totalCitas} citas comerciales\n`;
      });
    text += `\n`;
  }

  text += `_Grupo Constructor Meraki — "Nunca nos cansaremos de mejorar para ti."_`;
  return text;
}
