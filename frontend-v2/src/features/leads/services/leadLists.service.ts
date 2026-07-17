import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';

export interface LeadListFilters {
  status: 'all' | 'new' | 'active' | 'qualified' | 'scheduled' | 'lost' | 'closed';
  aiEnabled: 'all' | 'active' | 'manual';
  assignedTo: string;
  tags: string[];
  inboxId: string;
}

export interface LeadList {
  id: string;
  name: string;
  kind: 'smart' | 'import';
  filters: LeadListFilters | null;
  createdAt: number;
  createdBy?: string;
  sourceFileName?: string;
  sourceRowCount?: number;
  importedCount?: number;
  importedCreated?: number;
  importedUpdated?: number;
  importedInvalid?: number;
  lastImportAt?: number | null;
}

export interface ImportLeadRow {
  name?: string;
  phone: string;
  email?: string;
  company?: string;
  metadata?: Record<string, string>;
}

export interface ImportSummary {
  created: number;
  updated: number;
  invalid: number;
}

const listCallable = httpsCallable<{ companyId: string }, { lists: LeadList[] }>(functions, 'listLeadLists');
const createCallable = httpsCallable<
  { companyId: string; name: string; kind: 'smart' | 'import'; filters?: LeadListFilters; sourceFileName?: string; sourceRowCount?: number },
  { listId: string }
>(functions, 'createLeadList');
const deleteCallable = httpsCallable<{ companyId: string; listId: string }, { ok: boolean }>(functions, 'deleteLeadList');
const importChunkCallable = httpsCallable<
  { companyId: string; listId: string; rows: ImportLeadRow[]; tags: string[] },
  ImportSummary
>(functions, 'importLeadsChunk');

export async function listLeadLists(companyId: string): Promise<LeadList[]> {
  return (await listCallable({ companyId })).data.lists;
}

export async function createLeadList(
  companyId: string,
  name: string,
  kind: 'smart' | 'import',
  filters?: LeadListFilters,
  sourceFileName?: string,
  sourceRowCount?: number
): Promise<string> {
  return (await createCallable({ companyId, name, kind, filters, sourceFileName, sourceRowCount })).data.listId;
}

export async function deleteLeadList(companyId: string, listId: string): Promise<void> {
  await deleteCallable({ companyId, listId });
}

export async function importLeadRows(
  companyId: string,
  listId: string,
  rows: ImportLeadRow[],
  tags: string[],
  onProgress?: (completed: number, total: number) => void
): Promise<ImportSummary> {
  const summary: ImportSummary = { created: 0, updated: 0, invalid: 0 };
  const chunkSize = 250;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const result = (await importChunkCallable({ companyId, listId, rows: chunk, tags })).data;
    summary.created += result.created;
    summary.updated += result.updated;
    summary.invalid += result.invalid;
    onProgress?.(Math.min(index + chunk.length, rows.length), rows.length);
  }
  return summary;
}
