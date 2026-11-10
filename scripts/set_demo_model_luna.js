const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function setDemoModel() {
  const docRef = db.collection('companies').doc('empresa_demo').collection('aiConfigs').doc('default');
  const snap = await docRef.get();
  console.log('Valor previo de model en empresa_demo:', snap.data()?.model);
  
  await docRef.update({
    model: 'gpt-5.6-luna',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  
  const updatedSnap = await docRef.get();
  console.log('Nuevo valor de model en empresa_demo:', updatedSnap.data()?.model);

  // Verificar que grupo_meraki_real sigue intacto
  const realSnap = await db.collection('companies').doc('grupo_meraki_real').collection('aiConfigs').doc('default').get();
  console.log('Valor de model en grupo_meraki_real (intacto):', realSnap.data()?.model || 'gpt-4o-mini (default)');
}

setDemoModel().catch(console.error);
