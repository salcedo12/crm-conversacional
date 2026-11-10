const admin = require('firebase-admin');
const sa = require('../service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

const pairs = [
  { dupId: 'VuBTPHkX2zawsnUqlhGK', origId: 'ZyGXXjuKWhFukaD5VBxQ', name: '.jaidy .gomez' },
  { dupId: '6P7X7YehU90lzeQnQLkc', origId: 'xcKy86DjPaJOsPfQEZWs', name: 'Doris Romero' },
  { dupId: 'Fc6ZgSDxh4WCP4lvyx4H', origId: 'Uu157H8hEfeSaSQK6IWh', name: 'Esteban Bossa' },
  { dupId: 'cipIA4rryAPcOfId75KF', origId: 'bh3GqyeiwkETHug9odVC', name: 'Mazo .' }
];

async function mergePairs() {
  const companyId = 'grupo_meraki_real';

  for (const pair of pairs) {
    console.log(`\n========================================`);
    console.log(`Procesando par: ${pair.name} (DUP: ${pair.dupId} -> ORIG: ${pair.origId})`);

    const dupRef = db.collection('companies').doc(companyId).collection('leads').doc(pair.dupId);
    const origRef = db.collection('companies').doc(companyId).collection('leads').doc(pair.origId);

    const dupSnap = await dupRef.get();
    const origSnap = await origRef.get();

    if (!dupSnap.exists) {
      console.log(`Duplicate ${pair.dupId} already deleted or not found.`);
      continue;
    }
    if (!origSnap.exists) {
      console.error(`ERROR: Original ${pair.origId} does not exist! Aborting this pair.`);
      continue;
    }

    const dupData = dupSnap.data();
    const origData = origSnap.data();

    // 1. Obtener mensajes del duplicado
    const dupMsgsSnap = await dupRef.collection('messages').get();
    console.log(`Mensajes a migrar desde el duplicado: ${dupMsgsSnap.size}`);

    for (const msgDoc of dupMsgsSnap.docs) {
      const msgData = msgDoc.data();
      const targetMsgRef = origRef.collection('messages').doc(msgDoc.id);

      // Copiar mensaje al lead original con leadId actualizado
      await targetMsgRef.set({
        ...msgData,
        leadId: pair.origId
      }, { merge: true });

      // Borrar del duplicado
      await msgDoc.ref.delete();
      console.log(`  -> Mensaje migrado: ${msgDoc.id} (${msgData.direction} - ${msgData.content?.substring(0, 40)})`);
    }

    // 2. Obtener el último mensaje del lead original consolidado
    const allMsgsSnap = await origRef.collection('messages').orderBy('createdAt', 'desc').limit(5).get();
    const updates = {};

    if (!allMsgsSnap.empty) {
      const latestMsg = allMsgsSnap.docs[0].data();
      updates.lastMessageAt = latestMsg.createdAt || admin.firestore.Timestamp.now();
      updates.lastMessageText = latestMsg.content || (latestMsg.mediaType ? 'Archivo' : '');

      for (const d of allMsgsSnap.docs) {
        const m = d.data();
        if (m.direction === 'inbound' && !updates.lastInboundAt && m.createdAt) {
          updates.lastInboundAt = m.createdAt;
        }
        if (m.direction === 'outbound' && !updates.lastAdvisorMessageAt && m.createdAt) {
          updates.lastAdvisorMessageAt = m.createdAt;
        }
      }
    }

    // 3. Corregir normalizedPhone en el lead original (quitar +57 erróneo en números +1)
    if (origData.phone && origData.phone.startsWith('+1')) {
      updates.normalizedPhone = origData.phone;
      console.log(`  -> Corrigiendo normalizedPhone: ${origData.normalizedPhone} -> ${origData.phone}`);
    }

    // 4. Aplicar updates al lead original
    await origRef.update(updates);
    console.log(`  -> Lead original actualizado con éxito.`);

    // 5. Eliminar el lead duplicado
    await dupRef.delete();
    console.log(`  -> Lead duplicado ${pair.dupId} eliminado correctamente.`);
  }

  console.log(`\n¡Todos los 4 pares han sido unificados y consolidados exitosamente!`);
}

mergePairs().catch(console.error);
