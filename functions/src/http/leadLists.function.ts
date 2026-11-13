import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { db } from '../lib/admin';
import { logger } from '../utils/logger';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES, ADMIN_ROLES } from '../lib/authContext';
import { sendAdvisorPush } from '../modules/messages/pushNotifications.service';
import {
  sendTransferAlertWhatsapp,
  sendTransferResolutionConfirmationWhatsapp,
} from '../modules/leads/leadTransferAlert.service';
import { executeResolveLeadTransferRequest } from '../modules/leads/leadTransfer.service';

const FilterSchema = z.object({
  status: z.enum(['all', 'new', 'active', 'qualified', 'scheduled', 'lost', 'closed']).default('all'),
  aiEnabled: z.enum(['all', 'active', 'manual']).default('all'),
  assignedTo: z.string().max(128).default('all'),
  tags: z.array(z.string().max(40)).max(20).default([]),
  inboxId: z.string().max(40).default('all'),
});

const ImportRowSchema = z.object({
  name: z.string().max(120).optional().default(''),
  phone: z.string().min(7).max(40),
  email: z.string().max(160).optional().default(''),
  company: z.string().max(160).optional().default(''),
  metadata: z.record(z.string(), z.string().max(500)).optional().default({}),
});

const listCollection = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('leadLists');
const leadCollection = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('leads');
const transferRequestsCol = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('transferRequests');

function normalizeImportedPhone(raw: string): { phone: string; normalizedPhone: string } | null {
  const trimmed = raw.trim();
  const hasExplicitCountryCode = trimmed.startsWith('+') || trimmed.startsWith('00');
  let digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  // Solo anteponer 57 automáticamente si el usuario NO puso '+' explícito y es un celular colombiano de 10 dígitos (3XXXXXXXXX)
  if (!hasExplicitCountryCode && digits.length === 10 && digits.startsWith('3')) {
    digits = `57${digits}`;
  }
  if (digits.length < 8 || digits.length > 15) return null;
  const phone = `+${digits}`;
  return { phone, normalizedPhone: phone.toLowerCase() };
}

interface FollowUpCandidate {
  millis: number;
  summary: string;
}

function isSystemGeneratedNote(data: FirebaseFirestore.DocumentData): boolean {
  if (data.authorId === 'system' || data.authorId === 'bot') return true;
  if (data.type === 'audit' || data.type === 'deal_activity' || data.type === 'transfer_audit') return true;
  if (data.actionType === 'unificacion_duplicado' || data.actionType === 'traslado_comercial') return true;
  if (data.source === 'system' || data.source === 'automation') return true;

  const author = String(data.authorName || '').toLowerCase();
  if (
    author.includes('sistema') ||
    author.includes('unificaci') ||
    author.includes('dirección comercial') ||
    author.includes('direccion comercial')
  ) {
    return true;
  }

  const text = String(data.text || '');
  if (
    text.includes('Prospecto Unificado Automáticamente') ||
    text.includes('Solicitud de traslado') ||
    text.includes('Traslado aprobada') ||
    text.includes('Traslado aprobado') ||
    text.includes('Reasignación aprobada')
  ) {
    return true;
  }
  return false;
}

/**
 * Calcula la última fecha real de seguimiento humano del asesor asignado sobre un lead.
 * Filtra y excluye:
 * - Mensajes enviados por otros asesores (ej: asesores que intentan contactarlo o solicitan traslado).
 * - Notas y unificaciones automáticas del sistema o de auditoría.
 * - Notas redactadas por otros asesores.
 */
