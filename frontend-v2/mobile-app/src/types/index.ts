import type { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';

export type UserRole = 'admin' | 'manager' | 'advisor' | 'viewer' | 'platformAdmin';
export type Timestamp = FirebaseFirestoreTypes.Timestamp;

export const ADMIN_ROLES: UserRole[] = ['admin', 'manager', 'platformAdmin'];

export function isAdminRole(role: UserRole | null | undefined): boolean {
  return !!role && ADMIN_ROLES.includes(role);
}

export interface UserProfile {
  id: string;
  companyId: string;
  email: string;
  displayName: string;
  role: UserRole;
  active: boolean;
  receiveLeads?: boolean;
  platformAdmin?: boolean | string;
  isBlockedForLeads?: boolean;
  blockedReason?: string | null;
  blockedAt?: Timestamp;
  unresolvedAppointmentId?: string | null;
  unresolvedLeadId?: string | null;
  unresolvedLeadName?: string | null;
  phone?: string;
}

export interface AttributionTouch {
  source: string;
  channel: string;
  campaign?: string | null;
  adName?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  project?: string | null;
  timestamp: Timestamp;
}

export interface LeadSourceMeta {
  adId?: string;
  headline?: string;
  body?: string;
  sourceUrl?: string;
  mediaType?: 'video' | 'image' | 'unknown';
  imageUrl?: string;
  videoUrl?: string;
  ctwaClid?: string;
}

export type PipelineStageId =
  | 'prospecto'
  | 'contactado'
  | 'envio_info'
  | 'cita'
  | 'cotizacion'
  | 'visita_realizada'
  | 'negociacion'
  | 'documentacion'
  | 'firma'
  | 'no_interesado_ubicacion'
  | 'no_interesado_dinero'
  | 'no_interesado_otra';

export type PipelineMacroGroup = 'captacion' | 'en_linea' | 'cierre' | 'no_interesado';

export interface Lead {
  id: string;
  companyId: string;
  name?: string;
  phone: string;
  normalizedPhone?: string;
  phoneTail?: string;
  email?: string;
  city?: string;
  documentNumber?: string;
  status: 'new' | 'active' | 'qualified' | 'scheduled' | 'lost' | 'closed';
  source: string;
  fuenteUbicacion?: string;
  sourceMeta?: LeadSourceMeta;
  inbox?: 'central_317' | 'advisor_direct' | 'web_form';
  isArchived?: boolean;
  reactivationCount?: number;
  projectInterest?: string[];
  project?: string;
  firstTouch?: AttributionTouch;
  lastTouch?: AttributionTouch;
  metadata?: Record<string, string>;
  customFields?: Record<string, string>;
  inboxId?: string;
  assignedTo?: string | null;
  assignedAdvisorName?: string;
  assignmentLocked?: boolean;
  advisorAssignedAt?: Timestamp;
  advisorFirstContactAt?: Timestamp;
  lastAdvisorMessageAt?: Timestamp;
  lastAutoReassignedAt?: Timestamp;
  advisorReassignmentCount?: number;
  takeoverBy?: string | null;
  callPermission?: {
    granted?: boolean;
    expiresAt?: Timestamp | number | null;
    lastRequestedAt?: Timestamp | number | null;
  } | null;
  aiEnabled: boolean;
  aiPausedAt?: Timestamp;
  aiDisabledAt?: Timestamp;
  aiTakeoverSlaStatus?: 'compliant' | 'pending' | 'overdue' | string;
  lastMessageText?: string;
  lastMessageAt?: Timestamp;
  lastInboundAt?: Timestamp;
  nextFollowUpAt?: Timestamp | number | null;
  nextFollowUpDate?: string | null;
  nextFollowUpAction?: string | null;
  lastFollowUpAt?: Timestamp | number | null;
  lastFollowUpAction?: string | null;
  lastFichaAt?: Timestamp | number | null;
  fichaCount?: number;
  pipelineStage?: PipelineStageId | string;
  pipelineGroup?: PipelineMacroGroup | string;
  pipelineProbability?: number;
  pipelineStageLabel?: string;
  smartHomeCustomerId?: string | null;
  smartHomeProjectCode?: string | null;
  smartHomeAdvisor?: string | null;
  smarthomeCicloVenta?: string | null;
  smarthomeEstadoSeguimiento?: string | null;
  smarthomeBitacoras?: any[];
  bitacoras?: any[];
  readBy?: Record<string, Timestamp>;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
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
  suggestedStatus?: string;
  suggestedStatusReason?: string;
  analyzedAt?: Timestamp;
  messageCount?: number;
}

export interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  senderType: 'lead' | 'ai' | 'advisor' | 'system';
  content: string;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  errorCode?: string | number;
  errorMessage?: string;
  mediaUrl?: string;
  mediaType?: string;
  fileName?: string;
  mediaKind?: 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'file';
  createdAt: Timestamp;
  timestamp?: Timestamp;
  metadata?: Record<string, any>;
  advisorId?: string;
  advisorName?: string;
  mediaPending?: boolean;
  reaction?: string;
  reactions?: Record<string, string>;
}

