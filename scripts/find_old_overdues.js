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

async function findOldOverdues() {
  const snap = await db.collection('companies').doc('grupo_meraki_real').collection('leads').get();
  let oldOverdueCount = 0;
  const oldOverdueLeads = [];

  for (const doc of snap.docs) {
    const d = { id: doc.id, ...doc.data() };
    const res = evaluateOldCode(d);
    if (res.isOverdue) {
      oldOverdueCount++;
      oldOverdueLeads.push({ id: doc.id, name: d.name || d.phone, disabledMillis: d.aiDisabledAt });
    }
  }

  console.log('Total oldOverdueCount in grupo_meraki_real:', oldOverdueCount);
  console.log('Leads:', oldOverdueLeads);
}

findOldOverdues().catch(console.error);
