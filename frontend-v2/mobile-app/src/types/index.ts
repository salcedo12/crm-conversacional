import type { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';

export type UserRole = 'admin' | 'manager' | 'advisor' | 'viewer';
export type Timestamp = FirebaseFirestoreTypes.Timestamp;

export interface UserProfile {
  id: string;
  companyId: string;
  email: string;
  displayName: string;
  role: UserRole;
  active: boolean;
}

export interface Lead {
  id: string;
  companyId: string;
  name?: string;
  phone: string;
  status: 'new' | 'active' | 'qualified' | 'scheduled' | 'lost' | 'closed';
  source: string;
  metadata?: Record<string, string>;
  /** Número de negocio (inbox, +E.164) por el que vive la conversación (317 o línea de asesor). */
  inboxId?: string;
  assignedTo?: string;
  aiEnabled: boolean;
  lastMessageText?: string;
  lastMessageAt?: Timestamp;
  lastInboundAt?: Timestamp;
  readBy?: Record<string, Timestamp>;
  createdAt: Timestamp;
  tags?: string[];
  channel?: 'whatsapp' | 'messenger' | 'instagram';
  aiAnalysis?: LeadAnalysis;
}

export interface LeadAnalysis {
  score: number;
  temperature: 'hot' | 'warm' | 'cold';
  summary?: string;
  interestLevel?: string;
  buyingSignals?: string[];
  intent?: string;
  urgency?: string;
  objections?: string[];
  budget?: string;
  interestArea?: string;
  nextAction?: string;
  nextActionReason?: string;
  nextBestAction?: string;
  recommendedMessage?: string;
  lossRisk?: string;
  lossCategory?: string;
  scoreReasons?: string[];
  analyzedAt?: Timestamp;
  messageCount?: number;
}

export interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  senderType: 'lead' | 'ai' | 'advisor' | 'system';
  content: string;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  mediaUrl?: string;
  mediaType?: string;
  fileName?: string;
  mediaKind?: 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'file';
  createdAt: Timestamp;
  metadata?: Record<string, any>;
  advisorId?: string;
  advisorName?: string;
  mediaPending?: boolean;
  reaction?: string;
}

export interface Appointment {
  id: string;
  leadId: string;
  advisorId: string | null;
  leadName: string | null;
  leadPhone: string;
  title: string;
  startTime: number;
  endTime: number;
  googleMeetLink: string | null;
  status: 'scheduled' | 'canceled' | 'completed';
}

export interface RecentCall {
  id: string;
  leadId: string;
  leadName: string;
  leadPhone: string;
  status: string;
  summary?: string;
  transcript?: string;
  recordingUrl?: string;
  durationSec?: number;
  outcome?: string;
  createdAt: number;
}

export interface LeadNote {
  id: string;
  kind: 'note' | 'reminder';
  text: string;
  authorId: string;
  authorName: string;
  createdAt: Timestamp;
  dueAt?: Timestamp;
  done?: boolean;
}

export interface WhatsAppTemplate {
  id: string;
  displayName: string;
  body: string;
  category: string;
  status: 'approved' | 'pending' | 'rejected' | 'local';
  variables: { key: string; example?: string }[];
  /** Número/inbox (+E.164) dueño de la WABA de la plantilla; coincide con lead.inboxId. */
  lineNumber?: string;
}

export interface LibraryItem {
  id: string;
  kind?: 'document' | 'video';
  visibility?: 'general' | 'advisor';
  advisorId?: string;
  advisorName?: string;
  project?: string;
  title: string;
  fileName: string;
  storagePath: string;
  downloadUrl: string;
  contentType: string;
  sizeBytes: number;
}

export type ContactFieldType = 'text' | 'number' | 'date' | 'select';

export interface ContactField {
  id: string;
  label: string;
  type: ContactFieldType;
  options: string[];
}

export interface PhotoEvidenceItem {
  id: string;
  leadId?: string;
  leadName?: string;
  leadPhone?: string;
  photoUrl: string;
  storagePath: string;
  notes: string;
  actionLabel: string;
  context: string;
  authorId: string;
  authorName: string;
  createdAt: number | null;
  smartHomeSynced: boolean;
  smartHomeResult?: {
    ok: boolean;
    reason?: string;
    prospectId?: string;
  } | null;
}

export interface SearchedLeadData {
  id: string;
  name: string;
  phone: string;
  status: string;
  assignedTo: string | null;
  assignedAdvisorName: string;
  smartHomeCustomerId: string | null;
  smartHomeSyncError: string | null;
  smartHomeAdvisor?: string | null;
  smartHomeStage?: string | null;
  smartHomeScore?: number | null;
}

export interface SearchLeadResult {
  found: boolean;
  lead: SearchedLeadData | null;
  canUpload: boolean;
  message: string;
  evidences: PhotoEvidenceItem[];
}

export interface SubmitPhotoEvidenceInput {
  companyId: string;
  leadId: string;
  photoUrl: string;
  storagePath: string;
  notes: string;
  actionLabel?: string;
  context?: string;
  isAnEvent?: boolean;
  scheduledDate?: string | null;
}

export interface SubmitPhotoEvidenceResult {
  ok: boolean;
  evidenceId: string;
  smartHomeSynced: boolean;
  smartHomeResult?: {
    ok: boolean;
    reason?: string;
    prospectId?: string;
  } | null;
}

export type RootStackParams = {
  Main: undefined;
  Chat: { lead: Lead };
  AdvisorWhatsapp: undefined;
  ConfigAi: undefined;
  PhotoEvidence: { lead?: Lead; phone?: string } | undefined;
};

export type MainTabsParams = {
  Resumen: undefined;
  Bandeja: { filter?: 'pending' | 'hot' } | undefined;
  Leads: { filter?: 'all' | 'new' | 'scheduled' | 'hot' } | undefined;
  Calendario: { mode?: 'upcoming' } | undefined;
  Mas: undefined;
};
