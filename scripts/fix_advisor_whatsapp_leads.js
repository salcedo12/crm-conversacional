const admin = require('../functions/node_modules/firebase-admin');
const sa = require('../service-account.json');
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

async function run() {
  const companyId = 'grupo_meraki_real';
  const leadsRef = db.collection('companies').doc(companyId).collection('leads');
  
  console.log('Querying advisor_whatsapp leads...');
  const snap = await leadsRef.where('source', '==', 'advisor_whatsapp').get();
  console.log(`Found ${snap.size} leads with source == 'advisor_whatsapp'.`);

  let batch = db.batch();
  let countInBatch = 0;
  let totalUpdated = 0;
  let totalShCleared = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const hasSh = !!(data.smartHomeCustomerId || data.smartHomeProjectCode || data.smartHomeSyncAttemptedAt || data.smartHomeAdvisorId || data.smartHomeSyncedAt);
    const needsInbox = data.inbox !== 'advisor_direct' || data.pendingFirstContact !== false || !data.assignmentLocked;

    if (!hasSh && !needsInbox) {
      continue;
    }

    const updates = {
      inbox: 'advisor_direct',
      pendingFirstContact: false,
      assignmentLocked: true,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (hasSh) {
      updates.smartHomeCustomerId = FieldValue.delete();
      updates.smartHomeProjectCode = FieldValue.delete();
      updates.smartHomeAdvisorId = FieldValue.delete();
      updates.smartHomeSyncedAt = FieldValue.delete();
      updates.smartHomeSyncAttemptedAt = FieldValue.delete();
      updates.smartHomeSyncError = FieldValue.delete();
      updates.smartHomeDuplicateMatches = FieldValue.delete();
      totalShCleared++;
    }

    batch.update(doc.ref, updates);
    countInBatch++;
    totalUpdated++;

    if (countInBatch >= 200) {
      await batch.commit();
      console.log(`Committed batch of ${countInBatch} updates (Total so far: ${totalUpdated})...`);
      batch = db.batch();
      countInBatch = 0;
    }
  }

  if (countInBatch > 0) {
    await batch.commit();
    console.log(`Committed final batch of ${countInBatch} updates.`);
  }

  console.log(`\nDONE!`);
  console.log(`Total leads updated: ${totalUpdated}`);
  console.log(`Total leads with SmartHome attributes cleared: ${totalShCleared}`);
}

run().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
