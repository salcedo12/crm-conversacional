const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function checkActiveManualLeads() {
  const compId = 'grupo_meraki_real';
  const snap = await db.collection('companies').doc(compId).collection('leads')
    .orderBy('lastMessageAt', 'desc')
    .limit(500)
    .get();

  console.log(`Loaded ${snap.size} recent leads`);
  const advisorManual = {};
  let totalManualWithoutCompliant = 0;

  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.aiEnabled === false && d.aiTakeoverSlaStatus !== 'compliant') {
      totalManualWithoutCompliant++;
      const adv = d.assignedTo || 'unassigned';
      advisorManual[adv] = (advisorManual[adv] || 0) + 1;
    }
  }

  console.log('Total recent manual leads without compliant status:', totalManualWithoutCompliant);
  console.log('Breakdown by advisor:', advisorManual);
}

checkActiveManualLeads().catch(console.error);
