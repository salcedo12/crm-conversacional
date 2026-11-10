const path = require('path');
const xlsx = require('../../functions/node_modules/xlsx');
const admin = require('../../functions/node_modules/firebase-admin');
const sa = require('../../service-account.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

function norm(s) {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function run() {
  const uSnap = await db.collection('companies').doc('grupo_meraki_real').collection('users').get();
  const crmUsers = new Map();
  uSnap.forEach(u => {
    const d = u.data();
    const cleanName = norm(d.displayName || d.name || '');
    crmUsers.set(cleanName, {
      uid: u.id,
      name: d.displayName || d.name || cleanName,
      email: d.email,
      active: d.active !== false
    });
  });

  console.log('Usuarios CRM en grupo_meraki_real:', crmUsers.size);

  const filePath = path.join(process.env.USERPROFILE, 'Downloads', 'BaseDeDatosUnificada (31).xls');
  const wb = xlsx.readFile(filePath);
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

  const advisorCounts = {};
  rows.forEach(r => {
    const raw = r['Asesor'] || r['Vendedor'] || 'Sin Asignar';
    const cName = norm(raw);
    advisorCounts[cName] = advisorCounts[cName] || { count: 0, original: raw };
    advisorCounts[cName].count++;
  });

  let matchedLeads = 0;
  let activeMatchedLeads = 0;
  let inactiveMatchedLeads = 0;
  let unmatchedLeads = 0;

  console.log('\n--- COTEJO EXACTO NORMALIZANDO ESPACIOS Y TILDES ---');
  Object.keys(advisorCounts)
    .sort((a, b) => advisorCounts[b].count - advisorCounts[a].count)
    .forEach(k => {
      const item = advisorCounts[k];
      const match = crmUsers.get(k);
      if (match) {
        matchedLeads += item.count;
        if (match.active) {
          activeMatchedLeads += item.count;
          console.log(`[ACTIVO ✅] ${match.name.padEnd(30)} : ${item.count} leads (UID: ${match.uid})`);
        } else {
          inactiveMatchedLeads += item.count;
          console.log(`[INACTIVO ⏸️] ${match.name.padEnd(30)} : ${item.count} leads (UID: ${match.uid})`);
        }
      } else {
        unmatchedLeads += item.count;
        console.log(`[SIN REGISTRO ❓] ${item.original.padEnd(30)} : ${item.count} leads`);
      }
    });

  console.log('\n' + '='.repeat(60));
  console.log('RESUMEN FINAL DE COTEJO DE ASESORES:');
  console.log('='.repeat(60));
  console.log('• Total Filas en Excel:                ', rows.length.toLocaleString());
  console.log('• Leads asignados a Asesor ACTIVO CRM: ', activeMatchedLeads.toLocaleString(), `(${(activeMatchedLeads / rows.length * 100).toFixed(1)}%)`);
  console.log('• Leads de Asesor INACTIVO en CRM:     ', inactiveMatchedLeads.toLocaleString(), `(${(inactiveMatchedLeads / rows.length * 100).toFixed(1)}%)`);
  console.log('• Leads sin Asesor o Ex-empleado:      ', unmatchedLeads.toLocaleString(), `(${(unmatchedLeads / rows.length * 100).toFixed(1)}%)`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
