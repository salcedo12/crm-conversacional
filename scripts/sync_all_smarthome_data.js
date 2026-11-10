/**
 * sync_all_smarthome_data.js
 *
 * Trae todos los prospectos y ventas actuales desde SmartHome (getSales de todos los proyectos),
 * cruza con los prospectos del CRM (por prospectId o por teléfono),
 * obtiene la bitácora completa de eventos (getProspectEvents) de cada uno,
 * y sincroniza:
 *   1. Las notas de seguimiento en la subcolección `leads/{leadId}/notes` (Ficha Técnica).
 *   2. Los metadatos de SmartHome en `lead.metadata` (smarthomeBitacoras, ciclo, etapa, módulo, valor, etc.).
 *   3. Las propiedades raíz del lead (smartHomeProspectId, smartHomeAdvisorName, smartHomeStageName, etc.).
 *   4. Si hay registros en SmartHome que no existían en el CRM, los crea con su respectiva ficha y bitácora.
 */

const fs = require('fs');
const path = require('path');
const admin = require('../functions/node_modules/firebase-admin');
const sa = require('../service-account.json');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(sa),
    projectId: 'crm-conversacional',
  });
}
const db = admin.firestore();
const sh = require('../functions/lib/integrations/smarthome/smarthome.client.js');
const env = require('../functions/lib/config/env.js').env;

const COMPANY_ID = 'grupo_meraki_real';

function phoneKey(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : d;
}

function cleanAdvisorName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function classifyActionType(action, content) {
  const lower = `${action || ''} ${content || ''}`.toLowerCase();
  if (lower.includes('llamada') || lower.includes('telefono') || lower.includes('teléfono')) {
    return 'llamada';
  }
  if (lower.includes('visita') || lower.includes('terreno') || lower.includes('sala')) {
    return 'visita_terreno';
  }
  if (lower.includes('cita') || lower.includes('reunion') || lower.includes('reunión') || lower.includes('video')) {
    return 'cita_reunion';
  }
  if (lower.includes('brochure') || lower.includes('cotizacion') || lower.includes('cotización') || lower.includes('informacion') || lower.includes('información') || lower.includes('plano')) {
    return 'envio_informacion';
  }
  return 'seguimiento_general';
}

function parseEventDate(dateStr) {
  if (!dateStr) return admin.firestore.Timestamp.now();
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return admin.firestore.Timestamp.fromDate(d);
  }
  return admin.firestore.Timestamp.now();
}

async function fetchProjectSales(projectCode) {
  const url = `${env.smartHomeApiBase()}/api/v1/getSales/${env.smartHomeCompany()}/${projectCode}`;
  console.log(` -> Consultando proyecto ${projectCode}...`);
  const t0 = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      console.error(`Error HTTP ${res.status} para proyecto ${projectCode}`);
      return [];
    }
    const data = await res.json();
    const duration = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`    Proyecto ${projectCode}: ${data.prospects?.length || 0} prospectos en ${duration}s`);
    return data.prospects || [];
  } catch (err) {
    clearTimeout(timeout);
    console.error(`Error consultando proyecto ${projectCode}:`, err.message);
    return [];
  }
}

