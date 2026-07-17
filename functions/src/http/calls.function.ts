import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { db } from '../lib/admin';
import { leadsRepository } from '../modules/leads/leads.repository';
import { callsRepository } from '../modules/calls/calls.repository';
import { getDaptaClient } from '../integrations/dapta/dapta.client';
import type { Call } from '../modules/calls/calls.types';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES, ADMIN_ROLES } from '../lib/authContext';

export const startAiCall = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const { companyId, leadId } = z.object({
      companyId: z.string().min(1),
      leadId: z.string().min(1),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    if (!env.daptaConfigured()) {
      throw new HttpsError('failed-precondition', 'Las llamadas con IA no estan configuradas todavia.');
    }

    const lead = await leadsRepository.findById(companyId, leadId);
    if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');
    if (!lead.phone) throw new HttpsError('failed-precondition', 'El lead no tiene telefono.');

    if (!ADMIN_ROLES.includes(ctx.role) && lead.assignedTo !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Solo puedes llamar leads asignados a ti.');
    }

    let result;
    try {
      result = await getDaptaClient().startCall({
        phone: lead.phone,
        name: lead.name,
        leadId: lead.id,
        companyId,
        advisorId: ctx.uid,
        ...(lead.metadata && Object.keys(lead.metadata).length > 0
          ? { variables: lead.metadata }
          : {}),
      });
    } catch (err) {
      logger.error('[startAiCall] Error iniciando llamada en Dapta', {
        leadId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpsError('unavailable', 'No se pudo iniciar la llamada con Dapta.');
    }

    if (!result.ok) {
      throw new HttpsError('unavailable', `Dapta rechazo la solicitud (HTTP ${result.status}).`);
    }

    const now = Timestamp.now();
    const call = await callsRepository.create({
      companyId,
      leadId: lead.id,
      direction: 'outbound',
      provider: 'dapta',
      status: 'initiated',
      triggeredBy: ctx.uid,
      ...(result.externalId && { externalId: result.externalId }),
      createdAt: now,
    });

    logger.info('[startAiCall] Llamada iniciada', { leadId, callId: call.id, by: ctx.uid });
    return { callId: call.id, status: 'initiated' };
  }
);

interface RecentCallDTO {
  id: string;
  leadId: string;
  leadName: string;
  leadPhone: string;
  status: Call['status'];
  summary?: string;
  transcript?: string;
  recordingUrl?: string;
  durationSec?: number;
  outcome?: string;
  createdAt: number;
}

async function listCallsForAssignedLeads(
  companyId: string,
  advisorId: string,
  maxRows: number
): Promise<{ calls: Call[]; leadMap: Map<string, { name: string; phone: string }> }> {
  const leadsSnap = await db
    .collection('companies').doc(companyId)
    .collection('leads')
    .where('assignedTo', '==', advisorId)
    .get();

  const leadMap = new Map<string, { name: string; phone: string }>();
  const callBuckets = await Promise.all(leadsSnap.docs.map(async (leadDoc) => {
    const lead = leadDoc.data();
    leadMap.set(leadDoc.id, {
      name: typeof lead.name === 'string' ? lead.name : '',
      phone: typeof lead.phone === 'string' ? lead.phone : '',
    });

    const callsSnap = await leadDoc.ref
      .collection('calls')
      .orderBy('createdAt', 'desc')
      .limit(Math.min(maxRows, 20))
      .get();

    return callsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Call));
  }));

  const calls = callBuckets
    .flat()
    .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())
    .slice(0, maxRows);

  return { calls, leadMap };
}

export const listRecentCalls = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);

    const { companyId, limit } = z.object({
      companyId: z.string().min(1),
      limit: z.number().int().min(1).max(200).default(60),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    let calls: Call[] = [];
    let leadMap = new Map<string, { name: string; phone: string }>();

    if (ADMIN_ROLES.includes(ctx.role)) {
      const snap = await db
        .collectionGroup('calls')
        .where('companyId', '==', companyId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      calls = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Call));

      const leadIds = [...new Set(calls.map((c) => c.leadId))];
      await Promise.all(leadIds.map(async (leadId) => {
        const lead = await leadsRepository.findById(companyId, leadId);
        if (lead) leadMap.set(leadId, { name: lead.name ?? '', phone: lead.phone });
      }));
    } else {
      const scoped = await listCallsForAssignedLeads(companyId, ctx.uid, limit);
      calls = scoped.calls;
      leadMap = scoped.leadMap;
    }

    const rows: RecentCallDTO[] = calls.map((call) => {
      const lead = leadMap.get(call.leadId);
      return {
        id: call.id,
        leadId: call.leadId,
        leadName: lead?.name || lead?.phone || call.leadId,
        leadPhone: lead?.phone ?? '',
        status: call.status,
        ...(call.summary !== undefined && { summary: call.summary }),
        ...(call.transcript !== undefined && { transcript: call.transcript }),
        ...(call.recordingUrl !== undefined && { recordingUrl: call.recordingUrl }),
        ...(call.durationSec !== undefined && { durationSec: call.durationSec }),
        ...(call.outcome !== undefined && { outcome: call.outcome }),
        createdAt: call.createdAt.toMillis(),
      };
    });

    return { calls: rows };
  }
);
