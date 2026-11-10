/**
 * SmartHome Migration Master v2 (Official Live Engine)
 * Ingesta de los prospectos de SmartHome a Firestore en companies/grupo_meraki_real/leads
 * 
 * Configuración aplicada por orden de Gerencia:
 * - Asesores activos y registrados (incluidos Angelica Acevedo, Adriana Montaña, Laura Torres y Oscar Narváez):
 *   Asignados directamente a sus UIDs en el CRM.
 * - Ex-asesores y sin cuenta en CRM:
 *   assignedTo = null, etiquetados con ex_asesor_nombre para posterior reasignación.
 * - Preservación 100% de Fuentes de Captación, Medios de Atención, Ciclo de Venta y Bitácoras.
 * - Fechas originales de creación preservadas en createdAt.
 * - aiEnabled: false (IA apagada preventivamente para prospectos históricos).
 */

const path = require('path');
const fs = require('fs');
const admin = require('../../functions/node_modules/firebase-admin');
const xlsx = require('../../functions/node_modules/xlsx');

const saPath = path.join(__dirname, '../../service-account.json');
if (!fs.existsSync(saPath)) {
  console.error('ERROR: No se encontró service-account.json en la raíz.');
  process.exit(1);
}

const sa = require(saPath);
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
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

function parseDate(rawDate) {
  if (!rawDate) return admin.firestore.Timestamp.now();
  try {
    const d = new Date(rawDate);
    if (!isNaN(d.getTime())) {
      return admin.firestore.Timestamp.fromDate(d);
    }
  } catch {}
  return admin.firestore.Timestamp.now();
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

function mapCycleToStatus(cycleRaw = '') {
  const c = String(cycleRaw).toUpperCase().trim();
  if (c.includes('CIERRE') || c.includes('VENTA') || c.includes('COMPRO')) return 'closed';
  if (c.includes('CANCELADO') || c.includes('DESISTIMIENTO') || c.includes('PERDIDO')) return 'lost';
  if (c.includes('SEGUIMIENTO') || c.includes('LINEA')) return 'active';
  if (c.includes('CAPTACION')) return 'qualified';
  return 'new';
}

function mapSourceToStandard(sourceRaw = '') {
  const s = String(sourceRaw).toLowerCase().trim();
  if (s.includes('meta') || s.includes('facebook') || s.includes('instagram')) return 'meta_ads';
  if (s.includes('google')) return 'google_ads';
  if (s.includes('web') || s.includes('pagina')) return 'web';
  if (s.includes('317') || s.includes('whatsapp')) return 'whatsapp';
  if (s.includes('campo') || s.includes('calle') || s.includes('feria') || s.includes('expoferia')) return 'manual';
  return 'manual';
}

async function main() {
  const isLive = process.argv.includes('--live');
  const targetCompany = 'grupo_meraki_real';

  console.log('='.repeat(75));
  console.log(` MIGRACIÓN SMARTHOME A CRM MERAKI [MODO: ${isLive ? '🚀 EN VIVO (LIVE)' : '🔍 AUDITORÍA (DRY-RUN)'}]`);
  console.log(` Empresa destino: ${targetCompany}`);
  console.log('='.repeat(75));

  // A. Cargar usuarios de Firestore
  const uSnap = await db.collection('companies').doc(targetCompany).collection('users').get();
  const crmUsers = new Map();
  uSnap.forEach(u => {
    const d = u.data();
    const cleanName = norm(d.displayName || d.name || '');
    crmUsers.set(cleanName, {
      uid: u.id,
      name: d.displayName || d.name || cleanName,
      email: d.email || '',
      role: d.role || 'advisor',
      active: d.active !== false
    });
  });
  console.log(`[Firestore] Usuarios registrados en ${targetCompany}: ${crmUsers.size}`);

  // B. Leer archivo Excel
  const downloadsDir = path.join(process.env.USERPROFILE, 'Downloads');
  const filePath = path.join(downloadsDir, 'BaseDeDatosUnificada (31).xls');

  if (!fs.existsSync(filePath)) {
    console.error(`ERROR: No se encontró el archivo en ${filePath}`);
    process.exit(1);
  }

  const wb = xlsx.readFile(filePath);
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  console.log(`[Excel] Filas leídas: ${rows.length.toLocaleString()}\n`);

  const preparedLeads = [];
  const seenPhones = new Set();
  let invalidPhones = 0;
  let duplicates = 0;

  let assignedToRegisteredAdvisor = 0;
  let unassignedCount = 0;

  rows.forEach((row, idx) => {
    const phone = normalizePhone(row['Celular'] || row['Teléfono']);
    if (!phone) {
      invalidPhones++;
      return;
    }

    if (seenPhones.has(phone)) {
      duplicates++;
      return;
    }
    seenPhones.add(phone);

    // Mapeo de Asesor: Si está en el CRM (activo o inactivo), se asigna a su UID ("dejalos a nombre de ellos")
    const rawAdvisor = String(row['Asesor'] || row['Vendedor'] || 'Sin Asignar').trim() || 'Sin Asignar';
    const cleanAdvisorName = norm(rawAdvisor);
    const matchedUser = crmUsers.get(cleanAdvisorName);

    let assignedTo = null;
    let assignmentStatus = 'unassigned';
    let tags = ['smarthome_migracion'];

    if (matchedUser) {
      assignedTo = matchedUser.uid;
      assignmentStatus = 'assigned';
      assignedToRegisteredAdvisor++;
    } else {
      assignedTo = null;
      assignmentStatus = 'pending_reassignment';
      if (rawAdvisor !== 'Sin Asignar' && !cleanAdvisorName.includes('administrador')) {
        tags.push(`ex_asesor_${cleanAdvisorName.replace(/\s+/g, '_')}`);
      }
      unassignedCount++;
    }

    // Mapeo de Proyecto y Sector
    const fullProjText = `${row['Proyecto'] || ''} ${row['Etapa del Proyecto'] || ''} ${row['Modulo'] || ''}`;
    const proj = detectProjectAndSector(fullProjText);

    // Mapeo de Ciclo de Venta
    const rawCycle = String(row['Ciclo de Venta'] || 'CAPTACION').trim() || 'CAPTACION';
    const rawSequence = String(row['Secuencia Ciclo de Venta'] || '').trim();
    const trackingStatus = String(row['Estado de Seguimiento'] || 'Activo').trim() || 'Activo';
    const standardStatus = mapCycleToStatus(rawCycle);

    // Mapeo de Fuentes
    const rawSource = String(row['Fuente de Ubicación Cliente'] || row['Fuente de Ubicación Prospecto'] || row['Medio de Atención'] || 'SmartHome').trim() || 'SmartHome';
    const standardSource = mapSourceToStandard(rawSource);

    // Bitácoras
    const historyEvents = [];
    Object.keys(row).forEach(k => {
      if ((k.startsWith('Accion:') || k.startsWith(' Medio de atencion:')) && !k.endsWith('Ult. Fecha')) {
        const val = String(row[k]).trim();
        if (val !== '0' && val !== '') {
          const count = parseInt(val, 10) || 1;
          const lastDate = row[`${k} Ult. Fecha`] || '';
          const actionName = k.replace(/^Accion:|\s*Medio de atencion:/i, '').trim();
          historyEvents.push({
            action: actionName,
            count,
            lastDate,
            description: `${actionName} (${count} veces${lastDate ? ` - Última: ${lastDate}` : ''})`
          });
        }
      }
    });

    const leadDocId = `sm_${idx + 1}_${phone.replace(/\D/g, '').slice(-8)}`;
    const originalCreatedTs = parseDate(row['Fecha de Creacion'] || row['Fecha de Creación (dd/mm/aa)']);

    const leadPayload = {
      id: leadDocId,
      companyId: targetCompany,
      name: String(row['Nombre del Cliente'] || 'Sin Nombre').trim(),
      phone,
      normalizedPhone: phone.toLowerCase(),
      phoneTail: phone.slice(-10),
      email: String(row['Email'] || '').trim().toLowerCase() || null,
      city: String(row['Ciudad'] || '').trim() || null,
      department: String(row['Departamento'] || '').trim() || null,
      idNumber: String(row['Numero Identificación'] || '').trim() || null,
      
      status: standardStatus,
      source: standardSource,
      inbox: 'central_317',
      isArchived: standardStatus === 'lost',
      aiEnabled: false,
      
      assignedTo,
      assignmentLocked: !!assignedTo,
      assignmentStatus,
      
      projectInterest: [proj.projectName],
      tags,
      
      firstTouch: {
        source: standardSource,
        channel: 'whatsapp',
        campaign: rawSource,
        project: proj.projectName,
        sector: proj.sector,
        timestamp: originalCreatedTs
      },
      
      metadata: {
        migratedFrom: 'smarthome_excel_base_31',
        migratedAt: new Date().toISOString(),
        
        smarthomeFuenteOriginal: rawSource,
        smarthomeMedioAtencion: String(row['Medio de Atención'] || '').trim(),
        
        smarthomeCicloVenta: rawCycle,
        smarthomeSecuenciaCiclo: rawSequence,
        smarthomeEstadoSeguimiento: trackingStatus,
        
        smarthomeAsesorOriginal: rawAdvisor,
        
        smarthomeProyectoOriginal: row['Proyecto'] || '',
        smarthomeEtapaOriginal: row['Etapa del Proyecto'] || '',
        smarthomeModuloOriginal: row['Modulo'] || '',
        smarthomeSector: proj.sector,
        smarthomeValorInmueble: row['Valor del inmueble'] || row['Valor Total'] || '',
        
        smarthomeCustomerId: row['CustomerId'] || '',
        smarthomeProspectId: row['ProspectId'] || '',
        smarthomeFechaCreacionOriginal: row['Fecha de Creacion'] || '',
        
        smarthomeBitacoras: historyEvents
      },
      
      customFields: {
        proyecto: proj.projectName,
        sector: proj.sector,
        ciclo_venta: rawCycle,
        fuente_smarthome: rawSource,
        asesor_smarthome: rawAdvisor
      },
      
      createdAt: originalCreatedTs,
      updatedAt: admin.firestore.Timestamp.now()
    };

    preparedLeads.push(leadPayload);
  });

  console.log('='.repeat(75));
  console.log('              RESUMEN DE PREPARACIÓN DE CARGA');
  console.log('='.repeat(75));
  console.log(`• Total Filas Procesadas:              ${rows.length.toLocaleString()}`);
  console.log(`• Filas Omitidas (Sin Teléfono):       ${invalidPhones.toLocaleString()}`);
  console.log(`• Duplicados Unificados:               ${duplicates.toLocaleString()}`);
  console.log(`• TOTAL LEADS LISTOS PARA INGESTA:     ${preparedLeads.length.toLocaleString()}`);
  console.log(`  - Asignados a Asesores del CRM:      ${assignedToRegisteredAdvisor.toLocaleString()} (${(assignedToRegisteredAdvisor/preparedLeads.length*100).toFixed(1)}%)`);
  console.log(`  - Sin Asesor / Pendientes Reasignar: ${unassignedCount.toLocaleString()} (${(unassignedCount/preparedLeads.length*100).toFixed(1)}%)`);

  if (!isLive) {
    console.log('\n[DRY-RUN LISTO] Ejecuta con --live para guardar en Firestore.');
    return;
  }

  // -------------------------------------------------------------------------
  // INYECCIÓN REAL POR LOTES
  // -------------------------------------------------------------------------
  console.log('\n' + '='.repeat(75));
  console.log(` INICIANDO ESCRITURA EN FIRESTORE EN ${targetCompany}...`);
  console.log('='.repeat(75));

  const BATCH_SIZE = 350; // Lote seguro de 350 docs
  let batchCount = 0;
  let savedCount = 0;

  for (let i = 0; i < preparedLeads.length; i += BATCH_SIZE) {
    const chunk = preparedLeads.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    chunk.forEach(lead => {
      const docRef = db.collection('companies').doc(targetCompany).collection('leads').doc(lead.id);
      batch.set(docRef, lead, { merge: true });
    });

    await batch.commit();
    batchCount++;
    savedCount += chunk.length;
    process.stdout.write(`\r  -> Lote ${batchCount} completado: ${savedCount.toLocaleString()} de ${preparedLeads.length.toLocaleString()} leads guardados (${(savedCount/preparedLeads.length*100).toFixed(1)}%)...`);
  }

  console.log(`\n\n🎉 [MIGRACIÓN COMPLETADA CON ÉXITO]`);
  console.log(`Se han guardado ${savedCount.toLocaleString()} prospectos en 'companies/${targetCompany}/leads' con todos sus datos y bitácoras.`);
}

main().catch(err => {
  console.error('Error durante la migración:', err);
  process.exit(1);
});
