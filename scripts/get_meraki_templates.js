const admin = require('../functions/node_modules/firebase-admin');
const sa = require('../service-account.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function run() {
  const cId = 'grupo_meraki_real';
  const credSnap = await db.collection('companies').doc(cId).collection('channelCredentials').get();
  console.log(`=== CHANNEL CREDENTIALS FOR ${cId} ===`);
  const creds = [];
  credSnap.forEach(d => {
    creds.push({ id: d.id, ...d.data() });
    console.log(d.id, JSON.stringify(d.data(), null, 2));
  });

  const tplSnap = await db.collection('companies').doc(cId).collection('whatsappTemplates').get();
  console.log(`\n=== TEMPLATES FOR ${cId} (Total: ${tplSnap.size}) ===`);
  const tpls = [];
  tplSnap.forEach(t => {
    tpls.push({ id: t.id, ...t.data() });
  });

  const fs = require('fs');
  fs.writeFileSync('scripts/meraki_templates.json', JSON.stringify({ credentials: creds, templates: tpls }, null, 2), 'utf8');
  console.log(`Saved ${tpls.length} templates and ${creds.length} credentials to scripts/meraki_templates.json`);
}

run().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