async function inspectLeadLastFollowUp(
  companyId: string,
  leadId: string,
  leadData: FirebaseFirestore.DocumentData,
  targetAdvisorId?: string | null
): Promise<{
  lastFollowUpMillis: number | null;
  daysSinceFollowUp: number | null;
  lastFollowUpSummary: string | null;
  assignedAtMillis: number | null;
}> {
  const currentAdvisorId = targetAdvisorId || leadData.assignedTo || null;
  const candidates: FollowUpCandidate[] = [];

  // 1. Revisar mensajes reales de WhatsApp enviados específicamente por el asesor actual
  try {
    const msgsSnap = await leadCollection(companyId)
      .doc(leadId)
      .collection('messages')
      .orderBy('createdAt', 'desc')
      .limit(35)
      .get();

    for (const mDoc of msgsSnap.docs) {
      const m = mDoc.data();
      if (m.direction === 'outbound') {
        // Si conocemos el asesor asignado a auditar, SOLO contar mensajes enviados por él
        if (currentAdvisorId && m.advisorId && m.advisorId !== currentAdvisorId) {
          continue; // Mensaje enviado por otro asesor (ej: asesor solicitante de traslado), NO por el dueño actual
        }
        const mMs = m.createdAt?.toMillis?.() ?? 0;
        if (mMs > 0) {
          const content = m.content
            ? m.content.replace(/\s+/g, ' ').trim().slice(0, 140)
            : m.mediaType
            ? 'Archivo / imagen por WhatsApp'
            : 'Mensaje de WhatsApp';
          candidates.push({
            millis: mMs,
            summary: `WhatsApp: "${content}"`,
          });
          break; // Se toma el mensaje outbound más reciente del asesor asignado
        }
      }
    }
  } catch {}

  // 2. Revisar notas humanas en la subcolección notes (excluyendo auditorías de sistema y notas de otros asesores)
  try {
    const notesSnap = await leadCollection(companyId)
      .doc(leadId)
      .collection('notes')
      .orderBy('createdAt', 'desc')
      .limit(30)
      .get();

    for (const doc of notesSnap.docs) {
      const n = doc.data();
      if (isSystemGeneratedNote(n)) continue;

      // Si conocemos el asesor actual a auditar, no atribuirle notas registradas por otros asesores
      if (currentAdvisorId && n.authorId && n.authorId !== currentAdvisorId && n.authorId !== 'system') {
        continue;
      }

      const noteMs = n.createdAt?.toMillis?.() ?? 0;
      if (noteMs > 0) {
        let summary = '';
        if (n.type === 'ficha_tecnica') {
          const clean = (n.text || '')
            .replace(/^📋 FICHA TÉCNICA[^\n]*\n?/i, '')
            .replace(/\n?• Observaciones:[\s\S]*$/i, '')
            .trim();
          summary = [
            n.actionType ? `${n.actionType}` : '',
            n.result ? `(${n.result})` : '',
            clean,
          ].filter(Boolean).join(' ');
        } else {
          summary = n.text || '';
        }
        summary = summary.replace(/\s+/g, ' ').trim().slice(0, 180);
        if (n.authorName && !summary.includes(n.authorName)) {
          summary = `${summary} (por ${n.authorName})`;
        }
        candidates.push({ millis: noteMs, summary: summary || 'Nota de seguimiento comercial' });
        break; // Tomar la nota humana más reciente
      }
    }
  } catch {}

  // 3. Revisar bitácoras históricas embebidas (SmartHome / CRM) excluyendo logs del sistema
  const bitacoras = leadData.bitacoras || leadData.metadata?.smarthomeBitacoras || [];
  if (Array.isArray(bitacoras) && bitacoras.length > 0) {
    for (const bit of bitacoras) {
      if (!bit || typeof bit !== 'object') continue;
      const asesor = String(bit.asesor || '').toLowerCase();
      const action = String(bit.action || '').toLowerCase();
      const desc = String(bit.description || '');

      if (
        asesor.includes('sistema') ||
        action.includes('unificaci') ||
        action.includes('traslado') ||
        desc.includes('Prospecto Unificado') ||
        desc.includes('traslado') ||
        desc.includes('solicitud de traslado') ||
        bit.system === true ||
        action === 'evento del sistema'
      ) {
        continue;
      }

      const rawDate = bit.lastDate || bit.fecha;
      if (rawDate && typeof rawDate === 'string') {
        const parsed = Date.parse(rawDate.includes('T') ? rawDate : rawDate.replace(' ', 'T') + '-05:00');
        if (!Number.isNaN(parsed) && parsed > 0) {
          const actionStr = bit.action ? `${bit.action}: ` : '';
          const authorStr = bit.asesor ? ` (por ${bit.asesor})` : '';
          const fullDesc = `${actionStr}${desc}${authorStr}`.replace(/\s+/g, ' ').trim().slice(0, 180);
          candidates.push({ millis: parsed, summary: fullDesc || 'Bitácora de seguimiento comercial' });
          break;
        }
      }
    }
  }

  // 4. Si no encontramos mensajes en la subcolección pero existe lastAdvisorMessageAt del lead
  // (SOLO como fallback cuando no hay un asesor específico filtrado)
  if (!currentAdvisorId && candidates.length === 0 && leadData.lastAdvisorMessageAt?.toMillis) {
    candidates.push({
      millis: leadData.lastAdvisorMessageAt.toMillis(),
      summary: 'Mensaje de WhatsApp enviado por el asesor',
    });
  }

  // 5. Revisar primer contacto (solo como fallback)
  if (!currentAdvisorId && candidates.length === 0 && leadData.advisorFirstContactAt?.toMillis) {
    candidates.push({
      millis: leadData.advisorFirstContactAt.toMillis(),
      summary: 'Primer contacto realizado por el asesor',
    });
  }

  // 6. Revisar lastFollowUpAt si no fue establecido por un script o unificación
  const isSyntheticFollowUp =
    (typeof leadData.lastFollowUpAuthor === 'string' && leadData.lastFollowUpAuthor.toLowerCase().includes('sistema')) ||
    leadData.lastFollowUpAction === 'unificacion_duplicado' ||
    leadData.lastFollowUpAction === 'traslado_comercial' ||
    (typeof leadData.lastFollowUpSummary === 'string' && leadData.lastFollowUpSummary.includes('Prospecto Unificado'));

  if (leadData.lastFollowUpAt?.toMillis && !isSyntheticFollowUp) {
    candidates.push({
      millis: leadData.lastFollowUpAt.toMillis(),
      summary: (leadData.lastFollowUpSummary || 'Seguimiento comercial registrado').replace(/\s+/g, ' ').trim().slice(0, 180),
    });
  }

  let lastFollowUpMillis: number | null = null;
  let lastFollowUpSummary: string | null = null;

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.millis - a.millis);
    lastFollowUpMillis = candidates[0].millis;
    lastFollowUpSummary = candidates[0].summary;
  }

  const daysSinceFollowUp =
    lastFollowUpMillis !== null
      ? Math.max(0, Math.floor((Date.now() - lastFollowUpMillis) / (1000 * 60 * 60 * 24)))
      : null;

  const assignedAtMillis =
    leadData.advisorAssignedAt?.toMillis?.() || leadData.createdAt?.toMillis?.() || null;

  return {
    lastFollowUpMillis,
    daysSinceFollowUp,
    lastFollowUpSummary,
    assignedAtMillis,
  };
}

