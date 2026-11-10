import {
  collection, getDocs, limit, query, where, Timestamp,
  doc, updateDoc, serverTimestamp, addDoc, startAfter, getDoc,
  QueryDocumentSnapshot, DocumentData, orderBy,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { normalizeProject } from '@/features/database/pages/DatabasePage';
import { derivePipelineStage } from '@/features/pipeline/services/pipeline.service';
import { formatFriendlyDate } from '@/shared/utils/date';
import { isRealCommercialFollowUp, isAdvisorMatch } from './commercialReports.service';
import type {
  CommercialLeadItem,
  CommercialKPIs,
  CommercialSuggestion,
} from '../types/commercial.types';

function parseDate(ts: unknown): Date | null {
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
 * Retorna la fecha y hora de inicio de la semana comercial activa de Meraki:
 * - Ciclo semanal continuo: Desde el viernes anterior a las 09:00:00 a. m. (hace 7 días en día viernes).
 * - No se corta por cambio de mes: La semana comercial corre completa de viernes a viernes,
 *   garantizando que ningún prospecto con falta de seguimiento se oculte por inicio de mes.
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

export function mapDocToCommercialLeadItem(
  docId: string,
  data: DocumentData,
  advMap: Map<string, string>,
  now: Date = new Date(),
  weekStart: Date = getCommercialWeekStart(now)
): {
  item: CommercialLeadItem;
  isOverdue: boolean;
  isToday: boolean;
  isUpcoming: boolean;
  hasFicha: boolean;
  completedThisMonth: boolean;
  missingPeriodFollowUp: boolean;
} {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  // Etapa del pipeline
  const stageConfig = derivePipelineStage(data);

  // Bitácoras y notas (CRM + SmartHome, deduplicadas)
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

  // Próximo paso agendado
  const nextDateStr: string | null = data.nextFollowUpDate || (data.metadata?.nextFollowUpDate as string) || null;
  let isOverdue = false;
  let isToday = false;
  let isUpcoming = false;

  if (nextDateStr) {
    const parsedNext = parseDate(nextDateStr);
    if (parsedNext) {
      if (parsedNext < startOfToday) {
        isOverdue = true;
      } else if (parsedNext >= startOfToday && parsedNext <= endOfToday) {
        isToday = true;
      } else if (parsedNext > endOfToday) {
        isUpcoming = true;
      }
    }
  }

  // Comprobar si fue captado o asignado/trasladado en la semana comercial activa
  const createdDate = parseDate(data.createdAt);
  const assignedDate = parseDate(data.advisorAssignedAt);
  const transferDate = parseDate(data.transferDate);
  const isPeriodCreated =
    (createdDate ? (createdDate >= weekStart && createdDate <= now) : false) ||
    (assignedDate ? (assignedDate >= weekStart && assignedDate <= now) : false) ||
    (transferDate ? (transferDate >= weekStart && transferDate <= now) : false) ||
    !!data.isPeriodCreated ||
    !!data.isPeriodAssigned;

  // Comprobar si tiene seguimiento comercial real en la semana comercial
  // Tolerancia de +6h para fichas históricas guardadas en UTC sin zona horaria
  const nowWithUtcTolerance = new Date(now.getTime() + 6 * 3600 * 1000);
  let hadPeriodFollowUp = false;
  for (const b of rawBitacoras) {
    const bDate = parseDate(b.fecha || b.lastDate || b.date);
    if (bDate && bDate >= weekStart && bDate <= nowWithUtcTolerance) {
      if (isRealCommercialFollowUp(b.action, b.description)) {
        hadPeriodFollowUp = true;
        break;
      }
    }
  }

  if (!hadPeriodFollowUp && (data.lastFollowUpAt || data.smartHomeLastBitacoraAt)) {
    const lfuDate = parseDate(data.lastFollowUpAt || data.smartHomeLastBitacoraAt);
    if (lfuDate && lfuDate >= weekStart && lfuDate <= nowWithUtcTolerance) {
      const action = data.lastFollowUpAction || data.smartHomeLastActionLabel || '';
      const desc = (data.lastFollowUpSummary || data.smartHomeLastBitacoraText || data.lastFollowUpAction || '').trim();
      if (isRealCommercialFollowUp(action, desc)) {
        hadPeriodFollowUp = true;
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
    stageConfig.group === 'no_interesado' ||
    stageConfig.id.startsWith('no_interesado') ||
    stageConfig.id === 'cancelado';
  const isClosed = data.status === 'closed' || stageConfig.id === 'firma';
  const missingPeriodFollowUp = isPeriodCreated && !hadPeriodFollowUp && !isLost && !isClosed;

  // Fecha del último seguimiento real
  let completedThisMonth = false;
  const bitacoraDate = (hasBitacoras && rawBitacoras[0])
    ? parseDate(rawBitacoras[0].fecha || rawBitacoras[0].lastDate || rawBitacoras[0].date)
    : null;
  const lfuDate = parseDate(data.lastFollowUpAt);
  // PREFERENCIA ESTRICTA: La fecha de la bitácora histórica siempre refleja la última gestión real.
  const lastDate = bitacoraDate || lfuDate;
  if (lastDate && lastDate.getFullYear() === now.getFullYear() && lastDate.getMonth() === now.getMonth()) {
    completedThisMonth = true;
  }

  // Último resumen de seguimiento
  let lastSummary: string | null = null;
  let lastAction: string | null = data.lastFollowUpAction || null;
  let lastResult: string | null = null;
  let lastAuthor: string | null = null;

  if (hasBitacoras && rawBitacoras[0]) {
    const b0 = rawBitacoras[0];
    lastAction = lastAction || b0.action || 'Gestión';
    lastSummary = b0.description || b0.action || null;
    lastAuthor = b0.asesor || null;
  }

  const advisorName = advMap.get(data.assignedTo) || data.assignedToName || data.smartHomeAdvisorName || 'Sin asignar';

  const item: CommercialLeadItem = {
    id: docId,
    name: data.name || data.clientName || data.fullName || `Lead ${data.phone || ''}`,
    phone: data.phone || data.normalizedPhone || 'Sin teléfono',
    project: normalizeProject(data.projectInterest?.[0] || data.metadata?.project || data.metadata?.['¿qué_proyecto_te_interesa_más?'] || data.project),
    advisorId: data.assignedTo || '',
    advisorName,
    pipelineStage: stageConfig.id,
    pipelineStageLabel: stageConfig.label,
    status: isLost ? 'lost' : (isClosed ? 'closed' : (data.status || 'new')),
    source: data.source || data.metadata?.fuente || data.metadata?.source || 'manual',
    fuenteUbicacion: data.fuenteUbicacion || data.metadata?.fuenteUbicacion || 'Directo',
    hasFicha,
    lastFollowUpDate: lastDate ? formatFriendlyDate(lastDate) : null,
    lastFollowUpAction: lastAction,
    lastFollowUpResult: lastResult,
    lastFollowUpAuthor: lastAuthor,
    lastFollowUpSummary: lastSummary,
    nextFollowUpDate: nextDateStr,
    nextFollowUpAction: data.nextFollowUpAction || (data.metadata?.nextFollowUpAction as string) || null,
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
  targetAdvisorId: string = 'all',
  pageSize: number = 50,
  startAfterDoc: QueryDocumentSnapshot<DocumentData> | null = null,
  isUserAdmin: boolean = false,
  currentUserId?: string
): Promise<{
  leads: CommercialLeadItem[];
  kpis: CommercialKPIs;
  suggestions: CommercialSuggestion[];
  advisors: { id: string; name: string }[];
  lastVisibleDoc: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}> {
  // PRIVACIDAD ESTRICTA:
  // Si el usuario no tiene rol administrativo (admin, manager, platformAdmin),
  // se fuerza estrictamente a consultar únicamente sus leads asignados.
  const effectiveAdvisorId = isUserAdmin
    ? targetAdvisorId
    : (currentUserId || targetAdvisorId || '');

  // 1. Obtener catálogo de asesores y usuarios
  const advMap = new Map<string, string>();
  const advisorsList: { id: string; name: string }[] = [];
  try {
    const usersSnap = await getDocs(collection(db, 'companies', companyId, 'users'));
    usersSnap.docs.forEach((d) => {
      const u = d.data();
      const name = u.displayName || u.name || u.email || d.id;
      advMap.set(d.id, name);
      advisorsList.push({ id: d.id, name });
    });
  } catch (err) {
    console.warn('[commercial.service] Error leyendo usuarios:', err);
  }

  const effectiveAdvName = effectiveAdvisorId ? (advMap.get(effectiveAdvisorId) || '') : '';

  const now = new Date();
  const weekStart = getCommercialWeekStart(now);
  const weekStartTs = Timestamp.fromDate(weekStart);

  const leadCol = collection(db, 'companies', companyId, 'leads');

  // 2. Consultar TODOS los leads creados en la semana comercial activa
  // Esto asegura que NINGÚN lead nuevo captado (por ejemplo, desde pauta de Meta Ads,
  // webhooks o WhatsApp) se pierda, garantizando que los prospectos con "Falta Seguimiento"
  // coincidan exactamente con la auditoría del informe semanal.
  const weekDocsMap = new Map<string, QueryDocumentSnapshot<DocumentData>>();
  try {
    const qWeek = query(
      leadCol,
      where('createdAt', '>=', weekStartTs)
    );
    const snapWeek = await getDocs(qWeek);
    for (const d of snapWeek.docs) {
      const lData = d.data();
      if (effectiveAdvisorId && effectiveAdvisorId !== 'all') {
        const assigned = lData.assignedTo || '';
        const smartName = lData.smartHomeAdvisorName || lData.assignedToName || '';
        const isMatch =
          assigned === effectiveAdvisorId ||
          (effectiveAdvName && (isAdvisorMatch(assigned, effectiveAdvName) || isAdvisorMatch(smartName, effectiveAdvName)));
        if (!isMatch) continue;
      }
      weekDocsMap.set(d.id, d);
    }
  } catch (err) {
    console.warn('[commercial.service] Fallback consultando leads de la semana:', err);
  }

  // 2.1 Consultar también leads asignados o trasladados en la semana comercial activa
  try {
    const qAssignedWeek = query(
      leadCol,
      where('advisorAssignedAt', '>=', weekStartTs)
    );
    const snapAssignedWeek = await getDocs(qAssignedWeek);
    for (const d of snapAssignedWeek.docs) {
      const lData = d.data();
      if (effectiveAdvisorId && effectiveAdvisorId !== 'all') {
        const assigned = lData.assignedTo || '';
        const smartName = lData.smartHomeAdvisorName || lData.assignedToName || '';
        const isMatch =
          assigned === effectiveAdvisorId ||
          (effectiveAdvName && (isAdvisorMatch(assigned, effectiveAdvName) || isAdvisorMatch(smartName, effectiveAdvName)));
        if (!isMatch) continue;
      }
      weekDocsMap.set(d.id, d);
    }
  } catch {
    // Continuar si faltara índice en alguna instancia
  }

  // 3. Consulta de leads paginada por lotes (50 por defecto en lugar de 400)
  let docs: QueryDocumentSnapshot<DocumentData>[] = [];

  try {
    const baseConstraints: any[] = [];

    // Si hay un asesor objetivo o el usuario es asesor individual, filtrar estrictamente
    if (effectiveAdvisorId && effectiveAdvisorId !== 'all') {
      baseConstraints.push(where('assignedTo', '==', effectiveAdvisorId));
    }

    // Ordenar para que los prospectos MÁS RECIENTES (pauta Meta Ads, mensajes y nuevas llegadas) aparezcan de primero
    try {
      const qOrdered = query(
        leadCol,
        ...baseConstraints,
        orderBy('lastMessageAt', 'desc'),
        ...(startAfterDoc ? [startAfter(startAfterDoc)] : []),
        limit(pageSize)
      );
      const snap = await getDocs(qOrdered);
      docs = snap.docs;
    } catch {
      // Fallback sin orderBy si faltara índice en algún filtro específico
      const qFallback = query(
        leadCol,
        ...baseConstraints,
        ...(startAfterDoc ? [startAfter(startAfterDoc)] : []),
        limit(pageSize)
      );
      const snapFallback = await getDocs(qFallback);
      docs = snapFallback.docs;
    }
  } catch (err) {
    console.error('[commercial.service] Error consultando leads:', err);
  }

  const lastVisibleDoc = docs.length > 0 ? docs[docs.length - 1] : null;
  const hasMore = docs.length === pageSize;

  // Combinar los leads de la semana en la primera página para garantizar
  // que aparezcan inmediatamente disponibles en la vista
  const allDocsMap = new Map<string, QueryDocumentSnapshot<DocumentData>>();
  if (!startAfterDoc) {
    for (const [id, d] of weekDocsMap.entries()) {
      allDocsMap.set(id, d);
    }
  }
  for (const d of docs) {
    if (!allDocsMap.has(d.id)) {
      allDocsMap.set(d.id, d);
    }
  }

  const finalDocs = Array.from(allDocsMap.values());

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
    const { item, isOverdue, isToday, isUpcoming, hasFicha, completedThisMonth, missingPeriodFollowUp } =
      mapDocToCommercialLeadItem(docSnap.id, docSnap.data(), advMap, now, weekStart);

    const isLost = item.status === 'lost';
    const isClosed = item.status === 'closed';

    if (isLost) {
      cancelledCount++;
    } else if (isClosed) {
      closedCount++;
    } else {
      if (missingPeriodFollowUp) missingFollowUpCount++;
      if (isOverdue) overdueCount++;
      else if (isToday) todayCount++;
      else if (isUpcoming) upcomingCount++;

      if (!hasFicha) missingFichaCount++;
      if (completedThisMonth) completedThisMonthCount++;
    }

    leads.push(item);
  }

  // Ordenar leads con prioridad operativa activa:
  // 1. Cancelados y cerrados van al fondo en la vista global
  // 2. Prospectos captados en la semana sin seguimiento comercial (FALTA SEGUIMIENTO) de primeros
  // 3. Vencidos primero
  // 4. Programados para hoy
  // 5. Sin ficha técnica
  // 6. Resto por fecha más reciente
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

  const kpis: CommercialKPIs = {
    missingFollowUpCount,
    overdueCount,
    todayCount,
    missingFichaCount,
    upcomingCount,
    completedThisMonthCount,
    cancelledCount,
    closedCount,
    totalLeads: leads.length,
  };

  // Generar sugerencias inteligentes para el asesor
  const suggestions: CommercialSuggestion[] = [];

  if (missingFollowUpCount > 0) {
    suggestions.push({
      id: 'sug-missing-followup',
      type: 'missing_followup',
      icon: '',
      title: `${missingFollowUpCount} prospecto${missingFollowUpCount > 1 ? 's' : ''} de la semana sin seguimiento`,
      description: 'Prospectos captados en la semana comercial activa que aún no registran llamadas ni bitácoras de gestión.',
      count: missingFollowUpCount,
      actionFilter: 'missing_followup',
      badgeColor: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
    });
  }

  if (overdueCount > 0) {
    suggestions.push({
      id: 'sug-overdue',
      type: 'urgent',
      icon: '',
      title: `${overdueCount} seguimiento${overdueCount > 1 ? 's' : ''} vencido${overdueCount > 1 ? 's' : ''}`,
      description: 'Tenías fecha límite de contacto programada para estos prospectos y ya expiró. Recontáctalos cuanto antes para no enfriar el interés.',
      count: overdueCount,
      actionFilter: 'urgent',
      badgeColor: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
    });
  }

  if (todayCount > 0) {
    suggestions.push({
      id: 'sug-today',
      type: 'today',
      icon: '',
      title: `${todayCount} contacto${todayCount > 1 ? 's' : ''} programado${todayCount > 1 ? 's' : ''} para hoy`,
      description: 'Tienes acuerdos de llamadas, reuniones o envío de cotizaciones agendados para realizarse hoy.',
      count: todayCount,
      actionFilter: 'today',
      badgeColor: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    });
  }

  if (missingFichaCount > 0) {
    suggestions.push({
      id: 'sug-missing',
      type: 'missing_ficha',
      icon: '',
      title: `${missingFichaCount} prospecto${missingFichaCount > 1 ? 's' : ''} sin primera ficha técnica`,
      description: 'Aún no has registrado acuerdos o resumen inicial en la bitácora de estos contactos.',
      count: missingFichaCount,
      actionFilter: 'missing',
      badgeColor: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
    });
  }

  return { leads, kpis, suggestions, advisors: advisorsList, lastVisibleDoc, hasMore };
}

/**
 * Registra una acción rápida de "No Contestó" con 1 clic:
 * - Agrega entrada en la bitácora del lead.
 * - Reprograma un recordatorio activo para dentro de 3 horas o mañana a las 9:30 am.
 * - Registra la nota en Firestore.
 */
export async function registerQuickNoContesto(
  companyId: string,
  lead: CommercialLeadItem,
  authorName = 'Asesor'
): Promise<{ nextFollowUpDate: string; nextFollowUpAction: string; bitacoraEntry: any }> {
  const now = new Date();
  const nowFormatted = now.toISOString().replace('T', ' ').slice(0, 19);

  // Calcular próximo reintento: 3 horas después, o si ya es tarde (después de 4:30pm), mañana a las 9:30 am
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

  const existingBitacoras = lead.bitacoras || [];
  const updatedBitacoras = [bitacoraEntry, ...existingBitacoras].slice(0, 50);

  const leadRef = doc(db, 'companies', companyId, 'leads', lead.id);
  const leadUpdates: Record<string, any> = {
    lastFollowUpAt: serverTimestamp(),
    lastFollowUpAction: 'llamada',
    nextFollowUpDate: nextDateFormatted,
    nextFollowUpAction: 'Reintentar Llamada',
    bitacoras: updatedBitacoras,
    'metadata.smarthomeBitacoras': updatedBitacoras,
    updatedAt: serverTimestamp(),
  };
  if (lead.status === 'lost') {
    leadUpdates.status = 'active';
  }
  await updateDoc(leadRef, leadUpdates);

  // Guardar en subcolección notes
  const notesCol = collection(db, 'companies', companyId, 'leads', lead.id, 'notes');
  await addDoc(notesCol, {
    companyId,
    leadId: lead.id,
    authorName,
    text: `📞 INTENTO DE LLAMADA · Sin respuesta\n• Resultado: Cliente no contestó o envió a buzón de voz.\n• Próximo reintento: ${nextDateFormatted}`,
    kind: 'note',
    actionType: 'llamada',
    result: 'No contestó',
    createdAt: serverTimestamp(),
  }).catch(() => {});

  // Crear recordatorio activo
  await addDoc(notesCol, {
    companyId,
    leadId: lead.id,
    authorName,
    text: `⏰ Recordatorio: Reintentar llamada con ${lead.name}`,
    dueAt: Timestamp.fromDate(nextDate),
    kind: 'reminder',
    done: false,
    notified: false,
    createdAt: serverTimestamp(),
    leadName: lead.name,
    leadPhone: lead.phone,
    project: lead.project,
    nextAction: 'Reintentar Llamada',
    assignedTo: lead.advisorId || undefined,
  }).catch(() => {});

  return {
    nextFollowUpDate: nextDateFormatted,
    nextFollowUpAction: 'Reintentar Llamada',
    bitacoraEntry,
  };
}

/**
 * Exporta el conjunto de prospectos actualmente filtrados a un archivo CSV
 * formateado con BOM UTF-8 compatible con Microsoft Excel.
 */
export function exportCommercialLeadsToCsv(
  leads: CommercialLeadItem[],
  filename = `gestion_comercial_${new Date().toISOString().slice(0, 10)}.csv`
) {
  const headers = [
    'Nombre',
    'Teléfono',
    'Proyecto',
    'Etapa Embudo',
    'Asesor Asignado',
    'Última Gestión Fecha',
    'Última Gestión Acción',
    'Última Gestión Asesor',
    'Última Gestión Resumen',
    'Próximo Seguimiento Fecha',
    'Próximo Seguimiento Acción',
    'Estado / Urgencia',
    'Total Gestiones Registradas',
    'Historial de Bitácoras'
  ];

  const rows = leads.map((l) => {
    let urgencia = 'Al día';
    if (l.isOverdue) urgencia = 'Vencido';
    else if (l.isToday) urgencia = 'Para Hoy';
    else if (!l.hasFicha) urgencia = 'Sin Ficha';
    else if (l.isUpcoming) urgencia = 'Próximo';

    const bitacorasText = (l.bitacoras || [])
      .slice(0, 5)
      .map((b) => `[${b.fecha || b.lastDate || ''} - ${b.asesor || ''}]: ${b.action || ''} (${b.description || ''})`)
      .join(' || ');

    const escapeCsv = (val: any) => {
      const str = String(val ?? '').replace(/"/g, '""');
      return `"${str}"`;
    };

    return [
      escapeCsv(l.name),
      escapeCsv(l.phone),
      escapeCsv(l.project),
      escapeCsv(l.pipelineStageLabel),
      escapeCsv(l.advisorName),
      escapeCsv(l.lastFollowUpDate || ''),
      escapeCsv(l.lastFollowUpAction || ''),
      escapeCsv(l.lastFollowUpAuthor || ''),
      escapeCsv(l.lastFollowUpSummary || ''),
      escapeCsv(l.nextFollowUpDate || ''),
      escapeCsv(l.nextFollowUpAction || ''),
      escapeCsv(urgencia),
      escapeCsv(l.bitacorasCount || 0),
      escapeCsv(bitacorasText)
    ].join(',');
  });

  const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Búsqueda profunda en toda la base de datos de Firestore por número de teléfono exacto,
 * dígitos limpios (ej: 3022911626 o +573022911626), nombre o ID directo.
 */
export async function searchCommercialLeads(
  companyId: string,
  searchTerm: string,
  targetAdvisorId: string = 'all',
  isUserAdmin: boolean = false,
  currentUserId?: string,
  advMap?: Map<string, string>
): Promise<CommercialLeadItem[]> {
  const term = searchTerm.trim();
  if (!term || !companyId) return [];

  const effectiveAdvisorId = isUserAdmin
    ? targetAdvisorId
    : (currentUserId || targetAdvisorId || '');

  // Cargar catálogo de asesores si no fue provisto
  const resolvedAdvMap = advMap ? new Map(advMap) : new Map<string, string>();
  if (resolvedAdvMap.size === 0) {
    try {
      const usersSnap = await getDocs(collection(db, 'companies', companyId, 'users'));
      usersSnap.docs.forEach((d) => {
        const u = d.data();
        resolvedAdvMap.set(d.id, u.displayName || u.name || u.email || d.id);
      });
    } catch (e) {
      console.warn('[searchCommercialLeads] Error cargando usuarios:', e);
    }
  }

  const leadCol = collection(db, 'companies', companyId, 'leads');
  const docsMap = new Map<string, DocumentData & { id: string }>();

  // 1. Si contiene dígitos numéricos (búsqueda de teléfono)
  const cleanDigits = term.replace(/\D/g, '');
  const isDigitsSearch = cleanDigits.length >= 3;

  if (isDigitsSearch) {
    const promises: Promise<any>[] = [];
    if (cleanDigits.length >= 7) {
      const tail = cleanDigits.slice(-10);
      promises.push(getDocs(query(leadCol, where('phoneTail', '==', tail), limit(25))));
      promises.push(getDocs(query(leadCol, where('normalizedPhone', '==', `+57${tail}`), limit(25))));
      promises.push(getDocs(query(leadCol, where('normalizedPhone', '==', `+${cleanDigits}`), limit(25))));
      promises.push(getDocs(query(leadCol, where('phone', '==', `+57${tail}`), limit(25))));
      promises.push(getDocs(query(leadCol, where('phone', '==', tail), limit(25))));
      promises.push(getDocs(query(leadCol, where('phone', '==', `+${cleanDigits}`), limit(25))));
      promises.push(getDocs(query(leadCol, where('phone', '==', term), limit(25))));
    } else {
      promises.push(
        getDocs(query(
          leadCol,
          where('normalizedPhone', '>=', `+57${cleanDigits}`),
          where('normalizedPhone', '<=', `+57${cleanDigits}\uf8ff`),
          limit(25)
        ))
      );
      promises.push(
        getDocs(query(
          leadCol,
          where('phone', '>=', `+57${cleanDigits}`),
          where('phone', '<=', `+57${cleanDigits}\uf8ff`),
          limit(25)
        ))
      );
    }
    const snaps = await Promise.all(promises);
    snaps.forEach((s) => s.forEach((d: any) => docsMap.set(d.id, { id: d.id, ...d.data() })));
  }

  // 2. Búsqueda por nombre o texto
  if (!isDigitsSearch || cleanDigits.length < 10) {
    const variations = new Set<string>([
      term,
      term.toLowerCase(),
      term.toUpperCase(),
      term.charAt(0).toUpperCase() + term.slice(1).toLowerCase(),
    ]);
    const promises: Promise<any>[] = [];
    for (const v of variations) {
      promises.push(
        getDocs(query(
          leadCol,
          where('name', '>=', v),
          where('name', '<=', v + '\uf8ff'),
          limit(25)
        ))
      );
    }
    const snaps = await Promise.all(promises);
    snaps.forEach((s) => s.forEach((d: any) => docsMap.set(d.id, { id: d.id, ...d.data() })));
  }

  // 3. Chequeo por ID directo de documento
  try {
    const directDoc = await getDoc(doc(leadCol, term));
    if (directDoc.exists()) {
      docsMap.set(directDoc.id, { id: directDoc.id, ...directDoc.data() });
    }
  } catch (_) {}

  // 4. Filtrar por asesor según permisos (si es asesor individual o si un admin seleccionó un asesor)
  let rawList = Array.from(docsMap.values());
  if (effectiveAdvisorId && effectiveAdvisorId !== 'all') {
    rawList = rawList.filter((d) => d.assignedTo === effectiveAdvisorId);
  }

  // 5. Mapear a CommercialLeadItem
  const now = new Date();
  return rawList.map((d) => mapDocToCommercialLeadItem(d.id, d, resolvedAdvMap, now).item);
}
