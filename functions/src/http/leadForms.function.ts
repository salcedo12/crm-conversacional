import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { leadFormsRepository } from '../modules/metaLeads/leadForms.repository';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES } from '../lib/authContext';

/**
 * Gestión del mapeo "formulario de Meta (pauta) → plantilla de bienvenida".
 * Cada pauta de FORMULARIO puede tener su propia plantilla. Solo admin/manager.
 */

// ─── listLeadFormTemplates ────────────────────────────────────────────────────

export const listLeadFormTemplates = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(request.data);
    assertCompany(ctx, companyId);

    const forms = await leadFormsRepository.list(companyId);
    return {
      forms: forms.map((f) => ({
        formId:       f.formId,
        label:        f.label ?? null,
        templateName: f.templateName ?? null,
        leadCount:    f.leadCount ?? 0,
        lastLeadAt:   f.lastLeadAt?.toMillis() ?? null,
      })),
    };
  }
);

// ─── setLeadFormTemplate ──────────────────────────────────────────────────────

export const setLeadFormTemplate = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const { companyId, formId, templateName, label } = z.object({
      companyId:    z.string().min(1),
      formId:       z.string().min(1),
      templateName: z.string().max(80).default(''),  // vacío = limpiar (usar global)
      label:        z.string().max(120).nullish(),   // acepta ausente o null (form agregado a mano)
    }).parse(request.data);
    assertCompany(ctx, companyId);

    await leadFormsRepository.setTemplate(companyId, formId, templateName, label ?? undefined);
    logger.info('[LeadForms] Plantilla de formulario asignada', { companyId, formId, templateName });
    return { ok: true };
  }
);

// ─── deleteLeadFormTemplate ───────────────────────────────────────────────────

export const deleteLeadFormTemplate = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const { companyId, formId } = z.object({
      companyId: z.string().min(1),
      formId:    z.string().min(1),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    await leadFormsRepository.remove(companyId, formId);
    return { ok: true };
  }
);
