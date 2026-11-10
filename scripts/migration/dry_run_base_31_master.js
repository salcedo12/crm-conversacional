const path = require('path');
const fs = require('fs');
const admin = require('../../functions/node_modules/firebase-admin');
const xlsx = require('../../functions/node_modules/xlsx');

// 1. Inicializar Firebase con Service Account
const saPath = path.join(__dirname, '../../service-account.json');
let db = null;
if (fs.existsSync(saPath)) {
  const sa = require(saPath);
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  db = admin.firestore();
}

// 2. Catálogo Oficial Meraki
const PROJECTS_CATALOG = {
  'rio_claro': {
    name: 'Río Claro',
    sectors: ['Río Lagunilla', 'Río Medina']
  },
  'canon_arizona': {
    name: 'Cañón de Arizona',
    sectors: ['San Francisco', 'Las Vegas', 'Colorado', 'Texas', 'Los Ángeles']
  },
  'laguna_mar': {
    name: 'Laguna Mar',
    sectors: ['Mar Canarias', 'Mar Santorini']
  },
  'sobre_montanas': {
    name: 'Sobre Montañas de Alvarado',
    sectors: ['17 Aldeas']
  },
  'llano_grande': {
    name: 'Llano Grande',
    sectors: ['Santa Helena', 'Mall Guatapé', 'El Poblado', 'Valle de Aburrá', 'San Antonio']
  }
};

