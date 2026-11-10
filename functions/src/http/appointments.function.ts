import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { db } from '../lib/admin';
import { appointmentsRepository } from '../modules/appointments/appointments.repository';
import { bookAppointment, cancelAppointmentById } from '../modules/appointments/appointments.service';
import {
  unlockAdvisorIfCompliant,
  getCompanySlaConfig,
  saveCompanySlaConfig,
  unblockAdvisorManual,
  listBlockedAdvisors,
} from '../modules/appointments/appointmentSla.service';
import { leadsRepository } from '../modules/leads/leads.repository';
import { googleConnectionRepository } from '../modules/calendar/googleConnection.repository';
import { createMeetEvent } from '../integrations/google/google.client';
import { logger } from '../utils/logger';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES, ADMIN_ROLES } from '../lib/authContext';

// ─── listAppointments ──────────────────────────────────────────────────────────
// Devuelve las citas en un rango de fechas (para la vista de calendario).

export const listAppointments = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId, fromISO, toISO } = z.object({
      companyId: z.string().min(1),
      fromISO:   z.string(),
      toISO:     z.string(),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const allAppts = await appointmentsRepository.listInRange(
      companyId, new Date(fromISO), new Date(toISO)
    );
    const appts = (ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role))
      ? allAppts
      : allAppts.filter((appt) => appt.advisorId === ctx.uid);

    // Serializar Timestamps a millis para el cliente
    return {
      appointments: appts.map((a) => ({
        id:             a.id,
        leadId:         a.leadId,
        advisorId:      a.advisorId ?? null,
        leadName:       a.leadName ?? null,
        leadPhone:      a.leadPhone,
        title:          a.title,
        startTime:      a.startTime.toMillis(),
        endTime:        a.endTime.toMillis(),
        googleMeetLink: a.googleMeetLink ?? null,
        status:         a.status,
      })),
    };
  }
);

// ─── listLeadAppointments ────────────────────────────────────────────────────────
// Devuelve las citas de un lead concreto (para el detalle del contacto).

export const listLeadAppointments = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId, leadId } = z.object({
      companyId: z.string().min(1),
      leadId:    z.string().min(1),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const all = await appointmentsRepository.findByLead(companyId, leadId);
    const appts = ((ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role))
      ? all
      : all.filter((appt) => appt.advisorId === ctx.uid)
    ).sort((a, b) => b.startTime.toMillis() - a.startTime.toMillis());

    return {
      appointments: appts.map((a) => ({
        id:             a.id,
        leadId:         a.leadId,
        advisorId:      a.advisorId ?? null,
        leadName:       a.leadName ?? null,
        leadPhone:      a.leadPhone,
        title:          a.title,
        startTime:      a.startTime.toMillis(),
        endTime:        a.endTime.toMillis(),
        googleMeetLink: a.googleMeetLink ?? null,
        status:         a.status,
      })),
    };
  }
);

// ─── cancelAppointment ───────────────────────────────────────────────────────────

export const cancelAppointment = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);
    const { companyId, appointmentId } = z.object({
      companyId:     z.string().min(1),
      appointmentId: z.string().min(1),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const appointment = await appointmentsRepository.findById(companyId, appointmentId);
    if (!appointment) throw new HttpsError('not-found', 'Cita no encontrada.');
    if (!(ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role)) && appointment.advisorId !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Solo puedes cancelar tus citas asignadas.');
    }

    const ok = await cancelAppointmentById(companyId, appointmentId);
    return { ok };
  }
);

// ─── bookAppointmentManual ───────────────────────────────────────────────────────
// Permite a un asesor agendar manualmente desde el CRM.

export const bookAppointmentManual = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);
    const { companyId, leadId, startISO, durationMinutes, title } = z.object({
      companyId:       z.string().min(1),
      leadId:          z.string().min(1),
      startISO:        z.string(),
      durationMinutes: z.number().optional(),
      title:           z.string().optional(),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const lead = await leadsRepository.findById(companyId, leadId);
    if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');
    if (!(ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role)) && lead.assignedTo !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Solo puedes agendar leads asignados a ti.');
    }

    const appt = await bookAppointment({
      companyId, leadId, startTime: new Date(startISO), durationMinutes, title,
    });
    // Si el asesor tenía una toma manual de IA en curso, al agendar cita cumple el SLA de 24h
    await db.collection('companies').doc(companyId).collection('leads').doc(leadId).update({
      aiTakeoverSlaStatus: 'compliant',
      lastFollowUpAt: Timestamp.now(),
    }).catch(() => {});
    await unlockAdvisorIfCompliant(companyId, ctx.uid).catch(() => {});
    return { appointmentId: appt.id, googleMeetLink: appt.googleMeetLink ?? null };
  }
);

