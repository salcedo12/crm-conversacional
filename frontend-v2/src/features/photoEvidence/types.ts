import type { LeadStatus } from '@/features/inbox/types';

export interface PhotoEvidenceItem {
  id:               string;
  leadId?:          string;
  leadName?:        string;
  leadPhone?:       string;
  photoUrl:         string;
  shortUrl?:        string;
  storagePath:      string;
  notes:            string;
  actionLabel:      string;
  context:          string;
  isAnEvent?:       boolean;
  scheduledDate?:   string | null;
  authorId:         string;
  authorName:       string;
  createdAt:        number | null;
  smartHomeSynced:  boolean;
  smartHomeResult?: {
    ok: boolean;
    reason?: string;
    prospectId?: string;
  } | null;
}

export interface SearchedLeadData {
  id:                  string;
  name:                string;
  phone:               string;
  status:              LeadStatus | string;
  assignedTo:          string | null;
  assignedAdvisorName: string;
  smartHomeCustomerId: string | null;
  smartHomeSyncError:  string | null;
  smartHomeAdvisor?:   string | null;
  smartHomeStage?:     string | null;
  smartHomeScore?:     number | null;
  smartHomeProject?:   string | null;
  smartHomeEvents?:    Array<{ date: string; content: string; action: string; system: boolean }>;
}

export interface SearchLeadResult {
  found:      boolean;
  lead:       SearchedLeadData | null;
  canUpload:  boolean;
  message:    string;
  evidences:  PhotoEvidenceItem[];
}

export interface EvidenceAttachmentItem {
  downloadUrl:  string;
  storagePath:  string;
  contentType?: string;
  fileName?:    string;
}

export interface SubmitPhotoEvidenceInput {
  companyId:      string;
  leadId:         string;
  attachments?:   EvidenceAttachmentItem[];
  photoUrl?:      string;
  storagePath?:   string;
  notes:          string;
  actionLabel?:   string;
  context?:       string;
  isAnEvent?:     boolean;
  scheduledDate?: string;
}

export interface SubmitPhotoEvidenceResult {
  ok:              boolean;
  evidenceId:      string;
  smartHomeSynced: boolean;
  smartHomeResult?: {
    ok: boolean;
    reason?: string;
    prospectId?: string;
  } | null;
}
