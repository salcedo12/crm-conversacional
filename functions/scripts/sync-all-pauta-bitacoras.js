const admin = require('firebase-admin');
const sa = require('../service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
}
const db = admin.firestore();
const { getSmartHomeProspectSummary } = require('../lib/integrations/smarthome/smarthome.client');

async function main() {
  console.log('Iniciando sincronización masiva de bitácoras desde SmartHome API...');
  
  // Seleccionar leads operativos (no migrados de Excel)
  const snap = await db.collection('companies').doc('grupo_meraki_real').collection('leads').get();
  const leads = [];
  snap.forEach(d => {
    const data = d.data();
    const isMigrated = data.metadata?.migratedFrom || (data.tags && data.tags.includes('smarthome_migracion'));
    if (!isMigrated && data.phone) {
      leads.push({ id: d.id, phone: data.phone, name: data.name, metadata: data.metadata || {} });
    }
  });

  console.log(`Total leads operativos a verificar en SmartHome: ${leads.length}`);

  let synced = 0;
  let notFound = 0;
  let errors = 0;
  const CONCURRENCY = 8;
  let cursor = 0;

  async function worker(workerId) {
    while (cursor < leads.length) {
      const idx = cursor++;
      const lead = leads[idx];
      try {
        const summary = await getSmartHomeProspectSummary(lead.phone);
        if (summary && summary.found && summary.events && summary.events.length > 0) {
          const bitacoras = summary.events.map(e => ({
            action: e.action || 'Seguimiento',
            count: 1,
            lastDate: e.date ? e.date.replace('T', ' ').slice(0, 16) : '',
            description: e.content ? (e.action && !e.system ? `[${e.action}] ${e.content}` : e.content) : e.action || 'Nota',
            system: !!e.system,
            userId: e.userId || null,
          }));

          await db.collection('companies').doc('grupo_meraki_real').collection('leads').doc(lead.id).set({
            metadata: {
              ...lead.metadata,
              smarthomeBitacoras: bitacoras,
              smarthomeProspectId: summary.prospectId || '',
              smarthomeAsesorOriginal: summary.advisor || '',
              smarthomeCicloVenta: summary.saleCycle || '',
              smarthomeEstadoSeguimiento: summary.stage || '',
              smarthomeSyncedAt: new Date().toISOString(),
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });

          synced++;
          if (synced % 20 === 0) {
            console.log(`[Worker ${workerId}] Sincronizados ${synced} leads con bitácoras vivas...`);
          }
        } else {
          notFound++;
        }
      } catch (err) {
        errors++;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));

  console.log(`\n=== RESULTADOS SINCRONIZACIÓN SMART HOME API ===`);
  console.log(`Leads operativos con bitácora alimentada en vivo: ${synced}`);
  console.log(`Leads sin registro previo en SmartHome: ${notFound}`);
  console.log(`Errores de red/timeout: ${errors}`);
  console.log(`Proceso finalizado con éxito.`);
}

main().catch(console.error);
