/**
 * SOLO LECTURA. Diagnostica por qué el round-robin asigna siempre al mismo.
 * Uso: node scripts/diagnose-assignment.cjs "service-account.json" <companyId>
 */
const admin = require('firebase-admin');
const path  = require('path');
const keyPath   = process.argv[2];
const companyId = process.argv[3] || 'empresa_demo';
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(keyPath))) });
const db = admin.firestore();

(async () => {
  const companyRef = db.collection('companies').doc(companyId);
  const usersSnap = await companyRef.collection('users').get();

  console.log(`\n=== Diagnóstico de asignación · ${companyId} ===\n`);
  const rows = [];
  for (const d of usersSnap.docs) {
    const u = d.data();
    const conn = await companyRef.collection('googleConnections').doc(d.id).get();
    const c = conn.exists ? conn.data() : null;
    const googleActive = !!(c && c.status === 'connected' && c.refreshToken);
    const load = await companyRef.collection('leads').where('assignedTo', '==', d.id).count().get();
    rows.push({
      name: u.name || u.email || d.id,
      role: u.role || '?',
      active: u.active !== false,
      google: googleActive,
      leads: load.data().count,
    });
  }
  rows.sort((a, b) => (a.role).localeCompare(b.role) || a.name.localeCompare(b.name));

  console.log('NOMBRE'.padEnd(28), 'ROL'.padEnd(9), 'ACTIVO', 'GOOGLE', 'LEADS');
  rows.forEach((r) =>
    console.log(
      String(r.name).padEnd(28),
      String(r.role).padEnd(9),
      (r.active ? 'sí' : 'NO').padEnd(6),
      (r.google ? 'sí' : 'no').padEnd(6),
      r.leads
    )
  );

  const advisors = rows.filter((r) => r.role === 'advisor' && r.active);
  const withGoogle = advisors.filter((r) => r.google);
  console.log(`\nAsesores activos (elegibles): ${advisors.length}`);
  console.log(`  · de esos, con Google conectado: ${withGoogle.length}`);
  console.log(`\nPool que usa el round-robin: ${withGoogle.length > 0
    ? `SOLO los ${withGoogle.length} con Google → ${withGoogle.map((r) => r.name).join(', ')}`
    : `TODOS los ${advisors.length} asesores (ninguno tiene Google)`}`);
  process.exit(0);
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
