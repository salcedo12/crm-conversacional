/**
 * Borra UN mensaje de imagen concreto (doc de Firestore + archivo en Storage).
 * Seguro por defecto: solo MUESTRA lo que borraría. Para borrar de verdad: --apply
 *
 *   node functions/scripts/borrar-imagen.cjs             # simulación
 *   node functions/scripts/borrar-imagen.cjs --apply     # borra de verdad
 */
process.env.GOOGLE_APPLICATION_CREDENTIALS = 'C:/crm-conversacional/service-account.json';
process.env.GCLOUD_PROJECT = 'crm-conversacional';
const admin = require('C:/crm-conversacional/functions/node_modules/firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require('C:/crm-conversacional/service-account.json')),
    projectId: 'crm-conversacional',
    storageBucket: 'crm-conversacional.firebasestorage.app',
  });
}
const db = admin.firestore();

const APPLY = process.argv.includes('--apply');
const CID = 'grupo_meraki_real';
const LEAD_ID = 'JxhnMY8IetWPfRUEPFgq';               // Joseph 😎 (+573165576840)
const MSG_ID = 'viilDdModlxT7TeS5ODr';                // imagen del 25/08 05:41:38 a.m.

/** Extrae la ruta del objeto de Storage desde un mediaUrl de Firebase (…/o/<path>?…). */
function storagePathFromUrl(url) {
  const m = /\/o\/([^?]+)/.exec(url || '');
  return m ? decodeURIComponent(m[1]) : null;
}

(async () => {
  console.log(`\n== Borrar imagen == ${APPLY ? 'MODO APLICAR (borra)' : 'SIMULACIÓN (usa --apply para borrar)'}\n`);
  const ref = db.collection('companies').doc(CID).collection('leads').doc(LEAD_ID).collection('messages').doc(MSG_ID);
  const snap = await ref.get();
  if (!snap.exists) { console.log('El mensaje ya no existe. Nada que borrar.'); process.exit(0); }
  const m = snap.data();
  console.log('Mensaje:', MSG_ID, '| tipo:', m.mediaType || m.mediaKind, '| dir:', m.direction, '| fecha:', m.createdAt && m.createdAt.toDate && m.createdAt.toDate().toLocaleString('es-CO'));
  console.log('mediaUrl:', (m.mediaUrl || '').slice(0, 120));

  const bucketName = 'crm-conversacional.firebasestorage.app';
  const spath = m.mediaStoragePath || storagePathFromUrl(m.mediaUrl);
  const inThisBucket = (m.mediaUrl || '').includes(bucketName);
  console.log('Archivo en Storage:', inThisBucket && spath ? `${bucketName}/${spath}` : '(no está en nuestro bucket o no se pudo resolver — solo se borra el mensaje)');

  if (!APPLY) { console.log('\nSimulación: no se borró nada. Ejecuta con --apply para borrar.'); process.exit(0); }

  // 1) Borrar el archivo de Storage (si está en nuestro bucket).
  if (inThisBucket && spath) {
    try { await admin.storage().bucket(bucketName).file(spath).delete(); console.log('✓ Archivo de Storage borrado.'); }
    catch (e) { console.log('⚠ No se pudo borrar el archivo de Storage:', e.message, '(se borra el mensaje igual).'); }
  }
  // 2) Borrar el mensaje de Firestore.
  await ref.delete();
  console.log('✓ Mensaje de Firestore borrado.');
  console.log('\nListo. La imagen ya no aparecerá en la conversación.');
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e); process.exit(1); });
