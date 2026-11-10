const path = require('path');
const admin = require(path.join(__dirname, '../functions/node_modules/firebase-admin'));
const sa = require(path.join(__dirname, '../service-account.json'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(sa),
  });
}

const db = admin.firestore();

const LEAD_STATUSES = ['new', 'active', 'qualified', 'scheduled', 'lost', 'closed'];
const LEAD_SOURCES  = ['meta_ads', 'google_ads', 'whatsapp', 'web', 'advisor_whatsapp', 'manual', 'facebook', 'instagram'];
const LINE_317_SOURCES = new Set(['whatsapp', 'web', 'meta_ads', 'google_ads']);

const MONTH_NAMES = {
  'today':     '⚡ Hoy',
  'yesterday': '⚡ Ayer',
  '7d':        '⚡ Últimos 7 días (Esta semana)',
  '14d':       '⚡ Últimas 2 semanas (14 días)',
  '30d':       '⚡ Últimos 30 días',
  '2026-10':   '📅 Octubre 2026 (Mes actual)',
  '2026-09':   '📅 Septiembre 2026',
  '2026-08':   '📅 Agosto 2026',
  'all':       '🚀 Todo el período de Pauta (Agosto - Octubre 2026)',
};

function isMigrated(lead) {
  if (lead.metadata && lead.metadata.migratedFrom) return true;
  if (lead.tags && Array.isArray(lead.tags) && lead.tags.includes('smarthome_migracion')) return true;
  return false;
}

function isDirectAdvisorLead(lead) {
  if (lead.inbox === 'advisor_direct') return true;
  if (lead.source === 'advisor_whatsapp') return true;
  if (lead.metadata && (lead.metadata.advisorWhatsappMirror === 'true' || lead.metadata.advisorWhatsappMirror === true)) return true;
  return false;
}

function countsAs317LineLead(lead) {
  if (isDirectAdvisorLead(lead)) return false;
  if (isMigrated(lead)) return false;
  return LINE_317_SOURCES.has(lead.source);
}

function normalizeProject(raw) {
  if (!raw) return 'Sin especificar';
  const s = String(raw).toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (s.includes('arizona') || s.includes('canon') || s.includes('canion')) return 'Cañón de Arizona';
  if (s.includes('llano grande') || s.includes('llanogrande')) return 'Llano Grande';
  if (
    s.includes('tres') || s.includes('los 3') || s.includes('varios') ||
    (s.includes('melgar') && s.includes('mariquita')) ||
    (s.includes('melgar') && s.includes('alvarado')) ||
    (s.includes('alvarado') && s.includes('mariquita')) ||
    s.includes('diferentes ubicaciones') || s.includes('todos')
  ) {
    return 'Portafolio (Varios Proyectos)';
  }
  if (s.includes('laguna') || s.includes('santorini') || s.includes('canarias') || s.includes('melgar') || s.includes('bungalow')) return 'Laguna Mar';
  if (s.includes('rio claro') || s.includes('mariquita')) return 'Río Claro';
  if (s.includes('montana') || s.includes('montanas') || s.includes('alvarado') || s.includes('al varado')) return 'Sobre Montañas (Alvarado)';
  if (s.includes('campestre') || s.includes('lote') || s.includes('terreno') || s.includes('vivienda')) return 'Lotes Campestres (Interés General)';

  return 'Otros / Por Clasificar';
}

function getCreatedMs(lead) {
  if (lead.createdAt && typeof lead.createdAt.toMillis === 'function') {
    return lead.createdAt.toMillis();
  }
  if (lead.createdAt && typeof lead.createdAt.seconds === 'number') {
    return lead.createdAt.seconds * 1000;
  }
  if (typeof lead.createdAt === 'number') return lead.createdAt;
  if (typeof lead.createdAt === 'string') {
    const t = Date.parse(lead.createdAt);
    return isNaN(t) ? 0 : t;
  }
  return 0;
}

