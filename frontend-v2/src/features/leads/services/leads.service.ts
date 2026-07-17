import { httpsCallable } from 'firebase/functions';
import { functions }     from '@/config/firebase';
import type { LeadStatus } from '@/features/inbox/types';

interface UpdateLeadInput {
  companyId:   string;
  leadId:      string;
  name?:       string;
  status?:     LeadStatus;
  assignedTo?: string | null;
  tags?:       string[];
  metadata?:   Record<string, string>;
}

const _updateLead = httpsCallable<UpdateLeadInput, { leadId: string }>(
  functions,
  'updateLead'
);

export async function updateLead(input: UpdateLeadInput): Promise<void> {
  await _updateLead(input);
}
