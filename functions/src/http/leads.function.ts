import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { leadsRepository } from '../modules/leads/leads.repository';
import { requireAuth, assertCompany } from '../lib/authContext';

const LeadStatusSchema = z.enum(['new', 'active', 'qualified', 'scheduled', 'lost', 'closed']);
const LeadSourceSchema = z.enum(['whatsapp', 'manual', 'web', 'facebook', 'instagram', 'meta_ads']);

export const listLeadsPage = onCall(
  { region: 'us-central1', timeoutSeconds: 30, memory: '256MiB' },
  async (request) => {
    const ctx = requireAuth(request);
    const data = z.object({
      companyId: z.string().min(1),
      pageSize:  z.number().int().min(10).max(100).default(50),
      cursor:    z.object({ id: z.string(), value: z.unknown().optional() }).nullable().optional(),
      sortField: z.enum(['lastMessageAt', 'createdAt', 'name', 'status']).default('lastMessageAt'),
      sortDir:   z.enum(['asc', 'desc']).default('desc'),
      filters:   z.object({
        search:     z.string().max(120).optional(),
        status:     z.union([LeadStatusSchema, z.literal('all')]).default('all'),
        aiEnabled:  z.enum(['all', 'active', 'manual']).default('all'),
        assignedTo: z.string().default('all'),
        tags:       z.array(z.string()).max(10).default([]),
        inboxId:    z.string().default('all'),
        listId:     z.string().default('all'),
        source:     z.union([LeadSourceSchema, z.literal('all')]).default('all'),
      }),
    }).parse(request.data);

    assertCompany(ctx, data.companyId);
    return leadsRepository.listPage(data.companyId, {
      pageSize: data.pageSize,
      cursor: data.cursor ?? undefined,
      sortField: data.sortField,
      sortDir: data.sortDir,
      filters: data.filters,
    });
  }
);
