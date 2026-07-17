import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as https             from 'https';
import { z }                  from 'zod';
import { logger }             from '../utils/logger';
import { env }                from '../config/env';
import { templatesRepository }   from '../modules/templates/templates.repository';
import { leadsRepository }       from '../modules/leads/leads.repository';
import { getYcloudClient }       from '../integrations/ycloud/ycloud.client';
import type { YcloudTemplateCategory } from '../integrations/ycloud/ycloud.client';
import type { WhatsAppTemplate } from '../modules/templates/templates.types';
import {
  mapYcloudStatus, ycloudHeaderType, buildYcloudCreateComponents,
} from '../modules/templates/templates.helpers';
import { sendTemplateToLead } from '../modules/messages/templateSender.service';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES, WRITE_ROLES } from '../lib/authContext';

// ─── Schemas ─────────────────────────────────────────────────────────────────

const VariableSchema = z.object({
  key:     z.string().min(1).max(40),
  example: z.string().max(200),
});

const ButtonSchema = z.object({
  type:        z.enum(['QUICK_REPLY', 'URL', 'PHONE_NUMBER', 'COPY_CODE']),
  text:        z.string().max(25).default(''),
  url:         z.string().url().optional(),
  phoneNumber: z.string().max(20).optional(),
});

const TemplateSchema = z.object({
  companyId:   z.string().min(1),
  name:        z.string().min(1).max(80).regex(/^[a-z0-9_]+$/, 'Solo minúsculas, números y _'),
  displayName: z.string().min(1).max(80),
  category:    z.enum(['marketing', 'utility', 'authentication']),
  language:    z.string().default('es'),
  header:      z.string().max(60).optional(),
  headerType:  z.enum(['none', 'text', 'image', 'video', 'document']).optional(),
  headerMediaUrl: z.string().url().optional(),
  headerMediaFilename: z.string().max(240).optional(),
  body:        z.string().min(1).max(1024),
  footer:      z.string().max(60).optional(),
  buttons:     z.array(ButtonSchema).max(10).optional(),
  variables:   z.array(VariableSchema).max(10),
  twilioContentSid: z.string().optional(),
  status:      z.enum(['approved', 'pending', 'rejected', 'local']),
});

// ─── listTemplates ────────────────────────────────────────────────────────────

export const listTemplates = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(request.data);
    assertCompany(ctx, companyId);
    const templates = await templatesRepository.findAll(companyId);
    return { templates };
  }
);

// ─── createTemplate ───────────────────────────────────────────────────────────

