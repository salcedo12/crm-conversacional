/**
 * Backfill de inboxId / inboxProvider en los leads existentes (multi-número).
 *
 * Determina por qué número entró cada lead cruzando su teléfono con los
 * webhookEvents (que guardan el canal: 'ycloud' | 'meta').
 *
 * Uso:
 *   # Dry-run (NO escribe, solo muestra el plan):
 *   node scripts/backfill-inbox.cjs "C:\\ruta\\clave.json"
 *
 *   # Aplicar de verdad:
 *   node scripts/backfill-inbox.cjs "C:\\ruta\\clave.json" --apply
 *
 * Opcional: companyId como 3er argumento (default empresa_demo).
 */
const admin = require('firebase-admin');
const path  = require('path');

// ── Números de negocio por canal (edítalos si cambian) ──────────────────────
const YCLOUD_NUMBER = '+573148209662'; // sistemas meraki
const META_NUMBER   = '+573176820728'; // Grupo Constructor Meraki

const args      = process.argv.slice(2);
const keyPath   = args.find((a) => a.endsWith('.json'));
const apply     = args.includes('--apply');
const companyId = args.find((a) => !a.endsWith('.json') && a !== '--apply') || 'empresa_demo';

if (!keyPath) {
  console.error('❌ Falta la ruta de la llave de servicio (.json).');
  process.exit(1);
}

let serviceAccount;
try { serviceAccount = require(path.resolve(keyPath)); }
catch (e) { console.error('❌ No pude leer la llave:', e.message); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const digits = (s) => String(s || '').replace(/\D/g, '');

(async () => {
  console.log(`\n=== Backfill inbox · empresa: ${companyId} · modo: ${apply ? 'APLICAR' : 'DRY-RUN (sin escribir)'} ===\n`);

  // 1. Mapa teléfono-cliente → canal, desde webhookEvents inbound (ycloud/meta)
  const evSnap = await db.collection('companies').doc(companyId).collection('webhookEvents').get();
  const phoneChannel = new Map(); // digits(from) → { ycloud: n, meta: n }
  evSnap.forEach((d) => {
    const x = d.data() || {};
    if (x.channel !== 'ycloud' && x.channel !== 'meta') return; // ignorar echo / sin-canal
    const k = digits(x.from);
    if (!k) return;
    const cur = phoneChannel.get(k) || { ycloud: 0, meta: 0 };
    cur[x.channel]++;
    phoneChannel.set(k, cur);
  });

  const channelToInbox = {
    ycloud: { inboxProvider: 'ycloud', inboxId: YCLOUD_NUMBER },
    meta:   { inboxProvider: 'meta',   inboxId: META_NUMBER },
  };

  // 2. Recorrer leads y decidir su inbox
  const leadSnap = await db.collection('companies').doc(companyId).collection('leads').get();
  const plan = []; // { ref, name, phone, from, to, reason }
  let already = 0;

  leadSnap.forEach((d) => {
    const l = d.data() || {};
    if (l.inboxProvider) { already++; return; } // ya etiquetado (por el webhook)

    const k = digits(l.phone || l.normalizedPhone);
    const counts = phoneChannel.get(k);
    let channel, reason;
    if (counts) {
      channel = counts.meta > counts.ycloud ? 'meta' : 'ycloud';
      reason  = `eventos ycloud:${counts.ycloud} meta:${counts.meta}`;
    } else {
      channel = 'ycloud'; // default: el número principal
      reason  = 'sin eventos → default ycloud';
    }
    const target = channelToInbox[channel];
    plan.push({ ref: d.ref, name: l.name || '(sin nombre)', phone: l.phone, target, reason });
  });

  // 3. Reporte
  const byProvider = plan.reduce((acc, p) => { acc[p.target.inboxProvider] = (acc[p.target.inboxProvider] || 0) + 1; return acc; }, {});
  console.log(`Leads totales: ${leadSnap.size}`);
  console.log(`Ya etiquetados (se saltan): ${already}`);
  console.log(`A etiquetar: ${plan.length}`);
  console.log(`   → por proveedor:`, byProvider, '\n');

  plan.forEach((p, i) => {
    console.log(`  ${String(i + 1).padStart(3)}. ${String(p.phone).padEnd(16)} → ${p.target.inboxProvider.padEnd(6)} ${p.target.inboxId}  | ${p.name}  (${p.reason})`);
  });

  // 4. Aplicar
  if (apply && plan.length) {
    console.log('\nAplicando cambios...');
    let batch = db.batch(); let n = 0, committed = 0;
    for (const p of plan) {
      batch.update(p.ref, { inboxProvider: p.target.inboxProvider, inboxId: p.target.inboxId });
      if (++n === 400) { await batch.commit(); committed += n; batch = db.batch(); n = 0; }
    }
    if (n) { await batch.commit(); committed += n; }
    console.log(`✅ ${committed} leads actualizados.`);
  } else if (!apply) {
    console.log('\n(DRY-RUN: no se escribió nada. Corre de nuevo con --apply para aplicar.)');
  }

  console.log('\n=== Fin ===\n');
  process.exit(0);
})().catch((e) => { console.error('❌ Error:', e.message); process.exit(1); });
