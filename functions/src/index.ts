/**
 * Firebase Cloud Functions - Meraki CRM
 *
 * Arquitectura: http/ + triggers/ + modules/ + integrations/
 *
 * Funciones exportadas:
 *   webhookWhatsapp   → Webhook Twilio inbound (HTTPS público)
 *   onMessageCreated  → Trigger Firestore para respuesta IA (confiable)
 *   sendManualMessage → Callable: asesor envía mensaje manual
 *   pauseLeadAi       → Callable: pausar IA de un lead
 *   resumeLeadAi      → Callable: reactivar IA de un lead
 *   processReminders  → Scheduled: recordatorios de citas (cada 5 min)
 */

export { webhookWhatsapp }    from './http/twilioWebhook.function';
export { ycloudWebhook }      from './http/ycloudWebhook.function';
export { metaMessagingWebhook } from './http/metaMessagingWebhook.function';
export { daptaWebhook }       from './http/daptaWebhook.function';
export { onMessageCreated }   from './triggers/messageCreated.trigger';
export { onUserProfileWritten } from './triggers/userClaims.trigger';
export { onLeadStatusChanged } from './triggers/leadStatusChanged.trigger';
export { onLeadSmartHomeSync } from './triggers/leadSmartHomeSync.trigger';
export { sendManualMessage }  from './http/manualMessage.function';
export { pauseLeadAi, resumeLeadAi } from './http/aiControl.function';
export { updateLead }                from './http/updateLead.function';
export { markLeadRead, markLeadsRead, registerPushToken } from './http/notifications.function';
export { listLeadsPage }             from './http/leads.function';
export {
  getAiConfigCallable   as getAiConfig,
  saveAiConfigCallable  as saveAiConfig,
  resetAiConfigCallable as resetAiConfig,
} from './http/aiConfig.function';
export {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  syncTemplatesFromTwilio,
  sendTemplateMessage,
} from './http/templates.function';
export {
  startGoogleAuth,
  googleOAuthCallback,
  getGoogleConnection,
  disconnectGoogle,
} from './http/googleAuth.function';
export {
  listAppointments,
  cancelAppointment,
  bookAppointmentManual,
} from './http/appointments.function';
export {
  getSchedulingConfigCallable  as getSchedulingConfig,
  saveSchedulingConfigCallable as saveSchedulingConfig,
  listColombianHolidaysCallable as listColombianHolidays,
} from './http/scheduling.function';
export {
  listCalendarEvents,
  createCalendarEvent,
  deleteCalendarEvent,
} from './http/calendar.function';
export {
  listAdvisors,
  listCompanyUsers,
  createCompanyUser,
  updateCompanyUser,
  reassignLead,
} from './http/users.function';
export { listContactFields, saveContactFields } from './http/contactFields.function';
export { startAiCall, listRecentCalls } from './http/calls.function';
export { analyzeLead } from './http/leadAnalysis.function';
export { daptaGetFreeSlots, daptaBookAppointment } from './http/daptaScheduling.function';
export {
  requestCallPermission,
  startWhatsappCall,
  preAcceptWhatsappCall,
  acceptWhatsappCall,
  rejectWhatsappCall,
  terminateWhatsappCall,
} from './http/whatsappCalling.function';
export { listBroadcasts, countBroadcastAudience, sendBroadcast } from './http/broadcasts.function';
export { getDashboardMetrics } from './http/metrics.function';
export { generateLossInsight } from './http/leadInsights.function';
export { getMarketingMetrics } from './http/marketing.function';
export { getAdvisorReports } from './http/advisorReports.function';
export {
  syncLeadToSmartHomeCallable as syncLeadToSmartHome,
  listSmartHomeAdvisors,
} from './http/smarthome.function';
export {
  listLeadLists,
  createLeadList,
  deleteLeadList,
  importLeadsChunk,
  createContact,
} from './http/leadLists.function';
export { processReminders }   from './scheduled/reminders';
export { processFollowUps }   from './scheduled/processFollowUps';
export { processBroadcasts }  from './scheduled/processBroadcasts';
export { processLeadAnalysis } from './scheduled/processLeadAnalysis';