export const createTemplate = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);

    const parse = TemplateSchema.safeParse(request.data);
    if (!parse.success) throw new HttpsError('invalid-argument', parse.error.message);

    const { companyId, ...fields } = parse.data;
    assertCompany(ctx, companyId);
    let status: WhatsAppTemplate['status'] = fields.status ?? 'local';

    // ── Registrar en ycloud para aprobación de Meta ───────────────────────────
    if (env.useYcloud() && env.ycloudWabaId()) {
      try {
        const created = await getYcloudClient().createTemplate({
          wabaId:     env.ycloudWabaId(),
          name:       fields.name,
          language:   fields.language ?? 'es',
          category:   fields.category.toUpperCase() as YcloudTemplateCategory,
          components: buildYcloudCreateComponents(fields),
        });
        status = mapYcloudStatus(created.status);
        logger.info('[Templates] Plantilla registrada en ycloud', {
          name: fields.name, status: created.status,
        });
      } catch (err) {
        logger.error('[Templates] Error registrando plantilla en ycloud', {
          name:  fields.name,
          error: err instanceof Error ? err.message : String(err),
        });
        throw new HttpsError(
          'internal',
          `No se pudo registrar la plantilla en ycloud: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    const template = await templatesRepository.create(companyId, {
      ...fields,
      companyId,
      status,
    });

    logger.info('[Templates] Plantilla creada', { templateId: template.id, status });
    return { templateId: template.id, status };
  }
);

// ─── updateTemplate ───────────────────────────────────────────────────────────

export const updateTemplate = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const { companyId, templateId, ...fields } = z.object({
      companyId:  z.string().min(1),
      templateId: z.string().min(1),
    }).passthrough().parse(request.data);
    assertCompany(ctx, companyId as string);

    await templatesRepository.update(companyId as string, templateId as string, fields);
    return { ok: true };
  }
);

// ─── deleteTemplate ───────────────────────────────────────────────────────────

export const deleteTemplate = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const { companyId, templateId } = z.object({
      companyId:  z.string().min(1),
      templateId: z.string().min(1),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    await templatesRepository.delete(companyId, templateId);
    return { ok: true };
  }
);

// ─── syncTemplatesFromTwilio (ycloud + fallback Twilio) ──────────────────────

/**
 * Sincroniza plantillas aprobadas desde:
 * - ycloud (si YCLOUD_WABA_ID está configurado) — recomendado
 * - Twilio Content API (fallback)
 */
export const syncTemplatesFromTwilio = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(request.data);
    assertCompany(ctx, companyId);
    let synced = 0;

    // ── Sincronizar desde ycloud ──────────────────────────────────────────
    if (env.useYcloud() && env.ycloudWabaId()) {
      const ycloudTemplates = await getYcloudClient().listTemplates(env.ycloudWabaId());

      for (const t of ycloudTemplates) {
        const bodyComp   = t.components.find((c) => c.type === 'BODY');
        const headerComp = t.components.find((c) => c.type === 'HEADER');
        const footerComp = t.components.find((c) => c.type === 'FOOTER');
        const body = bodyComp?.text ?? '';
        if (!body) continue;

        // Variables {{1}}, {{2}} → ejemplos desde example.body_text
        const varKeys   = [...new Set([...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];
        const examples  = bodyComp?.example?.body_text?.[0] ?? [];
        const variables = varKeys.map((k, i) => ({ key: k, example: examples[i] ?? `[${k}]` }));

        // Header: texto o media
        const headerType = ycloudHeaderType(headerComp?.format);
        const headerMediaUrl = headerComp?.example?.header_url?.[0];

        // Botones
        const buttonsComp = t.components.find((c) => c.type === 'BUTTONS');
        const buttons = (buttonsComp?.buttons ?? []).map((b) => ({
          type: b.type,
          text: b.text ?? '',
          ...(b.url ? { url: b.url } : {}),
          ...(b.phone_number ? { phoneNumber: b.phone_number } : {}),
        }));

        await templatesRepository.upsertByName(companyId, {
          companyId,
          name:        t.name,
          displayName: t.name.replace(/_/g, ' '),
          category:    t.category.toLowerCase() as 'marketing' | 'utility' | 'authentication',
          language:    t.language,
          body,
          variables,
          status:      mapYcloudStatus(t.status),
          headerType,
          // campos opcionales solo si existen — Firestore rechaza undefined en update()
          ...(headerComp?.text ? { header: headerComp.text } : {}),
          ...(headerMediaUrl ? { headerMediaUrl } : {}),
          ...(footerComp?.text ? { footer: footerComp.text } : {}),
          ...(buttons.length > 0 ? { buttons } : {}),
        });
        synced++;
      }

      logger.info('[Templates] Sync ycloud completado', { synced });
      return { synced, source: 'ycloud' };
    }

    // ── Fallback: Twilio Content API ──────────────────────────────────────
    const accountSid = env.twilioAccountSid();
    const authToken  = env.twilioAuthToken();
    if (!accountSid || !authToken) {
      throw new HttpsError('failed-precondition', 'Configura YCLOUD_WABA_ID o credenciales de Twilio.');
    }

    const auth    = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const rawData = await new Promise<string>((resolve, reject) => {
      const req = https.request({
        hostname: 'content.twilio.com',
        path:     '/v1/Content',
        method:   'GET',
        headers:  { Authorization: `Basic ${auth}` },
      }, (res) => {
        let d = ''; res.on('data', (c: string) => d += c); res.on('end', () => resolve(d));
      });
      req.on('error', reject); req.end();
    });

    interface TwilioContent {
      sid: string; friendly_name: string; language: string;
      variables?: Record<string, string>;
      types?: Record<string, { body?: string }>;
    }
    const data = JSON.parse(rawData) as { contents?: TwilioContent[] };

    for (const c of data.contents ?? []) {
      const body = c.types?.['twilio/text']?.body ?? c.types?.['twilio/quick-reply']?.body ?? '';
      if (!body) continue;
      const varKeys  = [...new Set([...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];
      const variables = varKeys.map((k) => ({ key: k, example: c.variables?.[k] ?? `[${k}]` }));
      await templatesRepository.upsertByName(companyId, {
        companyId,
        name: c.sid.toLowerCase().replace(/[^a-z0-9]/g, '_'),
        displayName: c.friendly_name,
        category: 'utility', language: c.language ?? 'es',
        body, variables, twilioContentSid: c.sid, status: 'approved',
      });
      synced++;
    }

    logger.info('[Templates] Sync Twilio completado', { synced });
    return { synced, source: 'twilio' };
  }
);

// ─── sendTemplateMessage ──────────────────────────────────────────────────────

export const sendTemplateMessage = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);
    const { companyId, leadId, templateId, variables } = z.object({
      companyId:  z.string().min(1),
      leadId:     z.string().min(1),
      templateId: z.string().min(1),
      variables:  z.record(z.string(), z.string()).default({}),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const [lead, template] = await Promise.all([
      leadsRepository.findById(companyId, leadId),
      templatesRepository.findById(companyId, templateId),
    ]);

    if (!lead)     throw new HttpsError('not-found', 'Lead no encontrado.');
    if (!template) throw new HttpsError('not-found', 'Plantilla no encontrada.');

    try {
      const { messageId } = await sendTemplateToLead({
        companyId,
        lead,
        template,
        variables: variables as Record<string, string>,
        advisorId: ctx.uid,
      });
      return { messageId };
    } catch (err) {
      throw new HttpsError('internal', err instanceof Error ? err.message : String(err));
    }
  }
);