// ─── reportAppointmentFicha ───────────────────────────────────────────────────────
// Diligencia la Ficha Técnica de la cita, registra la evidencia, el próximo contacto y
// desbloquea automáticamente al asesor en el motor de SLAs de Round-Robin.

// ─── reportAppointmentFicha ───────────────────────────────────────────────────────
// Diligencia la Ficha Técnica & Seguimiento para CUALQUIER prospecto (o cita de calendario).
// Registra la acción (llamada, información, visita, cita), evidencia, próximo paso obligatorio,
// programa el Recordatorio con fecha/hora y desbloquea al asesor en el motor de SLAs.

export const reportAppointmentFicha = onCall(
  // 1GiB: con 256MiB se quedaba sin memoria al cargar el bundle completo (OOM, oct-2026).
  { region: 'us-central1', timeoutSeconds: 120, memory: '1GiB' },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);
    const schema = z.object({
      companyId:      z.string().min(1),
      leadId:         z.string().optional().nullable(),
      appointmentId:  z.string().optional().nullable(),
      actionType:     z.string().optional().nullable().default('seguimiento_general'),
      result:         z.string().optional().nullable(),
      attended:       z.boolean().optional().nullable().default(true),
      evidenceUrl:    z.string().optional().nullable(),
      nextAction:     z.string().min(1),
      nextActionDate: z.string().optional().nullable(),
      notes:          z.string().optional().nullable(),
      pipelineStage:  z.string().optional().nullable(),
      inviteReferralProgram: z.boolean().optional().nullable(),
      project:        z.string().optional().nullable(),
    });

    const parsed = schema.safeParse(request.data);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new HttpsError('invalid-argument', `Datos incompletos o inválidos en la ficha: ${issues}`);
    }

    const {
      companyId,
      leadId,
      appointmentId,
      actionType = 'seguimiento_general',
      result,
      attended = true,
      evidenceUrl,
      nextAction,
      nextActionDate,
      notes,
      pipelineStage,
      inviteReferralProgram,
      project,
    } = parsed.data;

    assertCompany(ctx, companyId);

    let targetLeadId = leadId || undefined;
    let targetAppt: any = null;

    if (appointmentId) {
      targetAppt = await appointmentsRepository.findById(companyId, appointmentId);
      if (!targetAppt) throw new HttpsError('not-found', 'Cita no encontrada.');

      if (!(ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role)) && targetAppt.advisorId !== ctx.uid) {
        throw new HttpsError('permission-denied', 'Solo puedes reportar tus citas asignadas.');
      }
      targetLeadId = targetLeadId || targetAppt.leadId;

      await appointmentsRepository.update(companyId, appointmentId, {
        attended,
        evidenceUrl: evidenceUrl || null,
        nextAction,
        nextActionDate: nextActionDate || null,
        notes: notes || null,
        postCitaStatus: 'reported',
        status: attended ? 'completed' : 'canceled',
        reportedAt: Timestamp.now(),
      });

      if (targetAppt.advisorId) {
        await unlockAdvisorIfCompliant(companyId, targetAppt.advisorId);
      }
    }

    if (!targetLeadId) {
      throw new HttpsError('invalid-argument', 'Se requiere el ID del prospecto o de la cita.');
    }

    // Resolver nombre legible del asesor
    let authorName = 'Asesor';
    try {
      const uSnap = await db.collection('companies').doc(companyId).collection('users').doc(ctx.uid).get();
      if (uSnap.exists) {
        authorName = (uSnap.data()?.displayName as string) || (uSnap.data()?.email as string) || 'Asesor';
      }
    } catch { /* best effort */ }

    // Obtener datos del lead
    const leadDocRef = db.collection('companies').doc(companyId).collection('leads').doc(targetLeadId);
    const leadSnap = await leadDocRef.get();
    const leadData = leadSnap.exists ? leadSnap.data() : {};
    const leadName = leadData?.name || leadData?.phone || 'Prospecto';
    const leadPhone = leadData?.phone || '';
    const leadProject = (project && project.trim()) || (leadData?.projectInterest && leadData.projectInterest[0]) || leadData?.firstTouch?.project || leadData?.metadata?.webArea || 'Proyecto Meraki';

    // Formatear texto de la acción
    let actionTitle = 'Seguimiento Comercial';
    if (actionType === 'envio_informacion') actionTitle = 'Envío de Información';
    else if (actionType === 'llamada') actionTitle = 'Llamada Telefónica';
    else if (actionType === 'cita_reunion') actionTitle = 'Cita / Videollamada';
    else if (actionType === 'visita_terreno') actionTitle = 'Visita a Terreno / Sala de Ventas';

    const statusSummary = result || (actionType === 'cita_reunion' || actionType === 'visita_terreno'
      ? (attended ? 'Asistió' : 'No asistió (No-Show)')
      : 'Gestión realizada');

    const outcomeText = `📋 FICHA TÉCNICA · ${actionTitle}\n• Resultado: ${statusSummary}\n• Próximo paso: ${nextAction}${nextActionDate ? ` (${nextActionDate})` : ''}${notes ? `\n• Observaciones: ${notes}` : ''}`;

    // 0. Cerrar recordatorios previos pendientes del lead para evitar alarmas o tareas duplicadas
    try {
      const openReminders = await leadDocRef.collection('notes')
        .where('kind', '==', 'reminder')
        .where('done', '==', false)
        .get();
      if (!openReminders.empty) {
        const b = db.batch();
        for (const rDoc of openReminders.docs) {
          b.update(rDoc.ref, { done: true, notified: true, completedAt: Timestamp.now() });
        }
        await b.commit();
      }
    } catch (remErr) {
      logger.warn('[reportAppointmentFicha] Error cerrando recordatorios previos:', { error: String(remErr) });
    }

    // 1. Guardar nota de bitácora en subcolección notes
    try {
      await leadDocRef.collection('notes').add({
        companyId,
        leadId: targetLeadId,
        authorId: ctx.uid,
        authorName,
        text: outcomeText,
        kind: 'note',
        actionType,
        result: statusSummary,
        evidenceUrl: evidenceUrl || null,
        createdAt: Timestamp.now(),
        type: 'ficha_tecnica',
        nextAction,
        nextActionDate: nextActionDate || null,
        notes: notes || null,
        pipelineStage: pipelineStage || null,
      });
    } catch (noteErr) {
      logger.error('[reportAppointmentFicha] Error guardando nota ficha_tecnica en subcolección notes:', {
        companyId,
        leadId: targetLeadId,
        error: String(noteErr),
      });
    }

    // 2. Si se programó próxima fecha/hora, crear RECORDATORIO activo y sincronizar con Google Calendar
    let reminderScheduled = false;
    let googleSyncResult: {
      synced: boolean;
      eventId: string | null;
      meetLink: string | null;
      htmlLink: string | null;
      directCalendarUrl: string;
    } = {
      synced: false,
      eventId: null,
      meetLink: null,
      htmlLink: null,
      directCalendarUrl: '',
    };

    if (nextActionDate) {
      // Si no tiene zona horaria especificada, se asume Colombia (-05:00)
      const cleanNextDate = nextActionDate.includes('Z') || /[+-]\d{2}:\d{2}$/.test(nextActionDate)
        ? nextActionDate
        : (nextActionDate.trim().includes('T') ? nextActionDate.trim() : nextActionDate.trim().replace(' ', 'T')) + '-05:00';
      const dueMillis = Date.parse(cleanNextDate);
      if (!isNaN(dueMillis)) {
        await leadDocRef.collection('notes').add({
          companyId,
          leadId: targetLeadId,
          authorId: ctx.uid,
          authorName,
          text: `⏰ Recordatorio: ${nextAction} con ${leadName}`,
          dueAt: Timestamp.fromMillis(dueMillis),
          kind: 'reminder',
          done: false,
          notified: false,
          createdAt: Timestamp.now(),
          leadName,
          leadPhone,
          project: leadProject,
          nextAction,
          notes: notes || '',
          actionType,
          result: statusSummary,
          assignedTo: leadData?.assignedTo || ctx.uid,
        }).catch(() => {});
        reminderScheduled = true;

        // ── Sincronización Automática con Google Calendar & CRM Appointments ──
        try {
          const isVisita = actionType === 'visita_terreno' || nextAction.toLowerCase().includes('visita');
          const isVirtualCita = actionType === 'cita_reunion' || nextAction.toLowerCase().includes('cita') || nextAction.toLowerCase().includes('zoom') || nextAction.toLowerCase().includes('meet');
          const durationMin = isVisita ? 120 : (isVirtualCita ? 45 : 30);
          const startDate = new Date(dueMillis);
          const endDate = new Date(dueMillis + durationMin * 60_000);

          const eventTitle = `${isVisita ? '📍 VISITA TERRENO' : '📅 CITA'}: ${nextAction} - ${leadName}`;
          const eventLocation = isVisita ? (leadProject || 'Terreno / Sala de Ventas Meraki') : '';
          const eventDescription = `🎯 Acción: ${nextAction}\n👤 Prospecto: ${leadName}\n📱 WhatsApp/Tel: ${leadPhone}\n🏢 Proyecto: ${leadProject}\n${notes ? `📝 Notas: ${notes}\n` : ''}Asesor responsable: ${authorName}\n\nAgendado desde CRM Conversacional Meraki`;

          // URL directa de 1-click para Google Calendar (funciona en móvil y escritorio sin auth previa)
          const formatGDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
          const directUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(eventTitle)}&dates=${formatGDate(startDate)}/${formatGDate(endDate)}&details=${encodeURIComponent(eventDescription)}&location=${encodeURIComponent(eventLocation)}`;
          googleSyncResult.directCalendarUrl = directUrl;

          // Verificar si el asesor tiene Google Calendar conectado vía OAuth
          const googleConn = await googleConnectionRepository.getActive(companyId, ctx.uid);
          let createdGEventId: string | undefined;
          let createdMeetLink: string | undefined;
          let createdHtmlLink: string | undefined;

          if (googleConn) {
            try {
              const ev = await createMeetEvent(googleConn.refreshToken, {
                title: eventTitle,
                description: eventDescription,
                location: eventLocation,
                attendees: [googleConn.email],
                start: startDate,
                end: endDate,
                withMeet: !isVisita, // Enlace de Meet solo para citas virtuales/llamadas
              });
              createdGEventId = ev.eventId ?? undefined;
              createdMeetLink = ev.meetLink ?? undefined;
              createdHtmlLink = ev.htmlLink ?? undefined;
              googleSyncResult.synced = true;
              googleSyncResult.eventId = createdGEventId ?? null;
              googleSyncResult.meetLink = createdMeetLink ?? null;
              googleSyncResult.htmlLink = createdHtmlLink ?? null;
              logger.info('[reportAppointmentFicha] Evento insertado en Google Calendar con alarma en móvil', {
                advisorId: ctx.uid,
                eventId: createdGEventId,
                title: eventTitle,
              });
            } catch (gErr) {
              logger.warn('[reportAppointmentFicha] Error al insertar en Google Calendar del asesor:', { error: String(gErr) });
            }
          }

          // Guardar también en la colección appointments de la empresa para que figure en la agenda CRM
          // IMPORTANTE: Marcamos isInternalReminder: true, source: 'ficha_tecnica' y remindersSent completo
          // para que sea una tarea/seguimiento del asesor y NUNCA le envíe recordatorios de cita al cliente.
          await appointmentsRepository.create({
            companyId,
            leadId: targetLeadId,
            advisorId: ctx.uid,
            leadName,
            leadPhone,
            title: eventTitle,
            description: eventDescription,
            startTime: Timestamp.fromDate(startDate),
            endTime: Timestamp.fromDate(endDate),
            googleEventId: createdGEventId,
            googleMeetLink: createdMeetLink,
            status: 'scheduled',
            source: 'ficha_tecnica',
            isInternalReminder: true,
            remindersSent: { h24: true, h2: true, m30: true },
          }).catch((err) => logger.warn('[reportAppointmentFicha] Error guardando cita en appointments:', { error: String(err) }));

        } catch (syncErr) {
          logger.warn('[reportAppointmentFicha] Error en flujo de sincronización de calendario:', { error: String(syncErr) });
        }
      }
    }

    // 3. Actualizar lead y agregar a historial de bitácoras del documento (Hora Colombia UTC-5)
    const nowFormatted = new Date(Date.now() - 5 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    const descriptionText = `${notes ? notes + ' — ' : ''}Próximo paso: ${nextAction}${nextActionDate ? ` (${nextActionDate})` : ''}`;
    const newBitacoraEntry = {
      id_registro: `crm_${Date.now()}`,
      origen: 'CRM',
      fecha: nowFormatted,
      action: `${actionTitle}: ${statusSummary}`,
      description: descriptionText,
      asesor: authorName,
      lastDate: nowFormatted,
    };

    const rawExistingBitacoras = [
      ...(Array.isArray(leadData?.bitacoras) ? leadData.bitacoras : []),
      ...(Array.isArray(leadData?.metadata?.smarthomeBitacoras) ? leadData.metadata.smarthomeBitacoras : []),
      ...(Array.isArray(leadData?.smarthomeBitacoras) ? leadData.smarthomeBitacoras : []),
    ];
    const seenBitacoraKeys = new Set<string>();
    const existingBitacoras: any[] = [];
    for (const b of rawExistingBitacoras) {
      if (!b || typeof b !== 'object') continue;
      const bKey = `${String(b.action || '').trim()}|${String(b.description || '').trim()}|${String(b.fecha || b.lastDate || '').slice(0, 16)}`;
      if (!seenBitacoraKeys.has(bKey)) {
        seenBitacoraKeys.add(bKey);
        existingBitacoras.push(b);
      }
    }
    const updatedBitacoras = [newBitacoraEntry, ...existingBitacoras].slice(0, 60);

    // Deducir o aplicar avance en el Embudo de Ventas (Pipeline)
    let finalPipelineStage = pipelineStage;
    if (!finalPipelineStage) {
      if (actionType === 'visita_terreno' && attended) finalPipelineStage = 'visita_realizada';
      else if (actionType === 'cita_reunion' && attended) finalPipelineStage = 'cita';
      else if (actionType === 'envio_informacion') finalPipelineStage = 'envio_info';

      if (nextAction.includes('Cierre') || nextAction.includes('Separación')) finalPipelineStage = 'negociacion';
      else if (nextAction.includes('Cotización')) finalPipelineStage = 'cotizacion';
      else if (nextAction.includes('Desistimiento')) finalPipelineStage = 'no_interesado_dinero';
    }

    const followUpSummaryText = `${actionTitle}: ${statusSummary} — ${descriptionText}`.slice(0, 240);
    const nowTs = Timestamp.now();

    const leadUpdates: Record<string, any> = {
      lastMessageAt: nowTs,
      lastAdvisorMessageAt: nowTs,
      lastFollowUpAt: nowTs,
      lastFollowUpAction: actionType,
      lastFollowUpSummary: followUpSummaryText,
      lastFollowUpAuthor: authorName,
      nextFollowUpDate: nextActionDate || null,
      nextFollowUpAction: nextAction,
      aiTakeoverSlaStatus: 'compliant',
      'metadata.smarthomeBitacoras': updatedBitacoras,
      bitacoras: updatedBitacoras,
      updatedAt: nowTs,
    };
    if (Array.isArray(leadData?.smarthomeBitacoras)) {
      leadUpdates.smarthomeBitacoras = updatedBitacoras;
    }
    // Mapeo correlativo con el estado comercial general (status)
    let statusUpdate: string | undefined;
    if (finalPipelineStage === 'firma') {
      statusUpdate = 'closed';
    } else if (finalPipelineStage && finalPipelineStage.startsWith('no_interesado')) {
      statusUpdate = 'lost';
    } else if (finalPipelineStage === 'cita' || finalPipelineStage === 'visita_realizada') {
      statusUpdate = 'scheduled';
    } else if (finalPipelineStage === 'cotizacion' || finalPipelineStage === 'negociacion' || finalPipelineStage === 'documentacion') {
      statusUpdate = 'qualified';
    } else if (finalPipelineStage === 'envio_info' || finalPipelineStage === 'contactado' || finalPipelineStage === 'prospecto') {
      statusUpdate = 'active';
    } else if (leadData?.status === 'lost') {
      // Si el lead estaba marcado como cancelado/perdido y se reporta una gestión activa, reactivarlo
      statusUpdate = 'active';
    }

    // Proteger ventas cerradas: no degradar ventas consolidadas a estados operativos
    if (leadData?.status === 'closed' && statusUpdate !== 'closed' && !finalPipelineStage?.startsWith('no_interesado')) {
      statusUpdate = undefined;
    }

    if (finalPipelineStage) {
      leadUpdates.pipelineStage = finalPipelineStage;
    }
    if (statusUpdate) {
      leadUpdates.status = statusUpdate;
    }
    if (inviteReferralProgram || nextAction.includes('Plan de Referidos')) {
      leadUpdates.tags = FieldValue.arrayUnion('plan_referidos');
      leadUpdates.referralProgramInvitedAt = nowTs;
    }
    if (project && project.trim()) {
      const cleanProj = project.trim();
      leadUpdates.projectInterest = [cleanProj];
      leadUpdates['metadata.project'] = cleanProj;
      if (appointmentId) {
        await appointmentsRepository.update(companyId, appointmentId, { project: cleanProj }).catch(() => {});
      }
    }

    try {
      await leadDocRef.update(leadUpdates);
    } catch (updateErr) {
      logger.warn('[reportAppointmentFicha] Fallback set merge en leadDocRef:', {
        companyId,
        leadId: targetLeadId,
        error: String(updateErr),
      });
      const fallbackUpdates: Record<string, any> = {
        ...leadUpdates,
        metadata: {
          ...(leadData?.metadata || {}),
          smarthomeBitacoras: updatedBitacoras,
          ...(project && project.trim() ? { project: project.trim() } : {}),
        },
      };
      delete fallbackUpdates['metadata.smarthomeBitacoras'];
      delete fallbackUpdates['metadata.project'];
      await leadDocRef.set(fallbackUpdates, { merge: true });
    }

    // 4. Desbloqueo preventivo de SLA si tenía citas pendientes o toma manual de 24h en este lead
    await unlockAdvisorIfCompliant(companyId, ctx.uid).catch(() => {});

    return {
      ok: true,
      leadId: targetLeadId,
      appointmentId: appointmentId || null,
      reminderScheduled,
      googleSync: googleSyncResult,
      updatedBitacoras,
      status: statusUpdate || leadData?.status,
      pipelineStage: finalPipelineStage || leadData?.pipelineStage,
    };
  }
);

// ─── SLA Management Callables ──────────────────────────────────────────────────

export const getSlaConfig = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId } = z.object({
      companyId: z.string().min(1),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const config = await getCompanySlaConfig(companyId);
    return { ok: true, config };
  }
);

export const saveSlaConfig = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const { companyId, config } = z.object({
      companyId: z.string().min(1),
      config: z.object({
        slaEnabled:              z.boolean().optional(),
        preCitaMinutes:          z.number().min(5).max(180).optional(),
        preCitaLookbackHours:    z.number().min(1).max(24).optional(),
        preCitaReassignEnabled:  z.boolean().optional(),
        preCitaBlockAdvisor:     z.boolean().optional(),
        postCitaMinutes:            z.number().min(5).max(1440).optional(),
        postCitaBlockAdvisor:       z.boolean().optional(),
        postCitaRequireEvidence:    z.boolean().optional(),
        manualTakeoverHours:        z.number().min(1).max(168).optional(),
        manualTakeoverBlockAdvisor: z.boolean().optional(),
      }),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const updated = await saveCompanySlaConfig(companyId, config);
    return { ok: true, config: updated };
  }
);

export const listBlockedAdvisorsCall = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const { companyId } = z.object({
      companyId: z.string().min(1),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const advisors = await listBlockedAdvisors(companyId);
    return { ok: true, advisors };
  }
);

export const unblockAdvisorManualCall = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const { companyId, advisorId, reason } = z.object({
      companyId: z.string().min(1),
      advisorId: z.string().min(1),
      reason:    z.string().optional(),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const adminEmail = (request.auth?.token?.email as string) || ctx.uid;
    await unblockAdvisorManual(companyId, advisorId, ctx.uid, adminEmail, reason);
    return { ok: true };
  }
);

