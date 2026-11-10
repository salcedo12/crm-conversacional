/**
 * unify_all_duplicate_leads.js
 *
 * Unifica todos los números duplicados en companies/grupo_meraki_real/leads
 * Criterio de Asesor: ACTIVIDAD MÁS RECIENTE (según instrucción del usuario).
 *
 * Características de seguridad:
 * - Modo Dry-Run (--dry-run) por defecto.
 * - Concurrencia controlada (10 workers paralelos) para Firestore.
 * - Respaldo en backups/duplicate_unification_backup_<timestamp>.json antes de aplicar cambios.
 * - Copia completa de notas, mensajes y negocios hacia el lead maestro.
 * - Retiro de índices de búsqueda telefónica del duplicado para que el CRM muestre solo 1 contacto.
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

const COMPANY_ID = 'grupo_meraki_real';

function getTimestampMillis(val) {
  if (!val) return 0;
  if (val.toMillis) return val.toMillis();
  if (val._seconds) return val._seconds * 1000 + Math.floor((val._nanoseconds || 0) / 1e6);
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }
  return 0;
}

function getMostRecentActivity(lead) {
  const candidates = [
    getTimestampMillis(lead.lastMessageAt),
    getTimestampMillis(lead.lastAdvisorMessageAt),
    getTimestampMillis(lead.lastInboundAt),
    getTimestampMillis(lead.lastFichaAt),
    getTimestampMillis(lead.updatedAt),
    getTimestampMillis(lead.createdAt),
  ];
  return Math.max(...candidates);
}

function phoneKey(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

async function run() {
  const isLive = process.argv.includes('--live');
  console.log('='.repeat(70));
  console.log(` UNIFICACIÓN DE PROSPECTOS DUPLICADOS EN ${COMPANY_ID}`);
  console.log(` MODO: ${isLive ? '🚀 EN VIVO (LIVE)' : '🔍 SIMULACIÓN (DRY-RUN)'}`);
  console.log(' Criterio Asesor: ACTIVIDAD MÁS RECIENTE');
  console.log('='.repeat(70));

  // 1. Cargar usuarios del CRM
  const usersSnap = await db.collection('companies').doc(COMPANY_ID).collection('users').get();
  const userMap = new Map();
  usersSnap.forEach((u) => {
    const ud = u.data();
    userMap.set(u.id, {
      name: ud.displayName || ud.name || ud.email || u.id,
      email: ud.email,
      active: ud.active !== false,
    });
  });

  // 2. Cargar todos los leads
  console.log('\n1. Consultando leads en Firestore...');
  const leadsSnap = await db.collection('companies').doc(COMPANY_ID).collection('leads').get();
  console.log(`-> Total leads en base de datos: ${leadsSnap.size}`);

  // Agrupar por cola de teléfono (10 dígitos)
  const phoneGroups = new Map();
  leadsSnap.forEach((doc) => {
    const data = doc.data();
    // Ignorar los que ya fueron unificados/descartados
    if (data.status === 'discarded' && (data.tags || []).includes('duplicado-unificado')) return;
    if (String(data.phoneTail || '').startsWith('unificado_')) return;

    const tail = phoneKey(data.phone || data.normalizedPhone || data.phoneTail);
    if (!tail || tail.length < 7) return;

    if (!phoneGroups.has(tail)) phoneGroups.set(tail, []);
    phoneGroups.get(tail).push({ id: doc.id, ...data });
  });

  const duplicateGroups = [];
  phoneGroups.forEach((leads, tail) => {
    if (leads.length > 1) {
      duplicateGroups.push({ tail, leads });
    }
  });

  console.log(`-> Grupos duplicados pendientes: ${duplicateGroups.length}`);

  if (duplicateGroups.length === 0) {
    console.log('No hay duplicados pendientes por unificar. Todo limpio.');
    return;
  }

  // 3. Evaluar plan de unificación
  let countSameAdvisor = 0;
  let countExAdvisorOrUnassigned = 0;
  let countDiffActiveAdvisor = 0;
  let countNeitherAdvisor = 0;

  const plan = [];

  for (const group of duplicateGroups) {
    const leads = group.leads;

    // Calcular actividad y scoring para cada lead
    const scoredLeads = leads.map((lead) => {
      const hasMsgs = !!(lead.lastMessageText || lead.lastMessageAt);
      const isSm = lead.id.startsWith('sm_');
      const recentTs = getMostRecentActivity(lead);
      const advId = lead.assignedTo || lead.advisorId || null;
      const advInfo = advId ? userMap.get(advId) : null;
      const isAdvActive = !!(advInfo && !advInfo.name.toLowerCase().includes('sin asignar'));

      // Puntos de prioridad para ser el Lead Maestro
      let masterScore = 0;
      if (hasMsgs) masterScore += 1000;
      if (!isSm) masterScore += 200; // Preferir ID nativo del CRM
      if (lead.status && lead.status !== 'lost' && lead.status !== 'discarded') masterScore += 50;
      if (isAdvActive) masterScore += 30;

      return {
        id: lead.id,
        lead,
        hasMsgs,
        isSm,
        recentTs,
        advId,
        advName: advInfo ? advInfo.name : (lead.advisorName || 'Sin asignar'),
        isAdvActive,
        masterScore,
      };
    });

    // Ordenar para elegir al Maestro: mayor masterScore, y en empate mayor recentTs
    scoredLeads.sort((a, b) => {
      if (b.masterScore !== a.masterScore) return b.masterScore - a.masterScore;
      return b.recentTs - a.recentTs;
    });

    const master = scoredLeads[0];
    const secondaries = scoredLeads.slice(1);

    // Resolver Asesor según: ACTIVIDAD MÁS RECIENTE
    const leadsWithActiveAdv = scoredLeads.filter((sl) => sl.isAdvActive);
    const uniqueActiveAdvIds = new Set(leadsWithActiveAdv.map((s) => s.advId).filter(Boolean));

    let chosenAdvisorId = null;
    let chosenAdvisorName = null;
    let advisorDecisionReason = '';

    if (uniqueActiveAdvIds.size > 1) {
      // Diferentes asesores activos: gana el que tenga recentTs más reciente
      leadsWithActiveAdv.sort((a, b) => b.recentTs - a.recentTs);
      const winner = leadsWithActiveAdv[0];
      chosenAdvisorId = winner.advId;
      chosenAdvisorName = winner.advName;
      advisorDecisionReason = `Elegido ${winner.advName} por actividad más reciente (${new Date(winner.recentTs).toISOString()})`;
      countDiffActiveAdvisor++;
    } else if (uniqueActiveAdvIds.size === 1) {
      const winner = leadsWithActiveAdv[0];
      chosenAdvisorId = winner.advId;
      chosenAdvisorName = winner.advName;
      if (leadsWithActiveAdv.length === scoredLeads.length) {
        advisorDecisionReason = `Mismo asesor ${winner.advName}`;
        countSameAdvisor++;
      } else {
        advisorDecisionReason = `Asesor activo ${winner.advName} (el otro lead no tenía asesor activo o era ex-asesor)`;
        countExAdvisorOrUnassigned++;
      }
    } else {
      // Ninguno tiene asesor activo
      chosenAdvisorId = null;
      chosenAdvisorName = 'Sin asignar';
      advisorDecisionReason = 'Ambos sin asesor activo';
      countNeitherAdvisor++;
    }

    plan.push({
      tail: group.tail,
      master,
      secondaries,
      chosenAdvisorId,
      chosenAdvisorName,
      advisorDecisionReason,
    });
  }

  console.log('\n--- RESUMEN DEL PLAN DE UNIFICACIÓN ---');
  console.log(`Total grupos a unificar: ${plan.length}`);
  console.log(`- Mismo asesor: ${countSameAdvisor}`);
  console.log(`- Uno activo y otro ex-asesor/sin asignar: ${countExAdvisorOrUnassigned}`);
  console.log(`- Diferentes asesores activos (resuelto por actividad reciente): ${countDiffActiveAdvisor}`);
  console.log(`- Ninguno con asesor activo: ${countNeitherAdvisor}`);

  if (!isLive) {
    console.log('\n[DRY-RUN] Muestra de 5 unificaciones planeadas:');
    plan.slice(0, 5).forEach((p, idx) => {
      console.log(`\n#${idx + 1} Teléfono tail: ${p.tail}`);
      console.log(`   Maestro: [${p.master.id}] ${p.master.lead.name || 'Sin nombre'} (Asesor actual: ${p.master.advName})`);
      p.secondaries.forEach((s) => {
        console.log(`   Secundario a absorber: [${s.id}] ${s.lead.name || 'Sin nombre'} (Asesor: ${s.advName})`);
      });
      console.log(`   -> Asesor resultante: ${p.chosenAdvisorName} | Motivo: ${p.advisorDecisionReason}`);
    });

    console.log('\nPara ejecutar la unificación real en Firestore, ejecuta:');
    console.log('node scripts/unify_all_duplicate_leads.js --live\n');
    return;
  }

  // 4. MODO LIVE: Crear backup local primero
  console.log('\n💾 Creando respaldo local antes de modificar Firestore...');
  const backupsDir = path.join(__dirname, '../backups');
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
  const backupFile = path.join(backupsDir, `duplicate_unification_backup_${Date.now()}.json`);
  
  const backupData = plan.map((p) => ({
    tail: p.tail,
    master: { id: p.master.id, data: p.master.lead },
    secondaries: p.secondaries.map((s) => ({ id: s.id, data: s.lead })),
    chosenAdvisorId: p.chosenAdvisorId,
    chosenAdvisorName: p.chosenAdvisorName,
  }));
  fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2), 'utf8');
  console.log(`-> Respaldo guardado con éxito en: ${backupFile}`);

  // 5. Ejecutar la unificación con concurrencia controlada
  console.log('\n🚀 Iniciando unificación masiva en Firestore...');
  let processed = 0;
  let successCount = 0;
  let errorCount = 0;

  const tStart = Date.now();

  async function processOneGroup(item) {
    const masterId = item.master.id;
    const mRef = db.doc(`companies/${COMPANY_ID}/leads/${masterId}`);
    const mData = item.master.lead;

    try {
      let combinedTags = new Set(mData.tags || []);
      let mergedCustomFields = { ...(mData.customFields || {}) };
      let mergedMetadata = { ...(mData.metadata || {}) };
      let secondaryIds = [];
      let bestName = mData.name;

      for (const sec of item.secondaries) {
        const sId = sec.id;
        const sData = sec.lead;
        secondaryIds.push(sId);

        (sData.tags || []).forEach((t) => combinedTags.add(t));
        mergedCustomFields = { ...(sData.customFields || {}), ...mergedCustomFields };
        mergedMetadata = { ...(sData.metadata || {}), ...mergedMetadata };

        const mNameClean = String(bestName || '').toLowerCase().trim();
        const sNameClean = String(sData.name || '').toLowerCase().trim();
        const isGenericM = !bestName || mNameClean.startsWith('lead +') || mNameClean === '.' || mNameClean === 'prueba de pruebas correo';
        const isBetterS = sData.name && !sNameClean.startsWith('lead +') && sNameClean !== '.';
        if (isGenericM && isBetterS) {
          bestName = sData.name;
        }

        // 1. Copiar notas/fichas técnicas del secundario al maestro
        const sNotesSnap = await db.collection(`companies/${COMPANY_ID}/leads/${sId}/notes`).get();
        if (!sNotesSnap.empty) {
          for (const nDoc of sNotesSnap.docs) {
            const nd = nDoc.data();
            await mRef.collection('notes').add({
              ...nd,
              companyId: COMPANY_ID,
              leadId: masterId,
              source: `unified_from_${sId}`,
              unifiedAt: admin.firestore.Timestamp.now(),
            });
          }
        }

        // 2. Copiar mensajes si existieran en el secundario
        const sMsgsSnap = await db.collection(`companies/${COMPANY_ID}/leads/${sId}/messages`).get();
        if (!sMsgsSnap.empty) {
          for (const mDoc of sMsgsSnap.docs) {
            const md = mDoc.data();
            await mRef.collection('messages').add({
              ...md,
              companyId: COMPANY_ID,
              leadId: masterId,
              source: `unified_from_${sId}`,
            });
          }
        }

        // 3. Reasignar deals/negocios si estuvieran apuntando al secundario
        const dealsSnap = await db.collection(`companies/${COMPANY_ID}/deals`).where('leadId', '==', sId).get();
        if (!dealsSnap.empty) {
          for (const dDoc of dealsSnap.docs) {
            await dDoc.ref.update({
              leadId: masterId,
              updatedAt: admin.firestore.Timestamp.now(),
              'metadata.reassignedFromDuplicate': sId,
            });
          }
        }

        // 4. Desactivar y limpiar índices de búsqueda del secundario
        const sRef = db.doc(`companies/${COMPANY_ID}/leads/${sId}`);
        await sRef.update({
          status: 'discarded',
          tags: admin.firestore.FieldValue.arrayUnion('duplicado-unificado'),
          isArchived: true,
          isDuplicateUnified: true,
          phone: `unificado_${sData.phone || ''}`,
          normalizedPhone: `unificado_${sData.normalizedPhone || sData.phone || ''}`,
          phoneTail: `unificado_${sData.phoneTail || phoneKey(sData.phone) || ''}`,
          'metadata.mergedInto': masterId,
          'metadata.mergedAt': admin.firestore.Timestamp.now(),
          'metadata.mergeReason': `Unificado con ${masterId} (${item.advisorDecisionReason})`,
          'metadata.originalPhone': sData.phone || null,
          'metadata.originalNormalizedPhone': sData.normalizedPhone || null,
          'metadata.originalPhoneTail': sData.phoneTail || null,
        });
      }

      // 5. Actualizar el Lead Maestro
      const masterUpdate = {
        name: bestName,
        tags: Array.from(combinedTags),
        customFields: mergedCustomFields,
        metadata: {
          ...mergedMetadata,
          unifiedFromDuplicates: secondaryIds,
          unifiedAt: admin.firestore.Timestamp.now(),
        },
        updatedAt: admin.firestore.Timestamp.now(),
      };

      if (item.chosenAdvisorId && item.chosenAdvisorId !== mData.assignedTo) {
        masterUpdate.assignedTo = item.chosenAdvisorId;
        masterUpdate.assignmentStatus = 'assigned';
        masterUpdate.advisorAssignedAt = admin.firestore.Timestamp.now();
      }

      await mRef.update(masterUpdate);

      // 6. Bitácora de auditoría en el Lead Maestro
      await mRef.collection('notes').add({
        companyId: COMPANY_ID,
        leadId: masterId,
        kind: 'note',
        type: 'audit',
        actionType: 'unificacion_duplicado',
        text: `🔄 Prospecto Unificado Automáticamente: Se fusionaron ${secondaryIds.length} registro(s) duplicado(s) (${secondaryIds.join(', ')}). Asesor asignado: ${item.chosenAdvisorName} (${item.advisorDecisionReason}).`,
        authorId: 'system',
        authorName: 'Sistema Meraki (Unificación)',
        createdAt: admin.firestore.Timestamp.now(),
      });

      successCount++;
    } catch (err) {
      console.error(`Error unificando grupo ${item.tail} (Master: ${masterId}):`, err.message);
      errorCount++;
    }

    processed++;
    if (processed % 50 === 0 || processed === plan.length) {
      const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
      console.log(`Progreso: ${processed}/${plan.length} grupos procesados (${successCount} OK, ${errorCount} errores) en ${elapsed}s`);
    }
  }

  // Ejecutar con concurrencia de 10
  const CONCURRENCY = 10;
  for (let i = 0; i < plan.length; i += CONCURRENCY) {
    const chunk = plan.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map((item) => processOneGroup(item)));
  }

  const totalTime = ((Date.now() - tStart) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(70));
  console.log(` UNIFICACIÓN COMPLETADA EN ${totalTime}s`);
  console.log(` Exitosos: ${successCount}`);
  console.log(` Errores: ${errorCount}`);
  console.log('='.repeat(70));
}

run().catch(console.error);
