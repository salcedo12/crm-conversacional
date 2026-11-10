const admin = require('firebase-admin');

if (!admin.apps.length) {
  const sa = require('../service-account.json');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

const FORBIDDEN = [
  'ai luis carlos machado',
  'luisa zuluaga',
  'juana avila',
  'encuentra tu refugio',
  'grupo constructor meraki',
  'constructor meraki',
  'sala de ventas',
];

async function main() {
  const snap = await db.collection('companies').doc('grupo_meraki_real').collection('leads').get();
  const toUpdate = [];

  snap.forEach((doc) => {
    const data = doc.data();
    const nameLower = (data.name || '').toLowerCase().trim();
    if (FORBIDDEN.some((f) => nameLower.includes(f))) {
      const phoneDigits = String(data.phone || '').replace(/\D/g, '');
      const tail = phoneDigits.length >= 4 ? phoneDigits.slice(-4) : phoneDigits;
      const cleanName = tail ? `Lead WhatsApp ${tail}` : 'Lead Sin Nombre';
      toUpdate.push({
        id: doc.id,
        currentName: data.name,
        newName: cleanName,
        phone: data.phone,
      });
    }
  });

  console.log(`Encontrados ${toUpdate.length} leads con nombres placeholder residuales.`);
  if (toUpdate.length === 0) {
    console.log('No hay leads pendientes por limpiar.');
    return;
  }

  console.table(toUpdate);

  const batch = db.batch();
  for (const item of toUpdate) {
    const ref = db.collection('companies').doc('grupo_meraki_real').collection('leads').doc(item.id);
    batch.update(ref, {
      name: item.newName,
      'metadata.rawBridgeName': item.currentName,
      updatedAt: admin.firestore.Timestamp.now(),
    });
  }

  await batch.commit();
  console.log(`✅ ${toUpdate.length} leads normalizados exitosamente a "Lead WhatsApp XXXX".`);
}

main().catch(console.error);
