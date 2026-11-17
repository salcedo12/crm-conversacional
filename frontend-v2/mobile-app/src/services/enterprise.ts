import firestore, { type FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import storage from '@react-native-firebase/storage';
import { Share, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import type { Lead, WhatsAppTemplate } from '../types';

const fn = getFunctions(undefined, 'us-central1');
const call = <TInput, TResult>(name: string) => httpsCallable<TInput, TResult>(fn, name);

function snapExists(snap: { exists: boolean | (() => boolean) }): boolean {
  return typeof snap.exists === 'function' ? snap.exists() : Boolean(snap.exists);
}

// ── Normalización de Proyectos Meraki (idéntica a DatabasePage.tsx) ──────────
export function normalizeProject(raw: unknown): string {
  if (!raw) return 'Sin especificar';
  const s = String(raw)
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (s.includes('arizona') || s.includes('canon') || s.includes('canion')) return 'Cañón de Arizona';
  if (s.includes('llano grande') || s.includes('llanogrande')) return 'Llano Grande';
  if (
    s.includes('tres') ||
    s.includes('los 3') ||
    s.includes('varios') ||
    (s.includes('melgar') && s.includes('mariquita')) ||
    (s.includes('melgar') && s.includes('alvarado')) ||
    (s.includes('alvarado') && s.includes('mariquita')) ||
    s.includes('diferentes ubicaciones') ||
    s.includes('todos')
  ) {
    return 'Portafolio (Varios Proyectos)';
  }
  if (s.includes('laguna') || s.includes('santorini') || s.includes('canarias') || s.includes('melgar') || s.includes('bungalow')) {
    return 'Laguna Mar';
  }
  if (s.includes('rio claro') || s.includes('mariquita')) return 'Río Claro';
  if (s.includes('montana') || s.includes('montanas') || s.includes('alvarado') || s.includes('al varado')) {
    return 'Sobre Montañas (Alvarado)';
  }
  if (s.includes('campestre') || s.includes('lote') || s.includes('terreno') || s.includes('vivienda')) {
    return 'Proyecto General';
  }
  return String(raw).trim() || 'Sin especificar';
}

export const MERAKI_PROJECTS = [
  'Laguna Mar',
  'Río Claro',
  'Sobre Montañas (Alvarado)',
  'Cañón de Arizona',
  'Llano Grande',
  'Proyectos de Ibagué',
];

// ── Exportar y Compartir CSV en Dispositivo Móvil ────────────────────────────
export async function shareCsvFile(filename: string, csvContent: string): Promise<void> {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const fsAny = FileSystem as any;
  const dir = fsAny.cacheDirectory || fsAny.documentDirectory;
  if (dir) {
    const uri = `${dir}${safeName}`;
    await fsAny.writeAsStringAsync?.(uri, '\uFEFF' + csvContent, {
      encoding: fsAny.EncodingType?.UTF8 || 'utf8',
    });
    await Share.share(
      Platform.OS === 'ios'
        ? { url: uri, title: safeName }
        : { message: csvContent, url: uri, title: safeName }
    );
  } else {
    await Share.share({ message: csvContent, title: safeName });
  }
}

// ── 1. DASHBOARD & METRICS ───────────────────────────────────────────────────
export interface AiInsights {
  analyzedCount: number;
  avgScore: number;
  temperature: { hot: number; warm: number; cold: number };
  lostTotal: number;
  lostAnalyzed: number;
  lossReasons: { category: string; count: number }[];
}

export interface DashboardMetrics {
  totalLeads: number;
  inboxBreakdown?: {
    central317Count: number;
    advisorDirectCount: number;
    reactivatedCount: number;
    allContactsTotal: number;
  };
  leadsByStatus: { status: string; count: number }[];
  leadsBySource: { source: string; count: number }[];
  firstTouchBySource?: { source: string; count: number }[];
  leadsByProject?: { project: string; count: number }[];
  leadsByAdvisor: { advisorId: string | null; name: string; count: number }[];
  appointments: { total: number; upcoming: number; completed: number; canceled: number };
  appointmentsByAdvisor: {
    advisorId: string | null;
    name: string;
    total: number;
    upcoming: number;
    completed: number;
    canceled: number;
  }[];
  conversionRate: number;
  newLeads7d: number;
  newLeads30d: number;
  dailyNewLeads: { date: string; count: number }[];
  aiInsights: AiInsights;
  generatedAt: number;
  month?: string;
  label?: string;
  defaultMonth?: string;
  availableMonths?: { key: string; label: string; count: number; group?: string }[];
  monthsData?: Record<string, DashboardMetrics>;
  databaseStats?: {
    totalContacts: number;
    migratedSmarthome: number;
    pautaTotal: number;
    activeAdvisorsAssigned: number;
    unassignedOrFormer: number;
  };
}

export async function getDashboardMetrics(companyId: string, refresh?: boolean): Promise<DashboardMetrics> {
  try {
    const r = await call<{ companyId: string; refresh?: boolean }, DashboardMetrics>('getDashboardMetrics')({
      companyId,
      refresh,
    });
    return r.data;
  } catch (err) {
    const snap = await firestore()
      .collection('companies')
      .doc(companyId)
      .collection('reportCache')
      .doc('dashboard__all')
      .get();
    if (snapExists(snap)) {
      const data = snap.data();
      if (data?.payload) return data.payload as DashboardMetrics;
    }
    throw err;
  }
}

export async function generateLossInsight(
  companyId: string
): Promise<{ insight: string; basedOn: number; generatedAt: number }> {
  const r = await call<{ companyId: string }, { insight: string; basedOn: number; generatedAt: number }>(
    'generateLossInsight'
  )({ companyId });
  return r.data;
}

export async function exportLeadsReport(
  companyId: string,
  inbox: 'all' | 'central_317' | 'advisor_direct' = 'all'
): Promise<{ downloadUrl: string; fileName: string; rowCount: number }> {
  const r = await call<
    { companyId: string; inbox?: string; includeArchived?: boolean },
    { downloadUrl: string; fileName: string; rowCount: number }
  >('exportLeadsReport')({ companyId, inbox, includeArchived: true });
  return r.data;
}

// ── 2. PIPELINE / KANBAN (12 Etapas) ─────────────────────────────────────────
export type PipelineGroup = 'captacion' | 'linea' | 'cierre' | 'no_interesado';

export interface PipelineStageConfig {
  id: string;
  label: string;
  group: PipelineGroup;
  probability: number | null;
  probabilityLabel: string;
  accentColor: string;
}

export const PIPELINE_GROUPS: Record<PipelineGroup, { label: string; color: string }> = {
  captacion: { label: '1. Captación', color: '#3b82f6' },
  linea: { label: '2. En Línea', color: '#f59e0b' },
  cierre: { label: '3. Cierre', color: '#10b981' },
  no_interesado: { label: '4. No Interesado', color: '#ef4444' },
};

export const PIPELINE_STAGES: PipelineStageConfig[] = [
  { id: 'prospecto', label: 'Prospecto', group: 'captacion', probability: 5, probabilityLabel: '5%', accentColor: '#3b82f6' },
  { id: 'contactado', label: 'Contactado', group: 'captacion', probability: 10, probabilityLabel: '10%', accentColor: '#06b6d4' },
  { id: 'envio_info', label: 'Envío de Info', group: 'captacion', probability: 20, probabilityLabel: '20%', accentColor: '#0284c7' },
  { id: 'cita', label: 'Cita', group: 'linea', probability: 35, probabilityLabel: '35%', accentColor: '#f59e0b' },
  { id: 'cotizacion', label: 'Cotización', group: 'linea', probability: 50, probabilityLabel: '50%', accentColor: '#f97316' },
  { id: 'visita_realizada', label: 'Visita Realizada', group: 'linea', probability: 65, probabilityLabel: '65%', accentColor: '#eab308' },
  { id: 'negociacion', label: 'Negociación', group: 'cierre', probability: 75, probabilityLabel: '75%', accentColor: '#14b8a6' },
  { id: 'documentacion', label: 'Documentación', group: 'cierre', probability: 85, probabilityLabel: '85%', accentColor: '#10b981' },
  { id: 'firma', label: 'Firma / Separación', group: 'cierre', probability: 100, probabilityLabel: '100%', accentColor: '#22c55e' },
  { id: 'no_interesado_ubicacion', label: 'No Interesado: Ubicación', group: 'no_interesado', probability: null, probabilityLabel: 'Descarte', accentColor: '#ef4444' },
  { id: 'no_interesado_dinero', label: 'No Interesado: Dinero', group: 'no_interesado', probability: null, probabilityLabel: 'Descarte', accentColor: '#f43f5e' },
  { id: 'no_interesado_otra', label: 'No Interesado: Otra Razón', group: 'no_interesado', probability: null, probabilityLabel: 'Descarte', accentColor: '#71717a' },
];

export function getStageConfig(stageId: string): PipelineStageConfig {
  return PIPELINE_STAGES.find((s) => s.id === stageId) || PIPELINE_STAGES[0];
}

export function derivePipelineStage(data: Record<string, any>): PipelineStageConfig {
  if (typeof data.pipelineStage === 'string') {
    const existing = PIPELINE_STAGES.find((s) => s.id === data.pipelineStage);
    if (existing) return existing;
  }
  const status = String(data.status || '').toLowerCase();
  const meta = (data.metadata || {}) as Record<string, any>;
  const ciclo = String(meta.smarthomeCicloVenta || '').toUpperCase();
  const etapa = String(meta.smarthomeEstadoSeguimiento || '').toUpperCase();

  if (status === 'closed' || ciclo.includes('CIERRE') || ciclo.includes('COMPRO') || etapa.includes('COMPRO')) return getStageConfig('firma');
  if (ciclo.includes('DOCUMENTACION') || etapa.includes('DOCUMENTACION') || etapa.includes('CREDITO')) return getStageConfig('documentacion');
  if (ciclo.includes('NEGOCIACION') || etapa.includes('NEGOCIACION') || etapa.includes('SEPARACION')) return getStageConfig('negociacion');
  if (status === 'lost' || ciclo.includes('CANCELADO') || ciclo.includes('DESISTIMIENTO') || etapa.includes('DESISTIMIENTO')) {
    const reason = String(meta.smarthomeMotivo || data.lossReason || '').toLowerCase();
    if (reason.includes('ubicacion') || reason.includes('lejos') || reason.includes('distancia')) return getStageConfig('no_interesado_ubicacion');
    if (reason.includes('dinero') || reason.includes('presupuesto') || reason.includes('precio') || reason.includes('caro')) return getStageConfig('no_interesado_dinero');
    return getStageConfig('no_interesado_otra');
  }
  if (ciclo.includes('VISITO') || ciclo.includes('SALA') || etapa.includes('VISITA')) return getStageConfig('visita_realizada');
  if (ciclo.includes('COTIZACION') || etapa.includes('COTIZACION')) return getStageConfig('cotizacion');
  if (status === 'scheduled' || ciclo.includes('CITA') || etapa.includes('CITA')) return getStageConfig('cita');
  if (ciclo.includes('EN LINEA') || status === 'qualified') return getStageConfig('envio_info');
  if (status === 'active' || ciclo.includes('CONTACTADO') || data.lastInboundAt || data.lastMessageAt) return getStageConfig('contactado');
  return getStageConfig('prospecto');
}

export interface PipelineCardItem {
  id: string;
  name: string;
  phone: string;
  email?: string;
  project: string;
  sector?: string;
  cupo?: string;
  advisorId: string;
  advisorName: string;
  source: string;
  sourceLabel: string;
  stageId: string;
  stageLabel: string;
  group: PipelineGroup;
  probability: number | null;
  probabilityLabel: string;
  createdAtText: string;
  createdMonthYear: string;
  score: number;
  lastBitacora?: string;
  lastBitacoraDate?: string;
  rawLead?: Record<string, any>;
}

export interface PipelineFilterOptions {
  advisorId?: string;
  projectFilter?: string;
  groupFilter?: PipelineGroup | 'all';
  sourceFilter?: string;
  followUpStatus?: 'all' | 'uncontacted' | 'overdue' | 'active';
  dateRange?: 'all' | 'last_30_days' | 'last_60_days' | 'year_2026' | 'year_2025' | 'year_2024';
  limitCount?: number;
}

function parseAnyDate(ts: any): Date | null {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (typeof ts === 'object' && ('_seconds' in ts || 'seconds' in ts)) {
    return new Date((ts._seconds ?? ts.seconds) * 1000);
  }
  if (typeof ts === 'string' || typeof ts === 'number') {
    const d = new Date(String(ts).trim().replace(' ', 'T'));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

export async function fetchPipelineCards(
  companyId: string,
  opts: PipelineFilterOptions = {}
): Promise<{
  cards: PipelineCardItem[];
  advisors: { id: string; name: string }[];
  byProject: Record<string, number>;
}> {
  const advisorId = opts.advisorId || 'all';
  const projectFilter = opts.projectFilter || 'all';
  const groupFilter = opts.groupFilter || 'all';
  const sourceFilter = opts.sourceFilter || 'all';
  const followUpStatus = opts.followUpStatus || 'all';
  const dateRange = opts.dateRange || 'all';
  const maxLimit = Math.min(Math.max(opts.limitCount || 250, 50), 1000);

  const advMap = new Map<string, string>();
  const advisors: { id: string; name: string }[] = [];
  try {
    const usersSnap = await firestore().collection('companies').doc(companyId).collection('users').get();
    usersSnap.docs.forEach((d) => {
      const u = d.data();
      const name = u.displayName || u.email || d.id;
      advMap.set(d.id, name);
      advisors.push({ id: d.id, name });
    });
  } catch {}

  const docsMap = new Map<string, any>();
  const leadsCol = firestore().collection('companies').doc(companyId).collection('leads');

  if (advisorId !== 'all') {
    try {
      const snap = await leadsCol.where('assignedTo', '==', advisorId).limit(Math.min(maxLimit, 100)).get();
      snap.docs.forEach((d) => docsMap.set(d.id, d));
    } catch {}
  } else {
    try {
      const snap = await leadsCol.orderBy('updatedAt', 'desc').limit(Math.min(maxLimit, 100)).get();
      snap.docs.forEach((d) => docsMap.set(d.id, d));
    } catch {
      try {
        const snap = await leadsCol.limit(Math.min(maxLimit, 80)).get();
        snap.docs.forEach((d) => docsMap.set(d.id, d));
      } catch {}
    }
  }

  const cards: PipelineCardItem[] = [];
  const byProject: Record<string, number> = {};
  const now = Date.now();

  docsMap.forEach((d) => {
    const data = d.data() || {};
    const meta = (data.metadata || {}) as Record<string, any>;
    const rawAssigned = data.assignedTo as string | undefined;
    const advisorName = (rawAssigned && advMap.get(rawAssigned)) || meta.smarthomeAsesorOriginal || 'Sin Asignar';
    const rawProj =
      (Array.isArray(data.projectInterest) ? data.projectInterest[0] : data.projectInterest) ||
      meta.smarthomeProyectoOriginal ||
      meta.webArea ||
      data.project ||
      '';
    const projName = normalizeProject(rawProj);
    byProject[projName] = (byProject[projName] || 0) + 1;

    const specificFuente = String(data.fuenteUbicacion || meta.smarthomeFuenteOriginal || '').trim();
    let sourceLabel = specificFuente || String(data.source || 'Directo');
    let sourceCategory = 'otro';
    if (data.source === 'meta_ads' || specificFuente.toLowerCase().includes('pauta')) {
      sourceCategory = 'meta_ads';
      if (!specificFuente) sourceLabel = 'PAUTA WHATSAPP 317';
    } else if (data.source === 'advisor_whatsapp' || data.inbox === 'advisor_direct') {
      sourceCategory = 'advisor_whatsapp';
      if (!specificFuente) sourceLabel = 'WhatsApp Asesor';
    } else if (data.source === 'web' || specificFuente.toLowerCase().includes('web')) {
      sourceCategory = 'web';
      if (!specificFuente) sourceLabel = 'Página Web';
    } else if (meta.migratedFrom === 'smarthome_excel_base_31' || data.smartHomeCustomerId) {
      sourceCategory = 'smarthome';
      if (!specificFuente) sourceLabel = 'Trabajo de campo';
    } else if (data.inbox === 'central_317' || data.source === 'whatsapp') {
      sourceCategory = 'whatsapp_ia';
      if (!specificFuente) sourceLabel = 'Línea WhatsApp 317';
    }

    const cDate = parseAnyDate(data.createdAt);
    const cYear = cDate ? cDate.getFullYear() : null;
    const ageDays = cDate ? Math.floor((now - cDate.getTime()) / 86_400_000) : 999;
    const monthLabel = cDate
      ? `Registro de ${cDate.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })}`
      : 'Sin fecha registrada';
    const dateStr = cDate
      ? cDate.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
      : '—';

    const isUncontacted = !data.lastMessageAt && !data.lastFollowUpAt && !data.advisorFirstContactAt;
    const nextDateMillis = data.nextFollowUpDate ? Date.parse(String(data.nextFollowUpDate).replace(' ', 'T')) : null;
    const isOverdue = !!nextDateMillis && !isNaN(nextDateMillis) && nextDateMillis < now;
    const isActiveFollowUp = !!nextDateMillis && !isNaN(nextDateMillis) && nextDateMillis >= now;

    if (advisorId !== 'all' && rawAssigned !== advisorId) return;
    if (projectFilter !== 'all' && projName !== projectFilter) return;
    if (sourceFilter !== 'all' && sourceCategory !== sourceFilter && !specificFuente.toLowerCase().includes(sourceFilter.toLowerCase())) return;
    if (followUpStatus === 'uncontacted' && !isUncontacted) return;
    if (followUpStatus === 'overdue' && !isOverdue) return;
    if (followUpStatus === 'active' && !isActiveFollowUp) return;
    if (dateRange === 'last_30_days' && ageDays > 30) return;
    if (dateRange === 'last_60_days' && ageDays > 60) return;
    if (dateRange === 'year_2026' && cYear !== 2026) return;
    if (dateRange === 'year_2025' && cYear !== 2025) return;
    if (dateRange === 'year_2024' && cYear !== 2024) return;

    const stageConfig = derivePipelineStage(data);
    if (groupFilter !== 'all' && stageConfig.group !== groupFilter) return;

    const bitacoras = (data.bitacoras || meta.smarthomeBitacoras) as Array<any> | undefined;
    const latestBitacora = Array.isArray(bitacoras) && bitacoras.length > 0 ? bitacoras[0] : null;

    cards.push({
      id: d.id,
      name: data.name || 'Cliente Sin Nombre',
      phone: data.phone || '',
      email: data.email || '',
      project: projName,
      sector: meta.smarthomeSector || meta.smarthomeEtapaOriginal || '',
      cupo: meta.smarthomeModuloOriginal || 'cupo1',
      advisorId: rawAssigned || '',
      advisorName,
      source: data.source || 'desconocido',
      sourceLabel,
      stageId: stageConfig.id,
      stageLabel: stageConfig.label,
      group: stageConfig.group,
      probability: stageConfig.probability,
      probabilityLabel: stageConfig.probabilityLabel,
      createdAtText: dateStr,
      createdMonthYear: monthLabel,
      score: typeof data.leadScore === 'number' ? data.leadScore : data.aiAnalysis?.score || (data.aiAnalysis?.temperature === 'hot' ? 85 : 0),
      lastBitacora: latestBitacora ? `${latestBitacora.action ? latestBitacora.action + ': ' : ''}${latestBitacora.description || ''}` : undefined,
      lastBitacoraDate: latestBitacora?.lastDate || latestBitacora?.fecha,
      rawLead: data,
    });
  });

  return { cards, advisors, byProject };
}

export async function updateLeadPipelineStage(
  companyId: string,
  leadId: string,
  newStageId: string,
  authorName = 'Asesor'
): Promise<void> {
  const stage = getStageConfig(newStageId);
  let statusUpdate: string | undefined;
  if (stage.id === 'firma') statusUpdate = 'closed';
  else if (stage.group === 'no_interesado') statusUpdate = 'lost';
  else if (stage.id === 'cita' || stage.id === 'visita_realizada') statusUpdate = 'scheduled';
  else if (stage.group === 'linea') statusUpdate = 'qualified';
  else if (stage.id === 'contactado' || stage.id === 'envio_info') statusUpdate = 'active';

  const leadRef = firestore().collection('companies').doc(companyId).collection('leads').doc(leadId);
  await leadRef.update({
    pipelineStage: stage.id,
    pipelineGroup: stage.group,
    pipelineProbability: stage.probability,
    pipelineStageLabel: stage.label,
    ...(statusUpdate ? { status: statusUpdate } : {}),
    updatedAt: firestore.FieldValue.serverTimestamp(),
  });

  await leadRef
    .collection('notes')
    .add({
      companyId,
      leadId,
      authorName,
      kind: 'note',
      text: `📊 Movido en Embudo de Ventas: ${stage.label} (${stage.probabilityLabel}) [Fase: ${PIPELINE_GROUPS[stage.group].label}]`,
      type: 'pipeline_stage_change',
      newStage: stage.id,
      newStageLabel: stage.label,
      createdAt: firestore.Timestamp.now(),
    })
    .catch(() => {});
}

// ── 3. GESTIÓN COMERCIAL & METAS / RANKING ───────────────────────────────────
export interface CommercialLeadItem {
  id: string;
  name: string;
  phone: string;
  project: string;
  advisorId: string;
  advisorName: string;
  pipelineStage: string;
  pipelineStageLabel: string;
  status: string;
  source: string;
  fuenteUbicacion?: string;
  hasFicha: boolean;
  lastFollowUpDate?: string | null;
  lastFollowUpAction?: string | null;
  lastFollowUpAuthor?: string | null;
  lastFollowUpSummary?: string | null;
  nextFollowUpDate?: string | null;
  nextFollowUpAction?: string | null;
  isOverdue: boolean;
  isToday: boolean;
  isUpcoming: boolean;
  isPeriodCreated?: boolean;
  hadPeriodFollowUp?: boolean;
  missingPeriodFollowUp?: boolean;
  createdAt?: any;
  lastMessageAt?: any;
  updatedAt?: any;
  bitacorasCount: number;
  metadata?: Record<string, any>;
  bitacoras?: any[];
}

export interface CommercialKPIs {
  missingFollowUpCount: number;
  overdueCount: number;
  todayCount: number;
  missingFichaCount: number;
  upcomingCount: number;
  completedThisMonthCount: number;
  cancelledCount?: number;
  closedCount?: number;
  totalLeads: number;
}

export interface CommercialSuggestion {
  id: string;
  type: 'urgent' | 'today' | 'missing_ficha' | 'stalled' | 'missing_followup';
  title: string;
  description: string;
  count: number;
  actionFilter: 'urgent' | 'today' | 'missing' | 'stalled' | 'missing_followup';
}

/**
 * Retorna la fecha y hora de inicio de la semana comercial activa de Meraki:
 * El viernes anterior más reciente a las 09:00:00 a. m.
 */
export function getCommercialWeekStart(now: Date = new Date()): Date {
  const currentDay = now.getDay();
  const rawDiff = (currentDay + 2) % 7;
  const daysSinceFriday = rawDiff === 0 ? 7 : rawDiff;
  const lastFriday = new Date(now);
  lastFriday.setDate(now.getDate() - daysSinceFriday);
  lastFriday.setHours(9, 0, 0, 0);
  return lastFriday;
}

function normalizeFollowUpStr(s: string): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Bitácora que deja el sistema al aprobar o solicitar un traslado de prospecto
 * ("Traslado Aprobado", "traslado_comercial", "Traslado comercial: <motivo>").
 * No es una gestión comercial del asesor.
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

export function isRealCommercialFollowUp(action?: string | null, text?: string | null): boolean {
  const rawAction = String(action ?? '').trim();
  const rawText = String(text ?? '').trim();
  if (!rawAction && !rawText) return false;

  // El traslado aprobado no cuenta como seguimiento del asesor que recibe el prospecto.
  if (isTransferBitacora(rawAction, rawText)) return false;

  const aNorm = normalizeFollowUpStr(rawAction);
  const dNorm = normalizeFollowUpStr(rawText);

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

  if (!dNorm || dNorm.length < 4) return false;

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

  return true;
}

export function isAdvisorMatch(rawA?: unknown, rawB?: unknown): boolean {
  if (!rawA || !rawB) return false;
  const a = normalizeFollowUpStr(String(rawA));
  const b = normalizeFollowUpStr(String(rawB));
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const stopWords = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'san', 'santa']);
  const wordsA = a.split(' ').filter((w) => w.length > 2 && !stopWords.has(w));
  const wordsB = b.split(' ').filter((w) => w.length > 2 && !stopWords.has(w));
  if (wordsA.length === 0 || wordsB.length === 0) return false;
  if (wordsA[0] === wordsB[0]) {
    const restA = wordsA.slice(1);
    const restB = wordsB.slice(1);
    if (restA.some((wa) => restB.includes(wa))) return true;
  }
  const common = wordsA.filter((wa) => wordsB.includes(wa));
  return common.length >= 2;
}

/**
 * Determina si un prospecto pertenece a la cartera del asesor consultado.
 *
 * REGLA DE NEGOCIO ESTRICTA:
 * Si un prospecto se reasigna, el ÚNICO que puede verlo y gestionarlo es el asesor
 * actualmente asignado (assignedTo / advisorId). Aunque se haya reasignado varias veces
 * o tenga bitácoras de otros asesores en su historial, la pertenencia es exclusiva del
 * asesor actual.
 */
export function leadBelongsToAdvisor(
  lead: Record<string, any>,
  targetAdvisorId?: string,
  targetAdvisorName?: string
): boolean {
  if (!targetAdvisorId || targetAdvisorId === 'all') return true;

  // 1. REGLA ESTRICTA DE ASIGNACIÓN ACTUAL POR ID:
  const currentAssignedId = lead.assignedTo || lead.advisorId || '';
  if (currentAssignedId) {
    return currentAssignedId === targetAdvisorId;
  }

  // 2. Si el prospecto NO tiene ID asignado (casos legacy de importación o sin UID):
  if (targetAdvisorName) {
    const currentName = lead.assignedToName || lead.smartHomeAdvisorName || lead.advisorName || '';
    if (currentName && isAdvisorMatch(currentName, targetAdvisorName)) {
      return true;
    }
  }

  return false;
}

function mapDocToCommercialLeadItem(
  docId: string,
  data: Record<string, any>,
  advMap: Map<string, string>,
  now: Date,
  weekStart: Date = getCommercialWeekStart(now),
  startDate?: Date | null,
  endDate?: Date | null
) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const isHistorical = startDate === null && endDate === null;
  const activeStart = isHistorical ? null : (startDate || weekStart);
  const activeEnd = isHistorical ? null : (endDate || now);

  const stageConfig = derivePipelineStage(data);
  const rawCombinedBitacoras = [
    ...(Array.isArray(data.bitacoras) ? data.bitacoras : []),
    ...(Array.isArray(data.metadata?.smarthomeBitacoras) ? data.metadata.smarthomeBitacoras : []),
    ...(Array.isArray(data.smarthomeBitacoras) ? data.smarthomeBitacoras : []),
  ];
  const seenBitKeys = new Set<string>();
  const rawBitacoras: any[] = [];
  for (const b of rawCombinedBitacoras) {
    if (!b || typeof b !== 'object') continue;
    const k = `${String(b.action || '').trim()}|${String(b.description || '').trim()}|${String(b.fecha || b.lastDate || '').slice(0, 16)}`;
    if (!seenBitKeys.has(k)) {
      seenBitKeys.add(k);
      rawBitacoras.push(b);
    }
  }
  const hasBitacoras = rawBitacoras.length > 0;
  const hasExplicitFollowUp = !!data.lastFollowUpAt || !!data.lastFollowUpAction || !!data.smartHomeLastBitacoraAt;
  const hasFicha = hasBitacoras || hasExplicitFollowUp || !!data.metadata?.hasFicha;

  const nextDateStr: string | null = data.nextFollowUpDate || data.metadata?.nextFollowUpDate || null;
  let isOverdue = false;
  let isToday = false;
  let isUpcoming = false;
  if (nextDateStr) {
    const parsedNext = parseAnyDate(nextDateStr);
    if (parsedNext) {
      if (parsedNext < startOfToday) isOverdue = true;
      else if (parsedNext <= endOfToday) isToday = true;
      else isUpcoming = true;
    }
  }

  // Comprobar captación y seguimiento de la semana comercial activa o período seleccionado
  const createdDate = parseAnyDate(data.createdAt);
  const assignedDate = parseAnyDate(data.advisorAssignedAt);
  const transferDate = parseAnyDate(data.transferDate);

  let isPeriodCreated = false;
  if (isHistorical) {
    isPeriodCreated = true;
  } else if (activeStart && activeEnd) {
    isPeriodCreated =
      (createdDate ? (createdDate >= activeStart && createdDate <= activeEnd) : false) ||
      (assignedDate ? (assignedDate >= activeStart && assignedDate <= activeEnd) : false) ||
      (transferDate ? (transferDate >= activeStart && transferDate <= activeEnd) : false) ||
      !!data.isPeriodCreated ||
      !!data.isPeriodAssigned;
  }

  const activeEndWithTolerance = activeEnd ? new Date(activeEnd.getTime() + 6 * 3600 * 1000) : null;
  let hadPeriodFollowUp = false;

  if (isHistorical) {
    hadPeriodFollowUp = hasFicha;
  } else if (activeStart && activeEndWithTolerance) {
    for (const b of rawBitacoras) {
      const bDate = parseAnyDate(b.fecha || b.lastDate || b.date);
      if (bDate && bDate >= activeStart && bDate <= activeEndWithTolerance) {
        if (isRealCommercialFollowUp(b.action, b.description)) {
          hadPeriodFollowUp = true;
          break;
        }
      }
    }

    if (!hadPeriodFollowUp && (data.lastFollowUpAt || data.smartHomeLastBitacoraAt)) {
      const lfuDate = parseAnyDate(data.lastFollowUpAt || data.smartHomeLastBitacoraAt);
      if (lfuDate && lfuDate >= activeStart && lfuDate <= activeEndWithTolerance) {
        const action = data.lastFollowUpAction || data.smartHomeLastActionLabel || '';
        const desc = (data.lastFollowUpSummary || data.smartHomeLastBitacoraText || data.lastFollowUpAction || '').trim();
        if (isRealCommercialFollowUp(action, desc)) {
          hadPeriodFollowUp = true;
        }
      }
    }
  }

  const rawStatus = String(data.status || '').toLowerCase();
  const isLost =
    rawStatus === 'lost' ||
    rawStatus === 'cancelado' ||
    rawStatus === 'cancelled' ||
    rawStatus === 'desistimiento' ||
    rawStatus === 'no_interesado' ||
    stageConfig.group === 'no_interesado';
  const isClosed = data.status === 'closed' || stageConfig.id === 'firma';
  const missingPeriodFollowUp = isPeriodCreated && !hadPeriodFollowUp && !isLost && !isClosed;

  const completedThisMonth = hadPeriodFollowUp;

  let lastSummary: string | null = null;
  let lastAction: string | null = data.lastFollowUpAction || null;
  let lastAuthor: string | null = null;
  if (hasBitacoras && rawBitacoras[0]) {
    const b0 = rawBitacoras[0];
    lastAction = lastAction || b0.action || 'Gestión';
    lastSummary = b0.description || b0.action || null;
    lastAuthor = b0.asesor || null;
  }

  const bitacoraDate = (hasBitacoras && rawBitacoras[0])
    ? parseAnyDate(rawBitacoras[0].fecha || rawBitacoras[0].lastDate || rawBitacoras[0].date)
    : null;
  const lfuDate = parseAnyDate(data.lastFollowUpAt);
  const lastDate = bitacoraDate || lfuDate;

  const advisorName = advMap.get(data.assignedTo) || data.assignedToName || data.smartHomeAdvisorName || 'Sin asignar';

  const item: CommercialLeadItem = {
    id: docId,
    name: data.name || data.clientName || data.fullName || `Lead ${data.phone || ''}`,
    phone: data.phone || data.normalizedPhone || 'Sin teléfono',
    project: normalizeProject(data.projectInterest?.[0] || data.metadata?.project || data.project),
    advisorId: data.assignedTo || '',
    advisorName,
    pipelineStage: stageConfig.id,
    pipelineStageLabel: stageConfig.label,
    status: data.status || 'new',
    source: data.source || data.metadata?.fuente || data.metadata?.source || 'manual',
    fuenteUbicacion: data.fuenteUbicacion || data.metadata?.fuenteUbicacion || 'Directo',
    hasFicha,
    lastFollowUpDate: lastDate
      ? lastDate.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
      : null,
    lastFollowUpAction: lastAction,
    lastFollowUpAuthor: lastAuthor,
    lastFollowUpSummary: lastSummary,
    nextFollowUpDate: nextDateStr,
    nextFollowUpAction: data.nextFollowUpAction || data.metadata?.nextFollowUpAction || null,
    isOverdue,
    isToday,
    isUpcoming,
    isPeriodCreated,
    hadPeriodFollowUp,
    missingPeriodFollowUp,
    createdAt: data.createdAt,
    lastMessageAt: data.lastMessageAt || null,
    updatedAt: data.updatedAt || null,
    bitacorasCount: rawBitacoras.length,
    metadata: data.metadata || {},
    bitacoras: rawBitacoras,
  };

  return { item, isOverdue, isToday, isUpcoming, hasFicha, completedThisMonth, missingPeriodFollowUp };
}

export async function fetchCommercialManagementData(
  companyId: string,
  targetAdvisorId = 'all',
  pageSize = 50,
  startAfterDoc: FirebaseFirestoreTypes.QueryDocumentSnapshot | null = null,
  isUserAdmin = false,
  currentUserId?: string,
  startDate?: Date | null,
  endDate?: Date | null
) {
  const effectiveAdvisorId = isUserAdmin ? targetAdvisorId : currentUserId || targetAdvisorId || '';
  const advMap = new Map<string, string>();
  const advisorsList: { id: string; name: string }[] = [];

  try {
    const usersSnap = await firestore().collection('companies').doc(companyId).collection('users').get();
    usersSnap.docs.forEach((d) => {
      const u = d.data();
      const name = u.displayName || u.name || u.email || d.id;
      advMap.set(d.id, name);
      advisorsList.push({ id: d.id, name });
    });
  } catch {}

  const effectiveAdvName = effectiveAdvisorId ? (advMap.get(effectiveAdvisorId) || '') : '';
  const now = new Date();
  const weekStart = getCommercialWeekStart(now);

  const isHistorical = startDate === null && endDate === null;
  const effectiveStart = isHistorical ? null : (startDate || weekStart);
  const effectiveEnd = isHistorical ? null : (endDate || now);

  const allDocsMap = new Map<string, FirebaseFirestoreTypes.QueryDocumentSnapshot>();

  // 1. Si hay un rango de fechas definido, consultar en paralelo:
  // A. Leads creados en el período (Captaciones)
  // B. Leads asignados o trasladados en el período
  // C. Leads con último seguimiento (lastFollowUpAt) en el período
  if (!isHistorical && effectiveStart && effectiveEnd) {
    const startTs = firestore.Timestamp.fromDate(effectiveStart);
    const endTs = firestore.Timestamp.fromDate(effectiveEnd);

    try {
      const periodQueries = [
        firestore().collection('companies').doc(companyId).collection('leads').where('createdAt', '>=', startTs).where('createdAt', '<=', endTs).get(),
        firestore().collection('companies').doc(companyId).collection('leads').where('advisorAssignedAt', '>=', startTs).where('advisorAssignedAt', '<=', endTs).get(),
        firestore().collection('companies').doc(companyId).collection('leads').where('lastFollowUpAt', '>=', startTs).where('lastFollowUpAt', '<=', endTs).get(),
      ];

      const results = await Promise.allSettled(periodQueries);
      results.forEach((res: any) => {
        if (res.status === 'fulfilled' && res.value?.docs) {
          res.value.docs.forEach((d: any) => {
            allDocsMap.set(d.id, d);
          });
        }
      });
    } catch (err) {
      console.warn('[mobile enterprise] Error consultando período:', err);
    }
  }

  // 2. Consulta regular paginada de leads
  let q: FirebaseFirestoreTypes.Query = firestore().collection('companies').doc(companyId).collection('leads');
  if (effectiveAdvisorId && effectiveAdvisorId !== 'all') {
    q = q.where('assignedTo', '==', effectiveAdvisorId);
  }

  let docs: FirebaseFirestoreTypes.QueryDocumentSnapshot[] = [];
  try {
    let qOrdered = q.orderBy('updatedAt', 'desc');
    if (startAfterDoc) {
      qOrdered = qOrdered.startAfter(startAfterDoc);
    }
    qOrdered = qOrdered.limit(pageSize);
    const snap = await qOrdered.get();
    docs = snap.docs;
  } catch {
    try {
      let qFallback = q.orderBy('lastMessageAt', 'desc');
      if (startAfterDoc) {
        qFallback = qFallback.startAfter(startAfterDoc);
      }
      qFallback = qFallback.limit(pageSize);
      const snap = await qFallback.get();
      docs = snap.docs;
    } catch {
      try {
        let qPlain = q;
        if (startAfterDoc) {
          qPlain = qPlain.startAfter(startAfterDoc);
        }
        qPlain = qPlain.limit(pageSize);
        const snap = await qPlain.get();
        docs = snap.docs;
      } catch {}
    }
  }

  const lastVisibleDoc = docs.length > 0 ? docs[docs.length - 1] : null;
  const hasMore = docs.length === pageSize;

  for (const d of docs) {
    if (!allDocsMap.has(d.id)) {
      allDocsMap.set(d.id, d);
    }
  }

  // 3. Filtrar estrictamente por asesor
  const rawDocs = Array.from(allDocsMap.values());
  const finalDocs = rawDocs.filter((docSnap) => {
    if (effectiveAdvisorId && effectiveAdvisorId !== 'all') {
      return leadBelongsToAdvisor(docSnap.data() || {}, effectiveAdvisorId, effectiveAdvName);
    }
    return true;
  });

  const leads: CommercialLeadItem[] = [];
  let missingFollowUpCount = 0;
  let overdueCount = 0;
  let todayCount = 0;
  let missingFichaCount = 0;
  let upcomingCount = 0;
  let completedThisMonthCount = 0;
  let cancelledCount = 0;
  let closedCount = 0;

  for (const docSnap of finalDocs) {
    const mapped = mapDocToCommercialLeadItem(docSnap.id, docSnap.data() || {}, advMap, now, weekStart, startDate, endDate);
    const isLost = mapped.item.status === 'lost';
    const isClosed = mapped.item.status === 'closed';

    if (isLost) {
      cancelledCount++;
    } else if (isClosed) {
      closedCount++;
    } else {
      if (mapped.missingPeriodFollowUp) missingFollowUpCount++;
      if (mapped.isOverdue) overdueCount++;
      else if (mapped.isToday) todayCount++;
      else if (mapped.isUpcoming) upcomingCount++;
      if (!mapped.hasFicha) missingFichaCount++;
      if (mapped.completedThisMonth) completedThisMonthCount++;
    }
    leads.push(mapped.item);
  }

  leads.sort((a, b) => {
    const aInactive = a.status === 'lost' || a.status === 'closed';
    const bInactive = b.status === 'lost' || b.status === 'closed';
    if (aInactive && !bInactive) return 1;
    if (!aInactive && bInactive) return -1;

    // Prioridad 1: Prospectos de la semana sin seguimiento comercial
    if (a.missingPeriodFollowUp && !b.missingPeriodFollowUp) return -1;
    if (!a.missingPeriodFollowUp && b.missingPeriodFollowUp) return 1;

    // Prioridad 2: Vencidos
    if (a.isOverdue && !b.isOverdue) return -1;
    if (!a.isOverdue && b.isOverdue) return 1;

    // Prioridad 3: Para hoy
    if (a.isToday && !b.isToday) return -1;
    if (!a.isToday && b.isToday) return 1;

    // Prioridad 4: Sin ficha técnica
    if (!a.hasFicha && b.hasFicha) return -1;
    if (a.hasFicha && !b.hasFicha) return 1;

    return 0;
  });

  const suggestions: CommercialSuggestion[] = [];
  if (missingFollowUpCount > 0) {
    suggestions.push({
      id: 'sug-missing-followup',
      type: 'missing_followup',
      title: `${missingFollowUpCount} prospecto${missingFollowUpCount > 1 ? 's' : ''} de la semana sin seguimiento`,
      description: 'Captados en la semana comercial activa sin llamadas ni bitácoras de gestión.',
      count: missingFollowUpCount,
      actionFilter: 'missing_followup',
    });
  }
  if (overdueCount > 0) {
    suggestions.push({
      id: 'sug-overdue',
      type: 'urgent',
      title: `${overdueCount} seguimiento${overdueCount > 1 ? 's' : ''} vencido${overdueCount > 1 ? 's' : ''}`,
      description: 'Fecha límite expirada. Recontáctalos cuanto antes para no enfriar el interés.',
      count: overdueCount,
      actionFilter: 'urgent',
    });
  }
  if (todayCount > 0) {
    suggestions.push({
      id: 'sug-today',
      type: 'today',
      title: `${todayCount} contacto${todayCount > 1 ? 's' : ''} para hoy`,
      description: 'Tienes acuerdos de llamadas, citas o cotizaciones programados para hoy.',
      count: todayCount,
      actionFilter: 'today',
    });
  }
  if (missingFichaCount > 0) {
    suggestions.push({
      id: 'sug-missing',
      type: 'missing_ficha',
      title: `${missingFichaCount} sin primera ficha técnica`,
      description: 'Registra acuerdos o resumen inicial en la bitácora de estos prospectos.',
      count: missingFichaCount,
      actionFilter: 'missing',
    });
  }

  return {
    leads,
    kpis: {
      missingFollowUpCount,
      overdueCount,
      todayCount,
      missingFichaCount,
      upcomingCount,
      completedThisMonthCount,
      cancelledCount,
      closedCount,
      totalLeads: leads.length,
    },
    suggestions,
    advisors: advisorsList,
    lastVisibleDoc,
    hasMore,
  };
}

export async function searchCommercialLeads(
  companyId: string,
  searchTerm: string,
  targetAdvisorId = 'all',
  isUserAdmin = false,
  currentUserId?: string
): Promise<CommercialLeadItem[]> {
  const term = searchTerm.trim();
  if (!term || !companyId) return [];
  const effectiveAdvisorId = isUserAdmin ? targetAdvisorId : currentUserId || targetAdvisorId || '';

  const advMap = new Map<string, string>();
  try {
    const usersSnap = await firestore().collection('companies').doc(companyId).collection('users').get();
    usersSnap.docs.forEach((d) => {
      const u = d.data();
      advMap.set(d.id, u.displayName || u.name || u.email || d.id);
    });
  } catch {}

  const leadCol = firestore().collection('companies').doc(companyId).collection('leads');
  const docsMap = new Map<string, Record<string, any>>();
  const cleanDigits = term.replace(/\D/g, '');

  if (cleanDigits.length >= 3) {
    const promises: Promise<any>[] = [];
    if (cleanDigits.length >= 7) {
      const tail = cleanDigits.slice(-10);
      promises.push(leadCol.where('phoneTail', '==', tail).limit(25).get());
      promises.push(leadCol.where('normalizedPhone', '==', `+57${tail}`).limit(25).get());
      promises.push(leadCol.where('normalizedPhone', '==', `+${cleanDigits}`).limit(25).get());
      promises.push(leadCol.where('phone', '==', `+57${tail}`).limit(25).get());
      promises.push(leadCol.where('phone', '==', tail).limit(25).get());
      promises.push(leadCol.where('phone', '==', `+${cleanDigits}`).limit(25).get());
    } else {
      promises.push(
        leadCol
          .where('phone', '>=', `+57${cleanDigits}`)
          .where('phone', '<=', `+57${cleanDigits}\uf8ff`)
          .limit(25)
          .get()
      );
    }
    const snaps = await Promise.allSettled(promises);
    snaps.forEach((r) => {
      if (r.status === 'fulfilled') {
        r.value.docs.forEach((d: any) => docsMap.set(d.id, { id: d.id, ...d.data() }));
      }
    });
  }

  if (cleanDigits.length < 10) {
    const variations = Array.from(
      new Set([
        term,
        term.toLowerCase(),
        term.toUpperCase(),
        term.charAt(0).toUpperCase() + term.slice(1).toLowerCase(),
      ])
    );
    const snaps = await Promise.allSettled(
      variations.map((v) =>
        leadCol.where('name', '>=', v).where('name', '<=', v + '\uf8ff').limit(25).get()
      )
    );
    snaps.forEach((r) => {
      if (r.status === 'fulfilled') {
        r.value.docs.forEach((d: any) => docsMap.set(d.id, { id: d.id, ...d.data() }));
      }
    });
  }

  let rawList = Array.from(docsMap.values());
  if (effectiveAdvisorId && effectiveAdvisorId !== 'all') {
    rawList = rawList.filter((d) => d.assignedTo === effectiveAdvisorId);
  }
  const now = new Date();
  return rawList.map((d) => mapDocToCommercialLeadItem(d.id, d, advMap, now).item);
}

export async function registerQuickNoContesto(
  companyId: string,
  lead: CommercialLeadItem,
  authorName = 'Asesor'
) {
  const now = new Date();
  const nowFormatted = new Date(now.getTime() - 5 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const nextDate = new Date();
  if ((nextDate.getHours() >= 16 && nextDate.getMinutes() >= 30) || nextDate.getHours() >= 17) {
    nextDate.setDate(nextDate.getDate() + 1);
    nextDate.setHours(9, 30, 0, 0);
  } else {
    nextDate.setHours(nextDate.getHours() + 3);
  }
  const yyyy = nextDate.getFullYear();
  const mm = String(nextDate.getMonth() + 1).padStart(2, '0');
  const dd = String(nextDate.getDate()).padStart(2, '0');
  const hh = String(nextDate.getHours()).padStart(2, '0');
  const min = String(nextDate.getMinutes()).padStart(2, '0');
  const nextDateFormatted = `${yyyy}-${mm}-${dd} ${hh}:${min}`;

  const bitacoraEntry = {
    fecha: nowFormatted,
    action: 'Llamada telefónica: No contestó',
    description: `Intento de llamada de seguimiento sin respuesta por ${authorName}. Reintento agendado automáticamente para ${nextDateFormatted}.`,
    asesor: authorName,
    lastDate: nowFormatted,
  };
  const updatedBitacoras = [bitacoraEntry, ...(lead.bitacoras || [])].slice(0, 50);

  const leadRef = firestore().collection('companies').doc(companyId).collection('leads').doc(lead.id);
  await leadRef.update({
    lastFollowUpAt: firestore.FieldValue.serverTimestamp(),
    lastFollowUpAction: 'llamada',
    nextFollowUpDate: nextDateFormatted,
    nextFollowUpAction: 'Reintentar Llamada',
    bitacoras: updatedBitacoras,
    'metadata.smarthomeBitacoras': updatedBitacoras,
    updatedAt: firestore.FieldValue.serverTimestamp(),
  });

  const notesCol = leadRef.collection('notes');
  await notesCol
    .add({
      companyId,
      leadId: lead.id,
      authorName,
      text: `📞 INTENTO DE LLAMADA · Sin respuesta\n• Resultado: Cliente no contestó o envió a buzón de voz.\n• Próximo reintento: ${nextDateFormatted}`,
      kind: 'note',
      actionType: 'llamada',
      result: 'No contestó',
      createdAt: firestore.FieldValue.serverTimestamp(),
    })
    .catch(() => {});

  await notesCol
    .add({
      companyId,
      leadId: lead.id,
      authorName,
      text: `⏰ Recordatorio: Reintentar llamada con ${lead.name}`,
      dueAt: firestore.Timestamp.fromDate(nextDate),
      kind: 'reminder',
      done: false,
      notified: false,
      createdAt: firestore.FieldValue.serverTimestamp(),
      leadName: lead.name,
      leadPhone: lead.phone,
      project: lead.project,
      nextAction: 'Reintentar Llamada',
      assignedTo: lead.advisorId || undefined,
    })
    .catch(() => {});

  return { nextFollowUpDate: nextDateFormatted, nextFollowUpAction: 'Reintentar Llamada', bitacoraEntry };
}

export interface CommercialGoalConfig {
  citasTarget: number;
  visitasTarget: number;
  ventasTarget: number;
  gestionesTarget: number;
}

export interface AdvisorLeaderboardItem {
  advisorId: string;
  advisorName: string;
  email: string;
  role: string;
  rank: number;
  score: number;
  targets: CommercialGoalConfig;
  actuals: { citas: number; visitas: number; ventas: number; gestiones: number };
  percentages: {
    citasPct: number;
    visitasPct: number;
    ventasPct: number;
    gestionesPct: number;
    averageCompletionPct: number;
  };
  badges: string[];
}

export interface CommercialLeaderboardResponse {
  monthKey: string;
  monthLabel: string;
  defaultGoals: CommercialGoalConfig;
  advisorGoals: Record<string, Partial<CommercialGoalConfig>>;
  companyTotals: {
    totalCitas: number;
    totalVisitas: number;
    totalVentas: number;
    totalGestiones: number;
    targetCitas: number;
    targetVisitas: number;
    targetVentas: number;
    targetGestiones: number;
    overallCompletionPct: number;
  };
  leaderboard: AdvisorLeaderboardItem[];
}

export async function fetchCommercialLeaderboard(
  companyId: string,
  monthKey?: string
): Promise<CommercialLeaderboardResponse> {
  const r = await call<{ companyId: string; monthKey?: string }, CommercialLeaderboardResponse>(
    'getCommercialLeaderboard'
  )({ companyId, monthKey });
  return r.data;
}

export async function saveCommercialGoalsConfig(
  companyId: string,
  defaultGoals: CommercialGoalConfig,
  advisorGoals?: Record<string, Partial<CommercialGoalConfig>>
): Promise<void> {
  await call('saveCommercialGoals')({ companyId, defaultGoals, advisorGoals });
}

// ── 4. CALENDARIO & FICHA TÉCNICA ────────────────────────────────────────────
export interface CalendarEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  meetLink: string | null;
  source: 'google' | 'crm' | 'reminder';
  status?: string;
  leadId?: string;
  leadName?: string | null;
  leadPhone?: string;
  project?: string;
  nextAction?: string;
  advisorId?: string;
  postCitaStatus?: string;
  attended?: boolean;
}

export interface ReportAppointmentFichaInput {
  appointmentId?: string;
  leadId?: string;
  actionType?: 'cita_reunion' | 'llamada' | 'envio_informacion' | 'visita_terreno' | 'seguimiento_general';
  result?: string;
  attended?: boolean;
  evidenceUrl?: string;
  nextAction: string;
  nextActionDate?: string;
  notes?: string;
  pipelineStage?: string;
  inviteReferralProgram?: boolean;
  project?: string;
}

export interface ReportAppointmentFichaResult {
  ok: boolean;
  appointmentId: string | null;
  leadId?: string;
  reminderScheduled?: boolean;
  googleSync?: {
    synced: boolean;
    eventId: string | null;
    meetLink: string | null;
    htmlLink: string | null;
    directCalendarUrl: string;
  };
}

export async function reportAppointmentFicha(
  companyId: string,
  input: ReportAppointmentFichaInput
): Promise<ReportAppointmentFichaResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await call<{ companyId: string } & ReportAppointmentFichaInput, ReportAppointmentFichaResult>(
        'reportAppointmentFicha'
      )({ companyId, ...input });
      return r.data;
    } catch (err: any) {
      lastError = err;
      if (attempt === 3) throw err;
      await new Promise((res) => setTimeout(res, attempt * 700));
    }
  }
  throw lastError;
}

