const path = require('path');
const { db } = require(path.join(__dirname, '../../functions/lib/lib/admin'));

async function checkCurrentUsers() {
  console.log('Consultando empresas y usuarios actuales en Firestore...');
  const companiesSnap = await db.collection('companies').get();

  for (const comp of companiesSnap.docs) {
    console.log(`\nEmpresa: ${comp.id} (${comp.data().name || 'Sin nombre'})`);
    const usersSnap = await db.collection('companies').doc(comp.id).collection('users').get();
    
    console.log(`Total usuarios registrados: ${usersSnap.size}`);
    usersSnap.docs.forEach(u => {
      const d = u.data();
      console.log(`  - [${d.role || 'sin rol'}] ${d.displayName || d.email || u.id} (Activo: ${d.active !== false}, UID: ${u.id})`);
    });
  }
}

checkCurrentUsers().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
