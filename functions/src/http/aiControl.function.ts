import { onCall, HttpsError }    from 'firebase-functions/v2/https';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { z }                     from 'zod';
import { db }                    from '../lib/admin';
import { logger }                from '../utils/logger';
import { leadsRepository }       from '../modules/leads/leads.repository';
import { messagesRepository }    from '../modules/messages/messages.repository';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES } from '../lib/authContext';

const LeadActionSchema = z.object({
  companyId: z.string().min(1),
  leadId:    z.string().min(1),
});

/** Referencia directa a un documento lead (para poder usar FieldValue.delete()) */
const leadDocRef = (companyId: string, leadId: string) =>
  db.collection('companies').doc(companyId).collection('leads').doc(leadId);

// ─────────────────────────────────────────────────────────────────────────────
// pauseLeadAi
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Callable: pausa la IA para un lead.
 * El webhook seguirá recibiendo mensajes pero no responderá automáticamente.
 */
export const pauseLeadAi = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const parse = LeadActionSchema.safeParse(request.data);
    if (!parse.success) throw new HttpsError('invalid-argument', 'Datos inválidos.');

    const { companyId, leadId } = parse.data;
    assertCompany(ctx, companyId);
    const advisorId = ctx.uid;

    const lead = await leadsRepository.findById(companyId, leadId);
    if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');
    if (!lead.aiEnabled) return { aiEnabled: false }; // ya estaba pausada

    await leadDocRef(companyId, leadId).update({
      aiEnabled:  false,
      takeoverBy: advisorId,
      updatedAt:  Timestamp.now(),
    });

    await messagesRepository.create({
      companyId,
      leadId,
      direction:  'outbound',
      senderType: 'system',
      content:    'IA pausada. El asesor tomó el control.',
      channel:    'whatsapp',
      status:     'sent',
      createdAt:  Timestamp.now(),
    });

    logger.info('[AiControl] IA pausada', { leadId, advisorId });
    return { aiEnabled: false };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// resumeLeadAi
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Callable: reactiva la IA para un lead.
 * Usa FieldValue.delete() para eliminar takeoverBy — Firestore no acepta undefined.
 */
export const resumeLeadAi = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const parse = LeadActionSchema.safeParse(request.data);
    if (!parse.success) throw new HttpsError('invalid-argument', 'Datos inválidos.');

    const { companyId, leadId } = parse.data;
    assertCompany(ctx, companyId);
    const advisorId = ctx.uid;

    const lead = await leadsRepository.findById(companyId, leadId);
    if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');
    if (lead.aiEnabled) return { aiEnabled: true }; // ya estaba activa

    await leadDocRef(companyId, leadId).update({
      aiEnabled:  true,
      takeoverBy: FieldValue.delete(), // elimina el campo en lugar de poner undefined
      updatedAt:  Timestamp.now(),
    });

    await messagesRepository.create({
      companyId,
      leadId,
      direction:  'outbound',
      senderType: 'system',
      content:    'IA reactivada.',
      channel:    'whatsapp',
      status:     'sent',
      createdAt:  Timestamp.now(),
    });

    logger.info('[AiControl] IA reactivada', { leadId, advisorId });
    return { aiEnabled: true };
  }
);