export async function listCalendarEvents(companyId: string, from: Date, to: Date) {
  const r = await call<
    { companyId: string; fromISO: string; toISO: string },
    { connected: boolean; events: CalendarEvent[] }
  >('listCalendarEvents')({ companyId, fromISO: from.toISOString(), toISO: to.toISOString() });
  return r.data;
}

export async function createCalendarEvent(
  companyId: string,
  input: { title: string; startISO: string; durationMinutes: number; description?: string; withMeet: boolean }
) {
  const r = await call<any, { eventId: string | null; meetLink: string | null }>('createCalendarEvent')({
    companyId,
    ...input,
  });
  return r.data;
}

export async function deleteCalendarEvent(companyId: string, eventId: string) {
  await call('deleteCalendarEvent')({ companyId, eventId });
}

export async function cancelAppointment(companyId: string, appointmentId: string) {
  await call('cancelAppointment')({ companyId, appointmentId });
}

export async function completeLeadFollowUp(companyId: string, leadId: string) {
  await call('completeLeadFollowUp')({ companyId, leadId });
}

export async function sendMorningAgendaSummaryNow(companyId: string, advisorId?: string) {
  const r = await call<
    { companyId: string; advisorId?: string },
    { ok: boolean; advisorsNotified: number; totalItems: number }
  >('sendMorningAgendaSummaryNow')({ companyId, advisorId });
  return r.data;
}

