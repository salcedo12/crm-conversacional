const admin = require('firebase-admin');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

if (!admin.apps.length) {
  const sa = require('../service-account.json');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

function cleanPhone(val) {
  if (!val) return '';
  const str = String(val).replace(/\D/g, '');
  if (str.length >= 10) return str.slice(-10);
  return str;
}

const isLive = process.argv.includes('--live');

async function main() {
  const p = path.join(process.env.USERPROFILE, 'Downloads', 'BaseDeDatosUnificada (31).xls');
  if (!fs.existsSync(p)) {
    console.error('File not found:', p);
    process.exit(1);
  }

  const wb = xlsx.readFile(p);
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

  const phoneToExcel = new Map();
  for (const r of rows) {
    const rawPhone = r['Telefono / Celular'] || r['Telefono'] || r['Celular'];
    const pClean = cleanPhone(rawPhone);
    if (pClean && pClean.length >= 7 && !phoneToExcel.has(pClean)) {
      phoneToExcel.set(pClean, {
        name: String(r['Nombres y Apellidos'] || r['Nombre'] || '').trim(),
        email: String(r['Correo'] || r['Email'] || '').trim(),
        city: String(r['Ciudad'] || '').trim(),
        advisor: String(r['Asesor'] || '').trim(),
        project: String(r['Inmueble'] || r['Proyecto'] || '').trim(),
      });
    }
  }

  const taskLogPath = path.join(
    process.env.USERPROFILE,
    '.gemini',
    'antigravity',
    'brain',
    '9be26797-e597-4eee-959f-c35ccb6a83f3',
    '.system_generated',
    'tasks',
    'task-645.log'
  );

  const file = fs.readFileSync(taskLogPath, 'utf8');
  const lines = file.split('\n');
  const updates = [];

  for (const line of lines) {
    const match = line.match(/ID: ([a-zA-Z0-9_-]+) \| Nombre actual: "([^"]+)" \| Tel: ([^\s|]+) \| Excel: (.*)/);
    if (!match) continue;
    const [, id, currentName, phone, excelNameRaw] = match;
    const excelName = excelNameRaw.trim();
    if (!excelName || excelName === 'NO en Excel 31' || excelName === '.' || excelName.toLowerCase() === 'no dio nombre') {
      continue;
    }
    if (/asesor|meraki|refugio/i.test(excelName)) {
      continue;
    }
    const pClean = cleanPhone(phone);
    const excelData = phoneToExcel.get(pClean) || { name: excelName };
    const finalName = (excelData.name || excelName).trim();

    if (!finalName || /asesor|meraki|refugio/i.test(finalName)) {
      continue;
    }

    updates.push({
      id,
      currentName,
      phone,
      newName: finalName,
      email: excelData.email || '',
      city: excelData.city || '',
    });
  }

  console.log(`\n=== AUDITORÍA DE ACTUALIZACIÓN DE NOMBRES ===`);
  console.log(`Modo: ${isLive ? '🔴 EN VIVO (GUARDANDO EN FIRESTORE)' : '🟡 DRY-RUN (SOLO SIMULACIÓN)'}`);
  console.log(`Total leads a renombrar con nombre real de cliente: ${updates.length}\n`);

  console.table(updates.slice(0, 20).map(u => ({
    ID: u.id,
    'Nombre Anterior': u.currentName,
    'Nombre Real (Cliente)': u.newName,
    Tel: u.phone,
    Email: u.email || 'N/A'
  })));

  if (isLive) {
    console.log(`\nAplicando ${updates.length} actualizaciones en Firestore...`);
    let count = 0;
    const batchSize = 100;
    for (let i = 0; i < updates.length; i += batchSize) {
      const chunk = updates.slice(i, i + batchSize);
      const batch = db.batch();
      for (const item of chunk) {
        const docRef = db.collection('companies').doc('grupo_meraki_real').collection('leads').doc(item.id);
        const updatePayload = {
          name: item.newName,
          updatedAt: admin.firestore.Timestamp.now(),
        };
        if (item.email && item.email.includes('@')) {
          updatePayload.email = item.email.toLowerCase();
        }
        batch.set(docRef, updatePayload, { merge: true });
        count++;
      }
      await batch.commit();
      console.log(`Actualizados ${count}/${updates.length} leads...`);
    }
    console.log(`\n✅ Proceso completado exitosamente: ${count} leads actualizados con su nombre real.`);
  } else {
    console.log(`\n💡 Para aplicar estos cambios en vivo, ejecuta: node scripts/fix-placeholder-names.js --live`);
  }
}

main().catch(console.error);
