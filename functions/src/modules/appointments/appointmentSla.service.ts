import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';
import { logger } from '../../utils/logger';
import { leadsRepository } from '../leads/leads.repository';
import { pickAdvisorForLead, markAdvisorTurnUsed } from '../leads/leadAssignment.service';
import { sendAdvisorPush } from '../messages/pushNotifications.service';

const appointmentsCol = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('appointments');

const usersCol = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('users');

const messagesCol = (companyId: string, leadId: string) =>
  db.collection('companies').doc(companyId).collection('leads').doc(leadId).collection('messages');

export interface SlaConfig {
  slaEnabled: boolean;              // Master toggle
  preCitaMinutes: number;           // Minutos antes de la cita para auditar contacto previo (default: 30)
  preCitaLookbackHours: number;     // Horas previas para verificar si escribió (default: 2)
  preCitaReassignEnabled: boolean;  // Reasignar cita a otro asesor disponible por Round-Robin (default: true)
  preCitaBlockAdvisor: boolean;     // Pausar recepción de leads al asesor moroso (default: true)
  postCitaMinutes: number;          // Minutos tras finalizar cita para reportar Ficha Técnica (default: 60)
  postCitaBlockAdvisor: boolean;    // Pausar recepción de leads si no reporta Ficha Técnica a tiempo (default: true)
  postCitaRequireEvidence: boolean; // Exigir evidencia obligatoria si cliente no asistió (default: true)
  manualTakeoverHours: number;      // Horas tras apagar la IA para agendar cita o llenar Ficha Técnica (default: 24)
  manualTakeoverBlockAdvisor: boolean; // Pausar recepción de leads / marcar en mora tras 24h sin Ficha Técnica (default: true)
}

export const DEFAULT_SLA_CONFIG: SlaConfig = {
  slaEnabled: false,
  preCitaMinutes: 30,
  preCitaLookbackHours: 2,
  preCitaReassignEnabled: false,
  preCitaBlockAdvisor: false,
  postCitaMinutes: 60,
  postCitaBlockAdvisor: false,
  postCitaRequireEvidence: false,
  manualTakeoverHours: 24,
  manualTakeoverBlockAdvisor: false,
};

export async function getCompanySlaConfig(companyId: string): Promise<SlaConfig> {
  const doc = await db.collection('companies').doc(companyId).collection('config').doc('sla').get();
  if (!doc.exists) return DEFAULT_SLA_CONFIG;
  return { ...DEFAULT_SLA_CONFIG, ...doc.data() } as SlaConfig;
}

export async function saveCompanySlaConfig(companyId: string, patch: Partial<SlaConfig>): Promise<SlaConfig> {
  const ref = db.collection('companies').doc(companyId).collection('config').doc('sla');
  await ref.set(patch, { merge: true });
  return getCompanySlaConfig(companyId);
}

export async function unblockAdvisorManual(
  companyId: string,
  advisorId: string,
  adminId: string,
  adminName: string,
  reason?: string
): Promise<void> {
  await usersCol(companyId).doc(advisorId).update({
    isBlockedForLeads: false,
    blockedReason: null,
    unresolvedAppointmentId: null,
    unresolvedLeadId: null,
    unresolvedLeadName: null,
    unblockedAt: Timestamp.now(),
    unblockedBy: adminId,
    unblockedByName: adminName,
    unblockReason: reason || 'Desbloqueo manual por administrador',
  });
  await db.collection('companies').doc(companyId).collection('auditLogs').add({
    action: 'unblock_advisor',
    adminId,
    adminName,
    advisorId,
    reason: reason || 'Desbloqueo manual por administrador',
    createdAt: Timestamp.now(),
  }).catch(() => {});
  logger.info('[AppointmentSLA] Asesor desbloqueado manualmente por admin', { companyId, advisorId, adminId });
}