// ── 5. LEADS, ASESORES, LISTAS, REACCIONES, AUDITORÍA ────────────────────────
export interface Advisor {
  id: string;
  displayName: string;
  email: string;
  role: string;
  active: boolean;
  googleConnected: boolean;
  receiveLeads?: boolean;
  isBlockedForLeads?: boolean;
  blockedReason?: string | null;
  phone?: string;
}

export async function listAdvisors(companyId: string): Promise<Advisor[]> {
  const r = await call<{ companyId: string }, { advisors: Advisor[] }>('listAdvisors')({ companyId });
  return r.data.advisors || [];
}

export async function reassignLead(companyId: string, leadId: string, advisorId: string | null): Promise<void> {
  await call('reassignLead')({ companyId, leadId, advisorId });
}

export async function setLeadAssignmentLock(companyId: string, leadId: string, locked: boolean): Promise<void> {
  await call('setLeadAssignmentLock')({ companyId, leadId, locked });
}

export async function reactToMessage(
  companyId: string,
  leadId: string,
  messageId: string,
  emoji: string
): Promise<void> {
  await call('reactToMessage')({ companyId, leadId, messageId, emoji });
}

export async function getMyMessagingLine(
  companyId: string
): Promise<{ line: { number: string; wabaId?: string } | null }> {
  const r = await call<{ companyId: string }, { line: { number: string; wabaId?: string } | null }>(
    'getMyMessagingLine'
  )({ companyId });
  return r.data;
}

