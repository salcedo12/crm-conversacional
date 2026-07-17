import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp }          from 'firebase-admin/firestore';
import { z }                  from 'zod';
import { logger }             from '../utils/logger';
import { leadsRepository }     from '../modules/leads/leads.repository';
import { templatesRepository } from '../modules/templates/templates.repository';
import { broadcastsRepository } from '../modules/broadcasts/broadcasts.repository';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES } from '../lib/authContext';

/** Tope de destinatarios por envío (evita exceder el timeout de la función). */
/** Envíos simultáneos. WhatsApp/BSP toleran ráfagas moderadas. */
/** Máximo de errores detallados que guardamos por envío. */

const NAME_KEYS = new Set(['nombre', 'name']);

function normalizedVariableName(value: string): string {
  return value.trim().replace(/^\{\{\s*|\s*\}\}$/g, '').replace(/^\[|\]$/g, '').toLowerCase();
}

function leadNameForMessage(name?: string): string {
  const candidate = name?.trim() ?? '';
  return candidate && !NAME_KEYS.has(normalizedVariableName(candidate)) ? candidate : 'cliente';
}

export function buildBroadcastVariables(
  templateVariables: { key: string; example: string }[],
  leadName: string | undefined,
  variables: Record<string, string>,
  templateBody: string
): Record<string, string> {
  const resolved = { ...variables };
  const name = leadNameForMessage(leadName);
  const greetingVariable = templateBody.match(/\b(?:hola|estimad[oa])\s+\{\{\s*(\w+)\s*\}\}/i)?.[1];

  for (const variable of templateVariables) {
    const keyIsName = NAME_KEYS.has(normalizedVariableName(variable.key));
    const exampleIsName = NAME_KEYS.has(normalizedVariableName(variable.example));
    const valueIsName = NAME_KEYS.has(normalizedVariableName(resolved[variable.key] ?? ''));
    const keyIsGreeting = normalizedVariableName(greetingVariable ?? '') === normalizedVariableName(variable.key);
    if (keyIsName || exampleIsName || valueIsName || keyIsGreeting) resolved[variable.key] = name;
  }

  resolved.nombre = name;
  resolved.name = name;
  return resolved;
}

const AudienceSchema = z.object({
  type:  z.enum(['all', 'status', 'tag', 'list']),
  value: z.string().max(60).optional(),
});

// ─── listBroadcasts ────────────────────────────────────────────────────────────

export const listBroadcasts = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(request.data);
    assertCompany(ctx, companyId);
    const broadcasts = await broadcastsRepository.listRecent(companyId);
    return { broadcasts };
  }
);

// ─── sendBroadcast ─────────────────────────────────────────────────────────────

/**
 * Envía una plantilla aprobada a una audiencia de leads (todos / por estado /
 * por etiqueta). Solo plantillas aprobadas pueden salir fuera de la ventana de
 * 24h de WhatsApp, por eso se exige `status: 'approved'`.
 *
 * Personaliza por lead: las variables {{nombre}} y {{name}} se rellenan con el
 * nombre del lead; el resto de variables se toman del objeto `variables`.
 */
export const countBroadcastAudience = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const { companyId, audience } = z.object({
      companyId: z.string().min(1),
      audience:  AudienceSchema,
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const total = await leadsRepository.countByAudience(companyId, audience);
    return { total };
  }
);

export const sendBroadcast = onCall(
  { region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);

    const { companyId, templateId, audience, variables } = z.object({
      companyId:  z.string().min(1),
      templateId: z.string().min(1),
      audience:   AudienceSchema,
      variables:  z.record(z.string(), z.string()).default({}),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const template = await templatesRepository.findById(companyId, templateId);
    if (!template) throw new HttpsError('not-found', 'Plantilla no encontrada.');
    if (template.status !== 'approved') {
      throw new HttpsError(
        'failed-precondition',
        'Solo se pueden enviar masivamente plantillas APROBADAS por WhatsApp.'
      );
    }

    const total = await leadsRepository.countByAudience(companyId, audience);
    if (total === 0) {
      throw new HttpsError('failed-precondition', 'La audiencia seleccionada no tiene leads.');
    }

    // Crear registro del envío
    const broadcast = await broadcastsRepository.create(companyId, {
      companyId,
      templateId,
      templateName: template.name,
      audience,
      variables,
      total,
      sent:      0,
      delivered: 0,
      read:      0,
      undelivered: 0,
      failed:    0,
      status:    'queued',
      createdBy: ctx.uid,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    logger.info('[Broadcast] Iniciando envío', {
      broadcastId: broadcast.id, companyId, template: template.name,
      total,
    });

    return { broadcastId: broadcast.id, total, sent: 0, failed: 0, truncated: false, queued: true };
  }
);
