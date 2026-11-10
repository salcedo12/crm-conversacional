/**
 * sync_recent_smarthome_prospects.js
 *
 * Sincroniza todos los prospectos nuevos y actualizados desde el jueves (2026-10-22)
 * hasta hoy (2026-10-26) desde SmartHome hacia Meraki CRM:
 *   1. Consulta /api/v1/getProspects/ac00771c/?startDate=2026-10-22
 *   2. Obtiene las bitácoras completas (getProspectEvents) de cada uno.
 *   3. Si el prospecto no existe en el CRM (como Gloria), lo crea con su ficha técnica,
 *      agenda de eventos (nextFollowUpDate), módulo de interés y asesor asignado.
 *   4. Si ya existe, actualiza su ficha, agrega las nuevas notas a su subcolección `notes`
 *      y sincroniza su bitácora en `metadata.smarthomeBitacoras`.
 */

const admin = require('../functions/node_modules/firebase-admin');
const sa = require('../service-account.json');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(sa),
    projectId: 'crm-conversacional',
  });
}
const db = admin.firestore();
const env = require('../functions/lib/config/env.js').env;

const COMPANY_ID = 'grupo_meraki_real';
const START_DATE = '2026-10-22';

function phoneKey(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : d;
}

function normalizePhone(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10) return `+57${d}`;
  if (d.length === 12 && d.startsWith('57')) return `+${d}`;
  return `+${d}`;
}

function cleanAdvisorName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeProject(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('laguna') || n.includes('mar')) return 'Laguna Mar';
  if (n.includes('arizona') || n.includes('cañon') || n.includes('canon')) return 'Cañon de Arizona';
  if (n.includes('claro') || n.includes('rio')) return 'Rio Claro';
  if (n.includes('montaña') || n.includes('montanas')) return 'Sobre Montañas';
  if (n.includes('llano') || n.includes('grande')) return 'Llano Grande';
  return name || 'Laguna Mar';
}

