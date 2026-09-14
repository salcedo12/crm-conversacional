/**
 * Backfill de lead.stats (contadores de mensajería denormalizados).
 *
 * Recorre los leads y, por cada uno, calcula stats desde su subcolección de
 * mensajes (orden cronológico) usando la MISMA lógica que el trigger. A partir
 * de aquí, getAdvisorReports lee estos contadores en vez de releer los mensajes.
 *
 * Los leads nuevos ya nacen con stats vía onMessageCreated; este script es solo
 * para los leads que existían antes del despliegue. Es idempotente (recalcula
 * desde cero cada vez), así que se puede correr varias veces sin peligro.
 *
 * Uso:
 *   # Dry-run (NO escribe, solo muestra el plan):
 *   node scripts/backfill-lead-stats.cjs "C:\\ruta\\clave.json"
 *
 *   # Aplicar de verdad:
 *   node scripts/backfill-lead-stats.cjs "C:\\ruta\\clave.json" --apply
 *
 *   # Opcional: limitar a una empresa (default: TODAS):
 *   node scripts/backfill-lead-stats.cjs "C:\\ruta\\clave.json" --apply <companyId>
 *
 *   # Opcional: rehacer también los leads que YA tienen stats:
 *   node scripts/backfill-lead-stats.cjs "C:\\ruta\\clave.json" --apply --force
 */
const admin = require('firebase-admin');
const path  = require('path');

const HOUR_MS = 3_600_000;
const BUCKET_UPPER_MS = [
  1 * 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000,
  120 * 60_000, 360 * 60_000, 1440 * 60_000, Number.POSITIVE_INFINITY,
];
const STATS_BUCKET_COUNT = BUCKET_UPPER_MS.length;

function bucketIndex(deltaMs) {
  for (let i = 0; i < BUCKET_UPPER_MS.length; i++) {
    if (deltaMs < BUCKET_UPPER_MS[i]) return i;
  }
  return BUCKET_UPPER_MS.length - 1;
}

/** Réplica de applyMessageToStats (leadStats.service.ts) en JS plano. */
function computeStatsFromMessages(messages) {
  const s = {
    advisorMsgCount: 0,
    waitingReply: false,
    pendingInboundAt: null, // ms mientras se acumula; se convierte a Timestamp al final
    responseCount: 0,
    responseSumMs: 0,
    responseWithin1h: 0,
    responseBuckets: new Array(STATS_BUCKET_COUNT).fill(0),
  };

  for (const m of messages) {
    const createdMs = m.createdAt && typeof m.createdAt.toMillis === 'function'
      ? m.createdAt.toMillis()
      : 0;
    s.waitingReply = m.senderType === 'lead';

    if (m.senderType === 'lead') {
      if (s.pendingInboundAt == null) s.pendingInboundAt = createdMs;
      continue;
    }
    if (m.direction === 'outbound') {
      // Solo mensajes HUMANOS del asesor (senderType 'advisor' CON advisorId).
      // Las plantillas automáticas (primer contacto/seguimiento) van sin advisorId
      // y NO deben contar como respuesta del asesor (si no, inflan la rapidez).
      const human = m.senderType === 'advisor' && !!(m.advisorId && String(m.advisorId).trim());
      if (human) s.advisorMsgCount += 1;
      if (s.pendingInboundAt != null) {
        if (human) {
          const delta = createdMs - s.pendingInboundAt;
          if (delta >= 0) {
            s.responseCount += 1;
            s.responseSumMs += delta;
            if (delta <= HOUR_MS) s.responseWithin1h += 1;
            s.responseBuckets[bucketIndex(delta)] += 1;
          }
        }
        s.pendingInboundAt = null;
      }
    }
  }

  return {
    advisorMsgCount: s.advisorMsgCount,
    waitingReply: s.waitingReply,
    pendingInboundAt: s.pendingInboundAt == null
      ? null
      : admin.firestore.Timestamp.fromMillis(s.pendingInboundAt),
    responseCount: s.responseCount,
    responseSumMs: s.responseSumMs,
    responseWithin1h: s.responseWithin1h,
    responseBuckets: s.responseBuckets,
    updatedAt: admin.firestore.Timestamp.now(),
  };
}

const args      = process.argv.slice(2);
const keyPath   = args.find((a) => a.endsWith('.json'));
const apply     = args.includes('--apply');
const force     = args.includes('--force');
const companyId = args.find((a) => !a.endsWith('.json') && !a.startsWith('--'));

if (!keyPath) {
  console.error('❌ Falta la ruta de la llave de servicio (.json).');
  process.exit(1);
}

let serviceAccount;
try { serviceAccount = require(path.resolve(keyPath)); }
catch (e) { console.error('❌ No pude leer la llave:', e.message); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function processCompany(companyRef) {
  const leadsSnap = await companyRef.collection('leads').get();
  let touched = 0, skipped = 0;

  for (const leadDoc of leadsSnap.docs) {
    if (!force && leadDoc.get('stats')) { skipped++; continue; }

    const msgsSnap = await leadDoc.ref.collection('messages').orderBy('createdAt', 'asc').get();
    const messages = msgsSnap.docs.map((d) => d.data());
    const stats = computeStatsFromMessages(messages);

    if (apply) {
      await leadDoc.ref.update({ stats });
    }
    touched++;
    if (touched % 50 === 0) console.log(`   … ${touched} leads procesados`);
  }

  return { total: leadsSnap.size, touched, skipped };
}

(async () => {
  console.log(`\n=== Backfill lead.stats · modo: ${apply ? 'APLICAR' : 'DRY-RUN (sin escribir)'}${force ? ' · FORCE' : ''} ===\n`);

  const companyRefs = companyId
    ? [db.collection('companies').doc(companyId)]
    : await db.collection('companies').listDocuments();

  let grandTouched = 0;
  for (const companyRef of companyRefs) {
    const snap = await companyRef.get();
    if (!snap.exists) { console.log(`⚠️  Empresa ${companyRef.id} no existe — saltando`); continue; }
    console.log(`• Empresa ${companyRef.id}`);
    const { total, touched, skipped } = await processCompany(companyRef);
    console.log(`   leads: ${total} · recalculados: ${touched} · ya tenían stats (saltados): ${skipped}\n`);
    grandTouched += touched;
  }

  console.log(`=== Listo. ${grandTouched} leads ${apply ? 'actualizados' : 'que se actualizarían (dry-run)'} ===\n`);
  process.exit(0);
})().catch((e) => { console.error('💥 Error:', e); process.exit(1); });
