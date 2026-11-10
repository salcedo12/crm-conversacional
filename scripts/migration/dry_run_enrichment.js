const path = require('path');
const fs = require('fs');

const admin = require('../../functions/node_modules/firebase-admin');

let serviceAccount;
try {
  serviceAccount = require('../../service-account.json');
} catch (e) {
  serviceAccount = require('../../functions/service-account.json');
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
const COMPANY_ID = 'grupo_meraki_real';

function normalizePhone(rawPhone) {
  if (!rawPhone) return { phone: '', phoneTail: '' };
  const digitsOnly = String(rawPhone).replace(/\D/g, '');
  const tail = digitsOnly.length >= 7 ? digitsOnly.slice(-10) : digitsOnly;
  
  let canonical = rawPhone;
  if (digitsOnly.length === 10 && digitsOnly.startsWith('3')) {
    canonical = `+57${digitsOnly}`;
  } else if (digitsOnly.length === 12 && digitsOnly.startsWith('573')) {
    canonical = `+${digitsOnly}`;
  }
  return { phone: canonical, phoneTail: tail };
}

function isDirectAdvisorLead(lead) {
  const meta = lead.metadata || {};
  return lead.source === 'advisor_whatsapp' ||
         meta.advisorWhatsappMirror === 'true' ||
         meta.advisorWhatsappMirror === true;
}

function resolveProject(lead) {
  const meta = lead.metadata || {};
  const ai = lead.aiAnalysis || {};
  if (meta['¿qué_proyecto_te_interesa_más?']) return meta['¿qué_proyecto_te_interesa_más?'];
  if (lead.smartHomeProjectCode === '48c9266a') return 'Laguna Mar (Melgar, Tolima)';
  if (ai.interestArea) return ai.interestArea;
  if (meta.webArea) return meta.webArea;
  return null;
}

function getDaysSince(ts) {
  if (!ts) return 999;
  let date;
  if (ts.toDate && typeof ts.toDate === 'function') date = ts.toDate();
  else if (ts._seconds) date = new Date(ts._seconds * 1000);
  else date = new Date(ts);
  if (isNaN(date.getTime())) return 999;
  const diffMs = Date.now() - date.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

async function runDryRun(applyChanges = false) {
  console.log('========================================================');
  console.log(`[ENRICHMENT ${applyChanges ? 'APPLY' : 'DRY-RUN'}] Procesando Leads de ${COMPANY_ID}`);
  console.log('========================================================');

  const leadsCol = db.collection('companies').doc(COMPANY_ID).collection('leads');
  const snapshot = await leadsCol.get();
  console.log(`[ANALISIS] Total de leads en Firestore: ${snapshot.size}`);

  const report = {
    executedAt: new Date().toISOString(),
    isDryRun: !applyChanges,
    totalScanned: snapshot.size,
    alreadyComplete: 0,
    needingUpdate: 0,
    sourcesBreakdown: {},
    inboxBreakdown: { central_317: 0, advisor_direct: 0 },
    archivedBreakdown: { archived: 0, active: 0 },
    patchSamples: []
  };

  const batches = [];
  let currentBatch = db.batch();
  let currentBatchCount = 0;

  for (const doc of snapshot.docs) {
    const lead = doc.data();
    const docRef = doc.ref;

    // 1. Teléfono y PhoneTail
    const rawPhone = lead.phone || lead.normalizedPhone || lead.whatsappUserId || '';
    const { phone: canonicalPhone, phoneTail } = normalizePhone(rawPhone);

    // 2. Inbox
    const isDirect = isDirectAdvisorLead(lead);
    const targetInbox = isDirect ? 'advisor_direct' : 'central_317';
    report.inboxBreakdown[targetInbox]++;

    // 3. Fuente histórica
    const rawSource = lead.source || (isDirect ? 'advisor_whatsapp' : 'whatsapp');
    report.sourcesBreakdown[rawSource] = (report.sourcesBreakdown[rawSource] || 0) + 1;

    // 4. Proyecto detectado
    const project = resolveProject(lead);

    // 5. FirstTouch y LastTouch
    const existingFirstTouch = lead.firstTouch;
    const existingLastTouch = lead.lastTouch;

    const meta = lead.metadata || {};
    const createdTs = lead.createdAt || admin.firestore.FieldValue.serverTimestamp();

    const reconstructedTouch = {
      source: rawSource,
      channel: lead.channel || (rawSource === 'web' ? 'web_form' : 'whatsapp'),
      campaign: meta.metaCampaignName || meta.webUtmCampaign || meta.campaign || null,
      adName: meta.metaAdName || null,
      gclid: meta.gclid || meta.webGclid || null,
      fbclid: meta.fbclid || meta.webFbclid || null,
      project: project,
      timestamp: createdTs
    };

    // 6. Archivado (> 90 días sin interacción y no en negociación activa)
    const lastActiveTs = lead.lastMessageAt || lead.lastInboundAt || lead.updatedAt || lead.createdAt;
    const daysSince = getDaysSince(lastActiveTs);
    const activeStatuses = ['visita_agendada', 'visita_realizada', 'scheduled', 'reserved', 'active'];
    const isArchived = daysSince > 90 && !activeStatuses.includes(lead.status);
    if (isArchived) report.archivedBreakdown.archived++;
    else report.archivedBreakdown.active++;

    // Comprobar si se requieren cambios
    const needsUpdate = !lead.phoneTail ||
                        !lead.firstTouch ||
                        !lead.lastTouch ||
                        !lead.inbox ||
                        lead.isArchived === undefined ||
                        lead.reactivationCount === undefined;

    if (!needsUpdate) {
      report.alreadyComplete++;
      continue;
    }

    report.needingUpdate++;

    const patch = {
      phoneTail: phoneTail || lead.phoneTail || '',
      inbox: lead.inbox || targetInbox,
      isArchived: lead.isArchived !== undefined ? lead.isArchived : isArchived,
      reactivationCount: lead.reactivationCount !== undefined ? lead.reactivationCount : 0,
      firstTouch: existingFirstTouch || reconstructedTouch,
      lastTouch: existingLastTouch || reconstructedTouch,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (project && (!lead.projectInterest || lead.projectInterest.length === 0)) {
      patch.projectInterest = [project];
    }

    if (report.patchSamples.length < 5) {
      report.patchSamples.push({
        id: doc.id,
        name: lead.name || 'Sin nombre',
        phone: canonicalPhone,
        current: {
          source: lead.source,
          inbox: lead.inbox,
          hasFirstTouch: !!lead.firstTouch,
          phoneTail: lead.phoneTail
        },
        patch: patch
      });
    }

    if (applyChanges) {
      currentBatch.update(docRef, patch);
      currentBatchCount++;
      if (currentBatchCount === 400) {
        batches.push(currentBatch.commit());
        currentBatch = db.batch();
        currentBatchCount = 0;
      }
    }
  }

  if (applyChanges && currentBatchCount > 0) {
    batches.push(currentBatch.commit());
  }

  if (applyChanges && batches.length > 0) {
    console.log(`[APPLY] Ejecutando ${batches.length} batches de actualización en Firestore...`);
    await Promise.all(batches);
    console.log(`[APPLY] ¡Actualización completada en Firestore!`);
  }

  const reportPath = path.join(__dirname, '../../backups/dry_run_report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('========================================================');
  console.log(`[REPORTE DRY-RUN GENERADO CON ÉXITO]`);
  console.log(`Total Escaneados: ${report.totalScanned}`);
  console.log(`Ya Completos: ${report.alreadyComplete}`);
  console.log(`Requieren Enriquecimiento: ${report.needingUpdate}`);
  console.log('Desglose de Inboxes:', JSON.stringify(report.inboxBreakdown));
  console.log('Desglose de Fuentes:', JSON.stringify(report.sourcesBreakdown));
  console.log('Desglose Archivado (>90 días inactivos):', JSON.stringify(report.archivedBreakdown));
  console.log(`Archivo de Reporte: ${reportPath}`);
  console.log('========================================================');

  return report;
}

const isApply = process.argv.includes('--apply');
runDryRun(isApply).catch(err => {
  console.error('[DRY-RUN ERROR FATAL]:', err);
  process.exit(1);
});
