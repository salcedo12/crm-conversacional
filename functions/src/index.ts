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

export { ycloudWebhook }      from './http/ycloudWebhook.function';
export { metaMessagingWebhook } from './http/metaMessagingWebhook.function';
export { daptaWebhook }       from './http/daptaWebhook.function';
export { leadWebhook }        from './http/leadWebhook.function';
export { errorAlertWebhook }  from './http/errorAlertWebhook.function';
export { onMessageCreated }   from './triggers/messageCreated.trigger';
export { onUserProfileWritten } from './triggers/userClaims.trigger';
export { onLeadStatusChanged } from './triggers/leadStatusChanged.trigger';
export { onLeadCreatedAutoCall } from './triggers/leadCreated.trigger';
export { onMediaRehost } from './triggers/mediaRehost.trigger';
export { onLeadSmartHomeSync } from './triggers/leadSmartHomeSync.trigger';
export { sendManualMessage }  from './http/manualMessage.function';
export { reactToMessage }     from './http/reactToMessage.function';
export { pauseLeadAi, resumeLeadAi } from './http/aiControl.function';
export { updateLead }                from './http/updateLead.function';
export {
  markLeadRead,
  markLeadsRead,
  registerPushToken,
  getPushNotificationStatus,
  sendTestPushNotification,
  sendTestPushToDevice,
} from './http/notifications.function';
export { addLeadNote, deleteLeadNote, setReminderDone } from './http/leadNotes.function';
export { listLeadsPage }             from './http/leads.function';
export {
  getAiConfigCallable   as getAiConfig,
  saveAiConfigCallable  as saveAiConfig,
  resetAiConfigCallable as resetAiConfig,
  testAiAssistant,
} from './http/aiConfig.function';
export { getAppBranding, saveAppBranding } from './http/appBranding.function';
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
  listLeadAppointments,
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
  setLeadAssignmentLock,
} from './http/users.function';
export {
  listPlatformCompanies,
  savePlatformCompany,
  saveChannelRoute,
} from './http/platformCompanies.function';
export { listContactFields, saveContactFields } from './http/contactFields.function';
export { saveLibraryItem, renameLibraryItem, deleteLibraryItem } from './http/library.function';
export { startAiCall, listRecentCalls } from './http/calls.function';
export { getAutoCallConfigCallable, saveAutoCallConfigCallable } from './http/autoCall.function';
export { analyzeLead } from './http/leadAnalysis.function';
export { generateLeadDossier } from './http/leadDossier.function';
export { daptaGetFreeSlots, daptaBookAppointment } from './http/daptaScheduling.function';
export {
  requestCallPermission,
  startWhatsappCall,
  preAcceptWhatsappCall,
  acceptWhatsappCall,
  rejectWhatsappCall,
  terminateWhatsappCall,
} from './http/whatsappCalling.function';
export {
  listAdvisorWhatsappConnections,
  requestAdvisorWhatsappQr,
  disconnectAdvisorWhatsapp,
  advisorWhatsappWebhook,
} from './http/advisorWhatsapp.function';
export { listBroadcasts, countBroadcastAudience, sendBroadcast } from './http/broadcasts.function';
export { getDashboardMetrics } from './http/metrics.function';
export { generateLossInsight } from './http/leadInsights.function';
export { getMarketingMetrics } from './http/marketing.function';
export {
  listLeadFormTemplates,
  setLeadFormTemplate,
  deleteLeadFormTemplate,
} from './http/leadForms.function';
export { getAdvisorReports } from './http/advisorReports.function';
export { getWeeklyFollowUpReport } from './http/weeklyFollowUpReport.function';
export { getSalesCommissionReport, saveSalesReportDocument, deleteSalesReportVersion } from './http/salesReports.function';
export {
  syncLeadToSmartHomeCallable as syncLeadToSmartHome,
  listSmartHomeAdvisors,
  listSmartHomeStages,
  changeSmartHomeLeadAdvisor,
  changeSmartHomeLeadStage,
  getSmartHomeLeadBitacoraAccess,
  postSmartHomeLeadBitacora,
} from './http/smarthome.function';
export {
  listLeadLists,
  createLeadList,
  deleteLeadList,
  importLeadsChunk,
  createContact,
} from './http/leadLists.function';
export {
  searchLeadForPhotoEvidence,
  submitPhotoEvidence,
  listPhotoEvidences,
} from './http/photoEvidence.function';
export { processReminders }   from './scheduled/reminders';
export { processLeadReminders } from './scheduled/leadReminders';
export { scheduledFirestoreBackup } from './scheduled/firestoreBackup';
export { processFollowUps }   from './scheduled/processFollowUps';
export { processBroadcasts }  from './scheduled/processBroadcasts';
export { processLeadAnalysis } from './scheduled/processLeadAnalysis';
export { processFirstContactReassignments } from './scheduled/processFirstContactReassignments';
export { processAutoCalls }   from './scheduled/processAutoCalls';
export { processPendingMedia } from './scheduled/processPendingMedia';
export { processSmartHomeRetries } from './scheduled/processSmartHomeRetries';
export { processErrorAlerts }  from './scheduled/processErrorAlerts';
