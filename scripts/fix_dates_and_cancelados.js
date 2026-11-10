/**
 * fix_dates_and_cancelados.js
 *
 * 1. Pasa a 'lost' (Cancelados / No Interesados) todos los prospectos cuya última
 *    gestión o ciclo en SmartHome fue CANCELADO, No Interesado, Desistimiento, Descartado, etc.
 * 2. Corrige `lastFollowUpAt` que se había fijado con timestamp sintético de hoy:
 *    - Si tiene bitácora histórica, restaura la fecha real de esa bitácora (ej. 13 Ago, 26 Ago, etc.).
 *    - Si no tiene bitácora, elimina/anula `lastFollowUpAt` para que no figure falsamente como gestionado hoy.
 * 3. Mantiene las protecciones SLA (aiTakeoverSlaStatus='compliant', aiTakeoverSlaExempt=true)
 *    para no generar vencidos artificiales.
 */

const admin = require('../functions/node_modules/firebase-admin');
const sa = require('../service-account.json');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(sa),
    projectId: 'crm-conversacional',
  });
}
const db = admin.firestore();

const COMPANY_ID = 'grupo_meraki_real';

function isCancelled(l) {
  if (l.status === 'closed') return false;
  const cycle = String(l.smartHomeSaleCycle || l.metadata?.smarthomeCicloVenta || '').toLowerCase();
  const stage = String(l.smartHomeStageName || l.metadata?.smarthomeEstadoSeguimiento || '').toLowerCase();
  const b0Desc = String(l.metadata?.smarthomeBitacoras?.[0]?.description || '').toLowerCase();
  const b0Action = String(l.metadata?.smarthomeBitacoras?.[0]?.action || '').toLowerCase();

  const cancelPattern = /cancelad|no interesado|desistimient|descartad|papelera|sin presupuesto|no califica|no aplica/i;
  return (
    cancelPattern.test(cycle) ||
    cancelPattern.test(stage) ||
    cancelPattern.test(b0Desc) ||
    cancelPattern.test(b0Action)
  );
}

function parseBitacoraDate(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  // Formatos: '2026-08-13 15:12', '2026-08-13T15:12:00', '2026-08-13'
  const isoLike = str.replace(' ', 'T');
  const d = new Date(isoLike);
  if (!isNaN(d.getTime())) {
    return admin.firestore.Timestamp.fromDate(d);
  }
  return null;
}

async function run() {
  console.log('=== CORRIGIENDO FECHAS HISTÓRICAS Y PASANDO A CANCELADOS ===\n');
  const t0 = Date.now();

  const snap = await db.collection('companies').doc(COMPANY_ID).collection('leads').get();
  console.log(`Total prospectos a evaluar: ${snap.size}`);

  let canceladosUpdated = 0;
  let datesRestoredFromBitacora = 0;
  let datesRemovedSynthetic = 0;
  let totalUpdated = 0;

  const todayIsoPrefix = '2026-10-26';

  let batch = db.batch();
  let batchCount = 0;

  async function flush() {
    if (batchCount > 0) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  for (let i = 0; i < snap.docs.length; i++) {
    const doc = snap.docs[i];
    const l = doc.data();

    const updates = {};
    let shouldUpdate = false;

    // 1. Pasar a Cancelados si corresponde
    if (isCancelled(l) && l.status !== 'lost') {
      updates.status = 'lost';
      updates.pipelineStage = 'lost';
      updates.lostReason = 'SmartHome: Cancelado / No Interesado / Desistimiento';
      canceladosUpdated++;
      shouldUpdate = true;
    }

    // 2. Corregir lastFollowUpAt sintético
    const lfu = l.lastFollowUpAt?.toDate
      ? l.lastFollowUpAt.toDate().toISOString()
      : typeof l.lastFollowUpAt === 'string'
      ? l.lastFollowUpAt
      : null;

    if (lfu && lfu.startsWith(todayIsoPrefix)) {
      const bitacoras = l.metadata?.smarthomeBitacoras || [];
      const b0 = bitacoras[0];
      const realDate = b0 ? parseBitacoraDate(b0.lastDate || b0.fecha) : null;

      if (realDate) {
        updates.lastFollowUpAt = realDate;
        datesRestoredFromBitacora++;
        shouldUpdate = true;
      } else {
        updates.lastFollowUpAt = null;
        datesRemovedSynthetic++;
        shouldUpdate = true;
      }
    }

    if (shouldUpdate) {
      batch.update(doc.ref, updates);
      batchCount++;
      totalUpdated++;

      if (batchCount >= 400) {
        await flush();
        console.log(`[Progreso] ${totalUpdated} leads actualizados...`);
      }
    }
  }

  await flush();

  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\n=== ACTUALIZACIÓN COMPLETADA ===');
  console.log(`Tiempo: ${sec}s`);
  console.log(`Total leads actualizados: ${totalUpdated}`);
  console.log(`Leads pasados a 'lost' (Cancelados / No Interesados): ${canceladosUpdated}`);
  console.log(`Fechas reales restauradas desde bitácora histórica: ${datesRestoredFromBitacora}`);
  console.log(`Fechas sintéticas eliminadas (sin bitácora): ${datesRemovedSynthetic}`);
}

run().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
