const admin = require('../../functions/node_modules/firebase-admin');
const sa = require('../../service-account.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

function normalizeFuente(raw, docData) {
  let f = (raw || '').trim();
  if (!f || f === 'SmartHome' || f === '(vacio)' || f === 'Base de Datos' || f === 'Base 1' || f === 'Base 2') {
    if (docData.source === 'meta_ads') return docData.firstTouch?.campaign || 'PAUTA WHATSAPP 317';
    if (docData.source === 'advisor_whatsapp') return 'WhatsApp Asesor Directo';
    if (docData.source === 'web') return 'Página Web';
    if (docData.source === 'whatsapp') return 'Línea WhatsApp 317';
    return 'Trabajo de campo';
  }

  // Normalizaciones estándar de nombres
  if (f.toLowerCase() === 'referido') return 'Referidos';
  if (f.toLowerCase() === 'pagina web' || f.toLowerCase() === 'página web') return 'Página Web';
  if (f.toLowerCase().includes('vallas') || f.toLowerCase().includes('valla')) return 'Vallas publicitarias';
  if (f.toLowerCase() === 'whatsapp') return 'Línea WhatsApp 317';
  if (f.toLowerCase() === 'instagram') return 'Redes Sociales';
  if (f.toLowerCase() === 'facebook') return 'Redes Sociales';

  return f;
}

const ACTIVE_BY_DEFAULT = new Set([
  'Trabajo de campo',
  'PAUTA WHATSAPP 317',
  'Referidos',
  'Redes Sociales',
  'Marketing',
  'Página Web',
  'WhatsApp Asesor Directo',
  'Vallas publicitarias',
  'Línea WhatsApp 317',
]);

async function main() {
  const isLive = process.argv.includes('--live');
  const companyId = 'grupo_meraki_real';

  console.log(`=== BACKFILL FUENTE DE UBICACIÓN [${isLive ? '🚀 EN VIVO' : '🔍 DRY RUN'}] ===`);
  const leadsRef = db.collection('companies').doc(companyId).collection('leads');
  const snap = await leadsRef.select('metadata', 'source', 'firstTouch', 'fuenteUbicacion').get();
  console.log(`Total leads a procesar: ${snap.size}`);

  const sourceCounts = new Map();
  const updates = [];

  snap.forEach(doc => {
    const d = doc.data();
    const raw = d.metadata?.smarthomeFuenteOriginal;
    const finalFuente = normalizeFuente(raw, d);

    sourceCounts.set(finalFuente, (sourceCounts.get(finalFuente) || 0) + 1);

    // Si no tiene fuenteUbicacion o es diferente a la normalizada
    if (d.fuenteUbicacion !== finalFuente) {
      updates.push({
        ref: doc.ref,
        fuenteUbicacion: finalFuente
      });
    }
  });

  console.log(`\nFuentes detectadas (${sourceCounts.size}):`);
  const sorted = [...sourceCounts.entries()].sort((a,b) => b[1] - a[1]);
  sorted.forEach(([k, v]) => {
    const isActive = ACTIVE_BY_DEFAULT.has(k);
    console.log(`  [${isActive ? 'ACTIVA' : 'INACTIVA'}] ${k}: ${v} leads`);
  });

  console.log(`\nLeads que requieren actualización de fuenteUbicacion: ${updates.length}`);

  if (!isLive) {
    console.log('\nModo auditoría terminado. Ejecuta con --live para aplicar cambios a Firestore.');
    return;
  }

  // 1. Guardar/Actualizar documentos en leadSources
  console.log('\n1. Creando catálogo en companies/grupo_meraki_real/leadSources...');
  const leadSourcesCol = db.collection('companies').doc(companyId).collection('leadSources');

  for (const [sourceName, count] of sorted) {
    const slug = sourceName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'fuente';

    const isActive = ACTIVE_BY_DEFAULT.has(sourceName);
    const sourceDoc = {
      name: sourceName,
      active: isActive,
      leadCount: count,
      updatedAt: admin.firestore.Timestamp.now(),
    };

    const docRef = leadSourcesCol.doc(slug);
    const existing = await docRef.get();
    if (!existing.exists) {
      await docRef.set({
        ...sourceDoc,
        createdAt: admin.firestore.Timestamp.now(),
      });
    } else {
      await docRef.update({
        leadCount: count,
        updatedAt: admin.firestore.Timestamp.now(),
      });
    }
  }
  console.log('Catálogo de fuentes creado y actualizado exitosamente.');

  // 2. Batch update de los leads
  console.log(`\n2. Actualizando ${updates.length} leads en Firestore (batches de 450)...`);
  const BATCH_SIZE = 450;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = updates.slice(i, i + BATCH_SIZE);
    chunk.forEach(item => {
      batch.update(item.ref, {
        fuenteUbicacion: item.fuenteUbicacion,
        updatedAt: admin.firestore.Timestamp.now()
      });
    });
    await batch.commit();
    console.log(`  Guardados ${Math.min(i + BATCH_SIZE, updates.length)} / ${updates.length}`);
  }

  console.log('\n✅ Backfill completado al 100% con éxito.');
}

main().catch(err => {
  console.error('Error durante backfill:', err);
  process.exit(1);
});
