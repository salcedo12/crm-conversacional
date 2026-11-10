const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

// 1. Mobile LeadRow getManualTakeoverSlaInfo
function getManualTakeoverSlaInfo(lead) {
  if (lead.aiEnabled) return null;
  const rawLead = lead;
  if (lead.aiTakeoverSlaStatus === 'compliant' || rawLead.aiTakeoverSlaStatus === 'exempt') {
    return { isManual: true, status: 'compliant', isOverdue: false, isCompliant: true };
  }
  const disabledMillis = lead.aiDisabledAt?.toMillis ? lead.aiDisabledAt.toMillis() : (rawLead.aiPausedAt?.toMillis ? rawLead.aiPausedAt.toMillis() : 0);
  const lastFollowUpMillis = lead.lastFollowUpAt?.toMillis ? lead.lastFollowUpAt.toMillis() : (rawLead.lastFichaAt?.toMillis ? rawLead.lastFichaAt.toMillis() : 0);
  const hasFollowUp = lastFollowUpMillis > 0;
  const isAfterDisabled = disabledMillis > 0 ? lastFollowUpMillis >= disabledMillis : hasFollowUp;
  if (hasFollowUp && isAfterDisabled) {
    return { isManual: true, status: 'compliant', isOverdue: false, isCompliant: true };
  }
  const startOfTodayMs = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 0, 0, 0, 0).getTime();
  if (disabledMillis === 0 || disabledMillis < startOfTodayMs) {
    return { isManual: true, status: 'compliant', isOverdue: false, isCompliant: true };
  }
  const deadlineMillis = disabledMillis + 24 * 3600_000;
  const diffMs = deadlineMillis - Date.now();
  if (diffMs <= 0 || lead.aiTakeoverSlaStatus === 'overdue') {
    return { isManual: true, status: 'overdue', isOverdue: true, isCompliant: false };
  }
  return { isManual: true, status: 'pending', isOverdue: false, isCompliant: false };
}

// 2. CommercialManagement mapDocToCommercialLeadItem
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

// 3. FollowUp Today or Overdue (LeadRow / InboxScreen)
function isFollowUpTodayOrOverdue(lead) {
  const nextDate = lead.nextFollowUpDate || lead.metadata?.nextFollowUpDate;
  if (!nextDate) return false;
  const d = parseAnyDate(nextDate);
  if (!d) return false;
  const todayStr = '2026-10-26';
  const itemDateStr = d.toISOString().slice(0, 10);
  return itemDateStr === todayStr; // In our fixed code
}

async function runAudit() {
  const snap = await db.collection('companies').doc('grupo_meraki_real').collection('leads').get();
  console.log('Total leads in grupo_meraki_real:', snap.size);
  const now = new Date();

  let slaOverdueCount = 0;
  let commercialOverdueCount = 0;
  let followUpOverdueCount = 0;
  let metadataNextFollowUpCount = 0;

  // By advisor counts
  const advisorSlaOverdue = {};
  const advisorCommercialOverdue = {};

  for (const doc of snap.docs) {
    const d = doc.data();
    const adv = d.assignedTo || 'unassigned';

    // Check SLA
    const sla = getManualTakeoverSlaInfo(d);
    if (sla?.isOverdue) {
      slaOverdueCount++;
      advisorSlaOverdue[adv] = (advisorSlaOverdue[adv] || 0) + 1;
    }

    // Check Commercial nextFollowUpDate
    if (checkCommercialLeadItem(d, now)) {
      commercialOverdueCount++;
      advisorCommercialOverdue[adv] = (advisorCommercialOverdue[adv] || 0) + 1;
    }

    if (d.metadata?.nextFollowUpDate) {
      metadataNextFollowUpCount++;
    }

    // Raw nextFollowUpDate < today
    if (d.nextFollowUpDate && typeof d.nextFollowUpDate === 'string' && d.nextFollowUpDate < '2026-10-26') {
      followUpOverdueCount++;
    }
  }

  console.log('Results:');
  console.log('- slaOverdueCount (getManualTakeoverSlaInfo):', slaOverdueCount);
  console.log('- commercialOverdueCount (nextDate < today):', commercialOverdueCount);
  console.log('- followUpOverdueCount (raw nextFollowUpDate < today):', followUpOverdueCount);
  console.log('- metadataNextFollowUpCount:', metadataNextFollowUpCount);
  console.log('- advisorCommercialOverdue:', advisorCommercialOverdue);
  console.log('- advisorSlaOverdue:', advisorSlaOverdue);
}

runAudit().catch(console.error);
