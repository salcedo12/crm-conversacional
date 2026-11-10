const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

function getManualTakeoverSlaInfo(lead) {
  if (lead.aiEnabled) return null;

  const rawLead = lead;

  // Si fue marcado explícitamente como compliant o exento en base de datos
  if (lead.aiTakeoverSlaStatus === 'compliant' || rawLead.aiTakeoverSlaStatus === 'exempt') {
    return {
      isManual: true,
      status: 'compliant',
      isOverdue: false,
      isCompliant: true,
    };
  }

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
    return {
      isManual: true,
      status: 'compliant',
      isOverdue: false,
      isCompliant: true,
    };
  }

  const startOfTodayMs = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 0, 0, 0, 0).getTime();

  if (disabledMillis === 0 || disabledMillis < startOfTodayMs) {
    return {
      isManual: true,
      status: 'compliant',
      isOverdue: false,
      isCompliant: true,
    };
  }

  const deadlineMillis = disabledMillis + 24 * 3600_000;
  const diffMs = deadlineMillis - Date.now();

  if (diffMs <= 0 || lead.aiTakeoverSlaStatus === 'overdue') {
    return {
      isManual: true,
      status: 'overdue',
      isOverdue: true,
      isCompliant: false,
    };
  }

  return {
    isManual: true,
    status: 'pending',
    isOverdue: false,
    isCompliant: false,
  };
}

async function run() {
  const compSnap = await db.collection('companies').get();
  for (const c of compSnap.docs) {
    const compId = c.id;
    console.log('\nChecking company:', compId);
    const snap = await db.collection('companies').doc(compId).collection('leads').get();
    let totalManual = 0;
    let overdueCount = 0;
    for (const doc of snap.docs) {
      const data = { id: doc.id, ...doc.data() };
      const info = getManualTakeoverSlaInfo(data);
      if (info) {
        totalManual++;
        if (info.isOverdue) {
          overdueCount++;
          console.log(`[OVERDUE] Lead ${doc.id}: ${data.name || data.phone}`, {
            aiEnabled: data.aiEnabled,
            aiTakeoverSlaStatus: data.aiTakeoverSlaStatus,
            aiDisabledAt: data.aiDisabledAt,
            aiPausedAt: data.aiPausedAt,
            lastFollowUpAt: data.lastFollowUpAt,
            lastFichaAt: data.lastFichaAt,
          });
        }
      }
    }
    console.log(`Company ${compId}: totalManual=${totalManual}, overdueCount=${overdueCount}`);
  }
}
run();