export interface LeadListItemMeta {
  id: string;
  name: string;
  count: number;
  leadIds?: string[];
}

export async function listLeadLists(companyId: string): Promise<LeadListItemMeta[]> {
  const r = await call<{ companyId: string }, { lists: LeadListItemMeta[] }>('listLeadLists')({ companyId });
  return r.data.lists || [];
}

export async function createLeadList(companyId: string, name: string, leadIds: string[] = []): Promise<string> {
  const r = await call<{ companyId: string; name: string; leadIds: string[] }, { listId: string }>(
    'createLeadList'
  )({ companyId, name, leadIds });
  return r.data.listId;
}

export async function deleteLeadList(companyId: string, listId: string): Promise<void> {
  await call('deleteLeadList')({ companyId, listId });
}

export async function importLeadsChunk(
  companyId: string,
  rows: Array<{ name?: string; phone: string; email?: string; tags?: string[]; project?: string }>,
  listId?: string
): Promise<{ created: number; updated: number; skipped: number }> {
  const r = await call<any, { created: number; updated: number; skipped: number }>('importLeadsChunk')({
    companyId,
    rows,
    listId,
  });
  return r.data;
}

export async function syncSmartHomeLeadBitacora(companyId: string, leadId: string) {
  const r = await call<{ companyId: string; leadId: string }, any>('syncSmartHomeLeadBitacora')({
    companyId,
    leadId,
  });
  return r.data;
}