export async function listBlockedAdvisors(companyId: string): Promise<any[]> {
  const snap = await usersCol(companyId)
    .where('isBlockedForLeads', '==', true)
    .get();
  return snap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      displayName: data.displayName || data.name || data.email,
      email: data.email,
      role: data.role,
      receiveLeads: data.receiveLeads !== false && data.excludeFromLeadAssignment !== true,
      blockedReason: data.blockedReason,
      blockedAt: data.blockedAt?.toDate?.()?.toISOString() || null,
      unresolvedAppointmentId: data.unresolvedAppointmentId || null,
      unresolvedLeadId: data.unresolvedLeadId || null,
      unresolvedLeadName: data.unresolvedLeadName || null,
    };
  });
}

/**
 * SLA PRE-CITA:
 * Verifica citas que iniciarán en los próximos X minutos (según config).
 * Si el asesor asignado no ha enviado ningún mensaje al lead en las últimas Y horas,
 * la cita se reasigna a otro asesor disponible por Round-Robin y se bloquea preventivamente al moroso.
 */
export async function checkPreCitaSla(companyId: string): Promise<number> {
  const config = await getCompanySlaConfig(companyId);
  if (!config.slaEnabled) return 0;

  const now = new Date();
  const preCitaMin = Math.max(5, config.preCitaMinutes || 30);
  const lookbackHours = Math.max(1, config.preCitaLookbackHours || 2);
  const inPreCita = new Date(now.getTime() + preCitaMin * 60_000);
  const lookbackAgo = new Date(now.getTime() - lookbackHours * 3600_000);

  const snap = await appointmentsCol(companyId)
    .where('status', '==', 'scheduled')
    .where('startTime', '>=', Timestamp.fromDate(now))
    .where('startTime', '<=', Timestamp.fromDate(inPreCita))
    .get();

  let reasignadas = 0;

  for (const doc of snap.docs) {
    const appt = doc.data();
    if (appt.reassignedPreCita || !appt.advisorId || !appt.leadId || appt.isInternalReminder || appt.source === 'ficha_tecnica') continue;

    // Verificar si el asesor escribió al cliente en la ventana de lookback
    const msgsSnap = await messagesCol(companyId, appt.leadId)
      .where('direction', '==', 'outbound')
      .where('senderType', '==', 'advisor')
      .where('createdAt', '>=', Timestamp.fromDate(lookbackAgo))
      .limit(1)
      .get();

    const yaLeEscribio = !msgsSnap.empty;

    if (!yaLeEscribio) {
      const previousAdvisorId = appt.advisorId;

      logger.warn('[AppointmentSLA] Asesor no contactó al cliente antes de la cita. Procesando novedades.', {
        companyId,
        appointmentId: doc.id,
        leadId: appt.leadId,
        previousAdvisorId,
      });

      let newAdvisorId: string | null = null;

      if (config.preCitaReassignEnabled) {
        // 1. Reasignar a otro asesor activo por Round-Robin (excluyendo al moroso)
        newAdvisorId = await pickAdvisorForLead(companyId, {
          exclude: [previousAdvisorId],
        });

        if (newAdvisorId) {
          await leadsRepository.update(companyId, appt.leadId, {
            assignedTo: newAdvisorId,
            advisorAssignedAt: Timestamp.now(),
          });
          await markAdvisorTurnUsed(companyId, newAdvisorId);
        }

        // 2. Actualizar la cita con el nuevo asesor
        await doc.ref.update({
          advisorId: newAdvisorId || previousAdvisorId,
          reassignedPreCita: true,
          previousAdvisorId,
          reassignedAt: Timestamp.now(),
        });
      }

      // 3. Bloquear preventivamente al asesor incumplido si está habilitado
      if (config.preCitaBlockAdvisor) {
        await usersCol(companyId).doc(previousAdvisorId).update({
          isBlockedForLeads: true,
          blockedReason: `SLA_PRE_CITA_${preCitaMin}M`,
          blockedAt: Timestamp.now(),
          unresolvedAppointmentId: doc.id,
        }).catch((e) => logger.error('[AppointmentSLA] Error bloqueando asesor', e));
      }

      // 4. Notificar de urgencia al nuevo asesor si fue reasignado
      if (newAdvisorId) {
        const lead = await leadsRepository.findById(companyId, appt.leadId);
        const leadName = lead?.name || 'Cliente';
        await sendAdvisorPush(companyId, newAdvisorId, {
          title: `🚨 Cita urgente reasignada (En ${preCitaMin} min)`,
          body: `Se te ha reasignado la cita con ${leadName} porque el asesor previo no se reportó.`,
          url: `/dashboard/calendar?lead=${appt.leadId}`,
          type: 'urgent_reassignment',
          leadId: appt.leadId,
        }).catch(() => {});
      }

      reasignadas++;
    }
  }

  return reasignadas;
}

