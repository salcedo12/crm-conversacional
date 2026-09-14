/** SOLO LECTURA. Diagnóstico de por qué NO se reasignan los leads de una empresa. */
const admin = require('firebase-admin');
const path  = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(process.argv[2]))) });
const db = admin.firestore();
const companyId = process.argv[3] || 'grupo_meraki_real';
const fmt = (ts) => ts && ts.toDate ? ts.toDate().toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : '—';

const DEFAULTS = { autoReassignFirstContactEnabled: false, firstContactTimeoutMinutes: 15, reassignStartHour: 7, reassignEndHour: 22 };

(async () => {
  const companyRef = db.collection('companies').doc(companyId);

  // 1) Config de reasignación
  const cfgSnap = await companyRef.collection('config').doc('scheduling').get();
  const cfg = { ...DEFAULTS, ...(cfgSnap.exists ? cfgSnap.data() : {}) };
  console.log(`\n=== Config reasignación · ${companyId} (doc ${cfgSnap.exists ? 'existe' : 'NO existe → defaults'}) ===`);
  console.log(`  autoReassignFirstContactEnabled = ${cfg.autoReassignFirstContactEnabled}`);
  console.log(`  firstContactTimeoutMinutes      = ${cfg.firstContactTimeoutMinutes}`);
  console.log(`  franja reasignación             = ${cfg.reassignStartHour}:00 – ${cfg.reassignEndHour}:00`);
  const hourNow = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date()).find((p) => p.type === 'hour').value);
  console.log(`  hora actual (Bogotá)            = ${hourNow}:00  → ${hourNow >= cfg.reassignStartHour && hourNow < cfg.reassignEndHour ? 'DENTRO de franja' : 'FUERA de franja'}`);

  // 2) Leads sin primer contacto: cómo están sus flags
  const leadsSnap = await companyRef.collection('leads').orderBy('createdAt', 'desc').limit(40).get();
  console.log(`\n=== Últimos 40 leads · flags de reasignación ===`);
  console.log(`(pending = pendingFirstContact · locked = assignmentLocked · firstContact/lastAdvMsg = ya hubo contacto humano)\n`);
  let pendingTrue = 0, pendingFalse = 0, pendingUndef = 0;
  const now = Date.now();
  leadsSnap.forEach((d) => {
    const l = d.data();
    const created = l.createdAt?.toDate?.().toLocaleString('es-CO', { timeZone: 'America/Bogota' }) || '—';
    const assignedMs = l.advisorAssignedAt?.toMillis?.();
    const waitedMin = assignedMs ? Math.floor((now - assignedMs) / 60000) : null;
    if (l.pendingFirstContact === true) pendingTrue++;
    else if (l.pendingFirstContact === false) pendingFalse++;
    else pendingUndef++;
    // Marca solo los candidatos "deberían reasignarse pero…"
    const flagPend = l.pendingFirstContact === true ? 'pending=TRUE ' : (l.pendingFirstContact === false ? 'pending=false' : 'pending=undef');
    const extras = [
      l.assignmentLocked ? 'LOCKED' : '',
      l.advisorFirstContactAt ? 'firstContact✓' : '',
      l.lastAdvisorMessageAt ? 'lastAdvMsg✓' : '',
      l.source ? `src=${l.source}` : '',
      waitedMin != null ? `esperó=${waitedMin}min` : 'sin advisorAssignedAt',
    ].filter(Boolean).join(' · ');
    console.log(`  ${String(l.phone || d.id).padEnd(16)} | ${flagPend} | ${extras}`);
  });
  console.log(`\n  Resumen pendingFirstContact:  true=${pendingTrue}  false=${pendingFalse}  undefined=${pendingUndef}`);
  console.log('');
  process.exit(0);
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
