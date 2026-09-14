/**
 * Revierte los leads de FORMULARIO (leadgen) que un backfill activó por error y
 * el cron reasignó. Los formularios deben quedarse con su asesor original (NO se
 * reasignan). Para cada leadId: restaura assignedTo + advisorAssignedAt al valor
 * original (guardado en el evento de reasignación), pone pendingFirstContact=false,
 * limpia advisorReassignmentCount/lastAutoReassignedAt y BORRA el evento erróneo.
 *
 * Guarda: solo actúa sobre leads que SON formulario (metadata.metaFormId presente)
 * y que tienen EXACTAMENTE 1 evento de reasignación (el del backfill). Si el lead
 * ya recibió contacto humano tras la reasignación, NO toca assignedTo (avisa).
 *
 * Uso:
 *   node scripts/restore-form-leads.cjs <sa.json> grupo_meraki_real <leadId...>          (DRY-RUN)
 *   node scripts/restore-form-leads.cjs <sa.json> grupo_meraki_real <leadId...> --apply
 */
const admin = require('firebase-admin');
const path  = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(process.argv[2]))) });
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const args      = process.argv.slice(2);
const apply     = args.includes('--apply');
const companyId = args[1];
const leadIds   = args.slice(2).filter((a) => !a.startsWith('--'));

if (!companyId || leadIds.length === 0) { console.error('❌ Uso: <sa.json> <companyId> <leadId...> [--apply]'); process.exit(1); }

(async () => {
  const companyRef = db.collection('companies').doc(companyId);
  console.log(`\n=== Restaurar formularios · ${companyId} · modo: ${apply ? 'APLICAR' : 'DRY-RUN'} ===\n`);

  for (const leadId of leadIds) {
    const ref  = companyRef.collection('leads').doc(leadId);
    const snap = await ref.get();
    if (!snap.exists) { console.log(`  ⚠ ${leadId}: no existe`); continue; }
    const l = snap.data();
    const isForm = !!(l.metadata && l.metadata.metaFormId);
    if (!isForm) { console.log(`  ⛔ ${leadId} (${l.name||''}): NO es formulario (sin metaFormId) → NO se toca`); continue; }
    if (l.advisorFirstContactAt || l.lastAdvisorMessageAt) {
      console.log(`  ⛔ ${leadId} (${l.name||''}): ya tuvo contacto humano → solo pending=false, NO se mueve el asesor`);
      if (apply) await ref.update({ pendingFirstContact: false, updatedAt: FieldValue.serverTimestamp() });
      continue;
    }
    const evSnap = await companyRef.collection('leadReassignmentEvents').where('leadId', '==', leadId).get();
    // Todos los eventos de este formulario son del backfill (antes nunca se
    // reasignaba). El asesor ORIGINAL = previousAdvisorId del evento más antiguo.
    const evs = evSnap.docs.sort((a, b) =>
      (a.data().reassignedAt?.toMillis?.() || 0) - (b.data().reassignedAt?.toMillis?.() || 0));
    if (evs.length === 0) { console.log(`  ⚠ ${leadId} (${l.name||''}): 0 eventos → solo pending=false`); if (apply) await ref.update({ pendingFirstContact: false }); continue; }
    const first     = evs[0].data();
    const original  = first.previousAdvisorId;
    const originalAt = first.previousAdvisorAssignedAt || null;

    console.log(`  ✓ ${leadId} (${l.name||''}) · ${evs.length} evento(s) del backfill`);
    console.log(`      assignedTo: ${l.assignedTo} → ${original}`);
    console.log(`      pending: ${l.pendingFirstContact} → false · reassignCount: ${l.advisorReassignmentCount||0} → 0 · borrar ${evs.length} evento(s)`);

    if (apply) {
      await ref.update({
        assignedTo: original,
        ...(originalAt ? { advisorAssignedAt: originalAt } : {}),
        pendingFirstContact: false,
        advisorReassignmentCount: 0,
        lastAutoReassignedAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      for (const e of evs) await e.ref.delete();
    }
  }

  console.log(apply ? '\n=== Listo. Formularios restaurados. ===\n' : '\n=== DRY-RUN: nada cambiado. Repite con --apply. ===\n');
  process.exit(0);
})().catch((e) => { console.error('💥', e.message); process.exit(1); });
