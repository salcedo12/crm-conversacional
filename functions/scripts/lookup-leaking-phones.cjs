/** SOLO LECTURA. Busca teléfonos concretos en TODAS las empresas del CRM y
 *  reporta si el lead existe aquí, su fuente, inbox, asesor y si ya se sincronizó
 *  a SmartHome. Sirve para saber si un lead "entró al CRM" o solo a SmartHome. */
const admin = require('firebase-admin');
const path  = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '..', 'service-account.json'))) });
const db = admin.firestore();

// Acepta teléfonos por argumento; si no, usa los tres detectados.
const rawPhones = process.argv.slice(2).length ? process.argv.slice(2)
  : ['573008706622', '573023632329', '573122492471'];
// Variantes con y sin +, por si están guardados distinto.
const variants = (p) => {
  const d = p.replace(/\D/g, '');
  return Array.from(new Set([`+${d}`, d, `+57${d.replace(/^57/, '')}`, d.replace(/^57/, '')]));
};
const fmt = (ts) => ts && ts.toDate ? ts.toDate().toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : '—';

(async () => {
  const companies = await db.collection('companies').get();
  console.log(`\nEmpresas en el CRM: ${companies.size} → ${companies.docs.map(d => d.id).join(', ')}\n`);

  for (const phone of rawPhones) {
    console.log(`================ ${phone} ================`);
    let found = 0;
    for (const c of companies.docs) {
      for (const v of variants(phone)) {
        const snap = await c.ref.collection('leads').where('phone', '==', v).get();
        for (const doc of snap.docs) {
          found++;
          const x = doc.data();
          console.log(`  ✅ EN EL CRM · empresa=${c.id}`);
          console.log(`     nombre       : ${x.name || '(sin nombre)'}`);
          console.log(`     phone        : ${x.phone}`);
          console.log(`     source       : ${x.source || x.leadSource || '—'}`);
          console.log(`     inbox        : ${x.inboxId || x.businessNumber || x.to || '—'}`);
          console.log(`     adId         : ${x.sourceMeta?.adId || x.metadata?.adId || x.adId || '—'}`);
          console.log(`     asignado a   : ${x.assignedTo || '— sin asignar'}`);
          console.log(`     smartHomeId  : ${x.smartHomeCustomerId || '— (no sincronizado)'}`);
          console.log(`     smartHomeErr : ${x.smartHomeSyncError || '—'}`);
          console.log(`     creado       : ${fmt(x.createdAt)}`);
          console.log('');
        }
      }
    }
    if (!found) console.log('  ❌ NO existe en ninguna empresa del CRM (solo llegó a SmartHome).\n');
  }
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
