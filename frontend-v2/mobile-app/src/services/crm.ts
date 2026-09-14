import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import storage from '@react-native-firebase/storage';
import type { Appointment, ContactField, LeadAnalysis, LeadNote, RecentCall, WhatsAppTemplate } from '../types';

const functionsInstance = getFunctions(undefined, 'us-central1');
const callable = <TInput, TResult>(name: string) =>
  httpsCallable<TInput, TResult>(functionsInstance, name);

export async function sendMessage(
  companyId: string,
  leadId: string,
  content: string,
  media?: UploadedMedia,
  deliveryChannel?: 'company_whatsapp' | 'advisor_whatsapp'
) {
  const result = await callable<any, { messageId: string }>('sendManualMessage')({
    companyId,
    leadId,
    content,
    mediaUrl: media?.downloadUrl,
    mediaType: media?.contentType,
    fileName: media?.fileName,
    deliveryChannel,
  });
  return result.data.messageId;
}

export async function markLeadRead(companyId: string, leadId: string) {
  await callable('markLeadRead')({ companyId, leadId });
}

export async function markLeadsRead(companyId: string, leadIds: string[]) {
  const chunkSize = 50;
  for (let i = 0; i < leadIds.length; i += chunkSize) {
    await callable('markLeadsRead')({ companyId, leadIds: leadIds.slice(i, i + chunkSize) });
  }
}

export interface CreateContactInput {
  companyId: string;
  name?: string;
  phone: string;
  source?: string;
  tags?: string[];
}

export interface CreateContactResult {
  leadId: string;
  existed: boolean;
}

export async function createContact(input: CreateContactInput): Promise<CreateContactResult> {
  const res = await callable<CreateContactInput, CreateContactResult>('createContact')(input);
  return res.data;
}

export async function setLeadAi(companyId: string, leadId: string, enabled: boolean) {
  await callable(enabled ? 'resumeLeadAi' : 'pauseLeadAi')({ companyId, leadId });
}

export async function updateLead(
  companyId: string,
  leadId: string,
  input: { name?: string; status?: string; tags?: string[]; metadata?: Record<string, string> }
) {
  await callable('updateLead')({ companyId, leadId, ...input });
}

export async function analyzeLead(companyId: string, leadId: string): Promise<LeadAnalysis> {
  const result = await callable<
    { companyId: string; leadId: string },
    { analysis: LeadAnalysis }
  >('analyzeLead')({ companyId, leadId });
  return result.data.analysis;
}

export async function startAiCall(companyId: string, leadId: string): Promise<string> {
  const result = await callable<
    { companyId: string; leadId: string },
    { callId: string }
  >('startAiCall')({ companyId, leadId });
  return result.data.callId;
}

export async function listRecentCalls(companyId: string, limit = 80): Promise<RecentCall[]> {
  const result = await callable<
    { companyId: string; limit: number },
    { calls: RecentCall[] }
  >('listRecentCalls')({ companyId, limit });
  return result.data.calls;
}

export async function listTemplates(companyId: string): Promise<WhatsAppTemplate[]> {
  const result = await callable<{ companyId: string }, { templates: WhatsAppTemplate[] }>('listTemplates')({ companyId });
  return result.data.templates;
}

export async function sendTemplateMessage(
  companyId: string,
  leadId: string,
  templateId: string,
  variables: Record<string, string>
) {
  await callable('sendTemplateMessage')({ companyId, leadId, templateId, variables });
}

export async function addLeadNote(
  companyId: string,
  leadId: string,
  kind: 'note' | 'reminder',
  text: string,
  dueAt?: number
): Promise<string> {
  const result = await callable<
    { companyId: string; leadId: string; kind: 'note' | 'reminder'; text: string; dueAt?: number },
    { noteId: string }
  >('addLeadNote')({ companyId, leadId, kind, text, dueAt });
  return result.data.noteId;
}

export async function setReminderDone(companyId: string, leadId: string, noteId: string, done: boolean) {
  await callable('setReminderDone')({ companyId, leadId, noteId, done });
}

export async function deleteLeadNote(companyId: string, leadId: string, noteId: string) {
  await callable('deleteLeadNote')({ companyId, leadId, noteId });
}

export async function listContactFields(companyId: string): Promise<ContactField[]> {
  const result = await callable<{ companyId: string }, { fields: ContactField[] }>('listContactFields')({ companyId });
  return result.data.fields;
}

export interface LocalFile {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
}

export interface UploadedMedia {
  downloadUrl: string;
  storagePath: string;
  contentType: string;
  fileName: string;
}

export async function uploadMedia(
  companyId: string,
  leadId: string,
  file: LocalFile,
  onProgress?: (percent: number) => void
): Promise<UploadedMedia> {
  assertMediaLimit(file);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `companies/${companyId}/media/${leadId}/${Date.now()}_${safeName}`;
  const reference = storage().ref(storagePath);
  const task = reference.putFile(file.uri, { contentType: file.mimeType });
  task.on('state_changed', (snapshot) => {
    onProgress?.(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100));
  });
  await task;
  return {
    downloadUrl: await reference.getDownloadURL(),
    storagePath,
    contentType: file.mimeType,
    fileName: file.name,
  };
}

const MB = 1024 * 1024;

function mediaLimitFor(mimeType: string): number | null {
  if (mimeType.startsWith('image/')) return 5 * MB;
  if (mimeType.startsWith('video/')) return 16 * MB;
  if (mimeType.startsWith('audio/')) return 16 * MB;
  if (mimeType === 'application/pdf') return 100 * MB;
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function assertMediaLimit(file: LocalFile) {
  const limit = mediaLimitFor(file.mimeType);
  if (!limit || !file.size || file.size <= limit) return;
  const kind = file.mimeType.startsWith('video/')
    ? 'video'
    : file.mimeType.startsWith('image/')
      ? 'imagen'
      : file.mimeType.startsWith('audio/')
        ? 'audio'
        : 'PDF';
  throw new Error(`El ${kind} pesa ${formatBytes(file.size)}. Maximo permitido: ${formatBytes(limit)}.`);
}

export async function listAppointments(companyId: string, from: Date, to: Date) {
  const result = await callable<
    { companyId: string; fromISO: string; toISO: string },
    { appointments: Appointment[] }
  >('listAppointments')({ companyId, fromISO: from.toISOString(), toISO: to.toISOString() });
  return result.data.appointments;
}

export async function listLeadAppointments(companyId: string, leadId: string) {
  const result = await callable<
    { companyId: string; leadId: string },
    { appointments: Appointment[] }
  >('listLeadAppointments')({ companyId, leadId });
  return result.data.appointments;
}

export async function bookAppointmentManual(
  companyId: string,
  input: { leadId: string; startISO: string; durationMinutes?: number; title?: string }
) {
  const result = await callable<
    { companyId: string; leadId: string; startISO: string; durationMinutes?: number; title?: string },
    { appointmentId: string; googleMeetLink: string | null }
  >('bookAppointmentManual')({ companyId, ...input });
  return result.data;
}

export async function startGoogleAuth(companyId: string): Promise<string> {
  const result = await callable<{ companyId: string }, { url: string }>('startGoogleAuth')({ companyId });
  return result.data.url;
}

export async function getGoogleConnection(companyId: string): Promise<{ connected: boolean; email: string | null }> {
  const result = await callable<{ companyId: string }, { connected: boolean; email: string | null }>('getGoogleConnection')({ companyId });
  return result.data;
}

export async function disconnectGoogle(companyId: string) {
  await callable('disconnectGoogle')({ companyId });
}

export type { LeadNote };
