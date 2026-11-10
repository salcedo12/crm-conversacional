const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

async function fixAllPastVencidos() {
  console.log('=== LIMPIANDO TODOS LOS VENCIDOS HASTA HOY (2026-10-26) ===');
  const startOfTodayMs = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 0, 0, 0, 0).getTime();
  const todayStr = '2026-10-26';

  const compSnap = await db.collection('companies').get();

  for (const c of compSnap.docs) {
    const compId = c.id;
    console.log(`\nProcesando empresa: ${compId}`);

    const leadsRef = db.collection('companies').doc(compId).collection('leads');

    // 1. Leads con aiTakeoverSlaStatus == 'pending' o 'overdue' con disabledMillis anterior a hoy
    const snapAi = await leadsRef.where('aiEnabled', '==', false).get();
    let updatedAi = 0;
    const batchList = [];
    let currentBatch = db.batch();
    let batchOpCount = 0;

    for (const doc of snapAi.docs) {
      const d = doc.data();
      const disabledMillis = d.aiDisabledAt?.toMillis ? d.aiDisabledAt.toMillis() : (d.aiPausedAt?.toMillis ? d.aiPausedAt.toMillis() : 0);
      
      // Si fue apagada la IA antes de hoy, o si tiene status pending/overdue previo:
      if (d.aiTakeoverSlaStatus === 'overdue' || d.aiTakeoverSlaStatus === 'pending' || (disabledMillis > 0 && disabledMillis < startOfTodayMs)) {
        currentBatch.update(doc.ref, {
          aiTakeoverSlaStatus: 'compliant',
          aiTakeoverOverdueAt: null,
          aiTakeoverSlaExempt: true,
        });
        batchOpCount++;
        updatedAi++;

        if (batchOpCount >= 400) {
          batchList.push(currentBatch);
          currentBatch = db.batch();
          batchOpCount = 0;
        }
      }
    }
    if (batchOpCount > 0) {
      batchList.push(currentBatch);
    }

    for (const b of batchList) {
      await b.commit();
    }
    console.log(`  -> Empresa ${compId}: ${updatedAi} leads en toma manual regularizados a compliant/exento.`);

    // 2. Leads con nextFollowUpDate anterior a hoy (< 2026-10-26)
    const snapFollowUps = await leadsRef.where('nextFollowUpDate', '!=', null).get();
    let updatedFollowUps = 0;
    let bFollow = db.batch();
    let bFollowCount = 0;
    const bFollowList = [];

    for (const doc of snapFollowUps.docs) {
      const d = doc.data();
      const dateStr = String(d.nextFollowUpDate || '');
      if (dateStr < todayStr) {
        bFollow.update(doc.ref, {
          nextFollowUpDate: null,
          nextFollowUpAction: null,
          isOverdue: false,
        });
        bFollowCount++;
        updatedFollowUps++;

        if (bFollowCount >= 400) {
          bFollowList.push(bFollow);
          bFollow = db.batch();
          bFollowCount = 0;
        }
      }
    }
    if (bFollowCount > 0) {
      bFollowList.push(bFollow);
    }
    for (const b of bFollowList) {
      await b.commit();
    }
    console.log(`  -> Empresa ${compId}: ${updatedFollowUps} seguimientos antiguos borrados.`);
  }

  console.log('\n=== LIMPIEZA COMPLETADA CON ÉXITO ===');
}

fixAllPastVencidos().catch(console.error);
