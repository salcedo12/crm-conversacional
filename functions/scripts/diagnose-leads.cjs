/**
 * Script de SOLO LECTURA para diagnosticar el origen de los leads.
 *
 * Uso:
 *   node scripts/diagnose-leads.cjs "C:\\ruta\\a\\clave.json" [companyId]
 *
 * - No escribe ni borra nada. Solo lee y cuenta.
 * - companyId por defecto: empresa_demo
 *
 * Reporta:
 *   1. Mensajes entrantes agrupados por canal (ycloud / meta / twilio) según webhookEvents.
 *   2. Lista de leads con fecha de creación, estado, fuente y asesor.
 *   3. Rango de fechas (lead más viejo y más nuevo).
 */
const admin = require('firebase-admin');
const path  = require('path');

const keyPath   = process.argv[2];
const companyId = process.argv[3] || 'empresa_demo';

if (!keyPath) {
  console.error('❌ Falta la ruta de la llave de servicio.');
  console.error('   Uso: node scripts/diagnose-leads.cjs "C:\\\\ruta\\\\clave.json" [companyId]');
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = require(path.resolve(keyPath));
} catch (err) {
  console.error('❌ No pude leer la llave en:', keyPath);
  console.error('  ', err.message);
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const fmt = (ts) => {
  if (!ts) return '—';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('es-CO', { timeZone: 'America/Bogota' });
  } catch {
    return String(ts);
  }
};

(async () => {
  console.log(`\n=== Diagnóstico de leads · empresa: ${companyId} ===\n`);

  // ── 1. webhookEvents agrupados por canal ───────────────────────────────────
  const evSnap = await db.collection('companies').doc(companyId).collection('webhookEvents').get();
  const byChannel = {};
  let evMin = null, evMax = null;
  evSnap.forEach((d) => {
    const data = data2(d);
    const ch = data.channel || '(sin canal)';
    byChannel[ch] = (byChannel[ch] || 0) + 1;
    const t = data.processedAt;
    if (t && t.toMillis) {
      if (!evMin || t.toMillis() < evMin.toMillis()) evMin = t;
      if (!evMax || t.toMillis() > evMax.toMillis()) evMax = t;
    }
  });

  console.log('1) MENSAJES ENTRANTES por canal (webhookEvents):');
  if (evSnap.empty) {
    console.log('   (no hay registros de webhookEvents)');
  } else {
    Object.entries(byChannel)
      .sort((a, b) => b[1] - a[1])
      .forEach(([ch, n]) => console.log(`   - ${ch.padEnd(12)} : ${n}`));
    console.log(`   Total eventos: ${evSnap.size}`);
    console.log(`   Rango: ${fmt(evMin)}  →  ${fmt(evMax)}`);
  }

  // ── 2. Leads ───────────────────────────────────────────────────────────────
  const leadSnap = await db.collection('companies').doc(companyId).collection('leads').get();
  const leads = [];
  leadSnap.forEach((d) => {
    const x = data2(d);
    leads.push({
      name:      x.name || '(sin nombre)',
      phone:     x.phone || x.normalizedPhone || '?',
      source:    x.source || '?',
      status:    x.status || '?',
      assigned:  x.assignedTo || '—',
      createdAt: x.createdAt,
      created:   x.createdAt && x.createdAt.toMillis ? x.createdAt.toMillis() : 0,
    });
  });
  leads.sort((a, b) => a.created - b.created); // del más viejo al más nuevo

  console.log(`\n2) LEADS (${leads.length} en total), del más viejo al más nuevo:`);
  leads.forEach((l, i) => {
    console.log(
      `   ${String(i + 1).padStart(3)}. ${fmt(l.createdAt).padEnd(22)} | ${String(l.phone).padEnd(15)} | ${String(l.status).padEnd(10)} | ${l.name}`
    );
  });

  if (leads.length) {
    console.log(`\n3) RANGO de creación de leads:`);
    console.log(`   Más viejo: ${fmt(leads[0].createdAt)}`);
    console.log(`   Más nuevo: ${fmt(leads[leads.length - 1].createdAt)}`);
  }

  console.log('\n=== Fin del diagnóstico (no se modificó nada) ===\n');
  process.exit(0);
})().catch((err) => {
  console.error('❌ Error ejecutando el diagnóstico:', err.message);
  process.exit(1);
});

function data2(doc) {
  return doc.data() || {};
}
