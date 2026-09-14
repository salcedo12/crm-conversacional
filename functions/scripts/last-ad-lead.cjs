/** SOLO LECTURA. ¿Cuándo entró el último lead de anuncio (source=meta_ads) al CRM?
 *  Muestra el más reciente, los últimos 10 y un conteo por fuente. */
const admin = require('firebase-admin');
const path  = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '..', 'service-account.json'))) });
const db = admin.firestore();
const companyId = process.argv[2] || 'grupo_meraki_real';
const fmt = (ts) => ts && ts.toDate ? ts.toDate().toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : '—';
const ms  = (ts) => ts && ts.toMillis ? ts.toMillis() : 0;

(async () => {
  const col = db.collection('companies').doc(companyId).collection('leads');
  const all = await col.get();

  const bySource = {};
  const adLeads = [];
  all.forEach((d) => {
    const x = d.data();
    const s = x.source || '(sin source)';
    bySource[s] = (bySource[s] || 0) + 1;
    if (s === 'meta_ads') adLeads.push({ id: d.id, name: x.name, phone: x.phone, adId: x.sourceMeta?.adId || '—', createdAt: x.createdAt, _ms: ms(x.createdAt) });
  });

  adLeads.sort((a, b) => b._ms - a._ms);

  console.log(`\nEmpresa: ${companyId} · total leads: ${all.size}\n`);
  console.log('=== Conteo por fuente ===');
  Object.entries(bySource).sort((a, b) => b[1] - a[1]).forEach(([s, n]) => console.log(`  ${String(n).padStart(5)}  ${s}`));

  console.log(`\n=== Leads de anuncio (meta_ads): ${adLeads.length} ===`);
  if (!adLeads.length) { console.log('  (ninguno)'); process.exit(0); }

  const top = adLeads[0];
  console.log(`\n  ⏱ ÚLTIMO lead de anuncio en el CRM:`);
  console.log(`     ${top.name || '(sin nombre)'} · ${top.phone} · ad ${top.adId}`);
  console.log(`     entró: ${fmt(top.createdAt)}`);

  const days = top._ms ? Math.floor((Date.now() - top._ms) / 86400000) : null;
  if (days !== null) console.log(`     → hace ${days} día(s)`);

  console.log(`\n  Últimos 10 leads de anuncio:`);
  adLeads.slice(0, 10).forEach((l) => console.log(`     ${fmt(l.createdAt).padEnd(22)} · ${(l.name || '—').slice(0, 22).padEnd(22)} · ${l.phone.padEnd(14)} · ad ${l.adId}`));
  console.log('');
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
