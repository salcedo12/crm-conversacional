import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z }                  from 'zod';
import { logger }             from '../utils/logger';
import { templatesRepository }   from '../modules/templates/templates.repository';
import { leadsRepository }       from '../modules/leads/leads.repository';
import { getYcloudClientForCompany } from '../integrations/ycloud/ycloud.client';
import { getYcloudConfigForCompany }  from '../modules/companies/channelCredentials.repository';
import { listAdvisorLines, getChannelRoute } from '../modules/companies/companyRouting';
import { normalizeBusinessNumber } from '../modules/whatsapp/inbox';
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
  // Línea/inbox (+E.164) para la que se crea la plantilla. Determina el WABA donde
  // se registra. Si se omite, va al WABA principal (317).
  inboxId:     z.string().optional(),
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

// ─── listMessagingLines ────────────────────────────────────────────────────────

/**
 * Líneas de WhatsApp de la empresa: la principal (317) y las de coexistencia de
 * asesores. Alimenta el selector "para qué línea" al crear una plantilla y el
 * badge de línea en el listado. Cada plantilla se registra/lista por su WABA.
 */
export const listMessagingLines = onCall(
  { region: 'us-central1', timeoutSeconds: 15 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(request.data);
    assertCompany(ctx, companyId);

    const cfg = await getYcloudConfigForCompany(companyId);
    const lines = [
      {
        number:    normalizeBusinessNumber(cfg.fromNumber) ?? cfg.fromNumber,
        wabaId:    cfg.wabaId,
        isDefault: true,
      },
      ...(await listAdvisorLines(companyId)).map((l) => ({
        number:    l.number,
        wabaId:    l.wabaId,
        isDefault: false,
        advisorId: l.advisorId,
      })),
    ];
    return { lines };
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

    const { companyId, inboxId, ...fields } = parse.data;
    assertCompany(ctx, companyId);
    let status: WhatsAppTemplate['status'] = fields.status ?? 'local';

    // ── Resolver la LÍNEA/WABA destino ────────────────────────────────────────
    // Por defecto la línea principal (317). Si se pide una línea de asesor
    // (coexistencia), la plantilla se registra en SU WABA y se etiqueta con su
    // número para que solo aparezca en su línea.
    const ycloudCfg = await getYcloudConfigForCompany(companyId);
    let targetWaba       = ycloudCfg.wabaId;
    let targetLineNumber = normalizeBusinessNumber(ycloudCfg.fromNumber);
    const requestedNumber = normalizeBusinessNumber(inboxId);
    if (requestedNumber && requestedNumber !== targetLineNumber) {
      const route = await getChannelRoute('ycloud', requestedNumber);
      if (route?.wabaId && route.companyId === companyId && route.active !== false) {
        targetWaba       = route.wabaId;
        targetLineNumber = requestedNumber;
      } else {
        throw new HttpsError('failed-precondition',
          'Esa línea no tiene un WABA registrado. Regístralo antes de crear plantillas para ella.');
      }
    }

    // ── Registrar en ycloud para aprobación de Meta ───────────────────────────
    if (ycloudCfg.apiKey && targetWaba) {
      try {
        const client  = await getYcloudClientForCompany(companyId);
        const created = await client.createTemplate({
          wabaId:     targetWaba,
          name:       fields.name,
          language:   fields.language ?? 'es',
          category:   fields.category.toUpperCase() as YcloudTemplateCategory,
          components: buildYcloudCreateComponents(fields),
        });
        status = mapYcloudStatus(created.status);
        logger.info('[Templates] Plantilla registrada en ycloud', {
          name: fields.name, status: created.status, wabaId: targetWaba,
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
      wabaId: targetWaba,
      ...(targetLineNumber ? { lineNumber: targetLineNumber } : {}),
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
    const ycloudCfg = await getYcloudConfigForCompany(companyId);
    if (ycloudCfg.apiKey && ycloudCfg.wabaId) {
      const client = await getYcloudClientForCompany(companyId);

      // Sincroniza TODOS los WABAs de la empresa: el principal (317) y las líneas
      // de coexistencia de asesores (cada una en su propio WABA). Cada plantilla
      // se etiqueta con su `wabaId` + `lineNumber` para que el selector muestre a
      // cada línea las suyas. Misma API key → un solo cliente sirve para todos.
      const targets: { wabaId: string; lineNumber?: string }[] = [
        { wabaId: ycloudCfg.wabaId, lineNumber: normalizeBusinessNumber(ycloudCfg.fromNumber) },
      ];
      for (const line of await listAdvisorLines(companyId)) {
        if (line.wabaId && !targets.some((t) => t.wabaId === line.wabaId)) {
          targets.push({ wabaId: line.wabaId, lineNumber: line.number });
        }
      }

      for (const target of targets) {
        let ycloudTemplates: Awaited<ReturnType<typeof client.listTemplates>> = [];
        try {
          ycloudTemplates = await client.listTemplates(target.wabaId);
        } catch (err) {
          logger.warn('[Templates] No se pudieron listar plantillas de un WABA', {
            wabaId: target.wabaId, error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }

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
            wabaId:      target.wabaId,
            // campos opcionales solo si existen — Firestore rechaza undefined en update()
            ...(target.lineNumber ? { lineNumber: target.lineNumber } : {}),
            ...(headerComp?.text ? { header: headerComp.text } : {}),
            ...(headerMediaUrl ? { headerMediaUrl } : {}),
            ...(footerComp?.text ? { footer: footerComp.text } : {}),
            ...(buttons.length > 0 ? { buttons } : {}),
          });
          synced++;
        }
      }

      logger.info('[Templates] Sync ycloud completado', { synced, wabas: targets.length });
      return { synced, source: 'ycloud' };
    }

    // Sin YCloud configurado no hay de dónde sincronizar (Twilio fue removido).
    throw new HttpsError('failed-precondition', 'Configura YCLOUD_WABA_ID para sincronizar plantillas.');
  }
);

// ─── sendTemplateMessage ──────────────────────────────────────────────────────

export const sendTemplateMessage = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);
    const { companyId, leadId, templateId, variables, fromInboxId } = z.object({
      companyId:  z.string().min(1),
      leadId:     z.string().min(1),
      templateId: z.string().min(1),
      variables:  z.record(z.string(), z.string()).default({}),
      // Línea (+E.164) elegida por el asesor para enviar; opcional. Si se omite se
      // usa la del lead. El backend valida propiedad de la línea (coexistencia).
      fromInboxId: z.string().min(1).optional(),
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
        fromInboxId,
      });
      return { messageId };
    } catch (err) {
      throw new HttpsError('internal', err instanceof Error ? err.message : String(err));
    }
  }
);