async function run() {
  console.log('=== INICIANDO SINCRONIZACIÓN COMPLETA DE SMARTHOME ===\n');
  const tStart = Date.now();

  // 1. Cargar usuarios de SmartHome y CRM
  console.log('1. Cargando usuarios de SmartHome y CRM...');
  const [shUsers, crmUsersSnap] = await Promise.all([
    sh.getSmartHomeUsers(true),
    db.collection('companies').doc(COMPANY_ID).collection('users').get(),
  ]);

  const shUserMap = new Map(); // shUserId -> clean name
  if (shUsers) {
    for (const u of shUsers) {
      shUserMap.set(u.userId, (u.firstName + ' ' + u.lastName).trim() || u.email);
    }
  }

  const crmUserMap = new Map(); // cleanName / email -> CRM uid
  crmUsersSnap.forEach((d) => {
    const u = d.data();
    const uid = d.id;
    if (u.displayName) crmUserMap.set(cleanAdvisorName(u.displayName), uid);
    if (u.email) crmUserMap.set(u.email.toLowerCase().trim(), uid);
  });

  // 2. Traer prospectos desde respaldo local o desde SmartHome
  const cachePath = path.join(__dirname, 'smarthome_sales_dump.json');
  let sales = [];
  if (fs.existsSync(cachePath)) {
    console.log(`\n2. Leyendo prospectos del dump local ${cachePath}...`);
    try {
      sales = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      console.log(`-> Cargados ${sales.length} prospectos desde cache local.`);
    } catch (_) {}
  }

  if (!sales || sales.length === 0) {
    console.log('\n2. Consultando ventas y prospectos de los proyectos en SmartHome...');
    const projectCodes = ['48c9266a', '17c89d4e', '5ad1b166'];
    const allProspects = [];
    for (const code of projectCodes) {
      const list = await fetchProjectSales(code);
      allProspects.push(...list);
    }

    const seenPid = new Set();
    for (const p of allProspects) {
      const key = p.prospectId || `${p.mobileNumber || ''}-${p.firstName || ''}`;
      if (!seenPid.has(key)) {
        seenPid.add(key);
        sales.push(p);
      }
    }
    fs.writeFileSync(cachePath, JSON.stringify(sales, null, 2), 'utf8');
  }

  console.log(`-> Total prospectos consolidados a sincronizar: ${sales.length}\n`);

  // 3. Cargar todos los leads existentes en CRM para cruzar rápidamente
  console.log('3. Indexando prospectos existentes en CRM...');
  const leadsSnap = await db.collection('companies').doc(COMPANY_ID).collection('leads').get();
  console.log(`-> ${leadsSnap.size} prospectos encontrados en el CRM.\n`);

  const leadByProspectId = new Map();
  const leadByPhone = new Map();

  leadsSnap.forEach((doc) => {
    const data = doc.data();
    const pid = data.smartHomeProspectId || data.metadata?.smarthomeProspectId;
    if (pid) leadByProspectId.set(pid, { id: doc.id, data });
    const pk = phoneKey(data.phone);
    if (pk && !leadByPhone.has(pk)) leadByPhone.set(pk, { id: doc.id, data });
  });

  // 4. Estadísticas por asesor
  const advisorStats = {};
  function getAdvKey(s) {
    const name = shUserMap.get(s.ownerId) || s.ownerName || s.advisorName || 'Sin Asesor Asignado';
    return name.trim();
  }

  // 5. Procesar cada prospecto con su propio batch seguro
  console.log('4. Sincronizando datos, fichas técnicas y bitácoras en paralelo...');
  let updatedLeadsCount = 0;
  let createdLeadsCount = 0;
  let totalNotesWritten = 0;
  let leadsWithNotesCount = 0;

  const CONCURRENCY = 8;
  let index = 0;

  async function processOne(s) {
    const advName = getAdvKey(s);
    if (!advisorStats[advName]) {
      advisorStats[advName] = {
        prospects: 0,
        notes: 0,
        stages: {},
        latestCreated: '',
      };
    }
    advisorStats[advName].prospects++;
    const stage = s.stageName || 'Sin etapa';
    advisorStats[advName].stages[stage] = (advisorStats[advName].stages[stage] || 0) + 1;
    if (s.createdDate && (!advisorStats[advName].latestCreated || s.createdDate > advisorStats[advName].latestCreated)) {
      advisorStats[advName].latestCreated = s.createdDate;
    }

    // Identificar o crear lead
    let leadRef = null;
    let leadId = null;
    let existingData = null;

    if (s.prospectId && leadByProspectId.has(s.prospectId)) {
      const match = leadByProspectId.get(s.prospectId);
      leadId = match.id;
      existingData = match.data;
      leadRef = db.collection('companies').doc(COMPANY_ID).collection('leads').doc(leadId);
    } else {
      const pk = phoneKey(s.mobileNumber) || phoneKey(s.phoneNumber) || phoneKey(s.secondPhoneNumber);
      if (pk && leadByPhone.has(pk)) {
        const match = leadByPhone.get(pk);
        leadId = match.id;
        existingData = match.data;
        leadRef = db.collection('companies').doc(COMPANY_ID).collection('leads').doc(leadId);
      }
    }

    // Resolver UID del asesor en CRM
    let assignedToUid = null;
    const cleanAdv = cleanAdvisorName(advName);
    if (crmUserMap.has(cleanAdv)) {
      assignedToUid = crmUserMap.get(cleanAdv);
    }

    // Batch propio para este prospecto (máx 35 operaciones)
    const batch = db.batch();

    // Si no existe en CRM, creamos el lead
    if (!leadRef) {
      leadRef = db.collection('companies').doc(COMPANY_ID).collection('leads').doc();
      leadId = leadRef.id;
      createdLeadsCount++;

      const isClosed = /promesa|escritur|vendid/i.test(s.stageName || '') || /cierre/i.test(s.saleCycleName || '');
      const rawPhone = s.mobileNumber || s.phoneNumber || s.secondPhoneNumber || '';
      const cleanPhone = rawPhone.startsWith('+') ? rawPhone : (rawPhone.length === 10 ? `+57${rawPhone}` : rawPhone);

      const newDoc = {
        name: `${s.firstName || ''} ${s.lastName || ''}`.trim() || 'Prospecto SmartHome',
        phone: cleanPhone,
        email: s.email || '',
        identificationNumber: s.identificationNumber || '',
        city: s.city || '',
        address: s.address || '',
        source: 'smarthome',
        status: isClosed ? 'closed' : 'active',
        projectInterest: s.project ? [s.project] : ['Laguna Mar'],
        assignedTo: assignedToUid || null,
        smartHomeProspectId: s.prospectId || '',
        smartHomeCustomerId: s.customerId || '',
        smartHomeProjectCode: s.projectCode || '',
        smartHomeProject: s.project || '',
        smartHomeModule: s.module || '',
        smartHomeAdvisorName: advName,
        smartHomeStageName: s.stageName || '',
        smartHomeSaleCycle: s.saleCycleName || '',
        smartHomeFound: true,
        aiEnabled: false,
        aiTakeoverSlaStatus: 'compliant',
        aiTakeoverSlaExempt: true,
        createdAt: s.createdDate ? parseEventDate(s.createdDate) : admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
        metadata: {
          importedFromSmartHome: true,
          smartHomeCreatedDate: s.createdDate || null,
        },
      };

      batch.set(leadRef, newDoc);
      existingData = newDoc;
    } else {
      updatedLeadsCount++;
    }

    // Consultar eventos de bitácora en SmartHome
    const events = s.prospectId ? (await sh.getSmartHomeProspectEvents(s.prospectId, s.projectCode)) : null;
    const bitacoras = (events || []).map((e) => ({
      action: e.action || 'Seguimiento',
      count: 1,
      lastDate: e.date ? e.date.replace('T', ' ').slice(0, 16) : '',
      description: e.content ? `${e.action && !e.system ? `[${e.action}] ` : ''}${e.content}` : e.action || 'Nota',
      system: !!e.system,
      userId: e.userId || null,
    }));

    // Cargar notas existentes en subcolección para no duplicar
    const existingTimestamps = new Set();
    const notesSnap = await db.collection('companies').doc(COMPANY_ID).collection('leads').doc(leadId).collection('notes').get();
    notesSnap.forEach((nd) => {
      const ca = nd.data().createdAt;
      if (ca && typeof ca.toMillis === 'function') {
        existingTimestamps.add(ca.toMillis());
      }
    });

    let notesAddedForThisLead = 0;
    let latestEvent = null;

    if (events && events.length > 0) {
      latestEvent = events[0];
      for (const e of events) {
        if (!e.content && !e.action) continue;

        const ts = parseEventDate(e.date);
        const ms = ts.toMillis();
        if (existingTimestamps.has(ms)) continue;
        existingTimestamps.add(ms);

        let noteAuthor = advName;
        const authorMatch = (e.content || '').match(/Registrado por:\s*([^\n\r]+)/i);
        if (authorMatch && authorMatch[1]) {
          noteAuthor = authorMatch[1].trim();
        }

        const actionType = classifyActionType(e.action, e.content);
        let cleanText = (e.content || e.action || '').trim();
        cleanText = cleanText.replace(/Registrado por:[^\n\r]+\n?/gi, '').trim();

        const noteRef = db.collection('companies').doc(COMPANY_ID).collection('leads').doc(leadId).collection('notes').doc();
        batch.set(noteRef, {
          companyId: COMPANY_ID,
          leadId,
          authorName: noteAuthor,
          text: cleanText || e.content || 'Gestión registrada en SmartHome',
          actionType,
          result: e.action || 'Gestión SmartHome',
          kind: 'note',
          type: 'ficha_tecnica',
          source: 'smarthome_sync',
          createdAt: ts,
          updatedAt: ts,
        });
        notesAddedForThisLead++;
        totalNotesWritten++;
      }
    }

    if (notesAddedForThisLead > 0 || (events && events.length > 0)) {
      leadsWithNotesCount++;
      advisorStats[advName].notes += (events ? events.length : 0);
    }

    // Actualizar metadata y ficha técnica del lead
    const metadataUpdate = {
      ...(existingData?.metadata || {}),
      smarthomeBitacoras: bitacoras,
      smarthomeProspectId: s.prospectId || existingData?.smartHomeProspectId || '',
      smarthomeCustomerId: s.customerId || existingData?.smartHomeCustomerId || '',
      smarthomeAsesorOriginal: advName,
      smarthomeCicloVenta: s.saleCycleName || '',
      smarthomeEstadoSeguimiento: s.stageName || '',
      smartHomeModule: s.module || '',
      smartHomeModuleCode: s.moduleCode || '',
      smartHomeTotalValue: s.totalValue || 0,
      smartHomeOfferPrice: s.offerPrice || 0,
      smartHomeDeposit: s.deposit || 0,
      smarthomeSyncedAt: new Date().toISOString(),
    };

    const leadRootUpdate = {
      metadata: metadataUpdate,
      smartHomeProspectId: s.prospectId || existingData?.smartHomeProspectId || '',
      smartHomeCustomerId: s.customerId || existingData?.smartHomeCustomerId || '',
      smartHomeProjectCode: s.projectCode || existingData?.smartHomeProjectCode || '',
      smartHomeProject: s.project || existingData?.smartHomeProject || '',
      smartHomeAdvisorName: advName,
      smartHomeStageName: s.stageName || '',
      smartHomeSaleCycle: s.saleCycleName || '',
      smartHomeFound: true,
      smartHomeFollowUps: bitacoras.length,
      updatedAt: admin.firestore.Timestamp.now(),
    };

    if (assignedToUid && !existingData?.assignedTo) {
      leadRootUpdate.assignedTo = assignedToUid;
    }
    if (s.module) {
      leadRootUpdate.smartHomeModule = s.module;
    }
    if (latestEvent) {
      leadRootUpdate.smartHomeLastBitacoraAt = parseEventDate(latestEvent.date);
      leadRootUpdate.smartHomeLastBitacoraText = latestEvent.content || latestEvent.action || '';
    }

    batch.set(leadRef, leadRootUpdate, { merge: true });
    await batch.commit();
  }

  // Ejecución en paralelo con control de concurrencia
  const total = sales.length;
  async function worker() {
    while (index < total) {
      const currentIndex = index++;
      const s = sales[currentIndex];
      try {
        await processOne(s);
      } catch (err) {
        console.error(`Error procesando prospecto ${s.prospectId}:`, err.message);
      }
      if ((currentIndex + 1) % 50 === 0 || currentIndex + 1 === total) {
        console.log(`[Progreso] ${currentIndex + 1}/${total} prospectos sincronizados (${(((currentIndex + 1) / total) * 100).toFixed(1)}%)...`);
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  const durationSec = ((Date.now() - tStart) / 1000).toFixed(1);
  console.log('\n=== SINCRONIZACIÓN COMPLETADA CON ÉXITO ===');
  console.log(`Tiempo total: ${durationSec}s`);
  console.log(`Prospectos procesados: ${total}`);
  console.log(`Leads actualizados en CRM: ${updatedLeadsCount}`);
  console.log(`Nuevos leads creados en CRM: ${createdLeadsCount}`);
  console.log(`Nuevas notas de Ficha Técnica creadas: ${totalNotesWritten}`);
  console.log(`Leads con bitácoras activas: ${leadsWithNotesCount}\n`);

  console.log('--- RESUMEN POR ASESOR EN SMARTHOME ---');
  const sortedAdvisors = Object.entries(advisorStats).sort((a, b) => b[1].prospects - a[1].prospects);
  for (const [name, stats] of sortedAdvisors) {
    console.log(`\n• ${name}:`);
    console.log(`   - Total Prospectos: ${stats.prospects}`);
    console.log(`   - Bitácoras/Eventos: ${stats.notes}`);
    console.log(`   - Última creación: ${stats.latestCreated || 'N/A'}`);
    console.log(`   - Etapas: ${Object.entries(stats.stages).map(([k, v]) => `${k} (${v})`).join(', ')}`);
  }
}

run().catch((err) => {
  console.error('Error fatal en sincronización:', err);
  process.exit(1);
});
