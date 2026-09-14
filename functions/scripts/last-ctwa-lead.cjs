/** SOLO LECTURA. Separa los leads de anuncio en FORMULARIO (metadata.metaFormId)
 *  vs CLIC A WHATSAPP (CTWA, sin formId) y reporta el último de cada tipo. */
const admin = require('firebase-admin');
const path  = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '..', 'service-account.json'))) });
const db = admin.firestore();
const companyId = process.argv[2] || 'grupo_meraki_real';
const fmt = (ts) => ts && ts.toDate ? ts.toDate().toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : '—';
const ms  = (ts) => ts && ts.toMillis ? ts.toMillis() : 0;

const isForm = (x) => !!(x.metadata && (x.metadata.metaFormId || x.metadata.metaFormName));

(async () => {
  const col = db.collection('companies').doc(companyId).collection('leads');
  const snap = await col.where('source', '==', 'meta_ads').get();

  const form = [], ctwa = [];
  snap.forEach((d) => {
    const x = d.data();
    const row = { name: x.name, phone: x.phone, adId: x.sourceMeta?.adId || x.metadata?.metaAdId || '—',
                  formId: x.metadata?.metaFormId || null, createdAt: x.createdAt, _ms: ms(x.createdAt) };
    (isForm(x) ? form : ctwa).push(row);
  });
  form.sort((a, b) => b._ms - a._ms);
  ctwa.sort((a, b) => b._ms - a._ms);

  console.log(`\nEmpresa: ${companyId} · meta_ads: ${snap.size}  (formulario: ${form.length} · clic-a-WhatsApp: ${ctwa.length})\n`);

  const daysAgo = (t) => t ? Math.floor((Date.now() - t) / 86400000) : null;

  console.log('════ ÚLTIMO de FORMULARIO ════');
  if (form[0]) console.log(`  ${form[0].name} · ${form[0].phone} · form ${form[0].formId} · ${fmt(form[0].createdAt)} (hace ${daysAgo(form[0]._ms)}d)`);
  else console.log('  (ninguno)');

  console.log('\n════ ÚLTIMO de CLIC A WHATSAPP (CTWA) ════');
  if (ctwa[0]) {
    console.log(`  ⏱ ${ctwa[0].name} · ${ctwa[0].phone} · ad ${ctwa[0].adId}`);
    console.log(`     entró: ${fmt(ctwa[0].createdAt)}  → hace ${daysAgo(ctwa[0]._ms)} día(s)`);
  } else console.log('  (ninguno)');

  console.log('\n  Últimos 12 CTWA:');
  ctwa.slice(0, 12).forEach((l) => console.log(`     ${fmt(l.createdAt).padEnd(22)} · ${(l.name || '—').slice(0, 22).padEnd(22)} · ${(l.phone || '—').padEnd(14)} · ad ${l.adId}`));
  console.log('');
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