export async function recordLeadAudit(
  companyId: string,
  leadId: string,
  action: string,
  details: Record<string, any>,
  actorName = 'Usuario'
) {
  await firestore()
    .collection('companies')
    .doc(companyId)
    .collection('leads')
    .doc(leadId)
    .collection('auditLogs')
    .add({
      action,
      details,
      actorName,
      createdAt: firestore.FieldValue.serverTimestamp(),
    })
    .catch(() => {});
}

function reviveTs(v: any): any {
  if (!v) return undefined;
  if (typeof v.toDate === 'function') return v;
  const sec = v.seconds ?? v._seconds;
  if (typeof sec === 'number') return new firestore.Timestamp(sec, v.nanoseconds ?? v._nanoseconds ?? 0);
  if (typeof v === 'number') return firestore.Timestamp.fromMillis(v);
  return firestore.Timestamp.now();
}

export async function listLeadsPage(input: {
  companyId: string;
  pageSize: number;
  cursor?: { id: string; value?: unknown } | null;
  sortField?: string;
  sortDir?: 'asc' | 'desc';
  filters?: Record<string, unknown>;
}): Promise<{ leads: Lead[]; nextCursor: { id: string; value?: unknown } | null; hasMore: boolean }> {
  const r = await call<any, { leads: any[]; nextCursor: any; hasMore: boolean }>('listLeadsPage')({
    companyId: input.companyId,
    pageSize: input.pageSize,
    cursor: input.cursor ?? null,
    sortField: input.sortField ?? 'lastMessageAt',
    sortDir: input.sortDir ?? 'desc',
    filters: input.filters ?? {},
  });
  return {
    leads: (r.data.leads || []).map((raw) => ({
      ...raw,
      createdAt: reviveTs(raw.createdAt) || firestore.Timestamp.now(),
      lastMessageAt: reviveTs(raw.lastMessageAt),
      lastInboundAt: reviveTs(raw.lastInboundAt),
    })),
    nextCursor: r.data.nextCursor ?? null,
    hasMore: !!r.data.hasMore,
  };
}

