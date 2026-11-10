const admin = require('../functions/node_modules/firebase-admin');
const sa = require('../service-account.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

// Test what client.listTemplates returns for both WABAs:
const https = require('https');

function ycloudGet(apiKey, path) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'api.ycloud.com',
      path,
      headers: { 'X-API-Key': apiKey }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
    }).on('error', reject);
  });
}

async function testSync() {
  const cred = await db.collection('channelCredentials').doc('grupo_meraki_real').get();
  const apiKey = cred.data().ycloud.apiKey;
  const wabaId = cred.data().ycloud.wabaId;

  console.log('Testing WABA:', wabaId);
  const res = await ycloudGet(apiKey, `/v2/whatsapp/templates?limit=100&filter.wabaId=${wabaId}`);
  console.log('Templates in WABA:', res.body.items);
}

testSync().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