export interface Appointment {
  id: string;
  leadId: string;
  advisorId: string | null;
  advisorName?: string | null;
  leadName: string | null;
  leadPhone: string;
  title: string;
  description?: string;
  startTime: number;
  endTime: number;
  googleMeetLink: string | null;
  status: 'scheduled' | 'canceled' | 'completed';
  fichaReported?: boolean;
}

export interface RecentCall {
  id: string;
  leadId: string;
  leadName: string;
  leadPhone: string;
  status: string;
  direction?: 'inbound' | 'outbound';
  callType?: 'ai' | 'whatsapp';
  summary?: string;
  transcript?: string;
  recordingUrl?: string;
  durationSec?: number;
  outcome?: string;
  advisorName?: string;
  createdAt: number;
}

export interface LeadNote {
  id: string;
  kind: 'note' | 'reminder' | 'ficha';
  type?: string;
  source?: string;
  text: string;
  authorId: string;
  authorName: string;
  createdAt: Timestamp;
  dueAt?: Timestamp;
  done?: boolean;
  actionType?: string;
  result?: string;
  contactResult?: string;
  conclusion?: string;
  nextAction?: string;
  nextActionDate?: string;
  evidenceUrl?: string;
}

export interface WhatsAppTemplate {
  id: string;
  name?: string;
  displayName: string;
  body: string;
  headerType?: 'none' | 'text' | 'image' | 'video' | 'document';
  headerText?: string;
  headerMediaUrl?: string;
  footer?: string;
  buttons?: Array<{ type: string; text: string; url?: string; phoneNumber?: string }>;
  category: string;
  language?: string;
  status: 'approved' | 'pending' | 'rejected' | 'local';
  variables: { key: string; example?: string }[];
  lineNumber?: string;
}

export interface LibraryItem {
  id: string;
  kind?: 'document' | 'video' | 'card';
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
  freshnessLabel?: string;
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

export type MainTabsParams = {
  Bandeja: { filter?: 'pending' | 'hot'; leadId?: string } | undefined;
  GestionComercial: undefined;
  Tablero: undefined;
  Resumen: undefined;
};

export type RootStackParams = {
  Main: undefined;
  Chat: { lead?: Lead; leadId?: string };
  Leads: { filter?: 'all' | 'new' | 'scheduled' | 'hot' } | undefined;
  Calendario: { mode?: 'pending' | 'calendar' | 'upcoming' } | undefined;
  Calls: undefined;
  Database: undefined;
  Marketing: undefined;
  Reports: undefined;
  Templates: undefined;
  Broadcasts: undefined;
  Config: { initialTab?: string } | undefined;
  AdvisorWhatsapp: undefined;
  ConfigAi: undefined;
  PhotoEvidence: { lead?: Lead; phone?: string } | undefined;
};