// ── 6. LLAMADAS IA & AUTO-CALL CONFIG & WHATSAPP CALLING ─────────────────────
export interface AutoCallConfig {
  enabled: boolean;
  startHour: number;
  endHour: number;
  maxCallsPerDay: number;
  retryHours: number[];
  followUpDelayHours?: number;
}

export async function getAutoCallConfig(companyId: string): Promise<AutoCallConfig> {
  const r = await call<{ companyId: string }, AutoCallConfig>('getAutoCallConfigCallable')({ companyId });
  return r.data;
}

export async function saveAutoCallConfig(companyId: string, config: Partial<AutoCallConfig>): Promise<void> {
  await call('saveAutoCallConfigCallable')({ companyId, ...config });
}

export async function requestWhatsappCallPermission(companyId: string, leadId: string): Promise<void> {
  await call('requestCallPermission')({ companyId, leadId });
}

export async function rejectWhatsappCall(companyId: string, leadId: string, callId: string): Promise<void> {
  await call('rejectWhatsappCall')({ companyId, leadId, callId });
}

// ── 7. PLANTILLAS & CAMPAÑAS MASIVAS (BROADCASTS) ────────────────────────────
export interface MessagingLine {
  number: string;
  wabaId?: string;
  isDefault: boolean;
  advisorId?: string;
}

