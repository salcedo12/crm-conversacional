const admin = require('../functions/node_modules/firebase-admin');
const sa = require('../service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(sa),
    projectId: 'crm-conversacional',
  });
}
const db = admin.firestore();

async function main() {
  const msgs = await db.collection('companies/grupo_meraki_real/leads/QQyrfXAVFX7KsapUhMKu/messages')
    .orderBy('createdAt', 'asc')
    .get();

  for (const m of msgs.docs) {
    const md = m.data();
    const dateStr = md.createdAt ? new Date(md.createdAt._seconds * 1000).toLocaleString('es-CO') : 'no-date';
    const text = md.content || md.fileName || md.mediaType || '(vacio)';
    const phone = md.metadata?.advisorPhone || '';
    const origin = md.metadata?.origin || '';
    console.log(`${dateStr} | ${md.direction.padEnd(8)} | ${md.senderType.padEnd(7)} | ${origin} (${phone}) | ${text}`);
  }
}

main().catch(console.error);