export const listLeadLists = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(request.data);
    assertCompany(ctx, companyId);

    const snap = await listCollection(companyId).orderBy('createdAt', 'asc').get();
    return {
      lists: snap.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data.name,
          kind: data.kind,
          filters: data.filters ?? null,
          createdAt: data.createdAt?.toMillis?.() ?? 0,
          createdBy: data.createdBy ?? '',
          sourceFileName: data.sourceFileName ?? '',
          sourceRowCount: data.sourceRowCount ?? 0,
          importedCount: data.importedCount ?? 0,
          importedCreated: data.importedCreated ?? 0,
          importedUpdated: data.importedUpdated ?? 0,
          importedInvalid: data.importedInvalid ?? 0,
          lastImportAt: data.lastImportAt?.toMillis?.() ?? null,
        };
      }),
    };
  }
);

export const createLeadList = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);
    const data = z.object({
      companyId: z.string().min(1),
      name: z.string().trim().min(1).max(60),
      kind: z.enum(['smart', 'import']).default('smart'),
      filters: FilterSchema.optional(),
      sourceFileName: z.string().max(160).optional(),
      sourceRowCount: z.number().int().min(0).max(100000).optional(),
    }).parse(request.data);
    assertCompany(ctx, data.companyId);

    const duplicate = await listCollection(data.companyId).where('name', '==', data.name).limit(1).get();
    if (!duplicate.empty) throw new HttpsError('already-exists', 'Ya existe una lista con ese nombre.');

    const ref = listCollection(data.companyId).doc();
    await ref.set({
      companyId: data.companyId,
      name: data.name,
      kind: data.kind,
      filters: data.kind === 'smart' ? data.filters ?? FilterSchema.parse({}) : null,
      sourceFileName: data.sourceFileName ?? '',
      sourceRowCount: data.sourceRowCount ?? 0,
      importedCount: 0,
      importedCreated: 0,
      importedUpdated: 0,
      importedInvalid: 0,
      createdBy: ctx.uid,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    return { listId: ref.id };
  }
);

export const deleteLeadList = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);
    const { companyId, listId } = z.object({
      companyId: z.string().min(1), listId: z.string().min(1),
    }).parse(request.data);
    assertCompany(ctx, companyId);
    await listCollection(companyId).doc(listId).delete();
    return { ok: true };
  }
);

export const checkPhoneAvailability = onCall(
  { region: 'us-central1', timeoutSeconds: 15 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);
    const { companyId, phone } = z.object({
      companyId: z.string().min(1),
      phone: z.string().trim().min(5).max(40),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const normalized = normalizeImportedPhone(phone);
    if (!normalized) {
      return { status: 'invalid' as const, message: 'Formato inválido (mínimo 10 dígitos).' };
    }

    const isColombianNumber = normalized.phone.startsWith('+57');
    const tail = normalized.phone.slice(-10);
    const [byNorm, byPhone, byTail] = await Promise.all([
      leadCollection(companyId).where('normalizedPhone', '==', normalized.normalizedPhone).limit(1).get(),
      leadCollection(companyId).where('phone', '==', normalized.phone).limit(1).get(),
      isColombianNumber
        ? leadCollection(companyId).where('phoneTail', '==', tail).limit(1).get()
        : Promise.resolve({ empty: true, docs: [] } as unknown as FirebaseFirestore.QuerySnapshot),
    ]);

    const existingDoc = !byNorm.empty ? byNorm.docs[0] : (!byPhone.empty ? byPhone.docs[0] : (!byTail.empty ? byTail.docs[0] : null));
    if (!existingDoc) {
      return {
        status: 'available' as const,
        normalizedPhone: normalized.phone,
        message: 'Número disponible. Se registrará con exclusividad a tu nombre.',
      };
    }

    const d = existingDoc.data();
    const isAdmin = ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role as never);

    // Si no tiene asesor asignado, está libre para asignarse
    if (!d.assignedTo) {
      return {
        status: 'available' as const,
        normalizedPhone: normalized.phone,
        leadId: existingDoc.id,
        message: 'Número disponible para asignar.',
      };
    }

    const isOwnLead = d.assignedTo === ctx.uid;
    if (isOwnLead) {
      return {
        status: 'own' as const,
        leadId: existingDoc.id,
        leadName: d.name || 'Sin Nombre',
        project: (d.projectInterest && d.projectInterest[0]) || d.metadata?.project || '',
      };
    }

    // Verificar si este asesor ya tiene una solicitud de traslado pendiente para este lead
    const pendingSnap = await transferRequestsCol(companyId)
      .where('leadId', '==', existingDoc.id)
      .where('requesterId', '==', ctx.uid)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    const hasPendingRequest = !pendingSnap.empty;

    // Para asesores: respuesta limpia y privada (no expone el nombre del otro asesor ni del cliente)
    if (!isAdmin) {
      return {
        status: 'locked_by_other' as const,
        leadId: existingDoc.id,
        hasPendingRequest,
      };
    }

    // Solo para Administradores: mostrar a quién pertenece y cuándo fue su último seguimiento real
    let advisorName = 'Otro Asesor';
    try {
      const uSnap = await db.collection('companies').doc(companyId).collection('users').doc(d.assignedTo).get();
      if (uSnap.exists) {
        advisorName = (uSnap.data()?.displayName) || (uSnap.data()?.name) || 'Otro Asesor';
      }
    } catch {}

    const followUpAudit = await inspectLeadLastFollowUp(companyId, existingDoc.id, d, d.assignedTo);

    return {
      status: 'locked_by_other' as const,
      leadId: existingDoc.id,
      leadName: d.name || 'Sin Nombre',
      advisorId: d.assignedTo,
      advisorName,
      daysSinceActivity: followUpAudit.daysSinceFollowUp,
      hasPendingRequest,
    };
  }
);

