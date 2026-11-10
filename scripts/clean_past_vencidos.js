const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

async function cleanPastVencidos() {
  console.log('--- Iniciando limpieza de vencidos anteriores a hoy (2026-10-26) ---');
  const compSnap = await db.collection('companies').get();

  for (const c of compSnap.docs) {
    const compId = c.id;
    console.log(`\nRevisando empresa: ${compId}`);

    // 1. Limpiar nextFollowUpDate anteriores a hoy
    const followUpsSnap = await db.collection('companies').doc(compId).collection('leads')
      .where('nextFollowUpDate', '!=', null)
      .get();

    let clearedFollowUps = 0;
    for (const d of followUpsSnap.docs) {
      const data = d.data();
      const dateStr = String(data.nextFollowUpDate || '');
      if (dateStr < '2026-10-26') {
        console.log(`  -> Limpiando seguimiento vencido en lead ${d.id} (${data.name || data.phone}): "${dateStr}"`);
        await d.ref.update({
          nextFollowUpDate: null,
          nextFollowUpAction: null,
          isOverdue: false,
          lastPastFollowUpClearedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        clearedFollowUps++;
      }
    }
    console.log(`  Empresa ${compId}: ${clearedFollowUps} seguimientos anteriores limpiados.`);

    // 2. Limpiar aiTakeoverSlaStatus: 'overdue' anteriores a hoy
    const overdueTakeoverSnap = await db.collection('companies').doc(compId).collection('leads')
      .where('aiTakeoverSlaStatus', '==', 'overdue')
      .get();

    let clearedTakeovers = 0;
    for (const d of overdueTakeoverSnap.docs) {
      await d.ref.update({
        aiTakeoverSlaStatus: 'compliant',
        aiTakeoverOverdueAt: null,
      });
      clearedTakeovers++;
    }
    console.log(`  Empresa ${compId}: ${clearedTakeovers} leads con aiTakeoverSlaStatus overdue reseteados.`);

    // 3. Desbloquear asesores si alguno estaba bloqueado
    const usersSnap = await db.collection('companies').doc(compId).collection('users').get();
    for (const u of usersSnap.docs) {
      const uData = u.data();
      if (uData.isBlockedForLeads) {
        console.log(`  -> Desbloqueando asesor: ${u.id} (${uData.displayName})`);
        await u.ref.update({
          isBlockedForLeads: false,
          blockedReason: null,
          blockedAt: null,
          unresolvedLeadId: null,
          unresolvedLeadName: null,
        });
      }
    }
  }

  console.log('\n--- Limpieza en base de datos completada exitosamente ---');
  process.exit(0);
}

cleanPastVencidos().catch(err => {
  console.error('Error en limpieza:', err);
  process.exit(1);
});
