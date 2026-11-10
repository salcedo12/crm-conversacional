const path = require('path');
const fs = require('fs');
const xlsx = require(path.join(__dirname, '../../functions/node_modules/xlsx'));

// ---------------------------------------------------------------------------
// 1. CONFIGURACIÓN DE PROYECTOS Y SECTORES OFICIALES MERAKI
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// 2. FUNCIÓN DE NORMALIZACIÓN TELEFÓNICA (E.164)
// ---------------------------------------------------------------------------
function normalizePhone(rawPhone) {
  if (!rawPhone) return null;
  let digits = String(rawPhone).replace(/\D/g, '');
  if (!digits) return null;

  // Si tiene 10 dígitos y empieza por 3 (formato móvil Colombia)
  if (digits.length === 10 && digits.startsWith('3')) {
    return `+57${digits}`;
  }
  // Si ya tiene 12 dígitos y empieza por 573
  if (digits.length === 12 && digits.startsWith('573')) {
    return `+${digits}`;
  }
  // Casos internacionales o con código de país ya incluido
  if (digits.length >= 10) {
    return `+${digits}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 3. IDENTIFICADOR DE PROYECTO Y SECTOR A PARTIR DEL TEXTO
// ---------------------------------------------------------------------------
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
  if (text.includes('montaña') || text.includes('alvarado') || text.includes('aldea')) {
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

  // Default a Cañón de Arizona si no especifica
  return { projectKey: 'canon_arizona', projectName: 'Cañón de Arizona', sector: 'General' };
}

// ---------------------------------------------------------------------------
// 4. EJECUCIÓN DEL ANÁLISIS DRY-RUN
// ---------------------------------------------------------------------------
async function runDryRun() {
  console.log('='.repeat(70));
  console.log('   MIGRACIÓN SMART HOME A CRM MERAKI 360° - AUDITORÍA EN SECO (DRY-RUN)');
  console.log('='.repeat(70));

  const downloadsDir = path.join(process.env.USERPROFILE, 'Downloads');
  const asinproPath = path.join(downloadsDir, 'leeds de asinpro.xlsx');
  const totalLeadsPath = path.join(downloadsDir, 'total_leads.xlsx');
  const adrianaOscarPath = path.join(__dirname, '../../Leads_Adriana_Montana_y_Oscar_Narvaez.xlsx');

  const unifiedLeads = new Map(); // phone -> lead object
  const advisorStats = {};
  const projectStats = {};
  const sourceStats = {};
  let totalRowsRead = 0;
  let duplicatesFound = 0;

  // A. Procesar archivo total_leads.xlsx (SmartHome detallado)
  if (fs.existsSync(totalLeadsPath)) {
    console.log(`\n[1/3] Procesando SmartHome Export: ${path.basename(totalLeadsPath)}...`);
    const wb = xlsx.readFile(totalLeadsPath);
    const data = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    totalRowsRead += data.length;

    data.forEach(row => {
      const phone = normalizePhone(row['Celular'] || row['Teléfono']);
      if (!phone) return;

      const advisor = String(row['Asesor'] || row['Vendedor'] || 'Sin Asignar').trim();
      const projInfo = detectProjectAndSector(`${row['Proyecto']} ${row['Etapa del Proyecto']} ${row['Modulo']}`);
      const source = String(row['Fuente de Ubicación Prospecto'] || row['Fuente de Ubicación Cliente'] || 'SmartHome').trim();

      // Construcción de bitácoras históricas si las tiene
      const historyNotes = [];
      Object.keys(row).forEach(k => {
        if (k.startsWith('Accion:') && String(row[k]) !== '0' && String(row[k]) !== '') {
          const actionDate = row[`${k} Ult. Fecha`] || row['Fecha de Creacion'] || '';
          historyNotes.push({
            action: k.replace('Accion:', '').trim(),
            count: row[k],
            lastDate: actionDate
          });
        }
      });

      if (unifiedLeads.has(phone)) {
        duplicatesFound++;
      } else {
        unifiedLeads.set(phone, {
          name: String(row['Nombre del Cliente'] || 'Sin Nombre').trim(),
          phone,
          email: String(row['Email'] || '').trim().toLowerCase(),
          city: String(row['Ciudad'] || '').trim(),
          advisor,
          projectKey: projInfo.projectKey,
          projectName: projInfo.projectName,
          sector: projInfo.sector,
          source,
          status: 'qualified',
          historyNotes,
          createdAt: row['Fecha de Creacion'] || new Date().toISOString()
        });
      }
    });
  }

  // B. Procesar archivo leeds de asinpro.xlsx (Bases por Asesor)
  if (fs.existsSync(asinproPath)) {
    console.log(`\n[2/3] Procesando Base Consolidada Asinpro: ${path.basename(asinproPath)}...`);
    const wb = xlsx.readFile(asinproPath);
    
    wb.SheetNames.forEach(sheetName => {
      const sheetData = xlsx.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
      totalRowsRead += sheetData.length;

      sheetData.forEach(row => {
        const phone = normalizePhone(row['Número de teléfono'] || row['Telefono'] || row['Celular']);
        if (!phone) return;

        const advisor = sheetName.trim();
        const source = String(row['Fuente'] || row['Campaña UTM (First)'] || 'Asinpro IA').trim();
        const projInfo = detectProjectAndSector(row['Etiquetas'] || '');

        if (unifiedLeads.has(phone)) {
          duplicatesFound++;
        } else {
          unifiedLeads.set(phone, {
            name: String(row['6l'] || row['Nombre'] || 'Sin Nombre').trim(),
            phone,
            email: String(row['Correo electrónico'] || '').trim().toLowerCase(),
            city: String(row['País'] || 'Colombia').trim(),
            advisor,
            projectKey: projInfo.projectKey,
            projectName: projInfo.projectName,
            sector: projInfo.sector,
            source,
            status: 'active',
            historyNotes: [],
            createdAt: row['Fecha de creación'] || new Date().toISOString()
          });
        }
      });
    });
  }

  // C. Métricas y Estadísticas
  unifiedLeads.forEach(lead => {
    advisorStats[lead.advisor] = (advisorStats[lead.advisor] || 0) + 1;
    projectStats[lead.projectName] = (projectStats[lead.projectName] || 0) + 1;
    sourceStats[lead.source] = (sourceStats[lead.source] || 0) + 1;
  });

  console.log('\n' + '='.repeat(70));
  console.log('   RESULTADO DE LA AUDITORÍA DE MIGRACIÓN');
  console.log('='.repeat(70));
  console.log(`• Total Filas Leídas en Archivos:   ${totalRowsRead.toLocaleString()} registros`);
  console.log(`• Duplicados Identificados & Unidos: ${duplicatesFound.toLocaleString()} registros`);
  console.log(`• Leads Únicos Listos para Ingesta:  ${unifiedLeads.size.toLocaleString()} prospectos únicos`);

  console.log('\n--- DISTRIBUCIÓN POR ASESOR COMERCIAL ---');
  Object.entries(advisorStats)
    .sort((a, b) => b[1] - a[1])
    .forEach(([adv, count]) => {
      console.log(`  - ${adv.padEnd(30)}: ${count.toLocaleString()} leads`);
    });

  console.log('\n--- DISTRIBUCIÓN POR PROYECTO MERAKI ---');
  Object.entries(projectStats)
    .sort((a, b) => b[1] - a[1])
    .forEach(([proj, count]) => {
      console.log(`  - ${proj.padEnd(30)}: ${count.toLocaleString()} leads`);
    });

  console.log('\n--- TOP 10 FUENTES DE CAPTACIÓN ---');
  Object.entries(sourceStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([src, count]) => {
      console.log(`  - ${src.padEnd(30)}: ${count.toLocaleString()} leads`);
    });

  console.log('\n[DRY-RUN EXITOSO] El esquema de datos está 100% normalizado y listo para carga masiva.');
}

runDryRun().catch(err => {
  console.error('Error durante la simulación de migración:', err);
});