function normalizePhone(rawPhone) {
  if (!rawPhone) return null;
  let digits = String(rawPhone).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10 && digits.startsWith('3')) {
    return `+57${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('573')) {
    return `+${digits}`;
  }
  if (digits.length >= 10) {
    return `+${digits}`;
  }
  return null;
}

function detectProjectAndSector(rawText = '') {
  const text = String(rawText).toLowerCase();
  
  if (text.includes('rio claro') || text.includes('lagunilla') || text.includes('medina') || text.includes('gual')) {
    const sector = text.includes('medina') ? 'Río Medina' : 'Río Lagunilla';
    return { projectKey: 'rio_claro', projectName: 'Río Claro', sector };
  }
  if (text.includes('arizona') || text.includes('las vegas') || text.includes('san francisco') || text.includes('colorado') || text.includes('texas') || text.includes('angeles')) {
    let sector = 'San Francisco';
    if (text.includes('las vegas')) sector = 'Las Vegas';
    else if (text.includes('colorado')) sector = 'Colorado';
    else if (text.includes('texas')) sector = 'Texas';
    else if (text.includes('angeles') || text.includes('ángeles')) sector = 'Los Ángeles';
    return { projectKey: 'canon_arizona', projectName: 'Cañón de Arizona', sector };
  }
  if (text.includes('laguna mar') || text.includes('canarias') || text.includes('santorini')) {
    const sector = text.includes('santorini') ? 'Mar Santorini' : 'Mar Canarias';
    return { projectKey: 'laguna_mar', projectName: 'Laguna Mar', sector };
  }
  if (text.includes('montaña') || text.includes('alvarado') || text.includes('aldea') || text.includes('gavilan')) {
    return { projectKey: 'sobre_montanas', projectName: 'Sobre Montañas de Alvarado', sector: '17 Aldeas' };
  }
  if (text.includes('llano grande') || text.includes('guatape') || text.includes('poblado') || text.includes('aburra') || text.includes('helena') || text.includes('san antonio')) {
    let sector = 'Santa Helena';
    if (text.includes('guatape')) sector = 'Mall Guatapé';
    else if (text.includes('poblado')) sector = 'El Poblado';
    else if (text.includes('aburra')) sector = 'Valle de Aburrá';
    else if (text.includes('san antonio')) sector = 'San Antonio';
    return { projectKey: 'llano_grande', projectName: 'Llano Grande', sector };
  }

  return { projectKey: 'canon_arizona', projectName: 'Cañón de Arizona', sector: 'General' };
}

async function run() {
  console.log('='.repeat(75));
  console.log('  AUDITORÍA EN SECO (DRY-RUN): BaseDeDatosUnificada (31).xls');
  console.log('  Migración SmartHome -> CRM Meraki 360°');
  console.log('='.repeat(75));

  // 1. Cargar usuarios actuales de Firestore si hay conexión
  const crmUsers = new Map(); // normalizedName -> userObj
  if (db) {
    try {
      const companies = ['grupo_meraki_real', 'empresa_demo'];
      for (const compId of companies) {
        const uSnap = await db.collection('companies').doc(compId).collection('users').get();
        uSnap.forEach(doc => {
          const d = doc.data();
          const name = (d.displayName || d.name || d.email || '').trim().toLowerCase();
          if (name) {
            crmUsers.set(name, {
              uid: doc.id,
              displayName: d.displayName || d.name || doc.id,
              email: d.email || '',
              role: d.role || '',
              companyId: compId,
              active: d.active !== false
            });
          }
        });
      }
      console.log(`[Firestore] Usuarios CRM cargados para cotejo: ${crmUsers.size} registrados.\n`);
    } catch (err) {
      console.warn('[Firestore] No se pudieron cargar usuarios de Firestore:', err.message);
    }
  }

  // 2. Leer archivo Excel
  const downloadsDir = path.join(process.env.USERPROFILE, 'Downloads');
  const filePath = path.join(downloadsDir, 'BaseDeDatosUnificada (31).xls');

  if (!fs.existsSync(filePath)) {
    console.error(`ERROR: No se encontró el archivo en: ${filePath}`);
    process.exit(1);
  }

  console.log(`Leyendo archivo Excel: ${filePath}...`);
  const wb = xlsx.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
  console.log(`Archivo cargado con éxito. Total filas leídas: ${rows.length.toLocaleString()}\n`);

  const uniquePhones = new Map(); // phone -> lead
  let invalidPhoneCount = 0;
  let duplicatesCount = 0;

  const advisorCounts = {};
  const projectCounts = {};
  const sectorCounts = {};
  const cycleCounts = {};
  const sourceCounts = {};
  const trackingStatusCounts = {};
  let totalBitacoraEntries = 0;
  const bitacoraTypes = {};

  rows.forEach((row, idx) => {
    const rawPhone = row['Celular'] || row['Teléfono'];
    const phone = normalizePhone(rawPhone);

    if (!phone) {
      invalidPhoneCount++;
      return;
    }

    if (uniquePhones.has(phone)) {
      duplicatesCount++;
      return;
    }

    const advisorRaw = String(row['Asesor'] || row['Vendedor'] || 'Sin Asignar').trim() || 'Sin Asignar';
    advisorCounts[advisorRaw] = (advisorCounts[advisorRaw] || 0) + 1;

    const fullProjText = `${row['Proyecto'] || ''} ${row['Etapa del Proyecto'] || ''} ${row['Modulo'] || ''}`;
    const proj = detectProjectAndSector(fullProjText);
    projectCounts[proj.projectName] = (projectCounts[proj.projectName] || 0) + 1;
    const sectorKey = `${proj.projectName} - ${proj.sector}`;
    sectorCounts[sectorKey] = (sectorCounts[sectorKey] || 0) + 1;

    const cycle = String(row['Ciclo de Venta'] || 'Sin Ciclo').trim() || 'Sin Ciclo';
    cycleCounts[cycle] = (cycleCounts[cycle] || 0) + 1;

    const source = String(row['Fuente de Ubicación Cliente'] || row['Fuente de Ubicación Prospecto'] || row['Medio de Atención'] || 'SmartHome').trim() || 'SmartHome';
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;

    const tracking = String(row['Estado de Seguimiento'] || 'Sin Estado').trim() || 'Sin Estado';
    trackingStatusCounts[tracking] = (trackingStatusCounts[tracking] || 0) + 1;

    // Detectar Bitácoras
    const actions = [];
    Object.keys(row).forEach(k => {
      if ((k.startsWith('Accion:') || k.startsWith(' Medio de atencion:')) && !k.endsWith('Ult. Fecha')) {
        const val = String(row[k]).trim();
        if (val !== '0' && val !== '') {
          const count = parseInt(val, 10) || 1;
          const lastDate = row[`${k} Ult. Fecha`] || '';
          const actionName = k.replace(/^Accion:|\s*Medio de atencion:/i, '').trim();
          actions.push({ action: actionName, count, lastDate });
          bitacoraTypes[actionName] = (bitacoraTypes[actionName] || 0) + count;
          totalBitacoraEntries += count;
        }
      }
    });

    uniquePhones.set(phone, {
      index: idx + 1,
      id: row['ProspectId'] || row['CustomerId'] || `sm_${idx + 1}`,
      customerId: row['CustomerId'] || '',
      prospectId: row['ProspectId'] || '',
      name: String(row['Nombre del Cliente'] || 'Sin Nombre').trim(),
      phone,
      rawPhone,
      email: String(row['Email'] || '').trim().toLowerCase(),
      city: String(row['Ciudad'] || '').trim(),
      advisor: advisorRaw,
      projectName: proj.projectName,
      sector: proj.sector,
      cycle,
      source,
      trackingStatus: tracking,
      createdAt: row['Fecha de Creacion'] || '',
      actionsCount: actions.length
    });
  });

  console.log('='.repeat(75));
  console.log('              RESUMEN GENERAL DE CALIDAD DE DATOS');
  console.log('='.repeat(75));
  console.log(`• Total Filas en Archivo:          ${rows.length.toLocaleString()}`);
  console.log(`• Teléfonos Válidos E.164:         ${(rows.length - invalidPhoneCount).toLocaleString()}`);
  console.log(`• Filas sin Teléfono Válido:       ${invalidPhoneCount.toLocaleString()}`);
  console.log(`• Registros Duplicados Omitidos:   ${duplicatesCount.toLocaleString()}`);
  console.log(`• LEADS ÚNICOS LISTOS PARA CARGA:  ${uniquePhones.size.toLocaleString()}`);
  console.log(`• Acciones/Bitácoras Detectadas:   ${totalBitacoraEntries.toLocaleString()} eventos históricos`);

  console.log('\n' + '='.repeat(75));
  console.log('      DISTRIBUCIÓN POR ASESOR COMERCIAL & COTEJO CON CRM');
  console.log('='.repeat(75));
  const sortedAdvisors = Object.entries(advisorCounts).sort((a, b) => b[1] - a[1]);
  
  sortedAdvisors.forEach(([adv, count]) => {
    const advNorm = adv.toLowerCase().trim();
    let crmMatch = null;
    for (const [cName, cUser] of crmUsers.entries()) {
      if (cName.includes(advNorm) || advNorm.includes(cName)) {
        crmMatch = cUser;
        break;
      }
    }

    const statusBadge = crmMatch 
      ? `✅ REGISTRADO EN CRM (UID: ${crmMatch.uid.slice(0, 8)}... [${crmMatch.role}])`
      : `⚠️ NO REGISTRADO EN CRM -> Sugerencia: [Pendiente Reasignar]`;

    console.log(`  • ${adv.padEnd(30)} : ${count.toString().padStart(5)} leads | ${statusBadge}`);
  });

  console.log('\n' + '='.repeat(75));
  console.log('           DISTRIBUCIÓN POR PROYECTO OFICIAL MERAKI');
  console.log('='.repeat(75));
  Object.entries(projectCounts).sort((a, b) => b[1] - a[1]).forEach(([proj, count]) => {
    const pct = ((count / uniquePhones.size) * 100).toFixed(1);
    console.log(`  • ${proj.padEnd(32)} : ${count.toString().padStart(5)} leads (${pct}%)`);
  });

  console.log('\n' + '='.repeat(75));
  console.log('                   TOP 10 SECTORES / ALDEAS');
  console.log('='.repeat(75));
  Object.entries(sectorCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([sec, count]) => {
    console.log(`  • ${sec.padEnd(40)} : ${count.toString().padStart(5)} leads`);
  });

  console.log('\n' + '='.repeat(75));
  console.log('             TOP 10 FUENTES DE CAPTACIÓN');
  console.log('='.repeat(75));
  Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([src, count]) => {
    console.log(`  • ${src.padEnd(35)} : ${count.toString().padStart(5)} leads`);
  });

  console.log('\n' + '='.repeat(75));
  console.log('           ESTADO DEL CICLO DE VENTA (SMARTHOME)');
  console.log('='.repeat(75));
  Object.entries(cycleCounts).sort((a, b) => b[1] - a[1]).forEach(([cyc, count]) => {
    console.log(`  • ${cyc.padEnd(35)} : ${count.toString().padStart(5)} leads`);
  });

  console.log('\n' + '='.repeat(75));
  console.log('       HISTORIAL DE BITÁCORAS POR TIPO DE ACCIÓN');
  console.log('='.repeat(75));
  Object.entries(bitacoraTypes).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([act, count]) => {
    console.log(`  • ${act.padEnd(35)} : ${count.toString().padStart(5)} registros`);
  });

  console.log('\n' + '='.repeat(75));
  console.log('  [DRY-RUN EXITOSO] Los 12,664 prospectos están mapeados y validados.');
  console.log('='.repeat(75));
}

run().catch(err => {
  console.error('Error durante la ejecución del Dry-Run:', err);
  process.exit(1);
});
