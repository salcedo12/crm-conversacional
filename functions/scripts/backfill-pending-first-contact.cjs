/**
 * Backfill: activa pendingFirstContact=true en leads SIN CONTACTAR creados HOY
 * (zona Bogotá), para que el cron de reasignación por falta de primer contacto
 * (processFirstContactReassignments) los tome. Necesario para los leads que se
 * crearon ANTES del deploy que corrigió la exclusión de pauta.
 *
 * Guardas (NO toca un lead si):
 *   - ya tuvo contacto humano (advisorFirstContactAt o lastAdvisorMessageAt)
 *   - está bloqueado (assignmentLocked)
 *   - está cerrado/perdido (status terminal)
 *   - no tiene assignedTo o advisorAssignedAt (el cron los necesita)
 *   - su source NO es meta_ads / whatsapp / web
 *   - ES un lead de FORMULARIO/leadgen (metadata.metaFormId presente) → los
 *     formularios NO se reasignan aunque su source sea meta_ads. Ojo: forms y
 *     click-to-WhatsApp comparten source='meta_ads'; el discriminador real es
 *     metaFormId (forms) vs sourceMeta.ctwaClid (click-to-WhatsApp).
 *   - ya tiene pendingFirstContact === true
 *
 * Uso:
 *   node scripts/backfill-pending-first-contact.cjs <service-account.json> grupo_meraki_real          (DRY-RUN)
 *   node scripts/backfill-pending-first-contact.cjs <service-account.json> grupo_meraki_real --apply   (aplica)
 */
const admin = require('firebase-admin');
const path  = require('path');

const args      = process.argv.slice(2);
const keyPath   = args.find((a) => a.endsWith('.json'));
const apply     = args.includes('--apply');
const companyId = args.find((a) => !a.endsWith('.json') && !a.startsWith('--')) || 'grupo_meraki_real';

if (!keyPath) { console.error('❌ Falta service-account.json'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(keyPath))) });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const TERMINAL = new Set(['lost', 'closed', 'perdido', 'cerrado']);
const ALLOWED_SOURCES = new Set(['meta_ads', 'whatsapp', 'web']);
const fmt = (ts) => ts && ts.toDate ? ts.toDate().toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : '—';

// Inicio de HOY en America/Bogota (UTC-5, sin DST) → Timestamp.
function startOfTodayBogota() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const d = parts.find((p) => p.type === 'day').value;
  return Timestamp.fromDate(new Date(`${y}-${m}-${d}T00:00:00-05:00`));
}

(async () => {
  const companyRef = db.collection('companies').doc(companyId);
  const startTs = startOfTodayBogota();
  console.log(`\n=== Backfill pendingFirstContact · ${companyId} · desde ${fmt(startTs)} · modo: ${apply ? 'APLICAR' : 'DRY-RUN'} ===\n`);

  const snap = await companyRef.collection('leads').where('createdAt', '>=', startTs).get();
  const toFix = [];
  const skipped = { contactado: 0, locked: 0, terminal: 0, sinAsesor: 0, fuente: 0, formulario: 0, yaPending: 0 };

  snap.forEach((doc) => {
    const l = doc.data();
    if (l.pendingFirstContact === true) { skipped.yaPending++; return; }
    if (l.advisorFirstContactAt || l.lastAdvisorMessageAt) { skipped.contactado++; return; }
    if (l.assignmentLocked) { skipped.locked++; return; }
    if (TERMINAL.has(String(l.status || '').toLowerCase())) { skipped.terminal++; return; }
    if (!l.assignedTo || !l.advisorAssignedAt) { skipped.sinAsesor++; return; }
    if (!ALLOWED_SOURCES.has(l.source)) { skipped.fuente++; return; }
    // Los FORMULARIOS (leadgen) comparten source='meta_ads' pero NO se reasignan.
    if (l.metadata && l.metadata.metaFormId) { skipped.formulario++; return; }
    toFix.push({ ref: doc.ref, id: doc.id, l });
  });

  toFix.sort((a, b) => (a.l.createdAt?.toMillis?.() || 0) - (b.l.createdAt?.toMillis?.() || 0));
  console.log(`Leads creados hoy: ${snap.size} · a activar: ${toFix.length}`);
  console.log(`Saltados → ya-pending:${skipped.yaPending} contactado:${skipped.contactado} locked:${skipped.locked} terminal:${skipped.terminal} sin-asesor:${skipped.sinAsesor} otra-fuente:${skipped.fuente} formulario:${skipped.formulario}\n`);
  for (const f of toFix) {
    console.log(`  ✓ ${String(f.l.phone || f.id).padEnd(16)} | ${String(f.l.name || '').slice(0, 22).padEnd(22)} | src=${f.l.source} | creado ${fmt(f.l.createdAt)}`);
  }

  if (!apply) { console.log(`\n=== DRY-RUN: no se cambió nada. Repite con --apply. ===\n`); process.exit(0); }
  if (toFix.length === 0) { console.log('\nNada que activar. Fin.\n'); process.exit(0); }

  const now = Timestamp.now();
  let done = 0;
  for (const f of toFix) {
    await f.ref.update({ pendingFirstContact: true, updatedAt: now });
    done++;
  }
  console.log(`\n=== Listo. Activados ${done} leads. El cron los reasignará en la próxima corrida (cada 1 min). ===\n`);
  process.exit(0);
})().catch((e) => { console.error('💥 Error:', e.message); process.exit(1); });
