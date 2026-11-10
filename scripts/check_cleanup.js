const admin = require('../functions/node_modules/firebase-admin');
const sa = require('../service-account.json');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(sa),
    projectId: 'crm-conversacional',
  });
}
const db = admin.firestore();

function isCancelled(l) {
  if (l.status === 'closed') return false;
  const cycle = String(l.smartHomeSaleCycle || l.metadata?.smarthomeCicloVenta || '').toLowerCase();
  const stage = String(l.smartHomeStageName || l.metadata?.smarthomeEstadoSeguimiento || '').toLowerCase();
  const b0Desc = String(l.metadata?.smarthomeBitacoras?.[0]?.description || '').toLowerCase();
  const b0Action = String(l.metadata?.smarthomeBitacoras?.[0]?.action || '').toLowerCase();

  const cancelPattern = /cancelad|no interesado|desistimient|descartad|papelera|sin presupuesto|no califica|no aplica/i;
  return cancelPattern.test(cycle) || cancelPattern.test(stage) || cancelPattern.test(b0Desc) || cancelPattern.test(b0Action);
}

async function dryRun() {
  const snap = await db.collection('companies').doc('grupo_meraki_real').collection('leads').get();
  console.log('Total leads:', snap.size);

  let canceladosToUpdate = 0;
  let alreadyLost = 0;
  let fakeLastFollowUpCount = 0;
  let realDatesRestored = 0;
  let removedLastFollowUp = 0;

  const todayPrefix = '2026-10-26';

  snap.forEach((d) => {
    const l = d.data();
    if (isCancelled(l)) {
      if (l.status !== 'lost') canceladosToUpdate++;
      else alreadyLost++;
    }

    const lfu = l.lastFollowUpAt?.toDate
      ? l.lastFollowUpAt.toDate().toISOString()
      : typeof l.lastFollowUpAt === 'string'
      ? l.lastFollowUpAt
      : null;

    if (lfu && lfu.startsWith(todayPrefix)) {
      fakeLastFollowUpCount++;
      const b0 = l.metadata?.smarthomeBitacoras?.[0];
      if (b0 && (b0.lastDate || b0.fecha)) {
        realDatesRestored++;
      } else {
        removedLastFollowUp++;
      }
    }
  });

  console.log('Leads needing status update to "lost" (Cancelados):', canceladosToUpdate);
  console.log('Leads already marked as lost:', alreadyLost);
  console.log('Leads with synthetic today lastFollowUpAt:', fakeLastFollowUpCount);
  console.log(' - Can restore real historical date from bitacora:', realDatesRestored);
  console.log(' - Will remove lastFollowUpAt (no bitacora):', removedLastFollowUp);
}

dryRun().catch(console.error);