function parseDateToTimestamp(val) {
  if (!val) return admin.firestore.Timestamp.now();
  const d = new Date(val);
  if (!isNaN(d.getTime())) {
    return admin.firestore.Timestamp.fromDate(d);
  }
  return admin.firestore.Timestamp.now();
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

async function fetchEvents(base, comp, code, prospectId) {
  const url = `${base}/api/v1/getProspectEvents/${comp}/${code}/${prospectId}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const data = await res.json();
    return data.events || [];
  } catch (err) {
    // Try other project codes if this one fails
    const otherCodes = ['48c9266a', '17c89d4e', '5ad1b166'].filter(c => c !== code);
    for (const altCode of otherCodes) {
      try {
        const altUrl = `${base}/api/v1/getProspectEvents/${comp}/${altCode}/${prospectId}`;
        const altRes = await fetch(altUrl, { signal: AbortSignal.timeout(10000) });
        if (altRes.ok) {
          const altData = await altRes.json();
          if (altData.events && altData.events.length > 0) return altData.events;
        }
      } catch (_) {}
    }
    return [];
  }
}

async function run() {
  console.log(`=== SINCRONIZACIÓN DE PROSPECTOS SMARTHOME DESDE ${START_DATE} ===\n`);
  const t0 = Date.now();

  const base = env.smartHomeApiBase();
  const comp = env.smartHomeCompany();

  // 1. Cargar catálogo de usuarios de CRM
  console.log('1. Cargando usuarios del CRM...');
  const usersSnap = await db.collection('companies').doc(COMPANY_ID).collection('users').get();
  const crmUserMap = new Map(); // cleanName -> { uid, name, email }
  usersSnap.forEach((d) => {
    const u = d.data();
    const info = { uid: d.id, name: u.displayName || u.name || d.id, email: u.email || '' };
    if (u.displayName) crmUserMap.set(cleanAdvisorName(u.displayName), info);
    if (u.email) crmUserMap.set(u.email.toLowerCase().trim(), info);
  });
  console.log(`-> ${crmUserMap.size} usuarios indexados en CRM.`);

  // 2. Cargar prospectos existentes en CRM (por teléfono y por smartHomeProspectId)
  console.log('\n2. Indexando prospectos existentes en CRM...');
  const leadsSnap = await db.collection('companies').doc(COMPANY_ID).collection('leads').get();
  const phoneToLeadMap = new Map();
  const shIdToLeadMap = new Map();

  leadsSnap.forEach((d) => {
    const data = d.data();
    const pk = phoneKey(data.phone);
    if (pk) phoneToLeadMap.set(pk, { id: d.id, ref: d.ref, data });
    if (data.smartHomeProspectId) shIdToLeadMap.set(data.smartHomeProspectId, { id: d.id, ref: d.ref, data });
  });
  console.log(`-> ${leadsSnap.size} prospectos en CRM indexados.`);

  // 3. Consultar SmartHome /api/v1/getProspects/?startDate=2026-10-22
  console.log(`\n3. Consultando SmartHome prospects desde ${START_DATE}...`);
  const firstRes = await fetch(`${base}/api/v1/getProspects/${comp}/?startDate=${START_DATE}`);
  const firstData = await firstRes.json();
  const totalPages = firstData.pages || 1;
  const allProspects = [...(firstData.records || [])];

  for (let p = 2; p <= totalPages; p++) {
    const res = await fetch(`${base}/api/v1/getProspects/${comp}/?startDate=${START_DATE}&page=${p}`);
    const d = await res.json();
    if (d.records) allProspects.push(...d.records);
  }
  console.log(`-> Obtenidos ${allProspects.length} prospectos en ${totalPages} páginas desde SmartHome.\n`);

  // 4. Procesar cada prospecto: crear o actualizar con sus bitácoras
  let createdCount = 0;
  let updatedCount = 0;
  let notesCount = 0;

  for (let i = 0; i < allProspects.length; i++) {
    const p = allProspects[i];
    const rawPhone = p.mobileNumber || p.phoneNumber || '';
    const cleanPhone = normalizePhone(rawPhone);
    const pk = phoneKey(rawPhone);
    const prospectId = p.prospectId;

    // Buscar si ya existe
    let existing = null;
    if (prospectId && shIdToLeadMap.has(prospectId)) {
      existing = shIdToLeadMap.get(prospectId);
    } else if (pk && phoneToLeadMap.has(pk)) {
      existing = phoneToLeadMap.get(pk);
    }

    // Identificar asesor
    const cleanOwner = cleanAdvisorName(p.owner);
    const advisorInfo = crmUserMap.get(cleanOwner) || null;
    const assignedUid = advisorInfo ? advisorInfo.uid : null;
    const assignedName = advisorInfo ? advisorInfo.name : (p.owner || 'Sin asignar');

    // Determinar código de proyecto
    let projectCode = '48c9266a';
    if (p.projectId) {
      if (p.projectId.startsWith('17c89d4e')) projectCode = '17c89d4e';
      else if (p.projectId.startsWith('5ad1b166')) projectCode = '5ad1b166';
    }
    const projectName = normalizeProject(p.project);

    // Obtener eventos / bitácora de SmartHome
    const rawEvents = prospectId ? await fetchEvents(base, comp, projectCode, prospectId) : [];
    // Ordenar eventos cronológicamente desc (el más reciente primero)
    rawEvents.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // Analizar eventos: detectar última gestión y próximas acciones agendadas
    let latestEventDate = p.lastUpdate || p.createdDate || null;
    let latestEventAction = p.lastAction || 'Captación';
    let latestEventContent = p.customerName ? `Gestión SmartHome para ${p.unit || ''}` : '';
    let latestAuthor = p.owner || assignedName;

    let scheduledDate = null;
    let scheduledAction = null;

    if (rawEvents.length > 0) {
      const topEv = rawEvents[0];
      latestEventDate = topEv.date || latestEventDate;
      latestEventAction = topEv.action || latestEventAction;
      latestEventContent = topEv.content || latestEventContent;

      for (const ev of rawEvents) {
        if (ev.startTime) {
          const stDate = new Date(ev.startTime);
          const evDate = new Date(ev.date || 0);
          // Si tiene startTime en el futuro o agendado después de la creación del evento
          if (!isNaN(stDate.getTime()) && stDate.getTime() > evDate.getTime() + 60000) {
            scheduledDate = ev.startTime.replace('T', ' ').slice(0, 16);
            scheduledAction = ev.action || 'Llamada Programada';
            break;
          }
        }
      }
    }

    // Construir bitacoras para metadata.smarthomeBitacoras
    const bitacoras = rawEvents.map((ev) => ({
      action: ev.action || 'Seguimiento',
      count: 1,
      lastDate: ev.date ? ev.date.replace('T', ' ').slice(0, 16) : '',
      description: ev.content ? `${ev.action ? `[${ev.action}] ` : ''}${ev.content}` : (ev.action || 'Nota'),
      system: false,
      asesor: p.owner || assignedName,
      fecha: ev.date ? ev.date.replace('T', ' ').slice(0, 16) : '',
      hora: ev.date ? ev.date.slice(11, 16) : '',
      userId: ev.userId || null,
    }));

    // Determinar si está cancelado o cerrado
    const isLost = /cancelad|no interesad|desistim|descartad/i.test(`${p.saleCycle || ''} ${p.stage || ''} ${latestEventAction} ${latestEventContent}`);
    const isClosed = /promesa|escritur|vendid/i.test(p.stage || '') || /cierre/i.test(p.saleCycle || '');

    const leadRef = existing ? existing.ref : db.collection('companies').doc(COMPANY_ID).collection('leads').doc();
    const leadId = leadRef.id;

    const leadUpdate = {
      name: p.customerName?.trim() || 'Prospecto SmartHome',
      phone: cleanPhone || existing?.data?.phone || 'Sin teléfono',
      normalizedPhone: cleanPhone ? (cleanPhone.startsWith('+') ? cleanPhone : ('+' + cleanPhone)) : '',
      phoneTail: pk || '',
      project: projectName,
      unit: p.unit || existing?.data?.unit || '',
      email: p.email || existing?.data?.email || '',
      identificationNumber: p.identificationNumber || existing?.data?.identificationNumber || '',
      city: p.city || existing?.data?.city || '',
      address: p.address || existing?.data?.address || '',
      source: existing?.data?.source || 'smarthome',
      fuenteUbicacion: p.locationSourceCustomer || p.locationSourceProspect || existing?.data?.fuenteUbicacion || 'Trabajo de campo',
      status: isLost ? 'lost' : (isClosed ? 'closed' : (existing?.data?.status || 'active')),
      pipelineStage: isLost ? 'lost' : (isClosed ? 'closed' : (existing?.data?.pipelineStage || 'qualified')),
      projectInterest: [projectName],
      assignedTo: assignedUid || existing?.data?.assignedTo || null,
      assignedToName: assignedName,
      assignedAdvisorName: assignedName,
      smartHomeProspectId: prospectId || existing?.data?.smartHomeProspectId || '',
      smartHomeCustomerId: p.customerId || existing?.data?.smartHomeCustomerId || '',
      smartHomeProjectCode: projectCode,
      smartHomeProject: p.project || '',
      smartHomeModule: p.unit || existing?.data?.smartHomeModule || '',
      smartHomeAdvisorName: p.owner || assignedName,
      smartHomeStageName: p.stage || '',
      smartHomeSaleCycle: p.saleCycle || '',
      smartHomeFound: true,
      aiEnabled: false,
      aiTakeoverSlaStatus: 'compliant',
      aiTakeoverSlaExempt: true,
      hasFicha: true,
      lastFollowUpAt: latestEventDate ? parseDateToTimestamp(latestEventDate) : null,
      lastFollowUpAction: latestEventAction || null,
      lastFollowUpSummary: latestEventContent || null,
      lastFollowUpAuthor: latestAuthor || assignedName,
      nextFollowUpDate: scheduledDate || existing?.data?.nextFollowUpDate || null,
      nextFollowUpAction: scheduledAction || existing?.data?.nextFollowUpAction || null,
      lastMessageAt: parseDateToTimestamp(latestEventDate || p.createdDate),
      updatedAt: admin.firestore.Timestamp.now(),
      metadata: {
        ...(existing?.data?.metadata || {}),
        importedFromSmartHome: true,
        smartHomeCreatedDate: p.createdDate || null,
        smartHomeLastUpdate: p.lastUpdate || null,
        smarthomeBitacoras: bitacoras.length > 0 ? bitacoras : (existing?.data?.metadata?.smarthomeBitacoras || []),
        hasFicha: true,
        project: projectName,
        unit: p.unit || '',
        fuenteUbicacion: p.locationSourceCustomer || p.locationSourceProspect || 'Trabajo de campo',
      },
    };

    if (!existing) {
      leadUpdate.createdAt = parseDateToTimestamp(p.createdDate);
      await leadRef.set(leadUpdate);
      createdCount++;
      // Actualizar mapa en memoria
      if (pk) phoneToLeadMap.set(pk, { id: leadId, ref: leadRef, data: leadUpdate });
      if (prospectId) shIdToLeadMap.set(prospectId, { id: leadId, ref: leadRef, data: leadUpdate });
      console.log(`[+] CREADO: ${p.customerName} (${cleanPhone}) | Asesor: ${assignedName} | Proj: ${projectName} ${p.unit || ''} | Próx: ${scheduledDate || 'Sin cita'}`);
    } else {
      await leadRef.set(leadUpdate, { merge: true });
      updatedCount++;
      console.log(`[~] ACTUALIZADO: ${p.customerName} (${cleanPhone}) | Asesor: ${assignedName} | Bitácoras: ${bitacoras.length}`);
    }

    // Escribir notas en subcolección `leads/{leadId}/notes`
    if (rawEvents.length > 0) {
      const notesCol = db.collection('companies').doc(COMPANY_ID).collection('leads').doc(leadId).collection('notes');
      const existingNotesSnap = await notesCol.get();
      const existingContentSet = new Set();
      existingNotesSnap.forEach(nd => {
        const d = nd.data();
        if (d.content) existingContentSet.add(d.content.trim());
      });

      for (const ev of rawEvents) {
        const text = (ev.content || ev.action || '').trim();
        if (!text || existingContentSet.has(text)) continue;

        const actionType = classifyActionType(ev.action, ev.content);
        const noteDoc = {
          content: ev.content ? `${ev.action ? `[${ev.action}] ` : ''}${ev.content}` : (ev.action || 'Nota'),
          actionType,
          authorName: p.owner || assignedName,
          createdAt: parseDateToTimestamp(ev.date),
          updatedAt: parseDateToTimestamp(ev.date),
          scheduledDate: ev.startTime || null,
          system: !!ev.system,
          source: 'smarthome',
          smarthomeEventId: ev.eventId || null,
        };

        await notesCol.add(noteDoc);
        existingContentSet.add(text);
        notesCount++;
      }
    }
  }

  const durationSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\n======================================================');
  console.log(`SINCRONIZACIÓN EXITOSA en ${durationSec}s:`);
  console.log(`- Prospectos creados nuevos: ${createdCount}`);
  console.log(`- Prospectos actualizados: ${updatedCount}`);
  console.log(`- Notas/Bitácoras sincronizadas: ${notesCount}`);
  console.log('======================================================\n');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error en sincronización:', err);
    process.exit(1);
  });
