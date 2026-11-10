const https = require('https');
const admin = require('../functions/node_modules/firebase-admin');
const sa = require('../service-account.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

function ycloudRequest(apiKey, path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.ycloud.com',
      path,
      method,
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          resolve({ status: res.statusCode, data: parsed });
        } catch {
          resolve({ status: res.statusCode, raw: d });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  const credDoc = await db.collection('channelCredentials').doc('grupo_meraki_real').get();
  const ycloud = credDoc.data()?.ycloud;
  if (!ycloud || !ycloud.apiKey) {
    console.error('No YCloud credentials found for grupo_meraki_real');
    return;
  }
  const apiKey = ycloud.apiKey;
  console.log('Using API key prefix:', apiKey.substring(0, 8));
  console.log('Stored wabaId:', ycloud.wabaId);
  console.log('Stored fromNumber:', ycloud.fromNumber);

  // 1. Check phone numbers
  console.log('\n--- 1. Querying /v2/whatsapp/phoneNumbers ---');
  const phonesRes = await ycloudRequest(apiKey, '/v2/whatsapp/phoneNumbers');
  console.log('Phone numbers status:', phonesRes.status);
  console.log('Phone numbers data:', JSON.stringify(phonesRes.data, null, 2));

  // 2. Check templates with stored wabaId
  console.log(`\n--- 2. Querying /v2/whatsapp/templates with wabaId ${ycloud.wabaId} ---`);
  const tplRes = await ycloudRequest(apiKey, `/v2/whatsapp/templates?limit=100&filter.wabaId=${encodeURIComponent(ycloud.wabaId)}`);
  console.log('Templates status:', tplRes.status);
  console.log('Templates data count:', tplRes.data?.items?.length ?? 0);
  if (tplRes.data?.items?.length) {
    console.log('Templates:', tplRes.data.items.map(t => ({ name: t.name, status: t.status, category: t.category })));
  }

  // 3. Check templates without filter
  console.log('\n--- 3. Querying /v2/whatsapp/templates without filter ---');
  const tplAllRes = await ycloudRequest(apiKey, '/v2/whatsapp/templates?limit=100');
  console.log('All templates status:', tplAllRes.status);
  console.log('All templates data count:', tplAllRes.data?.items?.length ?? 0);
  if (tplAllRes.data?.items?.length) {
    console.log('All templates:', tplAllRes.data.items.map(t => ({ name: t.name, status: t.status, wabaId: t.wabaId })));
  }
}

run().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