/**
 * Permite a un asesor solicitar a Dirección Comercial el traslado de un número que ya está asignado a otro asesor.
 */
export const requestLeadTransfer = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);
    const { companyId, phone, leadId, reason, suggestedName, project, targetAdvisorId } = z.object({
      companyId: z.string().min(1),
      phone: z.string().trim().max(40).optional().nullable().default(''),
      leadId: z.string().optional().nullable(),
      reason: z.string().trim().max(500).optional().nullable(),
      suggestedName: z.string().trim().max(120).optional().nullable(),
      project: z.string().trim().max(120).optional().nullable(),
      targetAdvisorId: z.string().optional().nullable(),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    let targetDoc: FirebaseFirestore.DocumentSnapshot | null = null;
    if (leadId) {
      const snap = await leadCollection(companyId).doc(leadId).get();
      if (snap.exists) targetDoc = snap;
    }

    if (!targetDoc && phone) {
      const normalized = normalizeImportedPhone(phone);
      if (!normalized) throw new HttpsError('invalid-argument', 'Número de teléfono inválido.');
      const isColombianNumber = normalized.phone.startsWith('+57');
      const tail = normalized.phone.slice(-10);
      const [byNorm, byTail] = await Promise.all([
        leadCollection(companyId).where('normalizedPhone', '==', normalized.normalizedPhone).limit(1).get(),
        isColombianNumber
          ? leadCollection(companyId).where('phoneTail', '==', tail).limit(1).get()
          : Promise.resolve({ empty: true, docs: [] } as unknown as FirebaseFirestore.QuerySnapshot),
      ]);
      targetDoc = !byNorm.empty ? byNorm.docs[0] : (!byTail.empty ? byTail.docs[0] : null);
    }

    if (!targetDoc || !targetDoc.exists) {
      throw new HttpsError('not-found', 'No se encontró un prospecto registrado con ese número.');
    }

    const leadData = targetDoc.data() ?? {};
    const isOwnLead = leadData.assignedTo === ctx.uid;
    if (isOwnLead && !reason && !targetAdvisorId) {
      throw new HttpsError('already-exists', 'Este prospecto ya está asignado a tu cuenta.');
    }

    // Evitar duplicar solicitud pendiente del mismo asesor para el mismo lead
    const existingReq = await transferRequestsCol(companyId)
      .where('leadId', '==', targetDoc.id)
      .where('requesterId', '==', ctx.uid)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (!existingReq.empty) {
      return { ok: true, requestId: existingReq.docs[0].id, alreadyPending: true };
    }

    // Obtener nombres del asesor solicitante y del asesor dueño actual
    let requesterName = 'Asesor';
    let currentAdvisorName = 'Sin Asignar';
    let targetAdvisorName: string | null = null;

    try {
      const reqUserSnap = await db.collection('companies').doc(companyId).collection('users').doc(ctx.uid).get();
      if (reqUserSnap.exists) {
        requesterName = (reqUserSnap.data()?.displayName as string) || (reqUserSnap.data()?.name as string) || 'Asesor';
      }
      if (leadData.assignedTo) {
        const curUserSnap = await db.collection('companies').doc(companyId).collection('users').doc(leadData.assignedTo).get();
        if (curUserSnap.exists) {
          currentAdvisorName = (curUserSnap.data()?.displayName as string) || (curUserSnap.data()?.name as string) || 'Asesor';
        }
      }
      if (targetAdvisorId) {
        const tgtSnap = await db.collection('companies').doc(companyId).collection('users').doc(targetAdvisorId).get();
        if (tgtSnap.exists) {
          targetAdvisorName = (tgtSnap.data()?.displayName as string) || (tgtSnap.data()?.name as string) || 'Asesor';
        }
      }
    } catch {}

    const followUpAudit = await inspectLeadLastFollowUp(companyId, targetDoc.id, leadData, leadData.assignedTo);
    const now = Timestamp.now();
    const actionToken = randomBytes(16).toString('hex');

    const reqRef = await transferRequestsCol(companyId).add({
      companyId,
      actionToken,
      leadId: targetDoc.id,
      leadName: leadData.name || suggestedName || 'Prospecto',
      suggestedName: suggestedName || null,
      leadPhone: leadData.phone || phone,
      project: project || (leadData.projectInterest && leadData.projectInterest[0]) || leadData.metadata?.project || '',
      currentAdvisorId: leadData.assignedTo || null,
      currentAdvisorName,
      requesterId: ctx.uid,
      requesterName,
      isReassignmentRequest: isOwnLead,
      targetAdvisorId: targetAdvisorId || null,
      targetAdvisorName: targetAdvisorName || null,
      reason: reason || (isOwnLead ? 'Solicita reasignar prospecto de su cartera' : 'Solicita traslado de prospecto'),
      lastFollowUpMillis: followUpAudit.lastFollowUpMillis,
      daysSinceFollowUp: followUpAudit.daysSinceFollowUp,
      lastFollowUpSummary: followUpAudit.lastFollowUpSummary,
      assignedAtMillis: followUpAudit.assignedAtMillis,
      status: 'pending',
      createdAt: now,
    });

    // Notificar por Push a los Administradores / Managers de la empresa
    try {
      const adminsSnap = await db
        .collection('companies')
        .doc(companyId)
        .collection('users')
        .where('role', 'in', ['admin', 'manager'])
        .get();

      for (const adminDoc of adminsSnap.docs) {
        await sendAdvisorPush(companyId, adminDoc.id, {
          title: isOwnLead ? '🔄 Solicitud de Reasignación de Lead' : '🔄 Nueva Solicitud de Traslado de Lead',
          body: isOwnLead
            ? `${requesterName} solicita reasignar a su cliente ${leadData.name || leadData.phone}${targetAdvisorName ? ` a ${targetAdvisorName}` : ''}.${reason ? ` Motivo: ${reason}` : ''}`
            : `${requesterName} solicita el traslado del cliente ${leadData.name || leadData.phone} (actualmente con ${currentAdvisorName}).`,
          url: '/dashboard/leads',
          type: 'transfer_request',
          leadId: targetDoc.id,
        }).catch(() => {});
      }
    } catch {}

    // Notificar inmediatamente por WhatsApp a Dirección Comercial (Eduardo Salcedo / Admins)
    sendTransferAlertWhatsapp({
      companyId,
      requestId: reqRef.id,
      actionToken,
      leadId: targetDoc.id,
      leadName: leadData.name || suggestedName || 'Prospecto',
      leadPhone: leadData.phone || phone,
      project: project || (leadData.projectInterest && leadData.projectInterest[0]) || leadData.metadata?.project || '',
      currentAdvisorName,
      requesterName,
      targetAdvisorName,
      reason: reason || (isOwnLead ? 'Solicita reasignar prospecto de su cartera' : 'Solicita traslado de prospecto'),
      lastFollowUpSummary: followUpAudit.lastFollowUpSummary,
      daysSinceFollowUp: followUpAudit.daysSinceFollowUp,
    }).catch((err) => {
      logger.warn('[TransferRequest] No se pudo enviar alerta de traslado por WhatsApp a admins', {
        companyId,
        requestId: reqRef.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    logger.info('[TransferRequest] Solicitud de traslado creada', {
      companyId,
      requestId: reqRef.id,
      leadId: targetDoc.id,
      requesterId: ctx.uid,
      currentAdvisorId: leadData.assignedTo,
    });

    return { ok: true, requestId: reqRef.id, alreadyPending: false };
  }
);

/**
 * Lista las solicitudes de traslado (para Administradores: todas con auditoría en vivo del último seguimiento;
 * para Asesores: sus propias solicitudes).
 */
export const listLeadTransferRequests = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    const parsedList = z.object({
      companyId: z.string().min(1),
      status: z.enum(['pending', 'approved', 'rejected', 'all']).optional().nullable(),
    }).parse(request.data);
    const companyId = parsedList.companyId;
    const status = parsedList.status || 'pending';
    assertCompany(ctx, companyId);

    const isAdmin = ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role as never);

    let query: FirebaseFirestore.Query = transferRequestsCol(companyId);
    if (!isAdmin) {
      query = query.where('requesterId', '==', ctx.uid);
    }
    if (status === 'pending') {
      query = query.where('status', '==', 'pending');
    }

    const snap = await query.limit(100).get();
    const docs = [...snap.docs].sort(
      (a, b) => (b.data().createdAt?.toMillis?.() ?? 0) - (a.data().createdAt?.toMillis?.() ?? 0)
    );

    const items = await Promise.all(
      docs.map(async (doc) => {
        const d = doc.data();
        let lastFollowUpMillis = d.lastFollowUpMillis ?? null;
        let daysSinceFollowUp = d.daysSinceFollowUp ?? null;
        let lastFollowUpSummary = d.lastFollowUpSummary ?? null;
        let assignedAtMillis = d.assignedAtMillis ?? null;

        // Si está pendiente y es admin, refrescar en vivo los datos reales del último seguimiento del asesor actual
        if (isAdmin && d.status === 'pending' && d.leadId) {
          try {
            const leadSnap = await leadCollection(companyId).doc(d.leadId).get();
            if (leadSnap.exists) {
              const liveAudit = await inspectLeadLastFollowUp(companyId, d.leadId, leadSnap.data() ?? {}, d.currentAdvisorId);
              lastFollowUpMillis = liveAudit.lastFollowUpMillis;
              daysSinceFollowUp = liveAudit.daysSinceFollowUp;
              lastFollowUpSummary = liveAudit.lastFollowUpSummary;
              assignedAtMillis = liveAudit.assignedAtMillis;
            }
          } catch {}
        }

        const createdAtMillis = d.createdAt?.toMillis?.() ?? Date.now();
        const resolvedAtMillis = d.resolvedAt?.toMillis?.() ?? null;
        return {
          id: doc.id,
          leadId: d.leadId,
          leadName: d.leadName || 'Prospecto',
          suggestedName: d.suggestedName || null,
          leadPhone: d.leadPhone || '',
          project: d.project || '',
          leadProject: d.project || '',
          leadSource: d.leadSource || '',
          currentAdvisorId: d.currentAdvisorId || null,
          currentAdvisorName: d.currentAdvisorName || 'Sin Asignar',
          requesterId: d.requesterId,
          requesterName: d.requesterName || 'Asesor',
          reason: d.reason || '',
          lastFollowUpMillis,
          daysSinceFollowUp,
          lastFollowUpSummary: lastFollowUpSummary || '',
          assignedAtMillis,
          status: d.status as 'pending' | 'approved' | 'rejected',
          createdAt: createdAtMillis,
          createdAtMillis,
          resolvedAt: resolvedAtMillis,
          resolvedAtMillis,
          resolvedByName: d.resolvedByName || '',
          adminNote: d.adminNote || '',
          targetAdvisorId: d.targetAdvisorId || null,
          targetAdvisorName: d.targetAdvisorName || null,
          isReassignmentRequest: Boolean(d.isReassignmentRequest ?? (d.requesterId === d.currentAdvisorId)),
        };
      })
    );

    return { requests: items };
  }
);

/**
 * Permite al Administrador aprobar o rechazar una solicitud de traslado.
 * Si aprueba, transfiere el lead al asesor solicitante, activa el muro de privacidad y deja bitácora.
 */
export const resolveLeadTransferRequest = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const parsedInput = z.object({
      companyId: z.string().min(1),
      requestId: z.string().min(1),
      action: z.enum(['approve', 'reject']).optional().nullable(),
      decision: z.enum(['approve', 'reject']).optional().nullable(),
      adminNote: z.string().trim().max(500).optional().nullable(),
      targetAdvisorId: z.string().optional().nullable(),
    }).parse(request.data);
    const { companyId, requestId } = parsedInput;
    const adminNote = parsedInput.adminNote || undefined;
    const action = parsedInput.action || parsedInput.decision || 'approve';
    assertCompany(ctx, companyId);

    let adminName = 'Administrador';
    try {
      const aSnap = await db.collection('companies').doc(companyId).collection('users').doc(ctx.uid).get();
      if (aSnap.exists) {
        adminName = (aSnap.data()?.displayName as string) || (aSnap.data()?.email as string) || 'Administrador';
      }
    } catch {}

    const result = await executeResolveLeadTransferRequest({
      companyId,
      requestId,
      action: action as 'approve' | 'reject',
      adminNote,
      targetAdvisorId: parsedInput.targetAdvisorId,
      resolvedById: ctx.uid,
      resolvedByName: adminName,
    });

    if (!result.ok) {
      throw new HttpsError('failed-precondition', result.message || 'No se pudo procesar la solicitud.');
    }

    sendTransferResolutionConfirmationWhatsapp({
      companyId,
      requestId,
      action: result.status,
      leadName: result.leadName,
      leadPhone: result.leadPhone,
      newAdvisorName: result.newAdvisorName,
      resolvedByName: adminName,
    }).catch(() => {});

    return { ok: true, status: result.status };
  }
);

