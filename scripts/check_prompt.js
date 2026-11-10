const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function checkBasePrompt() {
  const snap = await db.collection('companies').doc('empresa_demo').collection('aiConfigs').get();
  snap.forEach(d => {
    const data = d.data();
    console.log('ID:', d.id);
    console.log('quoteMode:', data.quoteMode);
    console.log('basePrompt:');
    console.log(data.basePrompt);
  });
}
checkBasePrompt().catch(console.error);
