const admin = require('../functions/node_modules/firebase-admin');
const sa = require('../service-account.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function run() {
  const compSnap = await db.collection('companies').get();
  console.log('COMPANIES:', compSnap.docs.map(d => ({ id: d.id, name: d.data().name })));
  
  for (const cDoc of compSnap.docs) {
    const cId = cDoc.id;
    console.log(`\n=================== Company: ${cId} (${cDoc.data().name}) ===================`);
    
    // Check channelCredentials
    const credSnap = await db.collection('companies').doc(cId).collection('channelCredentials').get();
    credSnap.forEach(cd => {
      const data = cd.data();
      console.log(' Credential:', cd.id, {
        channel: data.channel,
        fromNumber: data.fromNumber,
        wabaId: data.wabaId,
        hasApiKey: !!data.apiKey
      });
    });

    // Check whatsappTemplates
    const tplSnap = await db.collection('companies').doc(cId).collection('whatsappTemplates').get();
    console.log(` Templates count in ${cId}: ${tplSnap.size}`);
    tplSnap.forEach(t => {
      const d = t.data();
      console.log(`\n--- Template ID: ${t.id} ---`);
      console.log(JSON.stringify(d, null, 2));
    });
  }
}

run().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