export const createContact = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);
    const schema = z.object({
      companyId: z.string().min(1),
      name: z.string().trim().max(120).optional().nullable().default(''),
      phone: z.string().trim().min(7).max(40),
      email: z.string().trim().max(160).optional().nullable().default(''),
      company: z.string().trim().max(160).optional().nullable().default(''),
      project: z.string().trim().max(120).optional().nullable(),
      targetAdvisorId: z.string().optional().nullable(),
      tags: z.array(z.string()).optional().nullable(),
      assignedTo: z.string().optional().nullable(),
      notes: z.string().trim().max(2000).optional().nullable(),
      fuenteUbicacion: z.string().trim().max(120).optional().nullable(),
    });

    const parsed = schema.safeParse(request.data);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new HttpsError('invalid-argument', `Datos inválidos: ${issues}`);
    }
    const data = parsed.data;
    assertCompany(ctx, data.companyId);

    const normalized = normalizeImportedPhone(data.phone);
    if (!normalized) {
      throw new HttpsError(
        'invalid-argument',
        'El número celular no es válido. Debe contener al menos 10 dígitos (ej: 3001234567 o +573001234567).'
      );
    }

    const now = Timestamp.now();
    const isAdmin = ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role as never);
    const targetAdvisorId = (isAdmin && data.assignedTo) ? data.assignedTo : ctx.uid;

    // Regla de Exclusividad: Verificar si ya existe un lead con ese número
    const isColombianNumber = normalized.phone.startsWith('+57');
    const tail = normalized.phone.slice(-10);
    const [byNorm, byPhone, byTail] = await Promise.all([
      leadCollection(data.companyId).where('normalizedPhone', '==', normalized.normalizedPhone).limit(1).get(),
      leadCollection(data.companyId).where('phone', '==', normalized.phone).limit(1).get(),
      isColombianNumber
        ? leadCollection(data.companyId).where('phoneTail', '==', tail).limit(1).get()
        : Promise.resolve({ empty: true, docs: [] } as unknown as FirebaseFirestore.QuerySnapshot),
    ]);

    const existingDoc = !byNorm.empty ? byNorm.docs[0] : (!byPhone.empty ? byPhone.docs[0] : (!byTail.empty ? byTail.docs[0] : null));
    if (existingDoc) {
      const d = existingDoc.data();
      const isOwnLead = d.assignedTo === targetAdvisorId;
      const isUnassigned = !d.assignedTo;

      // Si pertenece a otro asesor y quien intenta crearlo NO es administrador -> bloquear limpiamente
      if (!isOwnLead && !isUnassigned && !isAdmin) {
        throw new HttpsError(
          'already-exists',
          'Este número ya se encuentra asignado a otro asesor. Puedes solicitar el traslado desde este mismo formulario.'
        );
      }

      const updatedTags = Array.from(new Set([
        ...(d.tags || []),
        ...(data.tags || []),
      ]));

      const patch: Record<string, any> = {
        assignedTo: targetAdvisorId,
        updatedAt: now,
        tags: updatedTags,
        ...(data.name && (!d.name || d.name.startsWith('Lead ')) ? { name: data.name } : {}),
        ...(data.project ? { projectInterest: Array.from(new Set([data.project, ...(d.projectInterest || [])])) } : {}),
        ...(data.fuenteUbicacion ? { fuenteUbicacion: data.fuenteUbicacion } : {}),
      };

      if (!isOwnLead) {
        patch.previousAdvisorId = d.assignedTo || null;
        patch.advisorAssignedAt = now;
      }

      if (data.notes) {
        let author = 'Asesor';
        try {
          const uSnap = await db.collection('companies').doc(data.companyId).collection('users').doc(ctx.uid).get();
          if (uSnap.exists) {
            author = (uSnap.data()?.displayName as string) || (uSnap.data()?.email as string) || 'Asesor';
          }
        } catch {}

        const nowFormatted = new Date(Date.now() - 5 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
        const newBitEntry = {
          fecha: nowFormatted,
          action: 'Nota de Ingreso Comercial',
          description: data.notes.slice(0, 200),
          asesor: author,
          lastDate: nowFormatted,
        };
        const existingBitacoras = [
          ...(Array.isArray(d.bitacoras) ? d.bitacoras : []),
          ...(Array.isArray(d.metadata?.smarthomeBitacoras) ? d.metadata.smarthomeBitacoras : []),
        ];
        const updatedBit = [newBitEntry, ...existingBitacoras].slice(0, 50);
        patch.bitacoras = updatedBit;
        patch['metadata.smarthomeBitacoras'] = updatedBit;
        patch.lastFollowUpAt = now;
        patch.lastFollowUpAction = 'nota_comercial';
        patch.lastFollowUpSummary = data.notes.slice(0, 180);
        patch.lastFollowUpAuthor = author;

        await existingDoc.ref.collection('notes').doc().set({
          authorUid: ctx.uid,
          authorName: author,
          text: data.notes,
          kind: 'note',
          createdAt: now,
          updatedAt: now,
        });
      }

      await existingDoc.ref.update(patch);

      return { leadId: existingDoc.id, existed: true, reclaimed: false };
    }

    const metadata: Record<string, string> = {
      ...(data.email ? { email: data.email } : {}),
      ...(data.company ? { company: data.company } : {}),
      ...(data.project ? { project: data.project } : {}),
    };

    const initialTags = Array.from(new Set([
      ...(data.tags || []),
      'outbound_propio',
    ]));

    const ref = leadCollection(data.companyId).doc();
    await ref.set({
      companyId: data.companyId,
      name: data.name || `Lead ${normalized.phone}`,
      phone: normalized.phone,
      normalizedPhone: normalized.normalizedPhone,
      phoneTail: tail,
      status: 'new',
      pipelineStage: 'nuevo',
      source: 'manual',
      inbox: 'advisor_direct',
      fuenteUbicacion: data.fuenteUbicacion || 'Trabajo de campo',
      channel: 'whatsapp',
      aiEnabled: false,
      assignedTo: targetAdvisorId,
      advisorAssignedAt: now,
      projectInterest: data.project ? [data.project] : [],
      createdAt: now,
      updatedAt: now,
      tags: initialTags,
      listIds: [],
      metadata,
    });

    if (data.notes) {
      let author = 'Asesor';
      try {
        const uSnap = await db.collection('companies').doc(data.companyId).collection('users').doc(ctx.uid).get();
        if (uSnap.exists) {
          author = (uSnap.data()?.displayName as string) || (uSnap.data()?.email as string) || 'Asesor';
        }
      } catch { /* best effort */ }

      await db.collection('companies').doc(data.companyId)
        .collection('leads').doc(ref.id)
        .collection('notes').doc().set({
          authorUid: ctx.uid,
          authorName: author,
          text: data.notes,
          kind: 'note',
          createdAt: now,
          updatedAt: now,
        });
    }

    logger.info('[Contacts] Contacto outbound manual creado', {
      companyId: data.companyId,
      leadId: ref.id,
      by: ctx.uid,
      assignedTo: targetAdvisorId,
      project: data.project,
    });
    return { leadId: ref.id, existed: false, reclaimed: false };
  }
);