/**
 * SLA POST-CITA:
 * Verifica citas cuya hora pactada finalizó hace más de X minutos (según config) y cuya Ficha Técnica no fue reportada.
 * Si hay mora, se bloquea la entrada de nuevos leads al asesor (sale del Round-Robin).
 */
export async function checkPostCitaSla(companyId: string): Promise<number> {
  const config = await getCompanySlaConfig(companyId);
  if (!config.slaEnabled) return 0;

  const now = new Date();
  const postCitaMin = Math.max(5, config.postCitaMinutes || 60);
  const postCitaAgo = new Date(now.getTime() - postCitaMin * 60_000);

  const snap = await appointmentsCol(companyId)
    .where('status', '==', 'scheduled')
    .where('endTime', '<=', Timestamp.fromDate(postCitaAgo))
    .get();

  let bloqueados = 0;

  for (const doc of snap.docs) {
    const appt = doc.data();
    // Si ya reportó, no tiene asesor o es seguimiento interno de ficha técnica, ignorar
    if (appt.attended !== undefined || appt.postCitaStatus === 'reported' || !appt.advisorId || appt.isInternalReminder || appt.source === 'ficha_tecnica') continue;

    // Marcar mora en la cita
    await doc.ref.update({
      postCitaStatus: 'overdue',
    });

    if (config.postCitaBlockAdvisor) {
      // Activar bloqueo de recepción de leads al asesor
      await usersCol(companyId).doc(appt.advisorId).update({
        isBlockedForLeads: true,
        blockedReason: `SLA_POST_CITA_${postCitaMin}M`,
        blockedAt: Timestamp.now(),
        unresolvedAppointmentId: doc.id,
      });

      // Enviar alerta Push al asesor
      await sendAdvisorPush(companyId, appt.advisorId, {
        title: '⚠️ Recepción de leads pausada',
        body: `Ha vencido el plazo de ${postCitaMin} minutos para reportar la Ficha Técnica de tu cita. Diligénciala para reactivarte.`,
        url: `/dashboard/calendar?lead=${appt.leadId}`,
        type: 'sla_block',
        leadId: appt.leadId,
      }).catch(() => {});

      bloqueados++;
    }
  }

  return bloqueados;
}

/**
 * SLA TOMA DE CONTROL MANUAL (AL APAGAR LA IA — 24 HORAS):
 * Verifica leads donde el asesor apagó la IA (`aiEnabled == false` y `aiTakeoverSlaStatus == 'pending'`)
 * hace más de X horas (default 24h) sin haber registrado una Ficha Técnica ni agendado cita posterior.
 * Si hay mora, pausa la recepción de leads al asesor (o lo marca en alerta de mora) hasta que llene la Ficha Técnica.
 */
