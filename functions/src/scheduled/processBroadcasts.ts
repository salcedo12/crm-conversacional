import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/admin';
import { logger } from '../utils/logger';
import { broadcastsRepository } from '../modules/broadcasts/broadcasts.repository';
import { leadsRepository } from '../modules/leads/leads.repository';
import { templatesRepository } from '../modules/templates/templates.repository';
import { sendTemplateToLead } from '../modules/messages/templateSender.service';
import { buildBroadcastVariables } from '../http/broadcasts.function';
import type { Broadcast, BroadcastError } from '../modules/broadcasts/broadcasts.types';
import type { Lead } from '../modules/leads/leads.types';

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_RETRIES = 3;
const MAX_STORED_ERRORS = 25;

function intEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export const processBroadcasts = onSchedule(
  {
    schedule:       'every 1 minutes',
    region:         'us-central1',
    timeoutSeconds: 540,
    memory:         '512MiB',
    timeZone:       'America/Bogota',
  },
  async () => {
    const companies = await db.collection('companies').listDocuments();
    let processed = 0;

    for (const companyRef of companies) {
      const broadcasts = await broadcastsRepository.listPending(companyRef.id, 3);
      for (const broadcast of broadcasts) {
        try {
          await processBroadcast(companyRef.id, broadcast);
          processed++;
        } catch (err) {
          logger.error('[BroadcastQueue] Error procesando campana', {
            companyId: companyRef.id,
            broadcastId: broadcast.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    logger.info('[BroadcastQueue] Ciclo completado', { processed });
  }
);

async function processBroadcast(companyId: string, broadcast: Broadcast): Promise<void> {
  const batchSize = intEnv('BROADCAST_BATCH_SIZE', DEFAULT_BATCH_SIZE);
  const concurrency = intEnv('BROADCAST_CONCURRENCY', DEFAULT_CONCURRENCY);
  const retries = intEnv('BROADCAST_RETRIES', DEFAULT_RETRIES);
  const delayMs = intEnv('BROADCAST_DELAY_MS', 1);

  await broadcastsRepository.update(companyId, broadcast.id, {
    status: 'processing',
    updatedAt: Timestamp.now(),
  });

  const template = await templatesRepository.findById(companyId, broadcast.templateId);
  if (!template || template.status !== 'approved') {
    await broadcastsRepository.update(companyId, broadcast.id, {
      status: 'failed',
      completedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      errors: [{
        leadId: 'broadcast',
        phone: '',
        error: 'Plantilla no encontrada o no aprobada.',
      }],
    });
    return;
  }
  const approvedTemplate = template;

  const page = await leadsRepository.listAudiencePage(
    companyId,
    broadcast.audience,
    batchSize,
    broadcast.cursor
  );

  let sent = 0;
  let failed = 0;
  const errors: BroadcastError[] = [...(broadcast.errors ?? [])].slice(0, MAX_STORED_ERRORS);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < page.leads.length) {
      const lead = page.leads[cursor++];
      const recipient = await broadcastsRepository.getRecipient(companyId, broadcast.id, lead.id);
      if (recipient?.status === 'sent' || recipient?.status === 'failed') continue;

      await sleep(delayMs);
      const result = await sendWithRetries(companyId, broadcast, lead, approvedTemplate, retries);
      if (result.ok) {
        sent++;
        await broadcastsRepository.setRecipient(companyId, broadcast.id, lead.id, {
          companyId,
          broadcastId: broadcast.id,
          leadId: lead.id,
          phone: lead.phone,
          status: 'sent',
          attempts: result.attempts,
          messageId: result.messageId,
          externalMsgId: result.externalMsgId,
          sentAt: Timestamp.now(),
        });
      } else {
        failed++;
        if (errors.length < MAX_STORED_ERRORS) {
          errors.push({ leadId: lead.id, phone: lead.phone, error: result.error ?? 'Error desconocido' });
        }
        await broadcastsRepository.setRecipient(companyId, broadcast.id, lead.id, {
          companyId,
          broadcastId: broadcast.id,
          leadId: lead.id,
          phone: lead.phone,
          status: 'failed',
          attempts: result.attempts,
          error: result.error,
          failedAt: Timestamp.now(),
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, page.leads.length) }, worker));

  const done = !page.hasMore;
  const nextStatus = done
    ? ((broadcast.sent + sent === 0 && broadcast.failed + failed > 0) ? 'failed' : 'completed')
    : 'queued';

  await broadcastsRepository.update(companyId, broadcast.id, {
    sent: FieldValue.increment(sent) as unknown as number,
    failed: FieldValue.increment(failed) as unknown as number,
    cursor: page.nextCursor,
    status: nextStatus,
    updatedAt: Timestamp.now(),
    ...(done ? { completedAt: Timestamp.now() } : {}),
    ...(errors.length > 0 ? { errors } : {}),
  });

  logger.info('[BroadcastQueue] Lote procesado', {
    companyId,
    broadcastId: broadcast.id,
    sent,
    failed,
    hasMore: page.hasMore,
  });
}

async function sendWithRetries(
  companyId: string,
  broadcast: Broadcast,
  lead: Lead,
  template: NonNullable<Awaited<ReturnType<typeof templatesRepository.findById>>>,
  retries: number
): Promise<
  | { ok: true; attempts: number; messageId: string; externalMsgId?: string }
  | { ok: false; attempts: number; error: string }
> {
  const variables = buildBroadcastVariables(template.variables, lead.name, broadcast.variables, template.body);
  let lastError = 'Error desconocido';

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await sendTemplateToLead({
        companyId,
        lead,
        template,
        variables,
        advisorId: broadcast.createdBy,
        broadcastId: broadcast.id,
      });
      return { ok: true, attempts: attempt, messageId: result.messageId, externalMsgId: result.externalMsgId };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await sleep(500 * attempt);
    }
  }

  return { ok: false, attempts: retries, error: lastError };
}
