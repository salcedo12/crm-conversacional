/**
 * Backfill único: reclasifica los leads que entraron DIRECTO al WhatsApp de un
 * asesor (marcados con metadata.advisorWhatsappMirror === 'true') para que su
 * fuente sea 'advisor_whatsapp'. Así salen de estadísticas (tablero, pauta,
 * informes) y del contador de reparto, igual que los nuevos.
 *
 * Seguro por defecto: solo CUENTA lo que cambiaría. Para escribir de verdad:
 *   node backfill-advisor-whatsapp-source.js --apply
 *
 * Requiere service-account.json en la raíz del repo.
 */

const path = require('path');
const admin = require(path.join(__dirname, 'functions', 'node_modules', 'firebase-admin'));

const APPLY = process.argv.includes('--apply');
const SOURCE = 'advisor_whatsapp';

admin.initializeApp({
  credential: admin.credential.cert(require(path.join(__dirname, 'service-account.json'))),
});

const db = admin.firestore();

async function main() {
  console.log(`\n== Backfill fuente '${SOURCE}' ==`);
  console.log(APPLY ? 'MODO: APLICAR (escribe cambios)\n' : 'MODO: SIMULACIÓN (no escribe; usa --apply para aplicar)\n');

  // Recorremos empresa por empresa. Consultar `metadata.advisorWhatsappMirror`
  // a nivel de colección usa el índice automático de campo; el collectionGroup
  // sobre un subcampo de mapa exigiría crear un índice manual, así que lo
  // evitamos. El marcador lo pone el webhook del bridge al reflejar el lead.
  const companies = await db.collection('companies').get();
  const found = [];
  for (const company of companies.docs) {
    const snap = await company.ref
      .collection('leads')
      .where('metadata.advisorWhatsappMirror', '==', 'true')
      .get();
    for (const d of snap.docs) found.push(d);
  }

  const toFix = found.filter((d) => d.get('source') !== SOURCE);
  console.log(`Empresas: ${companies.size} · leads directos: ${found.length} · por corregir: ${toFix.length}`);

  if (toFix.length === 0) {
    console.log('Nada que hacer.');
    return;
  }

  // Muestra de lo que cambiaría.
  toFix.slice(0, 10).forEach((d) => {
    console.log(`  - ${d.ref.path} · fuente actual: ${d.get('source')} → ${SOURCE}`);
  });
  if (toFix.length > 10) console.log(`  … y ${toFix.length - 10} más`);

  if (!APPLY) {
    console.log('\nSimulación: no se escribió nada. Reejecuta con --apply para aplicar.');
    return;
  }

  let done = 0;
  for (let i = 0; i < toFix.length; i += 400) {
    const batch = db.batch();
    for (const d of toFix.slice(i, i + 400)) {
      batch.update(d.ref, { source: SOURCE, updatedAt: admin.firestore.Timestamp.now() });
    }
    await batch.commit();
    done += Math.min(400, toFix.length - i);
    console.log(`  aplicados ${done}/${toFix.length}`);
  }
  console.log('\nListo.');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Error en backfill:', err);
  process.exit(1);
});
