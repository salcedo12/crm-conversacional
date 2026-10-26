/**
 * Conversions API (CAPI) de Meta — configuración y reenvío de conversiones.
 * Requiere `npm run build` (usa el código compilado de lib/).
 *
 * Uso:
 *   node scripts/meta-capi.cjs config <datasetId> --page=<pageId> [testEventCode]
 *                                                                      guarda channelCredentials/{empresa}.metaCapi
 *                                                                      (pageId = página que publica los anuncios CTWA)
 *   node scripts/meta-capi.cjs config --clear-test                     quita el código de prueba (envío real)
 *   node scripts/meta-capi.cjs resend [closed|scheduled|qualified]     DRY-RUN: lista qué se enviaría
 *   node scripts/meta-capi.cjs resend closed --apply                   envía a Meta
 *
 * Empresa: grupo_meraki_real (cambiar con --company=<id>).
 * Con código de prueba los eventos aparecen en Events Manager → Probar eventos
 * y NO se marcan como enviados (se pueden reenviar después en real).
 */
const admin = require('firebase-admin');
const sa = require('../service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
}
const db = admin.firestore();

const args      = process.argv.slice(2);
const cmd       = args[0];
const apply     = args.includes('--apply');
const companyId = (args.find((a) => a.startsWith('--company=')) || '').split('=')[1] || 'grupo_meraki_real';
const positional = args.slice(1).filter((a) => !a.startsWith('--'));

async function config() {
  const ref = db.collection('channelCredentials').doc(companyId);
  if (args.includes('--clear-test')) {
    await ref.set({ metaCapi: { testEventCode: admin.firestore.FieldValue.delete() } }, { merge: true });
    console.log('Código de prueba eliminado: los eventos ahora son reales.');
    return;
  }
  const [datasetId, testEventCode] = positional;
  const pageId = (args.find((a) => a.startsWith('--page=')) || '').split('=')[1];
  if (!/^\d+$/.test(datasetId || '')) throw new Error('datasetId inválido (solo dígitos)');
  if (pageId && !/^\d+$/.test(pageId)) throw new Error('pageId inválido (solo dígitos)');
  await ref.set({
    metaCapi: { datasetId, ...(pageId ? { pageId } : {}), ...(testEventCode ? { testEventCode } : {}) },
    updatedAt: admin.firestore.Timestamp.now(),
  }, { merge: true });
  console.log(`metaCapi guardado para ${companyId}: dataset ${datasetId}${testEventCode ? ` (prueba ${testEventCode})` : ''}`);
}

async function resend() {
  const { sendLeadConversion, STATUS_EVENT } = require('../lib/modules/meta/leadConversions.service');
  const { getSmartHomeSaleForProspect } = require('../lib/integrations/smarthome/smarthome.client');
  const status = positional[0] || 'closed';
  const eventName = STATUS_EVENT[status];
  if (!eventName) throw new Error(`Estado sin evento: ${status}`);

  const snap = await db.collection('companies').doc(companyId).collection('leads')
    .where('status', '==', status).get();
  const leads = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((l) => l.sourceMeta?.ctwaClid && !l.capiEvents?.[eventName]);

  console.log(`${leads.length} lead(s) "${status}" con ctwa_clid sin ${eventName} enviado${apply ? '' : ' (DRY-RUN)'}`);
  for (const lead of leads) {
    const label = `${lead.id} ${lead.name || ''} — ${lead.sourceMeta?.headline || lead.sourceMeta?.adId}`;
    if (!apply) {
      const sale = eventName === 'Purchase' && lead.smartHomeProspectId
        ? await getSmartHomeSaleForProspect(lead.smartHomeProspectId, lead.smartHomeProjectCode)
        : null;
      console.log(`  · ${label}${sale ? ` | valor ${sale.value} | cierre ${sale.closeDate}` : ''}`);
      continue;
    }
    const result = await sendLeadConversion(companyId, lead.id, lead);
    console.log(`  · ${label} → ${JSON.stringify(result)}`);
  }
}

(cmd === 'config' ? config() : cmd === 'resend' ? resend() : Promise.reject(new Error('Comando: config | resend')))
  .then(() => process.exit(0))
  .catch((err) => { console.error(err.message); process.exit(1); });
