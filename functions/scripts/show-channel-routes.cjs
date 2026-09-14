/** SOLO LECTURA. Muestra los números/canales que el CRM tiene registrados
 *  (colección channelRoutes): a qué número escucha y a qué empresa lo enruta. */
const admin = require('firebase-admin');
const path  = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '..', 'service-account.json'))) });
const db = admin.firestore();

(async () => {
  const snap = await db.collection('channelRoutes').get();
  console.log(`\nchannelRoutes (${snap.size}) — números/canales que el CRM escucha:\n`);
  snap.docs.forEach((d) => {
    const x = d.data();
    console.log(`  ${x.active === false ? '⛔' : '✅'} ${d.id}`);
    console.log(`     provider  : ${x.provider}`);
    console.log(`     identifier: ${x.identifier}  (número/handle)`);
    console.log(`     empresa   : ${x.companyId}`);
    console.log(`     label     : ${x.label || '—'}`);
    console.log('');
  });
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
