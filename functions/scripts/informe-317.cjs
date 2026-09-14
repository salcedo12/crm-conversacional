/**
 * Informe 317 — Grupo Constructor Meraki.
 *
 * Consolida TODO lo que entró al CRM por la línea 317 (pauta click-to-WhatsApp,
 * formularios/web y WhatsApp orgánico al 317), EXCLUYENDO los datos que entran
 * directo al WhatsApp personal del asesor (source `advisor_whatsapp`).
 *
 * Para cada lead cruza además su BITÁCORA en SmartHome (búsqueda por teléfono de
 * los 606) para ver si el asesor escribió algo allí, cuántas notas, la última y su
 * etapa/asesor en SmartHome.
 *
 * Salidas por asesor, por anuncio/campaña/formulario (incluye segmento España vs
 * Corferias) y análisis de chat (por qué no compró) desde lead.aiAnalysis.
 *
 * Uso:
 *   node functions/scripts/informe-317.cjs            # read-only, escribe JSON a scratchpad
 *   node functions/scripts/informe-317.cjs --persist  # además guarda el resumen SmartHome en cada lead
 *
 * Requiere service-account.json en la raíz del repo y functions/lib compilado.
 */
const fs = require('fs');
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'C:/crm-conversacional/service-account.json';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'crm-conversacional';
const admin = require('C:/crm-conversacional/functions/node_modules/firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(require('C:/crm-conversacional/service-account.json')), projectId: 'crm-conversacional' });
}
const sh = require('C:/crm-conversacional/functions/lib/integrations/smarthome/smarthome.client.js');
const db = admin.firestore();

const CID = 'grupo_meraki_real';
const PERSIST = process.argv.includes('--persist');
const OUT = 'C:/Users/INGENI~1/AppData/Local/Temp/claude/C--crm-conversacional/5e301df6-1268-42dc-95e9-acf3dfbc943e/scratchpad/informe-317.json';

const LINE = new Set(['whatsapp', 'web', 'meta_ads']);
const OPEN = new Set(['new', 'active', 'qualified', 'scheduled']);
const STATUS_ES = { new: 'Nuevo', active: 'Activo', qualified: 'Calificado', scheduled: 'Agendado', lost: 'Perdido', closed: 'Vendido' };
const LOSS_ES = {
  precio: 'Precio/presupuesto', ubicacion: 'Ubicación', competencia: 'Competencia',
  sin_respuesta: 'Dejó de responder', tiempo: 'No es el momento', no_califica: 'No califica',
  atencion: 'Mala atención/demora', otro: 'Otro', ninguno: 'Sin riesgo claro',
};

