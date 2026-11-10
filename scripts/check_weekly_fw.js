const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function checkWeeklyFollowUp() {
  const OPEN_STATUSES = new Set(['new', 'active', 'qualified', 'scheduled']);
  const snap = await db.collection('companies').doc('grupo_meraki_real').collection('leads')
    .limit(100)
    .get();

  let staleCount = 0;
  for (const doc of snap.docs) {
    const lead = doc.data();
    const lastConversationAt = lead.lastMessageAt?.toMillis ? lead.lastMessageAt.toMillis() : (lead.lastMessageAt ? new Date(lead.lastMessageAt).getTime() : null);
    const stale = OPEN_STATUSES.has(lead.status) && lastConversationAt !== null && Date.now() - lastConversationAt > 7 * 86_400_000;
    if (stale) staleCount++;
  }
  console.log('Sample staleCount (7 days without activity in open status):', staleCount);
}
checkWeeklyFollowUp().catch(console.error);
