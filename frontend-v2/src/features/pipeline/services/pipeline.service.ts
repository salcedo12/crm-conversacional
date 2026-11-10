import {
  collection, doc, getDocs, limit, query, updateDoc, serverTimestamp,
  Timestamp, addDoc, where, arrayUnion,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { normalizeProject } from '@/features/database/pages/DatabasePage';
import {
  PIPELINE_STAGES, PIPELINE_GROUPS, type PipelineCardItem,
  type PipelineStageConfig, type PipelineGroup,
} from '../types/pipeline.types';

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
 * Normaliza fecha para agrupar por mes estilo SmartHome: "Registro de agosto 2026 (X)"
 */
function formatMonthYearHeader(ts: unknown): { label: string; dateStr: string; dateObj: Date | null } {
  let date: Date | null = null;
  if (ts instanceof Timestamp) date = ts.toDate();
  else if (typeof ts === 'string' && ts) date = new Date(ts);
  else if (typeof ts === 'number') date = new Date(ts);

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
  advisorId?: string; // 'all' o uid
  projectFilter?: string; // 'all' o nombre de proyecto
  groupFilter?: PipelineGroup | 'all';
  sourceFilter?: string; // 'all' | 'meta_ads' | 'smarthome' | 'whatsapp_ia' | 'advisor_whatsapp' | 'ferias' | 'web'
  followUpStatus?: 'all' | 'uncontacted' | 'overdue' | 'active';
  dateRange?: 'all' | 'last_30_days' | 'last_60_days' | 'year_2026' | 'year_2025' | 'year_2024';
  limitCount?: number; // 100, 250, 500, 1000
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
        dateRange: 'all',
        limitCount: 500,
      }
    : {
        advisorId: filterOrAdvisorId.advisorId || 'all',
        projectFilter: filterOrAdvisorId.projectFilter || 'all',
        groupFilter: filterOrAdvisorId.groupFilter || 'all',
        sourceFilter: filterOrAdvisorId.sourceFilter || 'all',
        followUpStatus: filterOrAdvisorId.followUpStatus || 'all',
        dateRange: filterOrAdvisorId.dateRange || 'all',
        limitCount: filterOrAdvisorId.limitCount || 500,
      };

  // 1. Obtener asesores de la empresa (tolerante a fallos)
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

  // 2. Consulta de leads inteligente:
  // - Si se filtra por asesor: consulta específica por assignedTo
  // - Si es 'all': consulta prioritaria de leads con etapa de embudo activa (pipelineStage != null)
  //   combinada con la muestra general para garantizar que los leads con ficha o movidos siempre aparezcan.
  const maxLimit = Math.min(Math.max(opts.limitCount || 250, 50), 1000);
  const docsMap = new Map<string, any>();

  if (opts.advisorId && opts.advisorId !== 'all') {
    try {
      const advSnap = await getDocs(
        query(
          collection(db, 'companies', companyId, 'leads'),
          where('assignedTo', '==', opts.advisorId),
          limit(maxLimit)
        )
      );
      advSnap.docs.forEach((d) => docsMap.set(d.id, d));
    } catch (err) {
      console.warn('[pipeline.service] Error consultando leads por asesor:', err);
    }
  } else {
    // 2a. Leads con etapa explícita en el embudo (siempre presentes en el pipeline)
    try {
      const stagedSnap = await getDocs(
        query(
          collection(db, 'companies', companyId, 'leads'),
          where('pipelineStage', '!=', null),
          limit(200)
        )
      );
      stagedSnap.docs.forEach((d) => docsMap.set(d.id, d));
    } catch (err) {
      console.warn('[pipeline.service] Error consultando leads con pipelineStage:', err);
    }

    // 2b. Muestra general de leads para auto-deducción de etapas
    try {
      const generalSnap = await getDocs(
        query(
          collection(db, 'companies', companyId, 'leads'),
          limit(maxLimit)
        )
      );
      generalSnap.docs.forEach((d) => {
        if (!docsMap.has(d.id)) {
          docsMap.set(d.id, d);
        }
      });
    } catch (err) {
      console.warn('[pipeline.service] Error consultando muestra general de leads:', err);
    }
  }

  const allLeadDocs = Array.from(docsMap.values());
  const cards: PipelineCardItem[] = [];
  const now = Date.now();

  // Estadísticas acumuladas para los badges del drawer
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

    // Asesor
    const rawAssigned = data.assignedTo as string | undefined;
    const advisorName = (rawAssigned && advMap.get(rawAssigned)) || (meta.smarthomeAsesorOriginal as string) || 'Sin Asignar';

    // Proyecto normalizado
    const rawProj = (Array.isArray(data.projectInterest) ? data.projectInterest[0] : data.projectInterest)
      || meta.smarthomeProyectoOriginal || meta.webArea || '';
    const projName = normalizeProject(rawProj) || 'Sin especificar';

    // Source label y clasificación con soporte de fuenteUbicacion
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
    const dateInfo = formatMonthYearHeader(data.createdAt);
    const cDate = dateInfo.dateObj;
    const cYear = cDate ? cDate.getFullYear() : null;
    const ageDays = cDate ? Math.floor((now - cDate.getTime()) / (1000 * 60 * 60 * 24)) : 999;

    // Estado de seguimiento
    const isUncontacted = !data.lastMessageAt && !data.lastFollowUpAt && !data.advisorFirstContactAt;
    const nextDateMillis = data.nextFollowUpDate ? Date.parse(data.nextFollowUpDate) : null;
    const isOverdue = !!nextDateMillis && !isNaN(nextDateMillis) && nextDateMillis < now;
    const isActiveFollowUp = !!nextDateMillis && !isNaN(nextDateMillis) && nextDateMillis >= now;

    // Acumular estadísticas globales de la muestra
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

    // ── FILTROS IN-MEMORY ──
    if (opts.advisorId !== 'all' && rawAssigned !== opts.advisorId) {
      return;
    }
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

    // Filtro por fecha / antigüedad
    if (opts.dateRange === 'last_30_days' && ageDays > 30) return;
    if (opts.dateRange === 'last_60_days' && ageDays > 60) return;
    if (opts.dateRange === 'year_2026' && cYear !== 2026) return;
    if (opts.dateRange === 'year_2025' && cYear !== 2025) return;
    if (opts.dateRange === 'year_2024' && cYear !== 2024) return;

    const stageConfig = derivePipelineStage(data);

    // Filtro por grupo/fase si aplica
    if (opts.groupFilter && opts.groupFilter !== 'all' && stageConfig.group !== opts.groupFilter) {
      return;
    }

    // Última bitácora
    const bitacoras = (data.bitacoras || meta.smarthomeBitacoras) as Array<{ action?: string; description?: string; lastDate?: string }> | undefined;
    const latestBitacora = Array.isArray(bitacoras) && bitacoras.length > 0 ? bitacoras[0] : null;

    cards.push({
      id: d.id,
      name: (data.name as string) || 'Cliente Sin Nombre',
      phone: (data.phone as string) || '',
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
      lastBitacora: latestBitacora ? `${latestBitacora.action ? latestBitacora.action + ': ' : ''}${latestBitacora.description || ''}` : undefined,
      lastBitacoraDate: latestBitacora?.lastDate,
      rawLead: data,
    });
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
