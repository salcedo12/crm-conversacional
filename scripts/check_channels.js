const admin = require('../functions/node_modules/firebase-admin');
const sa = require('../service-account.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function run() {
  console.log('=== top-level channelCredentials ===');
  const snap = await db.collection('channelCredentials').get();
  snap.forEach(d => {
    const data = d.data();
    console.log(`Doc ID: ${d.id}`);
    if (data.ycloud) {
      console.log(' ycloud:', {
        fromNumber: data.ycloud.fromNumber,
        wabaId: data.ycloud.wabaId,
        hasApiKey: !!data.ycloud.apiKey,
        apiKeyPrefix: data.ycloud.apiKey ? data.ycloud.apiKey.substring(0, 8) + '...' : null,
      });
    } else {
      console.log(' data:', data);
    }
  });

  console.log('\n=== channelRouting ===');
  const routesSnap = await db.collection('channelRouting').get();
  routesSnap.forEach(d => {
    console.log(d.id, d.data());
  });

  console.log('\n=== advisor WhatsApp lines ===');
  // let's check advisor lines
  const advisorsSnap = await db.collection('companies').doc('grupo_meraki_real').collection('advisors').get();
  advisorsSnap.forEach(d => {
    console.log('Advisor:', d.id, d.data().name, d.data().whatsappLine, d.data().wabaId);
  });
}

run().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
