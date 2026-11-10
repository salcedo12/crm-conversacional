const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function regularizeAllManualLeads() {
  console.log('=== REGULARIZANDO TODOS LOS PROSPECTOS EN TOMA MANUAL ===');
  const compSnap = await db.collection('companies').get();

  for (const c of compSnap.docs) {
    const compId = c.id;
    console.log(`\nEmpresa: ${compId}`);
    const snap = await db.collection('companies').doc(compId).collection('leads')
      .where('aiEnabled', '==', false)
      .get();

    console.log(`  Total leads con aiEnabled == false: ${snap.size}`);

    let count = 0;
    let batch = db.batch();
    let batchCount = 0;
    const nowTimestamp = admin.firestore.Timestamp.now();

    for (const doc of snap.docs) {
      const d = doc.data();
      // Si no es compliant o no tiene lastFollowUpAt
      if (d.aiTakeoverSlaStatus !== 'compliant' || !d.lastFollowUpAt || d.aiTakeoverOverdueAt) {
        batch.update(doc.ref, {
          aiTakeoverSlaStatus: 'compliant',
          aiTakeoverSlaExempt: true,
          aiTakeoverOverdueAt: null,
          lastFollowUpAt: nowTimestamp,
          lastFichaAt: nowTimestamp,
          aiDisabledAt: nowTimestamp,
        });
        count++;
        batchCount++;

        if (batchCount >= 400) {
          await batch.commit();
          process.stdout.write(`.`);
          batch = db.batch();
          batchCount = 0;
        }
      }
    }

    if (batchCount > 0) {
      await batch.commit();
    }
    console.log(`\n  -> Empresa ${compId}: ${count} prospectos actualizados a compliant/exento.`);
  }

  console.log('\n=== REGULARIZACIÓN TERMINADA CON ÉXITO ===');
}

regularizeAllManualLeads().catch(console.error);
