const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function checkAdvisorCounts() {
  const usersSnap = await db.collection('companies').doc('grupo_meraki_real').collection('users').get();
  const userMap = {};
  for (const u of usersSnap.docs) {
    userMap[u.id] = u.data().displayName || u.data().name || u.data().email;
  }

  const snap = await db.collection('companies').doc('grupo_meraki_real').collection('leads').get();
  const counts = {};
  for (const doc of snap.docs) {
    const d = doc.data();
    const adv = d.assignedTo || 'unassigned';
    counts[adv] = (counts[adv] || 0) + 1;
  }

  console.log('Advisors and their total leads:');
  for (const [id, count] of Object.entries(counts)) {
    console.log(id, userMap[id] || id, count);
  }
}
checkAdvisorCounts().catch(console.error);
