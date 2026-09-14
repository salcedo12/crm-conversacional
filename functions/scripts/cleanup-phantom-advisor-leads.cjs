/**
 * Limpia los "leads fantasma" creados por el bug del puente WhatsApp de asesor:
 * leads cuyo número ES el número PROPIO de un asesor (su línea conectada por QR).
 *
 * Se originaban porque en chats `@lid`, el `senderPn` de un mensaje SALIENTE es
 * el número del propio asesor; el puente lo tomaba como "cliente" y creaba un
 * lead con ese número, amontonando ahí todos los salientes. Ya está corregido en
 * el puente (resolución por dirección + guarda de número propio). Este script
 * borra los que ya quedaron en la base.
 *
 * Detección: lead.normalizedPhone (o lead.phone) coincide con el `phone` de
 * alguna conexión en companies/<companyId>/advisorWhatsappConnections.
 *
 * Uso:
 *   # Dry-run (NO borra; solo lista lo que tocaría):
 *   node scripts/cleanup-phantom-advisor-leads.cjs "C:\\ruta\\service-account.json" grupo_meraki_real
 *
 *   # Borrar de verdad (lead + subcolecciones vía recursiveDelete):
 *   node scripts/cleanup-phantom-advisor-leads.cjs "C:\\ruta\\service-account.json" grupo_meraki_real --apply
 */
const admin = require('firebase-admin');
const path  = require('path');

const args      = process.argv.slice(2);
const keyPath   = args.find((a) => a.endsWith('.json'));
const apply     = args.includes('--apply');
const companyId = args.find((a) => !a.endsWith('.json') && !a.startsWith('--')) || 'grupo_meraki_real';

if (!keyPath) {
  console.error('❌ Falta la ruta de la llave de servicio (.json).');
  process.exit(1);
}

const onlyDigits = (v) => String(v || '').replace(/\D/g, '');

let serviceAccount;
try { serviceAccount = require(path.resolve(keyPath)); }
catch (e) { console.error('❌ No pude leer la llave:', e.message); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function countMessages(leadRef) {
  try {
    const agg = await leadRef.collection('messages').count().get();
    return agg.data().count;
  } catch {
    const snap = await leadRef.collection('messages').get();
    return snap.size;
  }
}

(async () => {
  console.log(`\n=== Limpieza de leads-fantasma (número propio de asesor) · empresa: ${companyId} · modo: ${apply ? 'APLICAR (borra)' : 'DRY-RUN (no borra)'} ===\n`);

  const companyRef = db.collection('companies').doc(companyId);

  // 1) Números propios de los asesores (líneas conectadas).
  const connSnap = await companyRef.collection('advisorWhatsappConnections').get();
  const ownNumbers = new Map(); // digits -> {advisorId, phone, status}
  for (const d of connSnap.docs) {
    const data = d.data();
    const digits = onlyDigits(data.phone);
    if (digits) ownNumbers.set(digits, { advisorId: d.id, phone: data.phone, status: data.status });
  }
  console.log(`• Líneas de asesor conectadas: ${ownNumbers.size}`);
  for (const [digits, info] of ownNumbers) console.log(`   - ${info.phone}  (${info.advisorId}, ${info.status || 's/estado'})`);
  console.log('');

  if (ownNumbers.size === 0) {
    console.log('No hay conexiones de asesor; nada que comparar. Fin.');
    process.exit(0);
  }

  // 2) Leads cuyo número == número propio de un asesor.
  const leadsSnap = await companyRef.collection('leads').get();
  const phantom = [];
  for (const leadDoc of leadsSnap.docs) {
    const lead = leadDoc.data();
    const digits = onlyDigits(lead.normalizedPhone || lead.phone);
    if (digits && ownNumbers.has(digits)) {
      phantom.push({ ref: leadDoc.ref, id: leadDoc.id, lead, matched: ownNumbers.get(digits) });
    }
  }

  console.log(`• Leads totales: ${leadsSnap.size}`);
  console.log(`• Leads-fantasma detectados: ${phantom.length}\n`);

  let totalMsgs = 0;
  for (const p of phantom) {
    const n = await countMessages(p.ref);
    totalMsgs += n;
    console.log(`   ✗ ${p.lead.phone || p.id}  · nombre="${p.lead.name || ''}"  · msgs=${n}  · asignado=${p.lead.assignedTo || '—'}  · = línea de ${p.matched.advisorId}`);
  }
  console.log(`\n• Total de mensajes en esos leads: ${totalMsgs}`);

  if (!apply) {
    console.log('\n=== DRY-RUN: no se borró nada. Corré de nuevo con --apply para borrar. ===\n');
    process.exit(0);
  }

  console.log(`\n>>> Borrando ${phantom.length} leads-fantasma (lead + subcolecciones)...`);
  let done = 0;
  for (const p of phantom) {
    await db.recursiveDelete(p.ref);
    done += 1;
    if (done % 10 === 0 || done === phantom.length) console.log(`   … ${done}/${phantom.length} borrados`);
  }
  console.log(`\n=== Listo. Borrados: ${done} leads-fantasma (${totalMsgs} mensajes). ===\n`);
  process.exit(0);
})().catch((e) => { console.error('💥 Error:', e.message); process.exit(1); });