function computeSubsetMetrics(leadsSubset, allRawSubset, apptsSubset, advisorName, now, label, periodKey) {
  const DAY = 86_400_000;
  const since7  = now - 7  * DAY;
  const since30 = now - 30 * DAY;

  // Filtrado estricto a Pauta Línea 317
  const central317Leads = leadsSubset.filter(countsAs317LineLead);
  const advisorDirectLeads = leadsSubset.filter((l) => isDirectAdvisorLead(l));
  const reactivatedCount = leadsSubset.filter((l) => (l.reactivationCount ?? 0) > 0).length;

  const leads = central317Leads;

  const statusCount = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0]));
  const sourceCount = Object.fromEntries(LEAD_SOURCES.map((s) => [s, 0]));
  const firstTouchCount = new Map();
  const projectCount = new Map();
  const advisorCount = new Map();

  let newLeads7d = 0;
  let newLeads30d = 0;

  // Daily map (últimos 14 días para la gráfica)
  const dailyMap = new Map();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * DAY);
    dailyMap.set(d.toISOString().slice(0, 10), 0);
  }

  let analyzedCount = 0;
  let scoreSum = 0;
  let lostTotal = 0;
  let lostAnalyzed = 0;
  const tempCount = { hot: 0, warm: 0, cold: 0 };
  const lossCount = new Map();

  for (const lead of leads) {
    if (lead.status in statusCount) statusCount[lead.status]++;
    const effectiveSource = lead.lastTouch?.source || lead.source;
    if (effectiveSource && effectiveSource in sourceCount) {
      sourceCount[effectiveSource]++;
    } else if (lead.source && lead.source in sourceCount) {
      sourceCount[lead.source]++;
    }

    const ftSource = lead.firstTouch?.source || lead.source || 'whatsapp';
    firstTouchCount.set(ftSource, (firstTouchCount.get(ftSource) ?? 0) + 1);

    const customProj = lead.customFields?.proyecto;
    const rawProj = lead.projectInterest || customProj || lead.metadata?.project || lead.metadata?.smarthomeProyectoOriginal || lead.firstTouch?.project;
    const cleanProj = normalizeProject(Array.isArray(rawProj) ? rawProj[0] : rawProj);
    if (cleanProj && cleanProj !== 'Sin especificar' && cleanProj !== 'Otros / Por Clasificar') {
      projectCount.set(cleanProj, (projectCount.get(cleanProj) ?? 0) + 1);
    }

    const key = lead.assignedTo ?? '__none__';
    advisorCount.set(key, (advisorCount.get(key) ?? 0) + 1);

    const createdMs = getCreatedMs(lead);
    if (createdMs >= since7)  newLeads7d++;
    if (createdMs >= since30) newLeads30d++;
    const dayKey = createdMs ? new Date(createdMs).toISOString().slice(0, 10) : '';
    if (dayKey && dailyMap.has(dayKey)) dailyMap.set(dayKey, (dailyMap.get(dayKey) ?? 0) + 1);

    const ai = lead.aiAnalysis;
    if (lead.status === 'lost') lostTotal++;
    if (ai && typeof ai.score === 'number') {
      analyzedCount++;
      scoreSum += ai.score;
      if (ai.temperature === 'hot' || ai.temperature === 'warm' || ai.temperature === 'cold') {
        tempCount[ai.temperature]++;
      }
      if (lead.status === 'lost') {
        lostAnalyzed++;
        if (ai.lossCategory && ai.lossCategory !== 'ninguno') {
          lossCount.set(ai.lossCategory, (lossCount.get(ai.lossCategory) ?? 0) + 1);
        }
      }
    }
  }

  const aiInsights = {
    analyzedCount,
    avgScore:     analyzedCount > 0 ? Math.round(scoreSum / analyzedCount) : 0,
    temperature:  tempCount,
    lostTotal,
    lostAnalyzed,
    lossReasons:  [...lossCount.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
  };

  let upcoming = 0, completed = 0, canceled = 0;
  const appointmentAdvisorCount = new Map();

  for (const a of apptsSubset) {
    const advisorKey = a.advisorId ?? '__none__';
    const advisorStats = appointmentAdvisorCount.get(advisorKey) ?? {
      total: 0,
      upcoming: 0,
      completed: 0,
      canceled: 0,
    };
    advisorStats.total++;

    if (a.status === 'completed') {
      completed++;
      advisorStats.completed++;
    } else if (a.status === 'canceled') {
      canceled++;
      advisorStats.canceled++;
    } else if (a.status === 'scheduled') {
      const apptMs = a.startTime?.toMillis?.() ?? (a.startTime?.seconds ? a.startTime.seconds * 1000 : 0);
      if (apptMs >= now) {
        upcoming++;
        advisorStats.upcoming++;
      }
    }

    appointmentAdvisorCount.set(advisorKey, advisorStats);
  }

  const total = leads.length;
  const converted = statusCount['scheduled'] + statusCount['closed'];
  const conversionRate = total > 0 ? Math.round((converted / total) * 1000) / 10 : 0;

  return {
    month: periodKey,
    label,
    totalLeads: total,
    inboxBreakdown: {
      central317Count:    central317Leads.length,
      advisorDirectCount: advisorDirectLeads.length,
      reactivatedCount,
      allContactsTotal:   allRawSubset.length,
    },
    leadsByStatus: LEAD_STATUSES.map((s) => ({ status: s, count: statusCount[s] })),
    leadsBySource: LEAD_SOURCES.map((s) => ({ source: s, count: sourceCount[s] }))
      .filter((x) => x.count > 0),
    firstTouchBySource: [...firstTouchCount.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count),
    leadsByProject: [...projectCount.entries()]
      .map(([project, count]) => ({ project, count }))
      .sort((a, b) => b.count - a.count),
    leadsByAdvisor: [...advisorCount.entries()]
      .map(([id, count]) => ({
        advisorId: id === '__none__' ? null : id,
        name:      id === '__none__' ? 'Sin asignar' : (advisorName.get(id) ?? id),
        count,
      }))
      .sort((a, b) => b.count - a.count),
    appointments: { total: apptsSubset.length, upcoming, completed, canceled },
    appointmentsByAdvisor: [...appointmentAdvisorCount.entries()]
      .map(([id, stats]) => ({
        advisorId: id === '__none__' ? null : id,
        name:      id === '__none__' ? 'Sin asignar' : (advisorName.get(id) ?? id),
        ...stats,
      }))
      .sort((a, b) => b.total - a.total),
    conversionRate,
    newLeads7d,
    newLeads30d,
    dailyNewLeads: [...dailyMap.entries()].map(([date, count]) => ({ date, count })),
    aiInsights,
    generatedAt: now,
  };
}

