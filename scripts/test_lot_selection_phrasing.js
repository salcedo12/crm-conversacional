process.env.GOOGLE_APPLICATION_CREDENTIALS = 'c:/crm-conversacional/service-account.json';
const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');

if (admin.apps.length === 0) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

const OpenAI = require('c:/crm-conversacional/functions/node_modules/openai');
const { getCotizacionToolForCompany } = require('c:/crm-conversacional/functions/lib/modules/ai/aiOrchestrator.service');

async function testLotPhrasing() {
  const demoDoc = await db.collection('companies').doc('empresa_demo').collection('aiConfigs').doc('default').get();
  const config = demoDoc.data();

  // Try to read secret or env
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('Skipping direct OpenAI call since OPENAI_API_KEY is not local env (runs on cloud).');
    return;
  }
}

testLotPhrasing().catch(console.error);
