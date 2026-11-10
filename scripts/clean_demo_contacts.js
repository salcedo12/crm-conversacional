const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');
const fs = require('fs');
const path = require('path');

admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

function getTimestampString() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function backupAndDeleteDemoContacts(dryRun = true) {
  console.log(`Starting ${dryRun ? 'DRY-RUN' : 'LIVE RUN'} for empresa_demo cleanup...`);

  const backupData = {
    timestamp: new Date().toISOString(),
    companyId: 'empresa_demo',
    leads: [],
    leadIndex: [],
    appointments: [],
    followUpTasks: [],
    leadReassignmentEvents: [],
    deletedLeadBackups: [],
    rootLeads: [],
    rootConversations: []
  };

  const demoRef = db.collection('companies').doc('empresa_demo');

  const leadSubRefs = [];
  const rootLeadSubRefs = [];
  const rootConvSubRefs = [];

  // 1. Leads in companies/empresa_demo/leads + subcollections
  console.log('Fetching companies/empresa_demo/leads...');
  const leadsSnap = await demoRef.collection('leads').get();
  console.log(`Found ${leadsSnap.size} leads in empresa_demo.`);

  let leadCount = 0;
  for (const doc of leadsSnap.docs) {
    leadCount++;
    if (leadCount % 20 === 0) console.log(`  Processed ${leadCount}/${leadsSnap.size} leads...`);
    const leadRecord = {
      id: doc.id,
      data: doc.data(),
      subcollections: {}
    };

    const subcols = await doc.ref.listCollections();
    for (const sub of subcols) {
      const subSnap = await sub.get();
      leadRecord.subcollections[sub.id] = subSnap.docs.map(s => {
        leadSubRefs.push(s.ref);
        return {
          id: s.id,
          data: s.data()
        };
      });
    }
    backupData.leads.push(leadRecord);
  }
  console.log(`Finished processing leads. Found ${leadSubRefs.length} subcollection documents.`);

  // 2. leadIndex
  console.log('Fetching companies/empresa_demo/leadIndex...');
  const indexSnap = await demoRef.collection('leadIndex').get();
  backupData.leadIndex = indexSnap.docs.map(d => ({ id: d.id, data: d.data() }));
  console.log(`Found ${indexSnap.size} leadIndex records.`);

  // 3. appointments
  console.log('Fetching companies/empresa_demo/appointments...');
  const apptSnap = await demoRef.collection('appointments').get();
  backupData.appointments = apptSnap.docs.map(d => ({ id: d.id, data: d.data() }));
  console.log(`Found ${apptSnap.size} appointments.`);

  // 4. followUpTasks
  console.log('Fetching companies/empresa_demo/followUpTasks...');
  const followSnap = await demoRef.collection('followUpTasks').get();
  backupData.followUpTasks = followSnap.docs.map(d => ({ id: d.id, data: d.data() }));
  console.log(`Found ${followSnap.size} followUpTasks.`);

  // 5. leadReassignmentEvents
  console.log('Fetching companies/empresa_demo/leadReassignmentEvents...');
  const reassignSnap = await demoRef.collection('leadReassignmentEvents').get();
  backupData.leadReassignmentEvents = reassignSnap.docs.map(d => ({ id: d.id, data: d.data() }));
  console.log(`Found ${reassignSnap.size} leadReassignmentEvents.`);

  // 5b. deletedLeadBackups
  console.log('Fetching companies/empresa_demo/deletedLeadBackups...');
  const dlbSnap = await demoRef.collection('deletedLeadBackups').get();
  backupData.deletedLeadBackups = dlbSnap.docs.map(d => ({ id: d.id, data: d.data() }));
  console.log(`Found ${dlbSnap.size} deletedLeadBackups.`);

  // 6. Root leads (companyId == 'empresa_demo')
  console.log('Fetching root leads for empresa_demo...');
  const rootLeadsSnap = await db.collection('leads').where('companyId', '==', 'empresa_demo').get();
  for (const doc of rootLeadsSnap.docs) {
    const rootLeadRecord = {
      id: doc.id,
      data: doc.data(),
      subcollections: {}
    };
    const subcols = await doc.ref.listCollections();
    for (const sub of subcols) {
      const subSnap = await sub.get();
      rootLeadRecord.subcollections[sub.id] = subSnap.docs.map(s => {
        rootLeadSubRefs.push(s.ref);
        return { id: s.id, data: s.data() };
      });
    }
    backupData.rootLeads.push(rootLeadRecord);
  }
  console.log(`Found ${rootLeadsSnap.size} root leads.`);

  // 7. Root conversations (companyId == 'empresa_demo')
  console.log('Fetching root conversations for empresa_demo...');
  const rootConvsSnap = await db.collection('conversations').where('companyId', '==', 'empresa_demo').get();
  for (const doc of rootConvsSnap.docs) {
    const rootConvRecord = {
      id: doc.id,
      data: doc.data(),
      subcollections: {}
    };
    const subcols = await doc.ref.listCollections();
    for (const sub of subcols) {
      const subSnap = await sub.get();
      rootConvRecord.subcollections[sub.id] = subSnap.docs.map(s => {
        rootConvSubRefs.push(s.ref);
        return { id: s.id, data: s.data() };
      });
    }
    backupData.rootConversations.push(rootConvRecord);
  }
  console.log(`Found ${rootConvsSnap.size} root conversations.`);

  // Save backup to file
  const backupDir = path.join('c:/crm-conversacional/backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const backupFilePath = path.join(backupDir, `backup_empresa_demo_${getTimestampString()}.json`);
  fs.writeFileSync(backupFilePath, JSON.stringify(backupData, null, 2), 'utf-8');
  console.log(`Backup successfully written to ${backupFilePath} (${(fs.statSync(backupFilePath).size / 1024).toFixed(1)} KB)`);

  if (dryRun) {
    console.log('DRY RUN COMPLETE. No data was deleted.');
    return;
  }

  // Helper for batch deletes (max 400 per commit)
  async function batchDeleteRefs(refs, label) {
    console.log(`Deleting ${refs.length} docs for ${label}...`);
    let count = 0;
    while (refs.length > 0) {
      const chunk = refs.splice(0, 400);
      const batch = db.batch();
      for (const ref of chunk) {
        batch.delete(ref);
      }
      await batch.commit();
      count += chunk.length;
      console.log(`  Deleted ${count} docs so far for ${label}`);
    }
  }

  // Deletions:
  // A. Subcollections of leads (messages, etc.)
  await batchDeleteRefs(leadSubRefs, 'leads subcollections');

  // B. Leads themselves
  const leadRefs = leadsSnap.docs.map(d => d.ref);
  await batchDeleteRefs(leadRefs, 'companies/empresa_demo/leads');

  // C. leadIndex
  const indexRefs = indexSnap.docs.map(d => d.ref);
  await batchDeleteRefs(indexRefs, 'companies/empresa_demo/leadIndex');

  // D. appointments
  const apptRefs = apptSnap.docs.map(d => d.ref);
  await batchDeleteRefs(apptRefs, 'companies/empresa_demo/appointments');

  // E. followUpTasks
  const followRefs = followSnap.docs.map(d => d.ref);
  await batchDeleteRefs(followRefs, 'companies/empresa_demo/followUpTasks');

  // F. leadReassignmentEvents
  const reassignRefs = reassignSnap.docs.map(d => d.ref);
  await batchDeleteRefs(reassignRefs, 'companies/empresa_demo/leadReassignmentEvents');

  // F2. deletedLeadBackups
  const dlbRefs = dlbSnap.docs.map(d => d.ref);
  await batchDeleteRefs(dlbRefs, 'companies/empresa_demo/deletedLeadBackups');

  // G. Root leads & subcollections
  await batchDeleteRefs(rootLeadSubRefs, 'root leads subcollections');
  const rootLeadRefs = rootLeadsSnap.docs.map(d => d.ref);
  await batchDeleteRefs(rootLeadRefs, 'root leads');

  // H. Root conversations & subcollections
  await batchDeleteRefs(rootConvSubRefs, 'root conversations subcollections');
  const rootConvRefs = rootConvsSnap.docs.map(d => d.ref);
  await batchDeleteRefs(rootConvRefs, 'root conversations');

  console.log('ALL DELETIONS FINISHED SUCCESSFULLY!');
}

const isLive = process.argv.includes('--live');
backupAndDeleteDemoContacts(!isLive).catch(console.error);
