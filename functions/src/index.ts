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

// Opciones globales (memoria por defecto): debe ir antes de cualquier export de funciones.
import './config/globalOptions';

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
export {
  listLeadDeals,
  listCompanyDeals,
  createDeal,
  getDeal,
  findClientByIdentification,
  saveDealBuyers,
  uploadDealAttachment,
  downloadDealAttachment,
  deleteDealAttachment,
  cancelDeal,
} from './http/deals.function';
export {
  listInventoryProjects,
  listAvailableLots,
  reserveDealLot,
  releaseDealLot,
  getDealLotStatus,
} from './http/dealLots.function';
export { getDealPriceOptions, saveDealPlan } from './http/dealPlan.function';
export { generateDealDocument, downloadDealDocument } from './http/dealDocuments.function';
export {
  getDealSignatureOptions,
  sendDealToSignature,
  refreshDealSignature,
  resendDealSignature,
  markDealSignatureCancelled,
  getDocuBlockCities,
} from './http/dealSignature.function';
export { listSmartHomeSales, syncSmartHomeSalesNow, setSmartHomeSaleIgnored, downloadSmartHomeFile } from './http/smarthomeSales.function';
export { listLeadsPage }             from './http/leads.function';
export {
  getAiConfigCallable   as getAiConfig,
  saveAiConfigCallable  as saveAiConfig,
  resetAiConfigCallable as resetAiConfig,
  testAiAssistant,
} from './http/aiConfig.function';
export { getAiReport } from './http/aiReport.function';
export { retryFailedMessage } from './http/retryMessage.function';
export { getAppBranding, saveAppBranding } from './http/appBranding.function';
export {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  syncTemplatesFromTwilio,
  sendTemplateMessage,
  listMessagingLines,
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
  reportAppointmentFicha,
  getSlaConfig,
  saveSlaConfig,
  listBlockedAdvisorsCall,
  unblockAdvisorManualCall,
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
  completeLeadFollowUp,
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
export { getFichaTecnicaConfig, saveFichaTecnicaConfig } from './http/fichaTecnicaConfig.function';
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
  getMyMessagingLine,
} from './http/advisorWhatsapp.function';
export { listBroadcasts, countBroadcastAudience, sendBroadcast } from './http/broadcasts.function';
export { getDashboardMetrics } from './http/metrics.function';
export { generateLossInsight } from './http/leadInsights.function';
export { getMarketingMetrics, getMarketingAdLeads } from './http/marketing.function';
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
  syncSmartHomeLeadBitacora,
  syncSmartHomeRecentActivity,
  postSmartHomeLeadEvidence,
} from './http/smarthome.function';
export {
  listLeadLists,
  createLeadList,
  deleteLeadList,
  importLeadsChunk,
  createContact,
  checkPhoneAvailability,
  requestLeadTransfer,
  listLeadTransferRequests,
  resolveLeadTransferRequest,
} from './http/leadLists.function';
export { quickLeadTransferAction } from './http/quickLeadTransferAction.function';
export {
  searchLeadForPhotoEvidence,
  submitPhotoEvidence,
  listPhotoEvidences,
} from './http/photoEvidence.function';
export { exportLeadsReport } from './http/exportLeads.function';
export { ev } from './http/evidenceLink.function';
export { getReport317, getLeadBitacora } from './http/report317.function';
export { syncBitacoraStatusNow } from './http/bitacoraSync.function';
export { processBitacoraStatusSync } from './scheduled/processBitacoraStatusSync';
export { processSmartHomeSalesSync } from './scheduled/processSmartHomeSalesSync';
export { processDealSignatures } from './scheduled/processDealSignatures';
export { processSmartHomeFileCopy } from './scheduled/processSmartHomeFileCopy';
export { processReminders }   from './scheduled/reminders';
export { processLeadReminders } from './scheduled/leadReminders';
export { processMorningAgendaSummary, sendMorningAgendaSummaryNow } from './scheduled/processMorningAgendaSummary';
export { scheduledFirestoreBackup } from './scheduled/firestoreBackup';
export { processFollowUps }   from './scheduled/processFollowUps';
export { processBroadcasts }  from './scheduled/processBroadcasts';
export { processLeadAnalysis } from './scheduled/processLeadAnalysis';
export { processFirstContactReassignments } from './scheduled/processFirstContactReassignments';
export { processAutoCalls }   from './scheduled/processAutoCalls';
export { processPendingMedia } from './scheduled/processPendingMedia';
export { processSmartHomeRetries } from './scheduled/processSmartHomeRetries';
export { processErrorAlerts }  from './scheduled/processErrorAlerts';
export { processAppointmentSla } from './scheduled/processAppointmentSla';
export {
  getMetaAdCreative,
  getMetaAdsConfigCallable as getMetaAdsConfig,
  saveMetaAdsConfigCallable as saveMetaAdsConfig,
  testMetaAdsConnection,
} from './http/metaCreative.function';
export {
  getCommercialLeaderboard,
  saveCommercialGoals,
} from './http/commercialLeaderboard.function';
export { generateExecutiveReportWithAi } from './http/commercialReports.function';
export { askCommercialAssistant } from './http/commercialAssistant.function';
