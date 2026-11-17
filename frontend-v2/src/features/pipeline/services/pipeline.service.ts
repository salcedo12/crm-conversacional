import {
  collection, doc, getDocs, limit, query, updateDoc, serverTimestamp,
  Timestamp, addDoc, where, arrayUnion, orderBy,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { normalizeProject } from '@/features/database/pages/DatabasePage';
import {
  PIPELINE_STAGES, PIPELINE_GROUPS, type PipelineCardItem,
  type PipelineStageConfig, type PipelineGroup,
} from '../types/pipeline.types';
import { isAdvisorMatch, MERAKI_OFFICIAL_ADVISORS } from '@/features/commercial/services/commercialReports.service';

export function getStageConfig(stageId: string): PipelineStageConfig {
  return PIPELINE_STAGES.find((s) => s.id === stageId) || PIPELINE_STAGES[0];
}

/**
 * Deduce la etapa del embudo basada en el historial del lead si aún no tiene una explícita
 */
export function derivePipelineStage(data: Record<string, unknown>): PipelineStageConfig {
  if (typeof data.pipelineStage === 'string') {
    const existing = PIPELINE_STAGES.find((s) => s.id === data.pipelineStage);
    if (existing) return existing;
  }

  const status = String(data.status || '').toLowerCase();
  const meta = (data.metadata || {}) as Record<string, unknown>;
  const ciclo = String(meta.smarthomeCicloVenta || '').toUpperCase();
  const etapa = String(meta.smarthomeEstadoSeguimiento || '').toUpperCase();

  // 1. CIERRE / FIRMA (100%)
  if (status === 'closed' || ciclo.includes('CIERRE') || ciclo.includes('COMPRO') || etapa.includes('COMPRO')) {
    return getStageConfig('firma');
  }

  // 2. DOCUMENTACIÓN (85%)
  if (ciclo.includes('DOCUMENTACION') || etapa.includes('DOCUMENTACION') || etapa.includes('CREDITO')) {
    return getStageConfig('documentacion');
  }

  // 3. NEGOCIACIÓN (75%)
  if (ciclo.includes('NEGOCIACION') || etapa.includes('NEGOCIACION') || etapa.includes('SEPARACION')) {
    return getStageConfig('negociacion');
  }

  // 4. DESCARTE / NO INTERESADO
  if (status === 'lost' || ciclo.includes('CANCELADO') || ciclo.includes('DESISTIMIENTO') || etapa.includes('DESISTIMIENTO')) {
    const reason = String(meta.smarthomeMotivo || data.lossReason || '').toLowerCase();
    if (reason.includes('ubicacion') || reason.includes('lejos') || reason.includes('distancia')) {
      return getStageConfig('no_interesado_ubicacion');
    }
    if (reason.includes('dinero') || reason.includes('presupuesto') || reason.includes('precio') || reason.includes('caro')) {
      return getStageConfig('no_interesado_dinero');
    }
    return getStageConfig('no_interesado_otra');
  }

  // 5. VISITA REALIZADA (65%)
  if (ciclo.includes('VISITO') || ciclo.includes('SALA') || etapa.includes('VISITA')) {
    return getStageConfig('visita_realizada');
  }

  // 6. COTIZACIÓN (50%)
  if (ciclo.includes('COTIZACION') || etapa.includes('COTIZACION')) {
    return getStageConfig('cotizacion');
  }

  // 7. CITA (35%)
  if (status === 'scheduled' || ciclo.includes('CITA') || etapa.includes('CITA')) {
    return getStageConfig('cita');
  }

  // 8. ENVÍO DE INFO (20%)
  if (ciclo.includes('EN LINEA') || status === 'qualified') {
    return getStageConfig('envio_info');
  }

  // 9. CONTACTADO (10%)
  if (status === 'active' || ciclo.includes('CONTACTADO') || (data.lastInboundAt || data.lastMessageAt)) {
    return getStageConfig('contactado');
  }

  // 10. PROSPECTO POR DEFECTO (5%)
  return getStageConfig('prospecto');
}

/**
 * Parsea con tolerancia múltiples formatos de fechas de Firestore y strings
 */
export function parseDate(ts: unknown): Date | null {
  if (!ts) return null;
  if (ts instanceof Timestamp) return ts.toDate();
  if (typeof (ts as any).toDate === 'function') return (ts as any).toDate();
  if (typeof ts === 'object' && ('_seconds' in (ts as any) || 'seconds' in (ts as any))) {
    const s = (ts as any)._seconds ?? (ts as any).seconds;
    return new Date(s * 1000);
  }
  if (typeof ts === 'string' || typeof ts === 'number') {
    const clean = String(ts).trim().replace(' ', 'T');
    const d = new Date(clean);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
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
  lead: {
    assignedTo?: string;
    advisorId?: string;
    assignedToName?: string;
    advisorName?: string;
    smartHomeAdvisorName?: string;
    metadata?: Record<string, unknown>;
  },
  targetAdvisorId?: string,
  targetAdvisorName?: string
): boolean {
  if (!targetAdvisorId || targetAdvisorId === 'all') return true;

  // 1. REGLA ESTRICTA DE ASIGNACIÓN ACTUAL POR ID:
  const currentAssignedId = lead.advisorId || lead.assignedTo || '';
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

/**
 * Normaliza fecha para agrupar por mes estilo SmartHome: "Registro de agosto 2026 (X)"
 */
function formatMonthYearHeader(ts: unknown, fallbackDate?: Date | null): { label: string; dateStr: string; dateObj: Date | null } {
  const date = parseDate(ts) || fallbackDate || null;

  if (!date || isNaN(date.getTime())) {
    return { label: 'Sin fecha registrada', dateStr: '—', dateObj: null };
  }

  const monthName = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' }).format(date);
  const dateStr = date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
  return {
    label: `Registro de ${monthName}`,
    dateStr,
    dateObj: date,
  };
}

export interface PipelineFilterOptions {
  advisorId?: string; // 'all' o uid o fakeId
  advisorName?: string;
  projectFilter?: string; // 'all' o nombre de proyecto
  groupFilter?: PipelineGroup | 'all';
  sourceFilter?: string; // 'all' | 'meta_ads' | 'smarthome' | 'whatsapp_ia' | 'advisor_whatsapp' | 'ferias' | 'web'
  followUpStatus?: 'all' | 'uncontacted' | 'overdue' | 'active';
  dateRange?: 'all' | 'last_30_days' | 'last_60_days' | 'year_2026' | 'year_2025' | 'year_2024' | 'today' | 'yesterday' | 'week' | 'custom';
  startDate?: Date | null;
  endDate?: Date | null;
  limitCount?: number; // 100, 250, 500, 1000
  /**
   * Seguridad (R05): uid del asesor que consulta. Si viene, TODAS las consultas a
   * Firestore se restringen a assignedTo == uid (las reglas solo dejan leer lo propio).
   * Solo se pasa para asesores; un admin filtrando por asesor usa advisorId.
   */
  scopeAssignedTo?: string;
}

export interface PipelineFilterStats {
  totalSample: number;
  byProject: Record<string, number>;
  bySource: Record<string, number>;
  byFollowUp: {
    uncontacted: number;
    overdue: number;
    active: number;
  };
  byYear: {
    '2026': number;
    '2025': number;
    '2024': number;
  };
  byAge: {
    under30Days: number;
    from30to60Days: number;
    over60Days: number;
  };
}

/**
 * Consulta y transforma los leads al modelo del Tablero Kanban con soporte de filtros avanzados
 */
export async function fetchPipelineCards(
  companyId: string,
  filterOrAdvisorId: string | PipelineFilterOptions = 'all',
  legacyProjectFilter = 'all'
): Promise<{
  cards: PipelineCardItem[];
  advisors: { id: string; name: string }[];
  stats: PipelineFilterStats;
}> {
  // Normalizar opciones de filtro
  const opts: PipelineFilterOptions = typeof filterOrAdvisorId === 'string'
    ? {
        advisorId: filterOrAdvisorId,
        projectFilter: legacyProjectFilter,
        groupFilter: 'all',
        sourceFilter: 'all',
        followUpStatus: 'all',
        dateRange: 'last_30_days',
        limitCount: 500,
      }
    : {
        advisorId: filterOrAdvisorId.advisorId || 'all',
        advisorName: filterOrAdvisorId.advisorName,
        projectFilter: filterOrAdvisorId.projectFilter || 'all',
        groupFilter: filterOrAdvisorId.groupFilter || 'all',
        sourceFilter: filterOrAdvisorId.sourceFilter || 'all',
        followUpStatus: filterOrAdvisorId.followUpStatus || 'all',
        dateRange: filterOrAdvisorId.dateRange || 'last_30_days',
        startDate: filterOrAdvisorId.startDate,
        endDate: filterOrAdvisorId.endDate,
        limitCount: filterOrAdvisorId.limitCount || 500,
        scopeAssignedTo: filterOrAdvisorId.scopeAssignedTo,
      };

  // 1. Obtener asesores de la empresa y complementar con oficiales de Meraki
  const advMap = new Map<string, string>();
  const advisorsList: { id: string; name: string }[] = [];
  try {
    const usersSnap = await getDocs(collection(db, 'companies', companyId, 'users'));
    usersSnap.docs.forEach((d) => {
      const u = d.data();
      const name = u.displayName || u.email || d.id;
      advMap.set(d.id, name);
      advisorsList.push({ id: d.id, name });
    });
  } catch (usersErr) {
    console.warn('[pipeline.service] Error consultando usuarios de la empresa:', usersErr);
  }

  MERAKI_OFFICIAL_ADVISORS.forEach((offName) => {
    const alreadyPresent = advisorsList.some((a) => isAdvisorMatch(a.name, offName));
    if (!alreadyPresent) {
      const fakeId = `advisor_${offName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      advMap.set(fakeId, offName);
      advisorsList.push({ id: fakeId, name: offName });
    }
  });

  // Determinar nombre del asesor objetivo para filtrado estricto
  let targetAdvisorName = opts.advisorName || '';
  if (!targetAdvisorName && opts.advisorId && opts.advisorId !== 'all') {
    const foundAdv = advisorsList.find((a) => a.id === opts.advisorId || isAdvisorMatch(a.id, opts.advisorId) || isAdvisorMatch(a.name, opts.advisorId));
    if (foundAdv) {
      targetAdvisorName = foundAdv.name;
    } else {
      targetAdvisorName = advMap.get(opts.advisorId) || opts.advisorId;
    }
  }

  // 2. Determinar rango de fechas efectivo
  const now = new Date();
  let effectiveStart: Date | null = null;
  let effectiveEnd: Date | null = null;

  if (opts.startDate !== undefined && opts.endDate !== undefined) {
    effectiveStart = opts.startDate;
    effectiveEnd = opts.endDate;
  } else if (opts.dateRange === 'today') {
    effectiveStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    effectiveEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  } else if (opts.dateRange === 'yesterday') {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    effectiveStart = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 0, 0, 0, 0);
    effectiveEnd = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59, 999);
  } else if (opts.dateRange === 'last_30_days') {
    const s = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    s.setHours(0, 0, 0, 0);
    effectiveStart = s;
    effectiveEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  } else if (opts.dateRange === 'last_60_days') {
    const s = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    s.setHours(0, 0, 0, 0);
    effectiveStart = s;
    effectiveEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  } else if (opts.dateRange === 'year_2026') {
    effectiveStart = new Date(2026, 0, 1, 0, 0, 0, 0);
    effectiveEnd = new Date(2026, 11, 31, 23, 59, 59, 999);
  } else if (opts.dateRange === 'year_2025') {
    effectiveStart = new Date(2025, 0, 1, 0, 0, 0, 0);
    effectiveEnd = new Date(2025, 11, 31, 23, 59, 59, 999);
  } else if (opts.dateRange === 'year_2024') {
    effectiveStart = new Date(2024, 0, 1, 0, 0, 0, 0);
    effectiveEnd = new Date(2024, 11, 31, 23, 59, 59, 999);
  }
  const isHistorical = effectiveStart === null && effectiveEnd === null;

  // 3. Consultas en Firestore optimizadas
  const maxLimit = Math.min(Math.max(opts.limitCount || 500, 100), 1000);
  const docsMap = new Map<string, any>();
  const leadCol = collection(db, 'companies', companyId, 'leads');

  const queriesToRun: Promise<any>[] = [];
  // Seguridad (R05): un asesor solo consulta sus leads asignados.
  const scope = opts.scopeAssignedTo ? [where('assignedTo', '==', opts.scopeAssignedTo)] : [];

  if (!isHistorical && effectiveStart && effectiveEnd) {
    const startTs = Timestamp.fromDate(effectiveStart);
    const endTs = Timestamp.fromDate(effectiveEnd);

    // Leads con seguimiento registrado en el período
    queriesToRun.push(
      getDocs(query(leadCol, ...scope, where('lastFollowUpAt', '>=', startTs), where('lastFollowUpAt', '<=', endTs), limit(500)))
    );
    // Leads captados/creados en el período
    queriesToRun.push(
      getDocs(query(leadCol, ...scope, where('createdAt', '>=', startTs), where('createdAt', '<=', endTs), limit(500)))
    );
    // Leads asignados en el período
    queriesToRun.push(
      getDocs(query(leadCol, ...scope, where('advisorAssignedAt', '>=', startTs), where('advisorAssignedAt', '<=', endTs), limit(300)))
    );
  }

  // Leads con etapa explícita de embudo (para un asesor ya los cubre la
  // consulta por assignedTo de abajo; evita un índice extra assignedTo+pipelineStage)
  if (!opts.scopeAssignedTo) {
    queriesToRun.push(
      getDocs(query(leadCol, where('pipelineStage', '!=', null), limit(300)))
    );
  }

  // Si se filtra por asesor por UID
  if (opts.advisorId && opts.advisorId !== 'all') {
    queriesToRun.push(
      getDocs(query(leadCol, where('assignedTo', '==', opts.advisorId), limit(maxLimit)))
    );
  }

  // Muestra general reciente ordenada por última actividad o creación
  queriesToRun.push(
    (async () => {
      try {
        return await getDocs(query(leadCol, ...scope, orderBy('lastMessageAt', 'desc'), limit(maxLimit)));
      } catch {
        return await getDocs(query(leadCol, ...scope, limit(maxLimit)));
      }
    })()
  );

  const queryResults = await Promise.allSettled(queriesToRun);
  queryResults.forEach((res) => {
    if (res.status === 'fulfilled' && res.value?.docs) {
      res.value.docs.forEach((d: any) => docsMap.set(d.id, d));
    }
  });

  const allLeadDocs = Array.from(docsMap.values());
  const cards: PipelineCardItem[] = [];
  const nowMs = Date.now();

  // Estadísticas acumuladas
  const stats: PipelineFilterStats = {
    totalSample: allLeadDocs.length,
    byProject: {},
    bySource: {},
    byFollowUp: { uncontacted: 0, overdue: 0, active: 0 },
    byYear: { '2026': 0, '2025': 0, '2024': 0 },
    byAge: { under30Days: 0, from30to60Days: 0, over60Days: 0 },
  };

  allLeadDocs.forEach((d) => {
    const data = d.data();
    const meta = (data.metadata || {}) as Record<string, unknown>;

    // ── FILTRO ESTRICTO DE ASESOR ──
    if (opts.advisorId && opts.advisorId !== 'all') {
      const belongs = leadBelongsToAdvisor(
        {
          assignedTo: data.assignedTo,
          advisorId: data.assignedTo || data.advisorId,
          assignedToName: data.assignedToName,
          advisorName: data.advisorName,
          smartHomeAdvisorName: data.smartHomeAdvisorName,
          metadata: meta,
        },
        opts.advisorId,
        targetAdvisorName
      );
      if (!belongs) return;
    }

    // ── FILTRO ESTRICTO DE FECHA / SEGUIMIENTO ──
    // "que si selecciona tal fecha a tal fecha, que sean los prospectos que les han hecho seguimiento esos días"
    if (!isHistorical && effectiveStart && effectiveEnd) {
      const createdDate = parseDate(data.createdAt);
      const followUpDate = parseDate(data.lastFollowUpAt) || parseDate(data.smartHomeLastBitacoraAt);
      const assignedDate = parseDate(data.advisorAssignedAt) || parseDate(data.transferDate);
      const messageDate = parseDate(data.lastMessageAt);
      const updatedDate = parseDate(data.updatedAt);

      const allBitacoras = [
        ...(Array.isArray(data.bitacoras) ? data.bitacoras : []),
        ...(Array.isArray(meta.smarthomeBitacoras) ? meta.smarthomeBitacoras : []),
        ...(Array.isArray(data.smarthomeBitacoras) ? data.smarthomeBitacoras : []),
      ];

      const hasBitacoraInPeriod = allBitacoras.some((b) => {
        if (!b) return false;
        const bDate = parseDate(b.fecha || b.lastDate || b.date);
        return bDate ? bDate >= effectiveStart! && bDate <= effectiveEnd! : false;
      });

      const hasCreationInPeriod = createdDate ? createdDate >= effectiveStart && createdDate <= effectiveEnd : false;
      const hasFollowUpInPeriod = followUpDate ? followUpDate >= effectiveStart && followUpDate <= effectiveEnd : false;
      const hasAssignedInPeriod = assignedDate ? assignedDate >= effectiveStart && assignedDate <= effectiveEnd : false;
      const hasMessageInPeriod = messageDate ? messageDate >= effectiveStart && messageDate <= effectiveEnd : false;
      const hasUpdateInPeriod = updatedDate ? updatedDate >= effectiveStart && updatedDate <= effectiveEnd : false;

      const hasActivityInPeriod = hasBitacoraInPeriod || hasFollowUpInPeriod || hasCreationInPeriod || hasAssignedInPeriod || hasMessageInPeriod || hasUpdateInPeriod;

      if (!hasActivityInPeriod) {
        return; // Excluir si no tuvo seguimiento, bitácora ni actividad en el período
      }
    }

    // Asesor mostrado
    const rawAssigned = data.assignedTo as string | undefined;
    const advisorName = (rawAssigned && advMap.get(rawAssigned)) || data.assignedToName || data.smartHomeAdvisorName || (meta.smarthomeAsesorOriginal as string) || 'Sin Asignar';

    // Proyecto normalizado
    const rawProj = (Array.isArray(data.projectInterest) ? data.projectInterest[0] : data.projectInterest)
      || meta.smarthomeProyectoOriginal || meta.webArea || '';
    const projName = normalizeProject(rawProj) || 'Sin especificar';

    // Origen
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
    } else if (specificFuente.toLowerCase().includes('feria') || specificFuente.toLowerCase().includes('expo') || specificFuente.toLowerCase().includes('corferias')) {
      sourceCategory = 'ferias';
    } else if (meta.migratedFrom === 'smarthome_excel_base_31' || data.smartHomeCustomerId) {
      sourceCategory = 'smarthome';
      if (!specificFuente) sourceLabel = 'Trabajo de campo';
    } else if (data.inbox === 'central_317' || data.source === 'whatsapp') {
      sourceCategory = 'whatsapp_ia';
      if (!specificFuente) sourceLabel = 'Línea WhatsApp 317';
    }

    if (String(data.source || '').toLowerCase().includes('feria') || String(meta.smarthomeMedio || '').toLowerCase().includes('feria')) {
      sourceCategory = 'ferias';
    }

    // Fecha de creación y antigüedad
    const dateInfo = formatMonthYearHeader(data.createdAt, parseDate(data.lastFollowUpAt) || parseDate(data.lastMessageAt));
    const cDate = dateInfo.dateObj;
    const cYear = cDate ? cDate.getFullYear() : null;
    const ageDays = cDate ? Math.floor((nowMs - cDate.getTime()) / (1000 * 60 * 60 * 24)) : 999;

    // Estado de seguimiento
    const isUncontacted = !data.lastMessageAt && !data.lastFollowUpAt && !data.advisorFirstContactAt;
    const nextDateMillis = data.nextFollowUpDate ? Date.parse(data.nextFollowUpDate) : null;
    const isOverdue = !!nextDateMillis && !isNaN(nextDateMillis) && nextDateMillis < nowMs;
    const isActiveFollowUp = !!nextDateMillis && !isNaN(nextDateMillis) && nextDateMillis >= nowMs;

    // Acumular estadísticas
    stats.byProject[projName] = (stats.byProject[projName] || 0) + 1;
    stats.bySource[sourceCategory] = (stats.bySource[sourceCategory] || 0) + 1;

    if (isUncontacted) stats.byFollowUp.uncontacted++;
    if (isOverdue) stats.byFollowUp.overdue++;
    if (isActiveFollowUp) stats.byFollowUp.active++;

    if (cYear === 2026) stats.byYear['2026']++;
    else if (cYear === 2025) stats.byYear['2025']++;
    else if (cYear === 2024) stats.byYear['2024']++;

    if (ageDays <= 30) stats.byAge.under30Days++;
    else if (ageDays <= 60) stats.byAge.from30to60Days++;
    else stats.byAge.over60Days++;

    // Filtros adicionales in-memory
    if (opts.projectFilter !== 'all' && projName !== opts.projectFilter) {
      return;
    }
    if (opts.sourceFilter && opts.sourceFilter !== 'all') {
      const sf = opts.sourceFilter.toLowerCase();
      const matchCategory = sourceCategory === opts.sourceFilter;
      const matchSpecific = specificFuente.toLowerCase().includes(sf);
      if (!matchCategory && !matchSpecific) {
        return;
      }
    }
    if (opts.followUpStatus === 'uncontacted' && !isUncontacted) {
      return;
    }
    if (opts.followUpStatus === 'overdue' && !isOverdue) {
      return;
    }
    if (opts.followUpStatus === 'active' && !isActiveFollowUp) {
      return;
    }

    const stageConfig = derivePipelineStage(data);

    if (opts.groupFilter && opts.groupFilter !== 'all' && stageConfig.group !== opts.groupFilter) {
      return;
    }

    // Bitácoras deduplicadas y ordenadas
    const rawCombinedBitacoras = [
      ...(Array.isArray(data.bitacoras) ? data.bitacoras : []),
      ...(Array.isArray(meta.smarthomeBitacoras) ? meta.smarthomeBitacoras : []),
      ...(Array.isArray(data.smarthomeBitacoras) ? data.smarthomeBitacoras : []),
    ];

    rawCombinedBitacoras.sort((a, b) => {
      const da = parseDate(a?.fecha || a?.lastDate || a?.date)?.getTime() || 0;
      const db = parseDate(b?.fecha || b?.lastDate || b?.date)?.getTime() || 0;
      return db - da;
    });

    const latestBitacora = rawCombinedBitacoras.length > 0 ? rawCombinedBitacoras[0] : null;
    let lastBitacoraText: string | undefined;
    let lastBitacoraDateStr: string | undefined;

    if (latestBitacora) {
      lastBitacoraText = `${latestBitacora.action ? latestBitacora.action + ': ' : ''}${latestBitacora.description || ''}`;
      lastBitacoraDateStr = latestBitacora.fecha || latestBitacora.lastDate || latestBitacora.date;
    } else if (data.lastFollowUpSummary || data.lastFollowUpAction) {
      lastBitacoraText = `${data.lastFollowUpAction ? data.lastFollowUpAction + ': ' : ''}${data.lastFollowUpSummary || ''}`;
      const lfu = parseDate(data.lastFollowUpAt);
      lastBitacoraDateStr = lfu ? lfu.toISOString().replace('T', ' ').slice(0, 16) : undefined;
    }

    cards.push({
      id: d.id,
      name: (data.name as string) || (data.clientName as string) || (data.fullName as string) || 'Cliente Sin Nombre',
      phone: (data.phone as string) || (data.normalizedPhone as string) || '',
      email: (data.email as string) || '',
      project: projName,
      sector: (meta.smarthomeSector as string) || (meta.smarthomeEtapaOriginal as string) || '',
      cupo: (meta.smarthomeModuloOriginal as string) || 'cupo1',
      advisorId: rawAssigned || '',
      advisorName,
      source: (data.source as string) || 'desconocido',
      sourceLabel,
      stageId: stageConfig.id,
      stageLabel: stageConfig.label,
      group: stageConfig.group,
      probability: stageConfig.probability,
      probabilityLabel: stageConfig.probabilityLabel,
      createdAtText: dateInfo.dateStr,
      createdMonthYear: dateInfo.label,
      score: typeof data.leadScore === 'number' ? data.leadScore : (data.aiAnalysis?.temperature === 'hot' ? 200 : 0),
      lastBitacora: lastBitacoraText,
      lastBitacoraDate: lastBitacoraDateStr,
      rawLead: data,
    });
  });

  // Ordenar tarjetas por la fecha de seguimiento o creación más reciente primero
  cards.sort((a, b) => {
    const da = parseDate(a.lastBitacoraDate) || parseDate(a.rawLead?.lastFollowUpAt) || parseDate(a.rawLead?.createdAt) || new Date(0);
    const db = parseDate(b.lastBitacoraDate) || parseDate(b.rawLead?.lastFollowUpAt) || parseDate(b.rawLead?.createdAt) || new Date(0);
    return db.getTime() - da.getTime();
  });

  return { cards, advisors: advisorsList, stats };
}

/**
 * Actualiza la etapa del lead en Firestore al moverlo en el embudo
 */
export async function updateLeadPipelineStage(
  companyId: string,
  leadId: string,
  newStageId: string,
  authorName = 'Asesor'
): Promise<void> {
  const stage = getStageConfig(newStageId);
  const docRef = doc(db, 'companies', companyId, 'leads', leadId);

  // Mapeo correlativo con el estado comercial general
  let statusUpdate: string | undefined;
  if (stage.id === 'firma') statusUpdate = 'closed';
  else if (stage.group === 'no_interesado') statusUpdate = 'lost';
  else if (stage.id === 'cita' || stage.id === 'visita_realizada') statusUpdate = 'scheduled';
  else if (stage.group === 'linea') statusUpdate = 'qualified';
  else if (stage.id === 'contactado' || stage.id === 'envio_info') statusUpdate = 'active';

  // Registrar nota de bitácora y seguimiento comercial real
  const isLostStage = stage.group === 'no_interesado' || stage.id.startsWith('no_interesado') || stage.id === 'cancelado';
  const nowFormatted = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const actionName = isLostStage ? 'Descarte / No Interesado' : `Cambio a ${stage.label}`;
  const bitacoraEntry = {
    fecha: nowFormatted,
    action: actionName,
    description: `Gestión comercial: Movido a ${stage.label} (${stage.probabilityLabel}) [Fase: ${PIPELINE_GROUPS[stage.group]?.label || stage.group}]`,
    asesor: authorName,
    lastDate: nowFormatted,
  };

  await updateDoc(docRef, {
    pipelineStage: stage.id,
    pipelineGroup: stage.group,
    pipelineProbability: stage.probability,
    pipelineStageLabel: stage.label,
    ...(statusUpdate ? { status: statusUpdate } : {}),
    lastFollowUpAt: serverTimestamp(),
    lastFollowUpAction: isLostStage ? 'descarte_no_interesado' : 'cambio_etapa',
    lastFollowUpSummary: `Movido a ${stage.label} (${stage.probabilityLabel})`,
    lastFollowUpAuthor: authorName,
    bitacoras: arrayUnion(bitacoraEntry),
    'metadata.smarthomeBitacoras': arrayUnion(bitacoraEntry),
    updatedAt: serverTimestamp(),
  });

  const noteText = `📊 Movido en Embudo de Ventas: ${stage.label} (${stage.probabilityLabel}) [Fase: ${PIPELINE_GROUPS[stage.group].label}]`;

  await addDoc(collection(db, 'companies', companyId, 'leads', leadId, 'notes'), {
    companyId,
    leadId,
    authorName,
    kind: 'note',
    text: noteText,
    type: 'pipeline_stage_change',
    newStage: stage.id,
    newStageLabel: stage.label,
    createdAt: Timestamp.now(),
  }).catch(() => {});
}
