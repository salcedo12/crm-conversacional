const admin = require('../functions/node_modules/firebase-admin');
const sa = require('../service-account.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function run() {
  const docRef = db.collection('channelCredentials').doc('grupo_meraki_real');
  const snap = await docRef.get();
  const current = snap.data();
  console.log('Current channelCredentials/grupo_meraki_real:', current);

  const updatedYcloud = {
    ...current.ycloud,
    wabaId: '1602852641481306',
  };

  await docRef.update({
    ycloud: updatedYcloud,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log('Successfully updated wabaId to 1602852641481306');
}

run().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
