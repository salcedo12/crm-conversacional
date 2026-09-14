#!/usr/bin/env node
/*
 * Carga (o actualiza) las credenciales de YCloud de UNA empresa en
 * `channelCredentials/{companyId}` para que esa empresa envíe/reciba por su
 * propia cuenta de YCloud (multi-cuenta).
 *
 * Uso (desde la carpeta functions/):
 *   node scripts/setYcloudCreds.js <companyId> <apiKey> <fromNumber> <wabaId> [callingFromNumber] [callingPhoneId]
 *
 * Ejemplo:
 *   node scripts/setYcloudCreds.js grupo_meraki_real sk_xxx "+573176820728" 1643056187826489
 *
 * Requiere credenciales de administrador (ADC). Si no las tienes, corre una vez:
 *   gcloud auth application-default login
 */
const admin = require('firebase-admin');

const [, , companyId, apiKey, fromNumber, wabaId, callingFromNumber, callingPhoneId] = process.argv;

if (!companyId || !apiKey || !fromNumber || !wabaId) {
  console.error(
    'Uso: node scripts/setYcloudCreds.js <companyId> <apiKey> <fromNumber> <wabaId> [callingFromNumber] [callingPhoneId]'
  );
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'crm-conversacional',
});

const ycloud = { apiKey, fromNumber, wabaId };
if (callingFromNumber) ycloud.callingFromNumber = callingFromNumber;
if (callingPhoneId) ycloud.callingPhoneId = callingPhoneId;

admin
  .firestore()
  .collection('channelCredentials')
  .doc(companyId)
  .set({ ycloud, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
  .then(() => {
    console.log(
      `✅ Credenciales YCloud guardadas para "${companyId}" (número ${fromNumber}, WABA ${wabaId}).`
    );
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Error guardando credenciales:', err.message);
    process.exit(1);
  });
