const admin = require('../functions/node_modules/firebase-admin');
const sa = require('../service-account.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function run() {
  const snap = await db.collection('companies').doc('grupo_meraki_real').collection('leads')
    .select('metadata', 'source', 'firstTouch')
    .get();
  
  const map = new Map();
  snap.forEach(doc => {
    const d = doc.data();
    let fuente = d.metadata?.smarthomeFuenteOriginal;
    if (!fuente || fuente === 'SmartHome') {
      if (d.source === 'meta_ads') fuente = d.firstTouch?.campaign || 'PAUTA WHATSAPP 317';
      else if (d.source === 'advisor_whatsapp') fuente = 'WhatsApp Asesor Directo';
      else if (d.source === 'web') fuente = 'Página Web';
      else if (d.source === 'whatsapp') fuente = 'Línea WhatsApp 317';
      else fuente = 'Trabajo de campo';
    }
    // Normalizaciones menores
    if (fuente === 'Referido') fuente = 'Referidos';
    map.set(fuente, (map.get(fuente) || 0) + 1);
  });

  console.log('Total unique sources:', map.size);
  const sorted = [...map.entries()].sort((a,b) => b[1] - a[1]);
  sorted.forEach(([k, v]) => console.log(`${v}\t${k}`));
}
run();
