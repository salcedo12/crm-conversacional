const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function checkGoogleConns() {
  const demoConns = await db.collection('companies').doc('empresa_demo').collection('googleConnections').get();
  console.log('empresa_demo googleConnections (' + demoConns.size + '):');
  demoConns.forEach(d => console.log(d.id, d.data().email, d.data().advisorId, d.data().status, d.data().connectedAt));

  const prodConns = await db.collection('companies').doc('grupo_meraki_real').collection('googleConnections').get();
  console.log('grupo_meraki_real googleConnections (' + prodConns.size + '):');
  prodConns.forEach(d => console.log(d.id, d.data().email, d.data().advisorId, d.data().status, d.data().connectedAt));
}
checkGoogleConns().catch(console.error);