export async function checkManualTakeoverSla(companyId: string): Promise<number> {
  const config = await getCompanySlaConfig(companyId);
  if (!config.slaEnabled) return 0;

  const now = new Date();
  const hoursLimit = Math.max(1, config.manualTakeoverHours || 24);
  const cutoffDate = new Date(now.getTime() - hoursLimit * 3600_000);
  const cutoffTimestamp = Timestamp.fromDate(cutoffDate);

  const leadsCol = db.collection('companies').doc(companyId).collection('leads');
  const snap = await leadsCol
    .where('aiTakeoverSlaStatus', '==', 'pending')
    .limit(200)
    .get();

  let bloqueados = 0;

  for (const doc of snap.docs) {
    const lead = doc.data();
    // Si la IA ya volvió a encenderse, marcar como compliant
    if (lead.aiEnabled === true) {
      await doc.ref.update({ aiTakeoverSlaStatus: 'compliant' }).catch(() => {});
      continue;
    }

    const disabledAt: Timestamp | undefined = lead.aiDisabledAt;
    if (!disabledAt || disabledAt.toMillis() > cutoffTimestamp.toMillis()) {
      // Aún está dentro del plazo de las 24 horas
      continue;
    }

    // Verificar si ya llenó Ficha Técnica después de apagar la IA
    const lastFollowUp: Timestamp | undefined = lead.lastFollowUpAt;
    if (lastFollowUp && lastFollowUp.toMillis() >= disabledAt.toMillis()) {
      await doc.ref.update({ aiTakeoverSlaStatus: 'compliant' }).catch(() => {});
      continue;
    }

    const advisorId = lead.takeoverBy || lead.assignedTo;
    if (!advisorId) continue;

    const leadName = lead.name || lead.phone || 'Prospecto';

    // Marcar lead en mora de Toma Manual
    await doc.ref.update({
      aiTakeoverSlaStatus: 'overdue',
      aiTakeoverOverdueAt: Timestamp.now(),
    }).catch(() => {});

    if (config.manualTakeoverBlockAdvisor !== false) {
      await usersCol(companyId).doc(advisorId).update({
        isBlockedForLeads: true,
        blockedReason: `SLA_TOMA_MANUAL_${hoursLimit}H (${leadName})`,
        blockedAt: Timestamp.now(),
        unresolvedLeadId: doc.id,
        unresolvedLeadName: leadName,
      }).catch((e) => logger.error('[AppointmentSLA] Error bloqueando asesor por Toma Manual 24h', e));

      await sendAdvisorPush(companyId, advisorId, {
        title: `⚠️ Plazo de ${hoursLimit}h vencido sin Ficha Técnica`,
        body: `Apagaste la IA de ${leadName} hace más de ${hoursLimit}h sin registrar cita ni Ficha Técnica. Llena la Ficha Técnica para reactivar tu recepción de leads.`,
        url: `/dashboard/inbox?lead=${doc.id}`,
        type: 'sla_block_manual_takeover',
        leadId: doc.id,
      }).catch(() => {});

      bloqueados++;
    }
  }

  return bloqueados;
}

/**
 * Desbloquea al asesor una vez diligencia la Ficha Técnica requerida.
 */
export async function unlockAdvisorIfCompliant(companyId: string, advisorId: string): Promise<void> {
  // 1. Verificar si le quedan otras citas vencidas pendientes
  const pendingSnap = await appointmentsCol(companyId)
    .where('advisorId', '==', advisorId)
    .where('postCitaStatus', '==', 'overdue')
    .limit(1)
    .get();

  // 2. Verificar si le quedan leads en mora de Toma Manual (24h sin Ficha Técnica)
  const leadsCol = db.collection('companies').doc(companyId).collection('leads');
  const overdueTakeoverSnap = await leadsCol
    .where('assignedTo', '==', advisorId)
    .where('aiTakeoverSlaStatus', '==', 'overdue')
    .limit(1)
    .get();

  if (pendingSnap.empty && overdueTakeoverSnap.empty) {
    await usersCol(companyId).doc(advisorId).update({
      isBlockedForLeads: false,
      blockedReason: null,
      unresolvedAppointmentId: null,
      unresolvedLeadId: null,
      unresolvedLeadName: null,
      unblockedAt: Timestamp.now(),
    });
    logger.info('[AppointmentSLA] Asesor desbloqueado automáticamente', { companyId, advisorId });
  }
}