export async function listMessagingLines(companyId: string): Promise<MessagingLine[]> {
  const r = await call<{ companyId: string }, { lines: MessagingLine[] }>('listMessagingLines')({ companyId });
  return r.data.lines || [];
}

export async function syncTemplates(companyId: string): Promise<number> {
  const r = await call<{ companyId: string }, { synced: number }>('syncTemplatesFromTwilio')({ companyId });
  return r.data.synced ?? 0;
}

export async function createTemplate(
  companyId: string,
  input: Record<string, any>,
  inboxId?: string
): Promise<string> {
  const r = await call<any, { templateId: string }>('createTemplate')({
    ...input,
    companyId,
    ...(inboxId ? { inboxId } : {}),
  });
  return r.data.templateId;
}

export async function deleteTemplate(companyId: string, templateId: string): Promise<void> {
  await call('deleteTemplate')({ companyId, templateId });
}

export async function sendTemplateMessageWithLine(
  companyId: string,
  leadId: string,
  templateId: string,
  variables: Record<string, string>,
  fromInboxId?: string
): Promise<string> {
  const r = await call<any, { messageId: string }>('sendTemplateMessage')({
    companyId,
    leadId,
    templateId,
    variables,
    ...(fromInboxId ? { fromInboxId } : {}),
  });
  return r.data.messageId;
}

export interface BroadcastAudience {
  type: 'all' | 'status' | 'tag' | 'list';
  value?: string;
}

export interface BroadcastRecord {
  id: string;
  templateName: string;
  audience: BroadcastAudience;
  total: number;
  sent: number;
  delivered?: number;
  read?: number;
  undelivered?: number;
  failed: number;
  status: 'queued' | 'processing' | 'sending' | 'completed' | 'failed';
  createdAt: number | null;
}

export async function listBroadcasts(companyId: string): Promise<BroadcastRecord[]> {
  const r = await call<{ companyId: string }, { broadcasts: any[] }>('listBroadcasts')({ companyId });
  return (r.data.broadcasts || []).map((b) => {
    const d = parseAnyDate(b.createdAt);
    return { ...b, createdAt: d ? d.getTime() : null };
  });
}

export async function countBroadcastAudience(companyId: string, audience: BroadcastAudience): Promise<number> {
  const r = await call<{ companyId: string; audience: BroadcastAudience }, { total: number }>(
    'countBroadcastAudience'
  )({ companyId, audience });
  return r.data.total ?? 0;
}

export async function sendBroadcast(
  companyId: string,
  templateId: string,
  audience: BroadcastAudience,
  variables: Record<string, string>
) {
  const r = await call<any, { broadcastId: string; total: number; sent: number; failed: number }>('sendBroadcast')({
    companyId,
    templateId,
    audience,
    variables,
  });
  return r.data;
}

// ── 8. MARKETING & REPORTES ──────────────────────────────────────────────────
export type MarketingRange = 'all' | '7d' | '30d' | '90d';

export async function getMarketingMetrics(companyId: string, range: MarketingRange = 'all'): Promise<any> {
  const r = await call<{ companyId: string; range: MarketingRange }, any>('getMarketingMetrics')({
    companyId,
    range,
  });
  return r.data;
}

export async function getAdvisorReports(companyId: string, rangeDays = 30, refresh = false): Promise<any> {
  const r = await call<any, any>('getAdvisorReports')({ companyId, rangeDays, refresh });
  return r.data;
}

export async function getWeeklyFollowUpReport(
  companyId: string,
  weekOffset = 0,
  refresh = false,
  search = ''
): Promise<any> {
  const r = await call<any, any>('getWeeklyFollowUpReport')({ companyId, weekOffset, refresh, search });
  return r.data;
}

