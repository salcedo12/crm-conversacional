const path = require('path');
const admin = require(path.resolve(__dirname, '../functions/node_modules/firebase-admin'));
const sa = require(path.resolve(__dirname, '../service-account.json'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(sa)
  });
}
const db = admin.firestore();

const MERAKI_OFFICIAL_ADVISORS = [
  'Alexander Zuluaga Santacruz',
  'Edwin Mauricio Ramirez Vega',
  'Luis Carlos Machado Tovar',
  'Isabel Betancourth',
  'Karen Ramirez',
  'Oscar Eduardo Narvaez Rojas',
  'Claudia Patricia Bolaños Vega',
  'Juana María Ávila Rojas',
  'Luisa Fernanda Zuluaga Mejia',
  'Adriana Montaña Cortez',
  'Adriana Garzón Osorio',
];

function normalizeStr(str) {
  return (str || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function isAdvisorMatch(candidate, official) {
  const c = normalizeStr(candidate);
  const o = normalizeStr(official);
  if (!c || !o) return false;
  if (c === o) return true;
  if (c.includes(o) || o.includes(c)) return true;

  const cTokens = c.split(/\s+/).filter(Boolean);
  const oTokens = o.split(/\s+/).filter(Boolean);

  let matches = 0;
  for (const token of cTokens) {
    if (token.length > 2 && oTokens.includes(token)) {
      matches++;
    }
  }
  if (matches >= 2) return true;

  const significantToken = oTokens.find(t => t.length > 5);
  if (significantToken && c.includes(significantToken)) {
    return true;
  }
  return false;
}

function cleanDigits(val) {
  const s = String(val ?? '').replace(/\D/g, '');
  if (s.length === 10) return s;
  if (s.length === 12 && s.startsWith('57')) return s.slice(2);
  if (s.length > 10 && s.startsWith('57')) return s.slice(-10);
  return s;
}

function parseDateAny(val) {
  if (!val) return null;
  if (val.toDate && typeof val.toDate === 'function') return val.toDate();
  if (val._seconds) return new Date(val._seconds * 1000);
  if (typeof val === 'number') return new Date(val);
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function isRealCommercialFollowUp(rawAction, rawText) {
  if (!rawAction && !rawText) return false;

  const aNorm = normalizeStr(rawAction);
  const dNorm = normalizeStr(rawText);

  // Excepción importante: Eventos que SmartHome rotuló genéricamente como "Evento del Sistema" o "CAPTACIÓN"
  // pero cuyo contenido es una anotación comercial escrita por un asesor
  const isAdvisorEventInSystem =
    (aNorm === 'evento del sistema' || aNorm === 'captacion') &&
    (dNorm.includes('registrado por:') ||
      dNorm.includes('cliente asiste') ||
      dNorm.includes('cliente no asiste') ||
      dNorm.includes('cita programada') ||
      dNorm.includes('ofrece servicio') ||
      dNorm.includes('agendo cita') ||
      dNorm.includes('se agendo'));

  // 1. Descartar acciones de creación o sistema si no contienen anotación comercial de asesor
  if (!isAdvisorEventInSystem) {
    if (
      aNorm === 'evento del sistema' ||
      aNorm === 'captacion' ||
      aNorm === 'sistema' ||
      aNorm === 'registro api' ||
      aNorm === 'cargue masivo' ||
      aNorm === 'asignacion automatica' ||
      aNorm === 'actualizacion automatica'
    ) {
      return false;
    }
  }

  // 2. Si el texto tiene menos de 4 caracteres o es vacío
  if (!dNorm || dNorm.length < 4) return false;

  // 3. Descartar textos automáticos generados por el sistema o por la creación del prospecto
  if (
    dNorm.includes('se agrega el cliente al sistema') ||
    dNorm.includes('se agrega el prospecto al sistema') ||
    dNorm.includes('se inicia el seguimiento para el modulo') ||
    dNorm.includes('registro api') ||
    dNorm.includes('registro automatico enviado desde crm') ||
    dNorm.includes('se ha actualizado la informacion') ||
    dNorm.includes('atendido en whatsapp') ||
    dNorm.includes('se ha actualizado el detalle de la oportunidad') ||
    dNorm.includes('se ha cambiado el ciclo de venta') ||
    dNorm.includes('se ha cambiado la probabilidad') ||
    dNorm.includes('se ha actualizado el valor') ||
    dNorm.includes('la empresa razon social cambio') ||
    dNorm.includes('la empresa cambio de') ||
    dNorm.includes('la ciudad cambio') ||
    dNorm.includes('el nombre cambio') ||
    dNorm.includes('el apellido cambio') ||
    dNorm.includes('actualizacion automatica') ||
    dNorm.includes('cargue masivo') ||
    dNorm.includes('asignacion automatica') ||
    dNorm.includes('webhook') ||
    dNorm.includes('infile') ||
    dNorm.includes('arkdia')
  ) {
    return false;
  }

  return true;
}

async function run() {
  const companyId = 'grupo_meraki_real';
  const startPeriod = new Date('2026-10-24T00:00:00-05:00');
  const endPeriod = new Date('2026-10-28T23:59:59-05:00');
  const startTs = admin.firestore.Timestamp.fromDate(startPeriod);
  const endTs = admin.firestore.Timestamp.fromDate(endPeriod);

  // 1. Cargar usuarios
  const usersSnap = await db.collection('companies').doc(companyId).collection('users').get();
  const allUsersList = [];
  usersSnap.docs.forEach(d => {
    const u = d.data();
    if (u.disabled) return;
    const rawName = u.displayName || u.email || '';
    allUsersList.push({ id: d.id, name: rawName, normName: normalizeStr(rawName), email: u.email || '', role: u.role });
  });

  const advisorsMap = new Map();
  MERAKI_OFFICIAL_ADVISORS.forEach(officialName => {
    const normOfficial = normalizeStr(officialName);
    const matchedUser = allUsersList.find(u => {
      if (u.role === 'admin') return false;
      return isAdvisorMatch(u.normName, normOfficial);
    });
    const advId = matchedUser ? matchedUser.id : `official_${normOfficial.replace(/\s+/g, '_')}`;
    advisorsMap.set(advId, {
      id: advId,
      name: officialName,
      normName: normOfficial,
      email: matchedUser ? matchedUser.email : ''
    });
  });

  const advisorsList = Array.from(advisorsMap.values());

  const resolveAdvisor = val => {
    if (!val) return null;
    const byId = advisorsMap.get(val);
    if (byId) return { id: byId.id, name: byId.name };
    const userById = allUsersList.find(u => u.id === val);
    if (userById) {
      if (userById.role === 'admin') return null;
      const matchOfficial = advisorsList.find(a => isAdvisorMatch(userById.normName, a.normName));
      if (matchOfficial) return { id: matchOfficial.id, name: matchOfficial.name };
    }
    const match = advisorsList.find(a => isAdvisorMatch(val, a.normName));
    if (match) return { id: match.id, name: match.name };
    return null;
  };

  // 2. Consultar leads del periodo
  const leadsRef = db.collection('companies').doc(companyId).collection('leads');
  const periodSnap = await leadsRef
    .where('createdAt', '>=', startTs)
    .where('createdAt', '<=', endTs)
    .get();

  console.log(`Leads creados en período (docs brutos): ${periodSnap.size}`);

  // 3. Consultar leads con lastFollowUpAt en el periodo
  let lfuSnapDocs = [];
  try {
    const lfuSnap = await leadsRef
      .where('lastFollowUpAt', '>=', startTs)
      .where('lastFollowUpAt', '<=', endTs)
      .get();
    lfuSnapDocs = lfuSnap.docs;
    console.log(`Leads con lastFollowUpAt en período: ${lfuSnap.size}`);
  } catch (e) {
    console.warn('lastFollowUpAt query warning:', e.message);
  }

  // 4. Armar mapa único de leads
  const uniqueLeadsMap = new Map();
  periodSnap.docs.forEach(doc => {
    uniqueLeadsMap.set(doc.id, { id: doc.id, ...doc.data(), isPeriodCreated: true });
  });
  lfuSnapDocs.forEach(doc => {
    if (!uniqueLeadsMap.has(doc.id)) {
      uniqueLeadsMap.set(doc.id, { id: doc.id, ...doc.data(), isPeriodCreated: false });
    }
  });

  // Deduplicación de captaciones por asesor
  const seenPeriodPhonesByAdvisor = new Map();
  const captSemanaMap = new Map();
  const periodLeadsByAdv = new Map();

  periodSnap.docs.forEach(docSnap => {
    const l = docSnap.data();
    const resolvedAdv = resolveAdvisor(l.assignedTo || l.smartHomeAdvisorName);
    const advId = resolvedAdv ? resolvedAdv.id : (l.assignedTo || 'unassigned');

    const rawPhoneDigits = cleanDigits(l.phone || l.normalizedPhone);
    const phoneKey = rawPhoneDigits || `doc_${docSnap.id}`;

    if (!seenPeriodPhonesByAdvisor.has(advId)) {
      seenPeriodPhonesByAdvisor.set(advId, new Set());
    }
    const advPhones = seenPeriodPhonesByAdvisor.get(advId);
    if (advPhones.has(phoneKey)) {
      // Prospecto duplicado (ej. Meta + WhatsApp)
      return;
    }
    advPhones.add(phoneKey);
    captSemanaMap.set(advId, (captSemanaMap.get(advId) || 0) + 1);

    if (!periodLeadsByAdv.has(advId)) periodLeadsByAdv.set(advId, []);
    periodLeadsByAdv.get(advId).push({
      docId: docSnap.id,
      name: l.name,
      phone: l.phone || l.normalizedPhone,
      source: l.source || l.metadata?.fuente,
      project: l.project || l.metadata?.['¿qué_proyecto_te_interesa_más?']
    });
  });

  // 5. Analizar Bitácoras de CRM y SmartHome
  const advisorNewLeadsManagedMap = new Map();
  const advisorOldClientsManagedMap = new Map();
  const advisorManagedDetails = new Map();
  const unmanagedPeriodLeadsByAdv = new Map();

  for (const [leadId, lead] of uniqueLeadsMap.entries()) {
    const createdAt = parseDateAny(lead.createdAt);
    const isNew = createdAt ? createdAt >= startPeriod && createdAt <= endPeriod : !!lead.isPeriodCreated;

    const clientPhoneDigits = cleanDigits(lead.phone || lead.normalizedPhone);
    const clientUniqueKey = clientPhoneDigits ? `phone_${clientPhoneDigits}` : leadId;

    const rawBitacoras = [
      ...(Array.isArray(lead.bitacoras) ? lead.bitacoras : []),
      ...(Array.isArray(lead.metadata?.smarthomeBitacoras) ? lead.metadata.smarthomeBitacoras : [])
    ];

    // Deduplicar bitácoras por acción + fecha + descripción
    const bitacoras = [];
    const seenBitKeys = new Set();
    for (const b of rawBitacoras) {
      const bDate = b.fecha || b.lastDate || b.date || '';
      const bKey = `${b.action || ''}_${bDate}_${b.description || ''}`;
      if (!seenBitKeys.has(bKey)) {
        seenBitKeys.add(bKey);
        bitacoras.push(b);
      }
    }

    let hadFollowUp = false;
    let followUpAuthor = lead.assignedTo || lead.smartHomeAdvisorName || 'Desconocido';
    let followUpNote = '';
    let followUpAction = '';

    for (const b of bitacoras) {
      const bDateStr = b.fecha || b.lastDate || b.date;
      if (!bDateStr) continue;
      const bDate = parseDateAny(bDateStr);
      if (bDate && bDate >= startPeriod && bDate <= endPeriod) {
        const desc = (b.description || b.action || '').trim();
        if (isRealCommercialFollowUp(b.action, b.description)) {
          hadFollowUp = true;
          if (b.asesor) followUpAuthor = b.asesor;
          followUpNote = desc;
          followUpAction = b.action || 'bitacora_comercial';
          break; // Con una interacción real en la semana es suficiente para acreditar seguimiento
        }
      }
    }

    // Fallback: lastFollowUpAt
    if (!hadFollowUp && lead.lastFollowUpAt) {
      const lfu = parseDateAny(lead.lastFollowUpAt);
      if (lfu && lfu >= startPeriod && lfu <= endPeriod) {
        const action = lead.lastFollowUpAction || '';
        const desc = (lead.lastFollowUpSummary || lead.lastFollowUpAction || '').trim();
        if (isRealCommercialFollowUp(action, desc)) {
          hadFollowUp = true;
          if (lead.lastFollowUpAuthor) followUpAuthor = lead.lastFollowUpAuthor;
          followUpNote = desc;
          followUpAction = action || 'seguimiento_crm';
        }
      }
    }

    // Comprobación de subcolección 'notes' para leads nuevos sin bitácora detectada
    if (!hadFollowUp && isNew) {
      const notesSnap = await leadsRef.doc(leadId).collection('notes').get();
      if (!notesSnap.empty) {
        for (const nd of notesSnap.docs) {
          const nData = nd.data();
          const nDate = parseDateAny(nData.createdAt || nData.date);
          if (nDate && nDate >= startPeriod && nDate <= endPeriod) {
            const rawAction = nData.actionType || nData.result || 'nota_ficha_tecnica';
            const rawNote = nData.content || nData.text || '';
            if (isRealCommercialFollowUp(rawAction, rawNote)) {
              hadFollowUp = true;
              followUpAuthor = nData.author || nData.authorName || lead.assignedTo;
              followUpNote = rawNote;
              followUpAction = rawAction;
              break;
            }
          }
        }
      }
    }

    if (hadFollowUp) {
      const resolvedAdv = resolveAdvisor(followUpAuthor || lead.assignedTo);
      const advId = resolvedAdv ? resolvedAdv.id : (lead.assignedTo || 'unassigned');

      if (!advisorManagedDetails.has(advId)) advisorManagedDetails.set(advId, []);
      advisorManagedDetails.get(advId).push({
        leadId,
        clientKey: clientUniqueKey,
        name: lead.name || 'Sin Nombre',
        phone: lead.phone || lead.normalizedPhone,
        isNew,
        action: followUpAction,
        note: followUpNote
      });

      if (isNew) {
        if (!advisorNewLeadsManagedMap.has(advId)) advisorNewLeadsManagedMap.set(advId, new Set());
        advisorNewLeadsManagedMap.get(advId).add(clientUniqueKey);
      } else {
        if (!advisorOldClientsManagedMap.has(advId)) advisorOldClientsManagedMap.set(advId, new Set());
        advisorOldClientsManagedMap.get(advId).add(clientUniqueKey);
      }
    } else if (isNew) {
      const resolvedAdv = resolveAdvisor(lead.assignedTo || lead.smartHomeAdvisorName);
      const advId = resolvedAdv ? resolvedAdv.id : (lead.assignedTo || 'unassigned');
      if (!unmanagedPeriodLeadsByAdv.has(advId)) unmanagedPeriodLeadsByAdv.set(advId, []);
      unmanagedPeriodLeadsByAdv.get(advId).push({
        leadId,
        name: lead.name || 'Sin Nombre',
        phone: lead.phone || lead.normalizedPhone,
        source: lead.source || lead.metadata?.fuente || 'Sin Fuente',
        pipelineStage: lead.pipelineStage || lead.stage || 'Sin Estado',
        totalBitacorasCount: rawBitacoras.length
      });
    }
  }

  // 6. Imprimir informe detallado asesor por asesor
  console.log('\n========================================================================================');
  console.log('AUDITORÍA RIGUROSA DE SEGUIMIENTOS Y FICHAS TÉCNICAS (11 ASESORES OFICIALES MERAKI)');
  console.log('========================================================================================\n');

  let totalCaptaciones = 0;
  let totalNuevosConSeg = 0;
  let totalAnterioresConSeg = 0;

  for (const adv of advisorsList) {
    const capt = captSemanaMap.get(adv.id) || 0;
    const nuevosSegSet = advisorNewLeadsManagedMap.get(adv.id) || new Set();
    const nuevosSeg = nuevosSegSet.size;
    const antSegSet = advisorOldClientsManagedMap.get(adv.id) || new Set();
    const antSeg = antSegSet.size;
    const totalAtendidos = nuevosSeg + antSeg;
    const cov = capt > 0 ? ((nuevosSeg / capt) * 100).toFixed(1) : '0.0';

    totalCaptaciones += capt;
    totalNuevosConSeg += nuevosSeg;
    totalAnterioresConSeg += antSeg;

    const managedList = advisorManagedDetails.get(adv.id) || [];
    const unmanagedList = unmanagedPeriodLeadsByAdv.get(adv.id) || [];

    console.log(`----------------------------------------------------------------------------------------`);
    console.log(`📌 ASESOR: ${adv.name.toUpperCase()} (ID: ${adv.id})`);
    console.log(`   * Captaciones Únicas Semana: ${capt}`);
    console.log(`   * Leads Nuevos con Seguimiento Real: ${nuevosSeg} (Cobertura: ${cov}%)`);
    console.log(`   * Clientes Anteriores con Gestión: ${antSeg}`);
    console.log(`   * Total Clientes Gestionados en la Semana: ${totalAtendidos}`);
    console.log(`   --- SEGUIMIENTOS REALIZADOS EN LA SEMANA (Muestra): ---`);
    if (managedList.length === 0) {
      console.log(`       [Sin seguimientos registrados en la semana]`);
    } else {
      managedList.slice(0, 4).forEach((m, idx) => {
        const tipo = m.isNew ? 'NUEVO' : 'ANTERIOR';
        console.log(`       ${idx + 1}. [${tipo}] ${m.name} (${m.phone}): [${m.action}] "${(m.note || '').slice(0, 80)}"`);
      });
      if (managedList.length > 4) {
        console.log(`       ... y ${managedList.length - 4} gestiones más.`);
      }
    }

    if (unmanagedList.length > 0) {
      console.log(`   --- LEADS DE LA SEMANA SIN SEGUIMIENTO (${unmanagedList.length}): ---`);
      unmanagedList.slice(0, 4).forEach((u, idx) => {
        console.log(`       ${idx + 1}. ${u.name} (${u.phone}) | Fuente: ${u.source} | Etapa: ${u.pipelineStage} (Bitácoras totales: ${u.totalBitacorasCount})`);
      });
      if (unmanagedList.length > 4) {
        console.log(`       ... y ${unmanagedList.length - 4} prospectos más.`);
      }
    }
  }

  console.log('\n========================================================================================');
  console.log('RESUMEN CONSOLIDADO EQUIPO COMERCIAL MERAKI');
  console.log('========================================================================================');
  console.log(`- Total Captaciones Únicas Semana: ${totalCaptaciones}`);
  console.log(`- Total Nuevos con Seguimiento Real: ${totalNuevosConSeg}`);
  console.log(`- Porcentaje de Cobertura de Nuevos: ${((totalNuevosConSeg / totalCaptaciones) * 100).toFixed(1)}%`);
  console.log(`- Total Clientes Anteriores Gestionados: ${totalAnterioresConSeg}`);
  console.log(`- Total General de Clientes Atendidos en la Semana: ${totalNuevosConSeg + totalAnterioresConSeg}`);
  console.log('========================================================================================\n');
}

run().catch(console.error);
