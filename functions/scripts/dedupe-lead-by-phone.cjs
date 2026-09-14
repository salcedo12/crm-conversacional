/**
 * Encuentra (y opcionalmente borra) leads DUPLICADOS por número de teléfono.
 * Busca en TODAS las empresas para no tener que adivinar el companyId.
 *
 * Uso:
 *   # Listar (NO borra): muestra cada lead con ese número + asesor + #mensajes
 *   node scripts/dedupe-lead-by-phone.cjs "C:\\ruta\\service-account.json" 573112464388
 *
 *   # Borrar UN lead específico por id (lead + subcolecciones vía recursiveDelete):
 *   node scripts/dedupe-lead-by-phone.cjs "C:\\ruta\\service-account.json" 573112464388 --delete <leadId> --apply
 *
 * Sin --apply el borrado es simulado (dry-run). El --delete exige el id EXACTO.
 */
const admin = require('firebase-admin');
const path  = require('path');

const args     = process.argv.slice(2);
const keyPath  = args.find((a) => a.endsWith('.json'));
const phoneArg = args.find((a) => /^\+?\d{6,}$/.test(a));
const apply    = args.includes('--apply');
const delIdx   = args.indexOf('--delete');
const deleteId = delIdx >= 0 ? args[delIdx + 1] : null;

if (!keyPath || !phoneArg) {
  console.error('❌ Uso: node scripts/dedupe-lead-by-phone.cjs <service-account.json> <telefono> [--delete <leadId> --apply]');
  process.exit(1);
}

const onlyDigits = (v) => String(v || '').replace(/\D/g, '');
const target = onlyDigits(phoneArg);

let serviceAccount;
try { serviceAccount = require(path.resolve(keyPath)); }
catch (e) { console.error('❌ No pude leer la llave:', e.message); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const fmt = (ts) => ts && ts.toDate ? ts.toDate().toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : '—';

async function countMessages(ref) {
  try { return (await ref.collection('messages').count().get()).data().count; }
  catch { return (await ref.collection('messages').get()).size; }
}

async function previewMessages(ref, n = 6) {
  const snap = await ref.collection('messages').orderBy('createdAt', 'asc').limit(n).get();
  return snap.docs.map((d) => {
    const m = d.data();
    const dir = m.direction === 'inbound' ? '←' : '→';
    const who = m.senderType || m.direction || '';
    const txt = (m.content || '').replace(/\s+/g, ' ').slice(0, 40);
    return `        ${dir} [${who}] ${txt}`;
  }).join('\n');
}

(async () => {
  console.log(`\n=== Leads con número ${target} · modo: ${deleteId ? (apply ? 'BORRAR '+deleteId : 'DRY-RUN borrado '+deleteId) : 'SOLO LISTAR'} ===\n`);

  const companies = await db.collection('companies').listDocuments();
  const found = [];

  for (const companyRef of companies) {
    // nombres de asesores para mostrar
    const usersSnap = await companyRef.collection('users').get();
    const nameOf = {};
    usersSnap.forEach((d) => { const u = d.data(); nameOf[d.id] = u.name || u.displayName || u.email || d.id; });

    const leadsSnap = await companyRef.collection('leads').get();
    for (const leadDoc of leadsSnap.docs) {
      const lead = leadDoc.data();
      const digits = onlyDigits(lead.normalizedPhone || lead.phone);
      if (digits && (digits === target || digits.endsWith(target) || target.endsWith(digits))) {
        const msgs = await countMessages(leadDoc.ref);
        found.push({
          companyId: companyRef.id, ref: leadDoc.ref, id: leadDoc.id, lead, msgs,
          advisor: lead.assignedTo ? (nameOf[lead.assignedTo] || lead.assignedTo) : '— sin asignar',
        });
      }
    }
  }

  if (found.length === 0) { console.log('No se encontró ningún lead con ese número.'); process.exit(0); }

  found.sort((a, b) => (a.lead.createdAt?.toMillis?.() || 0) - (b.lead.createdAt?.toMillis?.() || 0));
  for (const f of found) {
    console.log(`• empresa=${f.companyId}`);
    console.log(`  leadId   = ${f.id}`);
    console.log(`  nombre   = ${f.lead.name || ''}`);
    console.log(`  teléfono = ${f.lead.phone || ''}`);
    console.log(`  asesor   = ${f.advisor}  (uid=${f.lead.assignedTo || '—'})`);
    console.log(`  creado   = ${fmt(f.lead.createdAt)}`);
    console.log(`  mensajes = ${f.msgs}`);
    console.log(await previewMessages(f.ref));
    console.log('');
  }

  if (!deleteId) {
    console.log('=== Solo listado. Para borrar uno: agrega  --delete <leadId> --apply ===\n');
    process.exit(0);
  }

  const victim = found.find((f) => f.id === deleteId);
  if (!victim) { console.error(`❌ El leadId ${deleteId} no está entre los encontrados. Aborta.`); process.exit(1); }

  console.log(`>>> ${apply ? 'BORRANDO' : '(dry-run) borraría'} lead ${victim.id} (empresa ${victim.companyId}, asesor ${victim.advisor}, ${victim.msgs} mensajes)`);
  if (!apply) { console.log('\n=== DRY-RUN: no se borró nada. Repite con --apply. ===\n'); process.exit(0); }

  await db.recursiveDelete(victim.ref);
  console.log(`\n=== Listo. Borrado el lead ${victim.id} y sus mensajes. ===\n`);
  process.exit(0);
})().catch((e) => { console.error('💥 Error:', e.message); process.exit(1); });
