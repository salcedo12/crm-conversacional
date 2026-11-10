const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');

admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function verify() {
  const demoRef = db.collection('companies').doc('empresa_demo');

  const leads = await demoRef.collection('leads').get();
  const leadIndex = await demoRef.collection('leadIndex').get();
  const appointments = await demoRef.collection('appointments').get();
  const followUpTasks = await demoRef.collection('followUpTasks').get();
  const reassignments = await demoRef.collection('leadReassignmentEvents').get();
  const deletedLeadBackups = await demoRef.collection('deletedLeadBackups').get();

  const rootLeads = await db.collection('leads').where('companyId', '==', 'empresa_demo').get();
  const rootConvs = await db.collection('conversations').where('companyId', '==', 'empresa_demo').get();

  console.log('--- VERIFICATION RESULTS ---');
  console.log('empresa_demo/leads count:', leads.size);
  console.log('empresa_demo/leadIndex count:', leadIndex.size);
  console.log('empresa_demo/appointments count:', appointments.size);
  console.log('empresa_demo/followUpTasks count:', followUpTasks.size);
  console.log('empresa_demo/leadReassignmentEvents count:', reassignments.size);
  console.log('empresa_demo/deletedLeadBackups count:', deletedLeadBackups.size);
  console.log('root leads (empresa_demo) count:', rootLeads.size);
  console.log('root conversations (empresa_demo) count:', rootConvs.size);

  const aiConfigs = await demoRef.collection('aiConfigs').get();
  const users = await demoRef.collection('users').get();
  const config = await demoRef.collection('config').get();
  console.log('empresa_demo/aiConfigs count (should be >= 1):', aiConfigs.size);
  console.log('empresa_demo/users count (should be 3):', users.size);
  console.log('empresa_demo/config count (should be 2):', config.size);

  const prodLeads = await db.collection('companies').doc('grupo_meraki_real').collection('leads').get();
  console.log('grupo_meraki_real/leads count (should be intact, 1221):', prodLeads.size);
}

verify().catch(console.error);