export const importLeadsChunk = onCall(
  { region: 'us-central1', timeoutSeconds: 120, memory: '512MiB' },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const data = z.object({
      companyId: z.string().min(1),
      listId: z.string().min(1),
      rows: z.array(ImportRowSchema).min(1).max(300),
      tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    }).parse(request.data);
    assertCompany(ctx, data.companyId);

    const listRef = listCollection(data.companyId).doc(data.listId);
    const listSnap = await listRef.get();
    if (!listSnap.exists || listSnap.data()?.kind !== 'import') {
      throw new HttpsError('failed-precondition', 'La lista de importacion no existe.');
    }

    const unique = new Map<string, z.infer<typeof ImportRowSchema> & { formattedPhone: string }>();
    let invalid = 0;
    for (const row of data.rows) {
      const normalized = normalizeImportedPhone(row.phone);
      if (!normalized) {
        invalid++;
        continue;
      }
      unique.set(normalized.normalizedPhone, { ...row, formattedPhone: normalized.phone });
    }

    const phones = [...unique.keys()];
    const existing = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    for (let index = 0; index < phones.length; index += 30) {
      const phoneChunk = phones.slice(index, index + 30);
      if (!phoneChunk.length) continue;
      const snap = await leadCollection(data.companyId).where('normalizedPhone', 'in', phoneChunk).get();
      for (const doc of snap.docs) existing.set(doc.data().normalizedPhone, doc);
    }

    const now = Timestamp.now();
    const batch = db.batch();
    let created = 0;
    let updated = 0;

    for (const [normalizedPhone, row] of unique) {
      const existingDoc = existing.get(normalizedPhone);
      const metadata = {
        ...(existingDoc?.data().metadata ?? {}),
        ...(row.email ? { email: row.email } : {}),
        ...(row.company ? { company: row.company } : {}),
        ...row.metadata,
      };

      if (existingDoc) {
        batch.update(existingDoc.ref, {
          ...(row.name ? { name: row.name } : {}),
          listIds: FieldValue.arrayUnion(data.listId),
          ...(data.tags.length ? { tags: FieldValue.arrayUnion(...data.tags) } : {}),
          metadata,
          updatedAt: now,
        });
        updated++;
      } else {
        const ref = leadCollection(data.companyId).doc();
        batch.set(ref, {
          companyId: data.companyId,
          name: row.name || `Lead ${row.formattedPhone}`,
          phone: row.formattedPhone,
          normalizedPhone,
          phoneTail: row.formattedPhone.slice(-10),
          status: 'new',
          pipelineStage: 'nuevo',
          source: 'manual',
          fuenteUbicacion: 'Base de Datos General',
          aiEnabled: false,
          createdAt: now,
          updatedAt: now,
          tags: data.tags,
          listIds: [data.listId],
          metadata,
        });
        created++;
      }
    }

    batch.update(listRef, {
      updatedAt: now,
      lastImportAt: now,
      importedCount: FieldValue.increment(created + updated),
      importedCreated: FieldValue.increment(created),
      importedUpdated: FieldValue.increment(updated),
      importedInvalid: FieldValue.increment(invalid),
    });
    await batch.commit();

    logger.info('[LeadImport] Lote importado', {
      companyId: data.companyId, listId: data.listId, created, updated, invalid,
    });
    return { created, updated, invalid };
  }
);