function isAdvisorWa(l) {
  if (l.source === 'advisor_whatsapp') return true;
  const m = l.metadata || {};
  return m.advisorWhatsappMirror === 'true' || m.advisorWhatsappMirror === true;
}
function counts317(l) { return !isAdvisorWa(l) && LINE.has(l.source); }
const ms = (t) => (t && t.toMillis ? t.toMillis() : (t && t._seconds ? t._seconds * 1000 : 0));
function phoneKey(v) { const d = String(v || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : d; }
function parseDate(v) { if (!v) return null; const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
const AUTO_NOTE_RE = /se agrega el cliente al sistema|se ha actualizado la informaci|se asigna el atendido en|oportunidad generada por whatsapp|registro api/i;
/** Nota HUMANA del asesor. "Registrado por:" = escrita desde nuestro CRM (aunque
 * la acción diga "Evento del Sistema"). NO se filtra por acción. */
function isAdvisorNote(e) {
  const c = e.content || '';
  if (/registrado por:/i.test(c)) return true;
  if (e.system) return false;
  if (AUTO_NOTE_RE.test(c)) return false;
  return true;
}
function cleanNoteText(content) {
  const m = /contexto:\s*([\s\S]+)/i.exec(content || '');
  return (m ? m[1] : (content || '')).replace(/\s+/g, ' ').trim();
}
const SALE_STAGE_RE = /firma de (promesa|contrato)|promesa firmada|escritur|vendid|venta realizada|entrega/i;
function hasSaleStage(stage) { return SALE_STAGE_RE.test(stage || ''); }

// Detección de segmento de campaña por nombres de anuncio/campaña/formulario + país.
function segmentOf(l) {
  const m = l.metadata || {};
  const blob = [m.metaCampaignName, m.metaAdsetName, m.metaAdName, m.metaFormName, m.webUtmCampaign, m.utm_campaign, l.sourceMeta && l.sourceMeta.headline]
    .filter(Boolean).join(' | ').toLowerCase();
  const isSpainPhone = String(l.phone || '').startsWith('+34');
  if (/espa[nñ]a|spain|madrid|barcelona|\bes\b/.test(blob) || isSpainPhone) return 'España';
  if (/corferias|bogot[aá]|feria|colombia/.test(blob)) return 'Corferias';
  return 'Otro/Sin segmento';
}
function campaignLabel(l) {
  const m = l.metadata || {};
  return m.metaCampaignName || m.webUtmCampaign || m.utm_campaign || m.metaFormName || '(sin campaña)';
}
function adLabel(l) {
  const m = l.metadata || {};
  return m.metaAdName || (l.sourceMeta && l.sourceMeta.headline) || m.metaFormName || '(sin anuncio)';
}

function newAdvisor(id, name) {
  return {
    advisorId: id, name, leads: 0,
    byStatus: {}, converted: 0, closed: 0,
    scoreSum: 0, scored: 0,
    respCount: 0, respSumMs: 0, respWithin1h: 0,
    firstContactDelays: [], neverContacted: 0,
    reassignLost: 0, reassignReceived: 0,
    shFound: 0, shWithAdvisorNote: 0, shAdvisorNotesTotal: 0, shNoNote: 0,
  };
}

(async () => {
  console.error(`\n== Informe 317 == ${PERSIST ? '(PERSIST: escribe resumen SmartHome en leads)' : '(read-only)'}\n`);
  const companyRef = db.collection('companies').doc(CID);
  const [leadsSnap, usersSnap, reassignSnap] = await Promise.all([
    companyRef.collection('leads').get(),
    companyRef.collection('users').get(),
    companyRef.collection('leadReassignmentEvents').get(),
  ]);

  const userName = new Map();
  usersSnap.docs.forEach((d) => { const u = d.data(); userName.set(d.id, u.displayName || u.email || d.id); });

  const leads = leadsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(counts317);
  console.error(`Leads línea 317: ${leads.length} (de ${leadsSnap.size} totales)`);

  // ── SmartHome: bitácora por prospectId (fiable) + teléfono para los sin id ───
  // Desde el CRM SIEMPRE se crea el cliente en SmartHome → el smartHomeProspectId
  // del lead es la verdad de "está en SmartHome". Traemos la bitácora por ese id y
  // solo buscamos por teléfono a los que no tienen id (duplicados/errores de sync).
  const t0 = Date.now();
  // BI por teléfono para TODOS (trae etapa/ciclo → ventas). Eventos por prospectId
  // solo para los que el BI no halló.
  const allPhones = [...new Set(leads.map((l) => l.phone).filter(Boolean))];
  const shByPhone = allPhones.length
    ? await sh.getSmartHomeProspectSummariesByPhones(allPhones).catch((e) => { console.error('SmartHome phone error:', e.message); return null; })
    : null;
  const needEvents = leads.filter((l) => l.smartHomeProspectId && !(shByPhone && shByPhone.get(phoneKey(l.phone)) && shByPhone.get(phoneKey(l.phone)).found));
  console.error(`Consultando bitácora SmartHome: BI ${shByPhone ? shByPhone.size : 0} + ${needEvents.length} por prospectId...`);
  const eventsByLead = new Map();
  let cur = 0;
  await Promise.all(Array.from({ length: Math.min(8, needEvents.length) }, async () => {
    while (cur < needEvents.length) {
      const l = needEvents[cur++];
      const ev = await sh.getSmartHomeProspectEvents(l.smartHomeProspectId, l.smartHomeProjectCode).catch(() => null);
      if (ev) eventsByLead.set(l.id, ev);
    }
  }));
  console.error(`SmartHome respondió en ${((Date.now() - t0) / 1000).toFixed(0)}s.`);

  // ── Reasignaciones por lead ─────────────────────────────────────────────────
  const reassignByLead = new Map();
  reassignSnap.docs.forEach((d) => {
    const e = d.data();
    if (!e.leadId) return;
    reassignByLead.set(e.leadId, (reassignByLead.get(e.leadId) || 0) + 1);
  });

  const advisors = new Map();
  usersSnap.docs.forEach((d) => advisors.set(d.id, newAdvisor(d.id, userName.get(d.id))));
  const getAdv = (id) => { let a = advisors.get(id); if (!a) { a = newAdvisor(id, userName.get(id) || id); advisors.set(id, a); } return a; };

  const bySegment = {};       // España / Corferias / Otro
  const byCampaign = {};
  const byAd = {};
  const lossAgg = {};
  const objectionAgg = {};
  const tempAgg = { hot: 0, warm: 0, cold: 0 };
  const leadRows = [];        // detalle por lead
  const spainClients = [];    // detalle específico España
  const persistWrites = [];

  function bump(map, key, l, sh) {
    let g = map[key];
    if (!g) g = map[key] = { key, leads: 0, byStatus: {}, converted: 0, closed: 0, scoreSum: 0, scored: 0, shAdvisorNotes: 0, shFound: 0 };
    g.leads++;
    g.byStatus[l.status] = (g.byStatus[l.status] || 0) + 1;
    if (l.status === 'closed') g.closed++;
    if (l.status === 'scheduled' || l.status === 'closed') g.converted++;
    if (typeof (l.aiAnalysis && l.aiAnalysis.score) === 'number') { g.scoreSum += l.aiAnalysis.score; g.scored++; }
    if (sh && sh.found) { g.shFound++; g.shAdvisorNotes += (sh.advisorNotes || 0); }
  }

  const now = Date.now();
  for (const l of leads) {
    const adv = getAdv(l.assignedTo || 'unassigned');
    const byPhone = shByPhone ? shByPhone.get(phoneKey(l.phone)) : null;
    const shEvents = (byPhone && byPhone.found ? byPhone.events : eventsByLead.get(l.id)) || (byPhone && byPhone.events) || eventsByLead.get(l.id) || [];
    const shp = { found: !!l.smartHomeProspectId || (byPhone && byPhone.found), advisorNotes: shEvents.filter(isAdvisorNote).length };
    const seg = segmentOf(l);

    adv.leads++;
    adv.byStatus[l.status] = (adv.byStatus[l.status] || 0) + 1;
    if (l.status === 'closed') { adv.closed++; adv.converted++; }
    else if (l.status === 'scheduled') adv.converted++;

    const a = l.aiAnalysis;
    if (a) {
      if (typeof a.score === 'number') { adv.scoreSum += a.score; adv.scored++; }
      if (a.lossCategory) lossAgg[a.lossCategory] = (lossAgg[a.lossCategory] || 0) + 1;
      if (a.temperature && tempAgg[a.temperature] !== undefined) tempAgg[a.temperature]++;
      (a.objections || []).forEach((o) => { const k = String(o).trim().toLowerCase().slice(0, 60); if (k) objectionAgg[k] = (objectionAgg[k] || 0) + 1; });
    }

    const s = l.stats;
    if (s) {
      adv.respCount += s.responseCount || 0;
      adv.respSumMs += s.responseSumMs || 0;
      adv.respWithin1h += s.responseWithin1h || 0;
    }
    // Demora de primer contacto
    if (l.advisorFirstContactAt && l.advisorAssignedAt) {
      const delay = ms(l.advisorFirstContactAt) - ms(l.advisorAssignedAt);
      if (delay > 0) adv.firstContactDelays.push(delay);
    } else if (l.pendingFirstContact === true || (s && s.advisorMsgCount === 0)) {
      adv.neverContacted++;
    }

    // Reasignaciones
    const reassigns = reassignByLead.get(l.id) || l.advisorReassignmentCount || 0;
    if (reassignByLead.has(l.id)) adv.reassignReceived += reassignByLead.get(l.id); // aprox

    // SmartHome bitácora (prospectId primero)
    let shAdvisorNotes = 0, shLastNote = '', shLastNoteAt = null, shLastEvent = '', shLastEventAt = null;
    let shStage = '', shAdvisor = '', shFollowUps = 0, shFound = false, shDuplicate = false;
    shDuplicate = /duplicado/i.test(String(l.smartHomeSyncError || ''));
    if (shp.found || shEvents.length) {
      shFound = true;
      shAdvisorNotes = shEvents.filter(isAdvisorNote).length;
      shStage = (byPhone && byPhone.stage) || '';
      shAdvisor = (byPhone && (byPhone.advisor || byPhone.seller)) || '';
      shFollowUps = (byPhone && byPhone.followUps) || 0;
      const advNote = shEvents.find(isAdvisorNote);
      if (advNote) { shLastNote = cleanNoteText(advNote.content).slice(0, 300); shLastNoteAt = parseDate(advNote.date); }
      const lastAny = shEvents[0];
      if (lastAny) { shLastEvent = (lastAny.content || '').slice(0, 300); shLastEventAt = parseDate(lastAny.date); }
      adv.shFound++;
      adv.shAdvisorNotesTotal += shAdvisorNotes;
      if (shAdvisorNotes > 0) adv.shWithAdvisorNote++; else adv.shNoNote++;

      const shSaleCycle = (byPhone && byPhone.saleCycle) || '';
      const shSold = l.status === 'closed' && hasSaleStage(shStage);   // venta confirmada
      if (PERSIST) {
        const patch = {
          smartHomeProspectId: l.smartHomeProspectId || (byPhone && byPhone.prospectId) || '',
          smartHomeFound: true,
          smartHomeDuplicate: shDuplicate,
          smartHomeSold: shSold,
          smartHomeAdvisorName: shAdvisor,
          smartHomeStageName: shStage,
          smartHomeSaleCycle: shSaleCycle,
          smartHomeAdvisorNotes: shAdvisorNotes,
          smartHomeFollowUps: shFollowUps,
          smartHomeLastBitacoraAt: shLastNoteAt ? admin.firestore.Timestamp.fromMillis(shLastNoteAt) : null,
          smartHomeLastBitacoraText: shLastNote,
          smartHomeLastEventAt: shLastEventAt ? admin.firestore.Timestamp.fromMillis(shLastEventAt) : null,
          smartHomeLastEventText: shLastEvent,
          smartHomeTrackingUpdatedAt: admin.firestore.Timestamp.now(),
        };
        persistWrites.push(companyRef.collection('leads').doc(l.id).set(patch, { merge: true }));
      }
    }

    bump(bySegment, seg, l, shp);
    bump(byCampaign, campaignLabel(l), l, shp);
    bump(byAd, adLabel(l), l, shp);

    const row = {
      leadId: l.id, name: l.name || l.phone || 'Lead', phone: l.phone || '',
      source: l.source, segment: seg, campaign: campaignLabel(l), ad: adLabel(l),
      advisor: userName.get(l.assignedTo) || 'Sin asesor',
      status: l.status, statusEs: STATUS_ES[l.status] || l.status,
      createdAt: ms(l.createdAt), reassignments: reassigns,
      score: a ? a.score : null, temperature: a ? a.temperature : null,
      lossCategory: a ? a.lossCategory : null, lossReason: a ? a.lossRisk : null,
      objections: a ? (a.objections || []) : [], nextAction: a ? a.nextAction : null,
      summary: a ? a.summary : null,
      advisorMsgs: s ? s.advisorMsgCount : 0,
      avgResponseMin: s && s.responseCount ? Math.round((s.responseSumMs / s.responseCount) / 60000) : null,
      shFound, shDuplicate, shAdvisorNotes, shLastNote, shLastNoteAt, shLastEvent, shLastEventAt, shStage, shAdvisor, shFollowUps,
    };
    leadRows.push(row);
    if (seg === 'España') spainClients.push(row);
  }

  if (PERSIST && persistWrites.length) {
    console.error(`Persistiendo resumen SmartHome en ${persistWrites.length} leads...`);
    // Firestore admite lotes; aquí van sueltos con límite de concurrencia simple.
    for (let i = 0; i < persistWrites.length; i += 50) await Promise.all(persistWrites.slice(i, i + 50));
    console.error('Persistencia completa.');
  }

  // ── Serializar asesores ─────────────────────────────────────────────────────
  const median = (arr) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const advisorsOut = [...advisors.values()].filter((a) => a.leads > 0).map((a) => ({
    advisorId: a.advisorId, name: a.name, leads: a.leads,
    byStatus: a.byStatus, converted: a.converted, closed: a.closed,
    conversionRate: a.leads ? Math.round((a.converted / a.leads) * 1000) / 10 : 0,
    avgScore: a.scored ? Math.round(a.scoreSum / a.scored) : 0,
    avgResponseMin: a.respCount ? Math.round((a.respSumMs / a.respCount) / 60000) : null,
    within1hRate: a.respCount ? Math.round((a.respWithin1h / a.respCount) * 1000) / 10 : null,
    responseSamples: a.respCount,
    avgFirstContactMin: a.firstContactDelays.length ? Math.round(a.firstContactDelays.reduce((x, y) => x + y, 0) / a.firstContactDelays.length / 60000) : null,
    medianFirstContactMin: a.firstContactDelays.length ? Math.round(median(a.firstContactDelays) / 60000) : null,
    neverContacted: a.neverContacted,
    reassignReceived: a.reassignReceived,
    shFound: a.shFound, shWithAdvisorNote: a.shWithAdvisorNote, shNoNote: a.shNoNote,
    shAdvisorNotesTotal: a.shAdvisorNotesTotal,
    bitacoraCoverage: a.shFound ? Math.round((a.shWithAdvisorNote / a.shFound) * 1000) / 10 : 0,
  })).sort((x, y) => y.leads - x.leads);

  const finalize = (map) => Object.values(map).map((g) => ({
    key: g.key, leads: g.leads, byStatus: g.byStatus, converted: g.converted, closed: g.closed,
    conversionRate: g.leads ? Math.round((g.converted / g.leads) * 1000) / 10 : 0,
    avgScore: g.scored ? Math.round(g.scoreSum / g.scored) : 0,
    shFound: g.shFound, shAdvisorNotes: g.shAdvisorNotes,
  })).sort((a, b) => b.leads - a.leads);

  const report = {
    generatedAt: now,
    company: CID,
    dateRange: {
      min: Math.min(...leads.map((l) => ms(l.createdAt)).filter(Boolean)),
      max: Math.max(...leads.map((l) => ms(l.createdAt)).filter(Boolean)),
    },
    totals: {
      leads317: leads.length,
      byStatus: leads.reduce((o, l) => { o[l.status] = (o[l.status] || 0) + 1; return o; }, {}),
      withAiAnalysis: leads.filter((l) => l.aiAnalysis).length,
      reassignedLeads: [...reassignByLead.keys()].filter((id) => leads.find((l) => l.id === id)).length,
      shFound: leadRows.filter((r) => r.shFound).length,
      shWithAdvisorNote: leadRows.filter((r) => r.shAdvisorNotes > 0).length,
    },
    advisors: advisorsOut,
    bySegment: finalize(bySegment),
    byCampaign: finalize(byCampaign),
    byAd: finalize(byAd).slice(0, 40),
    lossAnalysis: Object.entries(lossAgg).map(([k, v]) => ({ category: k, label: LOSS_ES[k] || k, count: v })).sort((a, b) => b.count - a.count),
    temperature: tempAgg,
    topObjections: Object.entries(objectionAgg).map(([k, v]) => ({ objection: k, count: v })).sort((a, b) => b.count - a.count).slice(0, 25),
    spainClients: spainClients.sort((a, b) => b.createdAt - a.createdAt),
    leads: leadRows.sort((a, b) => b.createdAt - a.createdAt),
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.error(`\nJSON escrito en: ${OUT}`);

  // ── Resumen legible en consola ──────────────────────────────────────────────
  console.error('\n===== RESUMEN =====');
  console.error('Leads 317:', report.totals.leads317, '| por estado:', JSON.stringify(report.totals.byStatus));
  console.error('En SmartHome:', report.totals.shFound, '| con nota del asesor en bitácora:', report.totals.shWithAdvisorNote);
  console.error('\n-- Segmentos (España/Corferias) --');
  report.bySegment.forEach((s) => console.error(`  ${s.key}: ${s.leads} leads | conv ${s.conversionRate}% | score ${s.avgScore} | notas asesor SH ${s.shAdvisorNotes}`));
  console.error('\n-- Por asesor --');
  advisorsOut.forEach((a) => console.error(`  ${a.name}: ${a.leads} leads | conv ${a.conversionRate}% | resp ${a.avgResponseMin ?? '—'}min | bitácora ${a.shWithAdvisorNote}/${a.shFound} (${a.bitacoraCoverage}%)`));
  console.error('\n-- Por qué no compró (aiAnalysis) --');
  report.lossAnalysis.forEach((x) => console.error(`  ${x.label}: ${x.count}`));
  console.error('\n-- Clientes España:', report.spainClients.length, '--');
  report.spainClients.slice(0, 15).forEach((c) => console.error(`  ${c.name} ${c.phone} | ${c.statusEs} | asesor ${c.advisor} | SH nota:${c.shAdvisorNotes} | ${c.lossReason || ''}`));

  process.exit(0);
})().catch((e) => { console.error('FALLO:', e); process.exit(1); });