async function run() {
  const companyId = 'grupo_meraki_real';
  console.log(`[PautaMetricsEngine] Leyendo colecciones de ${companyId}...`);
  const companyRef = db.collection('companies').doc(companyId);

  const [leadsSnap, apptsSnap, usersSnap] = await Promise.all([
    companyRef.collection('leads')
      .select(
        'status', 'source', 'assignedTo', 'createdAt', 'inbox', 
        'firstTouch', 'lastTouch', 'projectInterest', 'reactivationCount', 
        'customFields', 'aiAnalysis', 'metadata', 'tags'
      ).get(),
    companyRef.collection('appointments').get(),
    companyRef.collection('users').get(),
  ]);

  console.log(`[PautaMetricsEngine] Total leads en base: ${leadsSnap.docs.length}`);

  const rawAllLeads = leadsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const appts = apptsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const advisorName = new Map();
  usersSnap.docs.forEach((d) => {
    const u = d.data();
    advisorName.set(d.id, u.displayName || u.email || d.id);
  });

  const now = new Date();
  const nowMs = now.getTime();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const since7d = nowMs - 7 * 86400000;
  const since14d = nowMs - 14 * 86400000;
  const since30d = nowMs - 30 * 86400000;

  // Filtrar estrictamente prospectos de Pauta / Línea 317 creados desde Agosto 2026 hacia acá
  const pautaLeads = [];
  const migratedLeads = [];

  for (const lead of rawAllLeads) {
    if (isMigrated(lead)) {
      migratedLeads.push(lead);
    } else if (countsAs317LineLead(lead)) {
      const ms = getCreatedMs(lead);
      if (ms) {
        const mKey = new Date(ms).toISOString().slice(0, 7);
        // Descartar meses anteriores a agosto 2026 (cuando no había pauta activa en el CRM)
        if (mKey >= '2026-08') {
          pautaLeads.push(lead);
        }
      }
    }
  }

  console.log(`[PautaMetricsEngine] Leads estrictos Pauta 317 (Agosto en adelante): ${pautaLeads.length}`);

  // Agrupar leads por períodos
  const subsets = {
    today:     pautaLeads.filter(l => getCreatedMs(l) >= startOfToday),
    yesterday: pautaLeads.filter(l => {
      const ms = getCreatedMs(l);
      return ms >= startOfYesterday && ms < startOfToday;
    }),
    '7d':      pautaLeads.filter(l => getCreatedMs(l) >= since7d),
    '14d':     pautaLeads.filter(l => getCreatedMs(l) >= since14d),
    '30d':     pautaLeads.filter(l => getCreatedMs(l) >= since30d),
    '2026-10': pautaLeads.filter(l => new Date(getCreatedMs(l)).toISOString().slice(0, 7) === '2026-10'),
    '2026-09': pautaLeads.filter(l => new Date(getCreatedMs(l)).toISOString().slice(0, 7) === '2026-09'),
    '2026-08': pautaLeads.filter(l => new Date(getCreatedMs(l)).toISOString().slice(0, 7) === '2026-08'),
    all:       pautaLeads,
  };

  const apptsSubsets = {
    today:     appts.filter(a => {
      const ms = a.startTime?.toMillis?.() ?? (a.startTime?.seconds ? a.startTime.seconds * 1000 : 0);
      return ms >= startOfToday;
    }),
    yesterday: appts.filter(a => {
      const ms = a.startTime?.toMillis?.() ?? (a.startTime?.seconds ? a.startTime.seconds * 1000 : 0);
      return ms >= startOfYesterday && ms < startOfToday;
    }),
    '7d':      appts.filter(a => {
      const ms = a.startTime?.toMillis?.() ?? (a.startTime?.seconds ? a.startTime.seconds * 1000 : 0);
      return ms >= since7d;
    }),
    '14d':     appts.filter(a => {
      const ms = a.startTime?.toMillis?.() ?? (a.startTime?.seconds ? a.startTime.seconds * 1000 : 0);
      return ms >= since14d;
    }),
    '30d':     appts.filter(a => {
      const ms = a.startTime?.toMillis?.() ?? (a.startTime?.seconds ? a.startTime.seconds * 1000 : 0);
      return ms >= since30d;
    }),
    '2026-10': appts.filter(a => {
      const ms = a.startTime?.toMillis?.() ?? (a.startTime?.seconds ? a.startTime.seconds * 1000 : 0);
      return ms ? new Date(ms).toISOString().slice(0, 7) === '2026-10' : false;
    }),
    '2026-09': appts.filter(a => {
      const ms = a.startTime?.toMillis?.() ?? (a.startTime?.seconds ? a.startTime.seconds * 1000 : 0);
      return ms ? new Date(ms).toISOString().slice(0, 7) === '2026-09' : false;
    }),
    '2026-08': appts.filter(a => {
      const ms = a.startTime?.toMillis?.() ?? (a.startTime?.seconds ? a.startTime.seconds * 1000 : 0);
      return ms ? new Date(ms).toISOString().slice(0, 7) === '2026-08' : false;
    }),
    all:       appts,
  };

  const monthsData = {};
  const availableMonths = [
    // ⚡ Días y Semanas
    { key: 'today',     label: '⚡ Hoy',                             count: subsets.today.length,     group: 'dias' },
    { key: 'yesterday', label: '⚡ Ayer',                            count: subsets.yesterday.length, group: 'dias' },
    { key: '7d',        label: '⚡ Últimos 7 días (Esta semana)',    count: subsets['7d'].length,      group: 'dias' },
    { key: '14d',       label: '⚡ Últimas 2 semanas (14 días)',     count: subsets['14d'].length,     group: 'dias' },
    { key: '30d',       label: '⚡ Últimos 30 días',                 count: subsets['30d'].length,     group: 'dias' },
    // 📅 Mes a Mes
    { key: '2026-10',   label: '📅 Octubre 2026 (Mes actual)',       count: subsets['2026-10'].length, group: 'meses' },
    { key: '2026-09',   label: '📅 Septiembre 2026',                 count: subsets['2026-09'].length, group: 'meses' },
    { key: '2026-08',   label: '📅 Agosto 2026',                     count: subsets['2026-08'].length, group: 'meses' },
    // 🚀 Período Activo Completo
    { key: 'all',       label: '🚀 Todo el período de Pauta (Agosto - Octubre 2026)', count: subsets.all.length, group: 'total' },
  ];

  for (const item of availableMonths) {
    const k = item.key;
    const lSubset = subsets[k] || [];
    const aSubset = apptsSubsets[k] || [];
    monthsData[k] = computeSubsetMetrics(
      lSubset,
      lSubset,
      aSubset,
      advisorName,
      nowMs,
      item.label,
      k
    );
  }

  // Database stats de la base completa
  const activeAdvisorsAssigned = rawAllLeads.filter(l => l.assignedTo).length;
  const unassignedOrFormer = rawAllLeads.filter(l => !l.assignedTo).length;

  const databaseStats = {
    totalContacts: rawAllLeads.length,
    migratedSmarthome: migratedLeads.length,
    pautaTotal: pautaLeads.length,
    activeAdvisorsAssigned,
    unassignedOrFormer,
  };

  // Por defecto el mes actual
  const defaultMonth = '2026-10';
  const defaultMetrics = monthsData[defaultMonth] || monthsData['all'];

  const finalPayload = {
    ...defaultMetrics,
    defaultMonth,
    availableMonths,
    monthsData,
    databaseStats,
  };

  const cacheDocRef = companyRef.collection('reportCache').doc('dashboard__all');
  await cacheDocRef.set({
    payload: finalPayload,
    computedAt: nowMs,
  });

  console.log(`[PautaMetricsEngine] ✅ Éxito: Guardado reporte estricto de Pauta 317 en Firestore.`);
  console.log('Resumen de períodos generados:');
  availableMonths.forEach(m => console.log(` - ${m.key}: ${m.label} (${m.count} leads)`));
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
