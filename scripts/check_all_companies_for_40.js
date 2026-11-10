const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

function parseAnyDate(val) {
  if (!val) return null;
  if (val.toDate) return val.toDate();
  if (typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function checkCommercialLeadItem(data, now) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const nextDateStr = data.nextFollowUpDate || data.metadata?.nextFollowUpDate || null;
  let isOverdue = false;
  if (nextDateStr) {
    const parsedNext = parseAnyDate(nextDateStr);
    if (parsedNext && parsedNext < startOfToday) isOverdue = true;
  }
  return isOverdue;
}

async function checkAll() {
  const compSnap = await db.collection('companies').get();
  console.log('Total companies:', compSnap.size);
  const now = new Date();

  for (const c of compSnap.docs) {
    const compId = c.id;
    console.log('\n--- Checking company:', compId);

    // Check users
    const usersSnap = await db.collection('companies').doc(compId).collection('users').get();
    console.log(`Users count: ${usersSnap.size}`);
    let blockedUsers = 0;
    for (const uDoc of usersSnap.docs) {
      const u = uDoc.data();
      if (u.blockedDueToSla || u.slaBlocked || u.slaStatus === 'blocked') {
        blockedUsers++;
        console.log(`  Blocked user in ${compId}:`, uDoc.id, u.displayName, u.email);
      }
    }
    console.log(`Total blocked users in ${compId}: ${blockedUsers}`);

    // Check leads
    const leadsSnap = await db.collection('companies').doc(compId).collection('leads').get();
    console.log(`Leads count: ${leadsSnap.size}`);
    let commOverdue = 0;
    let slaOverdue = 0;
    const advisorComm = {};
    const advisorSla = {};

    for (const lDoc of leadsSnap.docs) {
      const d = lDoc.data();
      const adv = d.assignedTo || 'unassigned';
      if (checkCommercialLeadItem(d, now)) {
        commOverdue++;
        advisorComm[adv] = (advisorComm[adv] || 0) + 1;
      }
      if (d.aiTakeoverSlaStatus === 'overdue' || (d.aiEnabled === false && d.aiTakeoverSlaStatus !== 'compliant' && d.aiTakeoverSlaExempt !== true)) {
        slaOverdue++;
        advisorSla[adv] = (advisorSla[adv] || 0) + 1;
      }
    }

    console.log(`Commercial overdue in ${compId}: ${commOverdue}`, advisorComm);
    console.log(`Non-compliant SLA in ${compId}: ${slaOverdue}`, advisorSla);
  }
}

checkAll().catch(console.error);
