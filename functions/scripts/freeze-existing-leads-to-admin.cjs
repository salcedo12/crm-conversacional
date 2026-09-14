/**
 * "Congela" los leads que YA existen en el CRM y los deja en manos del administrador.
 *
 * Qué hace por cada lead EXISTENTE:
 *   1. assignedTo            -> uid del administrador
 *   2. pendingFirstContact   -> false   (clave: el cron de reasignación solo mira
 *                                         leads con pendingFirstContact == true, así
 *                                         que estos quedan EXCLUIDOS para siempre)
 *   3. advisorFirstContactAt -> ahora    (guarda extra de defensa, por si algún lead
 *                                         quedara con el flag en true por datos viejos)
 *
 * Los leads NUEVOS no se tocan: seguirán naciendo con pendingFirstContact:true vía
 * assignLead(), así que a ellos SÍ les aplica la reasignación si nadie les escribe.
 *
 * Es idempotente: se puede correr varias veces sin peligro.
 *
 * Uso:
 *   # Dry-run (NO escribe, solo muestra el plan y cuántos leads tocaría):
 *   node scripts/freeze-existing-leads-to-admin.cjs "C:\\ruta\\clave.json" <companyId>
 *
 *   # Aplicar de verdad:
 *   node scripts/freeze-existing-leads-to-admin.cjs "C:\\ruta\\clave.json" <companyId> --apply
 *
 *   # Si hay más de un admin (o querés forzar uno específico):
 *   node scripts/freeze-existing-leads-to-admin.cjs "C:\\ruta\\clave.json" <companyId> --apply --admin=<uid>
 *
 * companyId por defecto: empresa_demo
 */
const admin = require('firebase-admin');
const path  = require('path');

const args      = process.argv.slice(2);
const keyPath   = args.find((a) => a.endsWith('.json'));
const apply     = args.includes('--apply');
const adminArg  = args.find((a) => a.startsWith('--admin='));
const adminUidOverride = adminArg ? adminArg.split('=')[1] : null;
const companyId = args.find((a) => !a.endsWith('.json') && !a.startsWith('--')) || 'empresa_demo';

if (!keyPath) {
  console.error('❌ Falta la ruta de la llave de servicio (.json).');
  console.error('   Uso: node scripts/freeze-existing-leads-to-admin.cjs "C:\\\\ruta\\\\clave.json" <companyId> [--apply] [--admin=<uid>]');
  process.exit(1);
}

let serviceAccount;
try { serviceAccount = require(path.resolve(keyPath)); }
catch (e) { console.error('❌ No pude leer la llave:', e.message); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

/** Encuentra al administrador de la empresa (o usa el uid pasado por --admin). */
async function resolveAdminUid(companyRef) {
  if (adminUidOverride) {
    const snap = await companyRef.collection('users').doc(adminUidOverride).get();
    if (!snap.exists) {
      throw new Error(`El uid --admin=${adminUidOverride} no existe en companies/${companyRef.id}/users`);
    }
    return adminUidOverride;
  }
  const usersSnap = await companyRef.collection('users').get();
  const admins = usersSnap.docs.filter((d) => {
    const u = d.data();
    return u.role === 'admin' && u.active !== false;
  });
  if (admins.length === 0) {
    throw new Error(`No hay ningún usuario con role:'admin' activo en companies/${companyRef.id}/users. Usá --admin=<uid>.`);
  }
  if (admins.length > 1) {
    const list = admins.map((d) => `${d.id} (${d.data().name || d.data().email || 'sin nombre'})`).join(', ');
    throw new Error(`Hay ${admins.length} administradores: ${list}. Elegí uno con --admin=<uid>.`);
  }
  return admins[0].id;
}

(async () => {
  console.log(`\n=== Congelar leads existentes → administrador · empresa: ${companyId} · modo: ${apply ? 'APLICAR' : 'DRY-RUN (sin escribir)'} ===\n`);

  const companyRef = db.collection('companies').doc(companyId);
  const companySnap = await companyRef.get();
  if (!companySnap.exists) {
    console.error(`❌ La empresa ${companyId} no existe.`);
    process.exit(1);
  }

  const adminUid = await resolveAdminUid(companyRef);
  const adminDoc = await companyRef.collection('users').doc(adminUid).get();
  const adminData = adminDoc.data() || {};
  console.log(`• Administrador destino: ${adminUid} (${adminData.name || adminData.email || 'sin nombre'})\n`);

  const leadsSnap = await companyRef.collection('leads').get();
  console.log(`• Leads existentes: ${leadsSnap.size}\n`);

  const now = admin.firestore.Timestamp.now();
  let alreadyAdmin = 0, willMove = 0, batch = db.batch(), inBatch = 0, committed = 0;

  for (const leadDoc of leadsSnap.docs) {
    const lead = leadDoc.data();
    if (lead.assignedTo === adminUid && lead.pendingFirstContact === false) {
      alreadyAdmin++;
      continue;
    }
    willMove++;

    if (apply) {
      batch.update(leadDoc.ref, {
        assignedTo: adminUid,
        pendingFirstContact: false,
        advisorFirstContactAt: now,
        updatedAt: now,
      });
      inBatch++;
      // Firestore limita a 500 escrituras por batch.
      if (inBatch === 400) {
        await batch.commit();
        committed += inBatch;
        console.log(`   … ${committed} leads actualizados`);
        batch = db.batch();
        inBatch = 0;
      }
    }
  }

  if (apply && inBatch > 0) {
    await batch.commit();
    committed += inBatch;
  }

  console.log(`\n• Ya estaban en el admin y congelados (saltados): ${alreadyAdmin}`);
  console.log(`• ${apply ? 'Reasignados al admin y congelados' : 'Se reasignarían al admin y congelarían'}: ${willMove}`);
  console.log(`\n=== ${apply ? 'Listo.' : 'Dry-run: no se modificó nada. Volvé a correr con --apply para aplicar.'} ===\n`);
  process.exit(0);
})().catch((e) => { console.error('💥 Error:', e.message); process.exit(1); });
