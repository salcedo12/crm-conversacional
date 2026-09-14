/** SOLO LECTURA. Últimos leads y a quién se asignaron. */
const admin = require('firebase-admin');
const path  = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(process.argv[2]))) });
const db = admin.firestore();
const companyId = process.argv[3] || 'empresa_demo';
const fmt = (ts) => ts && ts.toDate ? ts.toDate().toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : '—';

(async () => {
  const companyRef = db.collection('companies').doc(companyId);
  const usersSnap = await companyRef.collection('users').get();
  const nameOf = {};
  usersSnap.forEach((d) => { const u = d.data(); nameOf[d.id] = u.name || u.displayName || u.email || d.id; });

  const leadsSnap = await companyRef.collection('leads').get();
  const leads = leadsSnap.docs.map((d) => {
    const x = d.data();
    return {
      name: x.name || '(sin nombre)',
      phone: x.phone || '?',
      assignedTo: x.assignedTo || null,
      assignedName: x.assignedTo ? (nameOf[x.assignedTo] || `⚠ uid ${x.assignedTo} (no es usuario)`) : '— sin asignar',
      pending: x.pendingFirstContact,
      createdMs: x.createdAt && x.createdAt.toMillis ? x.createdAt.toMillis() : 0,
      createdAt: x.createdAt,
    };
  }).sort((a, b) => b.createdMs - a.createdMs);

  console.log(`\n=== Últimos 12 leads (más nuevo primero) · ${companyId} ===\n`);
  leads.slice(0, 12).forEach((l) => {
    console.log(`${fmt(l.createdAt).padEnd(22)} | ${String(l.phone).padEnd(15)} | ${String(l.assignedName).padEnd(38)} | pending=${l.pending}`);
  });

  // Conteo de asignación solo sobre leads NO-admin (nuevos)
  console.log(`\n=== Leads por asesor (excluye al admin) ===`);
  const counts = {};
  leads.forEach((l) => { if (l.assignedName && !/admin/i.test(l.assignedName)) counts[l.assignedName] = (counts[l.assignedName] || 0) + 1; });
  process.exit(0);
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
