const admin = require('firebase-admin');
const sa = require('../service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(sa),
    projectId: sa.project_id,
  });
}

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

async function migrateSmartHomeBitacorasToNotes() {
  console.log('Iniciando migración de bitácoras históricas a notas nativas de seguimiento...');

  const companyId = 'grupo_meraki_real';
  const leadsSnap = await db.collection('companies').doc(companyId).collection('leads').get();

  console.log(`Total de leads a inspeccionar: ${leadsSnap.size}`);

  let leadsProcessed = 0;
  let leadsWithBitacoras = 0;
  let notesCreated = 0;

  let batch = db.batch();
  let batchCount = 0;

  for (const doc of leadsSnap.docs) {
    leadsProcessed++;
    const data = doc.data();
    const bitacoras = data.metadata?.smarthomeBitacoras || data.bitacoras;

    if (!Array.isArray(bitacoras) || bitacoras.length === 0) {
      continue;
    }

    leadsWithBitacoras++;
    const leadId = doc.id;
    const notesColRef = db.collection('companies').doc(companyId).collection('leads').doc(leadId).collection('notes');

    // Revisar si ya tiene notas sincronizadas previamente para evitar duplicados
    const existingSnap = await notesColRef.where('source', '==', 'smarthome_sync').get();
    const existingDates = new Set();
    existingSnap.forEach((n) => {
      const ca = n.data().createdAt;
      if (ca && typeof ca.toMillis === 'function') {
        existingDates.add(ca.toMillis());
      }
    });

    for (const b of bitacoras) {
      const dateStr = b.fecha || b.lastDate;
      let dateMillis = Date.now();
      if (dateStr) {
        const cleanDateStr = String(dateStr).trim().replace(' ', 'T');
        const parsed = new Date(cleanDateStr);
        if (!isNaN(parsed.getTime())) {
          dateMillis = parsed.getTime();
        }
      }

      if (existingDates.has(dateMillis)) {
        continue;
      }
      existingDates.add(dateMillis);

      const ts = Timestamp.fromMillis(dateMillis);

      // Clasificación del tipo de acción
      let actionType = 'seguimiento_general';
      const textToScan = `${b.action || ''} ${b.description || ''}`.toLowerCase();
      if (textToScan.includes('llamada') || textToScan.includes('telefono') || textToScan.includes('teléfono')) {
        actionType = 'llamada';
      } else if (textToScan.includes('visita') || textToScan.includes('terreno') || textToScan.includes('sala')) {
        actionType = 'visita_terreno';
      } else if (textToScan.includes('cita') || textToScan.includes('reunion') || textToScan.includes('reunión')) {
        actionType = 'cita_reunion';
      } else if (textToScan.includes('brochure') || textToScan.includes('cotizacion') || textToScan.includes('cotización') || textToScan.includes('informacion') || textToScan.includes('información')) {
        actionType = 'envio_informacion';
      }

      let authorName = b.asesor || (data.metadata?.smarthomeAsesorOriginal) || (data.assignedToName) || 'SmartHome';
      let cleanDesc = (b.description || b.action || '').trim();
      const authorMatch = cleanDesc.match(/Registrado por:\s*([^\n\r]+)/i);
      if (authorMatch && authorMatch[1]) {
        authorName = authorMatch[1].trim();
      }
      cleanDesc = cleanDesc.replace(/Registrado por:[^\n\r]+\n?/gi, '').trim();

      const newDocRef = notesColRef.doc();
      batch.set(newDocRef, {
        companyId,
        leadId,
        authorName,
        text: cleanDesc || b.action || 'Gestión registrada en SmartHome',
        actionType,
        result: b.action || 'Gestión SmartHome',
        kind: 'note',
        type: 'ficha_tecnica',
        source: 'smarthome_sync',
        createdAt: ts,
        updatedAt: ts,
      });

      batchCount++;
      notesCreated++;

      if (batchCount >= 400) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
        console.log(`Guardadas ${notesCreated} notas... (${leadsProcessed}/${leadsSnap.size} leads procesados)`);
      }
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log('\n=== MIGRACIÓN FINALIZADA ===');
  console.log(`Leads con bitácoras encontradas: ${leadsWithBitacoras}`);
  console.log(`Notas nativas de seguimiento creadas: ${notesCreated}`);
}

migrateSmartHomeBitacorasToNotes().catch(console.error);
