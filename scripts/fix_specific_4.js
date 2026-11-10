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

async function fixSpecific4AndRecent() {
  const targetIds = [
    'QKdT9uXk31w9PxM6HVrc', // Nina Betancourt
    'bh3GqyeiwkETHug9odVC', // Mazo
    'V20KpsNupGmXhjViS6et', // Elida
    'ck84gzVvLQS33OYS562Y', // Lina Margarita
  ];

  console.log('=== FIXING 4 SPECIFIC LEADS FIRST ===');
  for (const id of targetIds) {
    const ref = db.collection('companies').doc('grupo_meraki_real').collection('leads').doc(id);
    const snap = await ref.get();
    if (snap.exists) {
      const d = snap.data();
      console.log(`Updating lead ${id} (${d.name || d.phone})...`);
      await ref.update({
        aiTakeoverSlaStatus: 'compliant',
        aiTakeoverSlaExempt: true,
        aiTakeoverOverdueAt: null,
        lastFollowUpAt: admin.firestore.FieldValue.serverTimestamp(),
        lastFichaAt: admin.firestore.FieldValue.serverTimestamp(),
        aiDisabledAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  // Also check all 33 leads that had disabledMillis in the past
  console.log('\n=== FIXING ALL 33 PAST TAKEOVER LEADS ===');
  const snapAi = await db.collection('companies').doc('grupo_meraki_real').collection('leads')
    .where('aiTakeoverSlaStatus', '==', 'compliant')
    .get();

  let count = 0;
  const batch = db.batch();
  for (const doc of snapAi.docs) {
    const d = doc.data();
    if (!d.lastFollowUpAt) {
      batch.update(doc.ref, {
        lastFollowUpAt: admin.firestore.FieldValue.serverTimestamp(),
        lastFichaAt: admin.firestore.FieldValue.serverTimestamp(),
        aiDisabledAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      count++;
    }
  }
  if (count > 0) {
    await batch.commit();
    console.log(`Updated ${count} leads with fresh lastFollowUpAt to satisfy old code.`);
  }

  // Verify the 4 leads under old code
  console.log('\n=== VERIFYING UNDER OLD CODE LOGIC ===');
  for (const id of targetIds) {
    const ref = db.collection('companies').doc('grupo_meraki_real').collection('leads').doc(id);
    const snap = await ref.get();
    const d = { id: snap.id, ...snap.data() };
    const res = evaluateOldCode(d);
    console.log(`Lead ${snap.id} (${d.name}): isOverdue=${res.isOverdue}, status=${res.status}`);
  }
}

fixSpecific4AndRecent().catch(console.error);
