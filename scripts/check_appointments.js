const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function checkAppointments() {
  const compSnap = await db.collection('companies').get();
  for (const c of compSnap.docs) {
    const snap = await db.collection('companies').doc(c.id).collection('appointments').get();
    console.log(`Company ${c.id}: ${snap.size} appointments`);
    let overdue = 0;
    const now = new Date();
    for (const d of snap.docs) {
      const a = d.data();
      const start = a.start?.toDate ? a.start.toDate() : (a.date ? new Date(a.date) : null);
      if (start && start < now && a.status !== 'completed' && a.status !== 'canceled' && a.attended !== true && a.postCitaStatus !== 'reported') {
        overdue++;
      }
    }
    console.log(`  Overdue appointments in ${c.id}: ${overdue}`);
  }
}
checkAppointments().catch(console.error);
