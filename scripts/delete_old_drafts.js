const admin = require('../functions/node_modules/firebase-admin');
const sa = require('../service-account.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function deleteOldDrafts() {
  const colRef = db.collection('companies').doc('grupo_meraki_real').collection('whatsappTemplates');
  
  // 1. Delete bievenida_angelica_acevedo (ID: XIKcBgVFIF5pQKh11HVS)
  const doc1 = await colRef.doc('XIKcBgVFIF5pQKh11HVS').get();
  if (doc1.exists) {
    console.log('Deleting:', doc1.id, doc1.data().name);
    await colRef.doc('XIKcBgVFIF5pQKh11HVS').delete();
    console.log('Successfully deleted bievenida_angelica_acevedo');
  } else {
    console.log('Doc XIKcBgVFIF5pQKh11HVS not found');
  }

  // 2. Delete bienvenida_angelica (ID: eW4g7fCYFJqErU3ieFez)
  const doc2 = await colRef.doc('eW4g7fCYFJqErU3ieFez').get();
  if (doc2.exists) {
    console.log('Deleting:', doc2.id, doc2.data().name);
    await colRef.doc('eW4g7fCYFJqErU3ieFez').delete();
    console.log('Successfully deleted bienvenida_angelica');
  } else {
    console.log('Doc eW4g7fCYFJqErU3ieFez not found');
  }

  // Verify remaining templates
  const snap = await colRef.orderBy('createdAt', 'desc').get();
  console.log(`\nRemaining templates in grupo_meraki_real (${snap.size}):`);
  snap.docs.forEach((d, i) => {
    const data = d.data();
    console.log(` ${i + 1}. [${data.lineNumber}] ${data.name} (${data.status}) - ID: ${d.id}`);
  });
}

deleteOldDrafts().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
