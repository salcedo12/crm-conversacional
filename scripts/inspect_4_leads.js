const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function inspect() {
  const names = ['Nina Betancourt', 'Mazo', 'Elida', 'Lina Margarita'];
  const compSnap = await db.collection('companies').get();

  for (const c of compSnap.docs) {
    const compId = c.id;
    for (const name of names) {
      const snap = await db.collection('companies').doc(compId).collection('leads')
        .where('name', '==', name)
        .get();
      if (!snap.empty) {
        for (const doc of snap.docs) {
          console.log(`\nFound in ${compId}: Lead ID=${doc.id}, Name=${name}`);
          const d = doc.data();
          console.log(JSON.stringify({
            aiEnabled: d.aiEnabled,
            aiTakeoverSlaStatus: d.aiTakeoverSlaStatus,
            aiTakeoverSlaExempt: d.aiTakeoverSlaExempt,
            aiDisabledAt: d.aiDisabledAt,
            aiPausedAt: d.aiPausedAt,
            lastFollowUpAt: d.lastFollowUpAt,
            lastFichaAt: d.lastFichaAt,
            assignedTo: d.assignedTo,
            status: d.status,
            createdAt: d.createdAt,
            updatedAt: d.updatedAt
          }, null, 2));
        }
      }
    }
  }
}
inspect().catch(console.error);