export async function getSalesCommissionReport(
  companyId: string,
  monthKey = 'all',
  refresh = false
): Promise<any> {
  const r = await call<any, any>('getSalesCommissionReport')({ companyId, monthKey, refresh });
  const raw = r.data || {};
  const items = Array.isArray(raw.items) ? raw.items : Array.isArray(raw.sales) ? raw.sales : [];
  return {
    monthKey: raw.monthKey || monthKey,
    totalSales: typeof raw.totalSales === 'number' ? raw.totalSales : items.length,
    totalVolume: raw.totalVolume || 0,
    totalCommissions: raw.totalCommissions || 0,
    generatedAt: raw.generatedAt || Date.now(),
    items,
  };
}

export async function saveSalesReportDocument(payload: Record<string, any>): Promise<any> {
  const r = await call<any, any>('saveSalesReportDocument')(payload);
  return r.data;
}

export async function deleteSalesReportVersion(companyId: string, saleId: string, versionId: string): Promise<any> {
  const r = await call<any, any>('deleteSalesReportVersion')({ companyId, saleId, versionId });
  return r.data;
}

// ── 9. CONFIGURACIÓN COMPLETA & EMPRESAS PLATAFORMA ──────────────────────────
export interface LeadSourceItem {
  id: string;
  name: string;
  active: boolean;
  leadCount?: number;
  description?: string;
}

export function subscribeLeadSources(
  companyId: string,
  onUpdate: (sources: LeadSourceItem[]) => void
): () => void {
  return firestore()
    .collection('companies')
    .doc(companyId)
    .collection('leadSources')
    .orderBy('name', 'asc')
    .onSnapshot(
      (snap) => {
        onUpdate(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<LeadSourceItem, 'id'>),
          }))
        );
      },
      () => onUpdate([])
    );
}

export async function createLeadSource(companyId: string, name: string, description?: string) {
  const cleanName = name.trim();
  const slug =
    cleanName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || `fuente_${Date.now()}`;
  await firestore()
    .collection('companies')
    .doc(companyId)
    .collection('leadSources')
    .doc(slug)
    .set({
      name: cleanName,
      active: true,
      description: description?.trim() || '',
      leadCount: 0,
      createdAt: firestore.FieldValue.serverTimestamp(),
      updatedAt: firestore.FieldValue.serverTimestamp(),
    });
  return slug;
}

export async function toggleLeadSourceActive(companyId: string, sourceId: string, active: boolean) {
  await firestore()
    .collection('companies')
    .doc(companyId)
    .collection('leadSources')
    .doc(sourceId)
    .update({ active, updatedAt: firestore.FieldValue.serverTimestamp() });
}

export async function updateLeadSourceName(companyId: string, sourceId: string, name: string, description?: string) {
  await firestore()
    .collection('companies')
    .doc(companyId)
    .collection('leadSources')
    .doc(sourceId)
    .update({
      name: name.trim(),
      ...(description !== undefined ? { description: description.trim() } : {}),
      updatedAt: firestore.FieldValue.serverTimestamp(),
    });
}

export async function listCompanyUsers(companyId: string): Promise<any[]> {
  const r = await call<{ companyId: string }, { users: any[] }>('listCompanyUsers')({ companyId });
  return r.data.users || [];
}

export async function createCompanyUser(input: Record<string, any>): Promise<any> {
  const r = await call<any, any>('createCompanyUser')(input);
  return r.data;
}

export async function updateCompanyUser(input: Record<string, any>): Promise<void> {
  await call('updateCompanyUser')(input);
}

export async function saveContactFields(companyId: string, fields: any[]): Promise<void> {
  await call('saveContactFields')({ companyId, fields });
}

export async function getSchedulingConfig(companyId: string): Promise<any> {
  const r = await call<{ companyId: string }, any>('getSchedulingConfig')({ companyId });
  return r.data;
}

export async function saveSchedulingConfig(companyId: string, config: Record<string, any>): Promise<void> {
  await call('saveSchedulingConfig')({ companyId, ...config });
}

export async function getSlaConfig(companyId: string): Promise<any> {
  const r = await call<{ companyId: string }, any>('getSlaConfig')({ companyId });
  return r.data;
}

export async function saveSlaConfig(companyId: string, config: Record<string, any>): Promise<void> {
  await call('saveSlaConfig')({ companyId, ...config });
}

export async function listBlockedAdvisors(companyId: string): Promise<any[]> {
  const r = await call<{ companyId: string }, { advisors?: any[]; items?: any[] }>('listBlockedAdvisorsCall')({
    companyId,
  });
  return r.data.advisors || r.data.items || [];
}

export async function unblockAdvisorManual(companyId: string, advisorId: string): Promise<void> {
  await call('unblockAdvisorManualCall')({ companyId, advisorId });
}

export async function getMetaAdsConfig(companyId: string): Promise<any> {
  const r = await call<{ companyId: string }, any>('getMetaAdsConfig')({ companyId });
  return r.data;
}

export async function saveMetaAdsConfig(companyId: string, config: Record<string, any>): Promise<void> {
  await call('saveMetaAdsConfig')({ companyId, ...config });
}

export async function testMetaAdsConnection(companyId: string): Promise<any> {
  const r = await call<{ companyId: string }, any>('testMetaAdsConnection')({ companyId });
  return r.data;
}

export async function listLeadFormTemplates(companyId: string): Promise<any[]> {
  const r = await call<{ companyId: string }, { items?: any[]; forms?: any[] }>('listLeadFormTemplates')({
    companyId,
  });
  return r.data.items || r.data.forms || [];
}

export async function setLeadFormTemplate(companyId: string, formId: string, templateId: string, formName?: string) {
  await call('setLeadFormTemplate')({ companyId, formId, templateId, formName });
}

export async function deleteLeadFormTemplate(companyId: string, formId: string) {
  await call('deleteLeadFormTemplate')({ companyId, formId });
}

export async function testAiAssistant(companyId: string, message: string, history: any[] = [], draftConfig?: any) {
  const r = await call<any, { reply: string }>('testAiAssistant')({
    companyId,
    message,
    history,
    draftConfig,
  });
  return r.data.reply;
}

export async function resetAiConfig(companyId: string): Promise<any> {
  const r = await call<{ companyId: string }, any>('resetAiConfig')({ companyId });
  return r.data;
}

export async function sendTestPushNotification(companyId: string): Promise<any> {
  const r = await call<{ companyId: string }, any>('sendTestPushNotification')({ companyId });
  return r.data;
}

export async function sendTestPushToDevice(companyId: string, tokenId?: string): Promise<any> {
  if (!tokenId) {
    return sendTestPushNotification(companyId);
  }
  const r = await call<{ companyId: string; tokenId: string }, any>('sendTestPushToDevice')({ companyId, tokenId });
  return r.data;
}

export async function getPushNotificationStatus(companyId: string): Promise<any> {
  const r = await call<{ companyId: string }, any>('getPushNotificationStatus')({ companyId });
  return r.data;
}

export interface PlatformCompany {
  id: string;
  name: string;
  environment: 'production' | 'demo';
  smartHomeEnabled?: boolean;
  channelRoutes: Array<{ channel: string; identifier: string }>;
}

export async function listPlatformCompanies(): Promise<PlatformCompany[]> {
  const r = await call<void, { companies: PlatformCompany[] }>('listPlatformCompanies')();
  return r.data.companies || [];
}

export async function savePlatformCompany(input: Record<string, any>): Promise<any> {
  const r = await call<any, any>('savePlatformCompany')(input);
  return r.data;
}

export async function saveChannelRoute(input: Record<string, any>): Promise<any> {
  const r = await call<any, any>('saveChannelRoute')(input);
  return r.data;
}

export async function uploadLibraryAsset(
  companyId: string,
  uri: string,
  fileName: string,
  mimeType: string,
  meta: { title: string; project?: string; kind?: 'document' | 'video' | 'card'; visibility?: 'general' | 'advisor'; advisorId?: string; advisorName?: string; sizeBytes?: number }
) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `companies/${companyId}/library/${Date.now()}_${safeName}`;
  const ref = storage().ref(storagePath);
  await ref.putFile(uri, { contentType: mimeType });
  const downloadUrl = await ref.getDownloadURL();
  await firestore()
    .collection('companies')
    .doc(companyId)
    .collection('library')
    .add({
      title: meta.title || fileName,
      fileName,
      storagePath,
      downloadUrl,
      contentType: mimeType,
      sizeBytes: meta.sizeBytes || 0,
      project: meta.project || 'General',
      kind: meta.kind || 'document',
      visibility: meta.visibility || 'general',
      advisorId: meta.advisorId || null,
      advisorName: meta.advisorName || null,
      createdAt: firestore.FieldValue.serverTimestamp(),
    });
  return downloadUrl;
}

export async function deleteLibraryAsset(companyId: string, itemId: string, storagePath?: string) {
  await firestore().collection('companies').doc(companyId).collection('library').doc(itemId).delete();
  if (storagePath) {
    await storage().ref(storagePath).delete().catch(() => {});
  }
}

export async function uploadBrandLogoFile(companyId: string, uri: string, fileName: string, mimeType: string) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `companies/${companyId}/branding/${Date.now()}_${safeName}`;
  const ref = storage().ref(storagePath);
  await ref.putFile(uri, { contentType: mimeType });
  return ref.getDownloadURL();
}

export type { WhatsAppTemplate };
