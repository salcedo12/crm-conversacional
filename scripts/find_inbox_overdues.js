const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

function evaluateOldCode(lead) {
  if (lead.aiEnabled) return { isOverdue: false, status: 'ai_on' };

  const rawLead = lead;
  const disabledMillis =
    lead.aiDisabledAt?.toMillis?.() ??
    rawLead.aiPausedAt?.toMillis?.() ??
    (lead.aiDisabledAt ? new Date(lead.aiDisabledAt).getTime() : 0);

  const lastFollowUpMillis =
    lead.lastFollowUpAt?.toMillis?.() ??
    rawLead.lastFichaAt?.toMillis?.() ??
    (lead.lastFollowUpAt ? new Date(lead.lastFollowUpAt).getTime() : 0);

  const hasFollowUp = lastFollowUpMillis > 0;
  const isAfterDisabled = disabledMillis > 0 ? lastFollowUpMillis >= disabledMillis : hasFollowUp;

  if (hasFollowUp && isAfterDisabled) {
    return { isOverdue: false, status: 'compliant' };
  }

  const deadlineMillis = disabledMillis + 24 * 3600_000;
  const diffMs = deadlineMillis - Date.now();

  if (diffMs <= 0 || lead.aiTakeoverSlaStatus === 'overdue') {
    return { isOverdue: true, status: 'overdue' };
  }

  return { isOverdue: false, status: 'pending' };
}

async function findInboxOverdues() {
  const snap = await db.collection('companies').doc('grupo_meraki_real').collection('leads')
    .orderBy('lastMessageAt', 'desc')
    .limit(300)
    .get();

  console.log('Total recent leads loaded:', snap.size);
  let manualCount = 0;
  let overdueCount = 0;
  const overdues = [];

  for (const doc of snap.docs) {
    const d = { id: doc.id, ...doc.data() };
    if (!d.aiEnabled) {
      manualCount++;
      const res = evaluateOldCode(d);
      if (res.isOverdue) {
        overdueCount++;
        overdues.push({
          id: doc.id,
          name: d.name || d.phone,
          disabledMillis: d.aiDisabledAt,
          lastFollowUpAt: d.lastFollowUpAt,
          aiTakeoverSlaStatus: d.aiTakeoverSlaStatus
        });
      }
    }
  }

  console.log(`Manual count: ${manualCount}, Overdue under OLD code: ${overdueCount}`);
  console.log('Overdue leads:', overdues);
}

findInboxOverdues().catch(console.error);
