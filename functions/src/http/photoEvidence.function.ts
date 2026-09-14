import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../lib/admin';
import { logger } from '../utils/logger';
import { requireAuth, requireRole, assertCompany, WRITE_ROLES, ADMIN_ROLES } from '../lib/authContext';
import { leadsRepository } from '../modules/leads/leads.repository';
import type { Lead } from '../modules/leads/leads.types';
import { resolveOwnerId } from '../modules/smarthome/smarthomeSync.service';
import { postLeadSmartHomeManualEvent } from '../modules/smarthome/smarthomeAdmin.service';
import { resolveSmartHomeProspectForLead } from '../modules/smarthome/smarthomeEvents.service';
import { getSmartHomeUsers } from '../integrations/smarthome/smarthome.client';
import { phoneTail, toNormalizedPhone } from '../utils/phone';

async function crmUserName(companyId: string, uid: string): Promise<string> {
  const snap = await db.collection('companies').doc(companyId).collection('users').doc(uid).get();
  const data = snap.data() ?? {};
  return String(data.displayName || data.email || uid).trim();
}

function cleanText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function recordValue(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

async function getSmartHomeAccess(
  companyId: string,
  uid: string,
  lead: Awaited<ReturnType<typeof leadsRepository.findById>>
): Promise<{ allowed: boolean; message: string; actorSmartHomeUserId?: string; authorName?: string }> {
  if (!lead) return { allowed: false, message: 'Lead no encontrado.' };

  const actor = await resolveOwnerId(companyId, uid);
  if (!actor.ownerId) {
    return { allowed: false, message: 'Tu usuario no tiene asesor asociado en SmartHome.' };
  }

  const authorName = await crmUserName(companyId, uid);
  const ref = await resolveSmartHomeProspectForLead(lead);
  if (!ref) {
    // Si no tiene prospecto en SmartHome todavía, permitimos al asesor asignado registrar
    if (lead.assignedTo === uid) {
      return { allowed: true, message: '', actorSmartHomeUserId: actor.ownerId, authorName };
    }
    return { allowed: false, message: 'Prospecto de SmartHome no encontrado.' };
  }

  const prospect = ref.prospect as Record<string, unknown>;
  const ownerId = recordValue(prospect, [
    'ownerId', 'OwnerId', 'userId', 'UserId', 'sellerId', 'SellerId',
    'advisorId', 'AdvisorId', 'asesorId', 'AsesorId', 'vendedorId', 'VendedorId',
  ]);
  const storedAdvisorId = String(lead.smartHomeAdvisorId ?? '').trim();

  if (ownerId) {
    if (ownerId !== actor.ownerId) {
      return {
        allowed: false,
        message: 'Este prospecto está asignado a otro asesor en SmartHome.',
      };
    }
    return { allowed: true, message: '', actorSmartHomeUserId: actor.ownerId, authorName };
  }

  if (storedAdvisorId) {
    if (storedAdvisorId !== actor.ownerId) {
      return {
        allowed: false,
        message: 'Este prospecto está asignado a otro asesor en SmartHome.',
      };
    }
    return { allowed: true, message: '', actorSmartHomeUserId: actor.ownerId, authorName };
  }

  if (lead.assignedTo === uid && lead.smartHomeCustomerId) {
    return { allowed: true, message: '', actorSmartHomeUserId: actor.ownerId, authorName };
  }

  const ownerName = cleanText(recordValue(prospect, [
    'ownerName', 'OwnerName', 'sellerName', 'SellerName',
    'advisorName', 'AdvisorName', 'Asesor', 'Vendedor',
  ]));

  const users = await getSmartHomeUsers(true);
  const smartHomeUser = users?.find((u) => u.userId === actor.ownerId);
  const allowedNames = [
    `${smartHomeUser?.firstName ?? ''} ${smartHomeUser?.lastName ?? ''}`,
    smartHomeUser?.email,
    authorName,
  ].map(cleanText).filter(Boolean);

  if (ownerName && !allowedNames.some((n) => n && (n === ownerName || n.includes(ownerName) || ownerName.includes(n)))) {
    return {
      allowed: false,
      message: `Este prospecto aparece asignado a "${recordValue(prospect, ['ownerName', 'sellerName', 'advisorName', 'Asesor'])}" en SmartHome.`,
    };
  }

  return { allowed: true, message: '', actorSmartHomeUserId: actor.ownerId, authorName };
}

export const searchLeadForPhotoEvidence = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const { companyId, phone } = z.object({
      companyId: z.string().min(1),
      phone:     z.string().min(1).max(50),
    }).parse(request.data);

    assertCompany(ctx, companyId);

    const rawPhone = phone.trim();
    const tail = phoneTail(rawPhone);
    const normalized = toNormalizedPhone(rawPhone);
    const digitsOnly = rawPhone.replace(/\D/g, '');

    let lead: Awaited<ReturnType<typeof leadsRepository.findById>> | null = null;

    // 1. Buscar por phoneTail si tiene al menos 7-9 dígitos
    if (tail) {
      lead = await leadsRepository.findByPhoneTail(companyId, tail);
    }

    // 2. Buscar por normalizedPhone
    if (!lead && normalized) {
      lead = await leadsRepository.findByNormalizedPhone(companyId, normalized);
    }

    // 3. Buscar por coincidencia exacta en campo phone
    if (!lead) {
      const snap = await db.collection('companies').doc(companyId).collection('leads')
        .where('phone', '==', rawPhone)
        .limit(1)
        .get();
      if (!snap.empty) {
        lead = { id: snap.docs[0].id, ...snap.docs[0].data() } as unknown as Lead;
      }
    }

    // 4. Probar con prefijo +57 si son 10 dígitos colombianos
    if (!lead && /^\d{10}$/.test(digitsOnly) && digitsOnly.startsWith('3')) {
      const colSnap = await db.collection('companies').doc(companyId).collection('leads')
        .where('phone', '==', `+57${digitsOnly}`)
        .limit(1)
        .get();
      if (!colSnap.empty) {
        lead = { id: colSnap.docs[0].id, ...colSnap.docs[0].data() } as unknown as Lead;
      }
    }

    if (!lead) {
      return {
        found: false,
        message: `No se encontró ningún contacto con el número "${rawPhone}".`,
        lead: null,
      };
    }

    // Obtener información del asesor asignado en CRM
    let assignedAdvisorName = 'Sin asignar';
    if (lead.assignedTo) {
      const userDoc = await db.collection('companies').doc(companyId).collection('users').doc(lead.assignedTo).get();
      if (userDoc.exists) {
        const userData = userDoc.data() ?? {};
        assignedAdvisorName = String(userData.displayName || userData.email || lead.assignedTo);
      }
    }

    const isAdmin = ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role as never);
    const isAssigned = lead.assignedTo === ctx.uid;
    const smartHomeAccess = await getSmartHomeAccess(companyId, ctx.uid, lead);

    // Puede subir evidencia si es el asesor asignado en CRM, o tiene acceso SmartHome, o es admin
    const canUpload = isAdmin || isAssigned || smartHomeAccess.allowed;

    let permissionMessage = '';
    if (!canUpload) {
      if (assignedAdvisorName !== 'Sin asignar') {
        permissionMessage = `Este contacto está asignado al asesor ${assignedAdvisorName}. Solo el asesor propietario o un administrador puede registrar evidencias fotográficas.`;
      } else {
        permissionMessage = smartHomeAccess.message || 'No tienes permisos para registrar evidencias en este contacto.';
      }
    }

    // Traer las evidencias fotográficas previas registradas para este lead
    const evidencesSnap = await db.collection('companies').doc(companyId)
      .collection('leads').doc(lead.id)
      .collection('photo_evidence')
      .orderBy('createdAt', 'desc')
      .limit(30)
      .get();

    const evidences = evidencesSnap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        photoUrl: d.photoUrl,
        storagePath: d.storagePath,
        notes: d.notes,
        actionLabel: d.actionLabel,
        context: d.context,
        authorId: d.authorId,
        authorName: d.authorName,
        createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : (d.createdAt ?? null),
        smartHomeSynced: !!d.smartHomeSynced,
        smartHomeResult: d.smartHomeResult ?? null,
      };
    });

    return {
      found: true,
      lead: {
        id: lead.id,
        name: lead.name || 'Sin nombre',
        phone: lead.phone || rawPhone,
        status: lead.status || 'new',
        assignedTo: lead.assignedTo ?? null,
        assignedAdvisorName,
        smartHomeCustomerId: lead.smartHomeCustomerId ?? null,
        smartHomeSyncError: lead.smartHomeSyncError ?? null,
      },
      canUpload,
      message: permissionMessage,
      evidences,
    };
  }
);

export const submitPhotoEvidence = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const input = z.object({
      companyId:     z.string().min(1),
      leadId:        z.string().min(1),
      photoUrl:      z.string().url().min(1),
      storagePath:   z.string().min(1),
      notes:         z.string().trim().max(2000).default(''),
      actionLabel:   z.string().trim().max(120).default('Visita Terreno Realizada'),
      context:       z.string().trim().max(120).default('Comercial'),
      isAnEvent:     z.boolean().default(false),
      scheduledDate: z.string().trim().max(32).nullish(),
    }).parse(request.data);

    assertCompany(ctx, input.companyId);

    const lead = await leadsRepository.findById(input.companyId, input.leadId);
    if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');

    const isAdmin = ctx.platformAdmin || ADMIN_ROLES.includes(ctx.role as never);
    const isAssigned = lead.assignedTo === ctx.uid;
    const smartHomeAccess = await getSmartHomeAccess(input.companyId, ctx.uid, lead);

    if (!isAdmin && !isAssigned && !smartHomeAccess.allowed) {
      throw new HttpsError('permission-denied', 'No tienes permiso para registrar evidencia en este contacto.');
    }

    const currentAuthorName = await crmUserName(input.companyId, ctx.uid);

    // Preparar el contenido del evento para SmartHome
    const eventTextLines = [
      input.notes.trim() ? input.notes.trim() : 'Registro de evidencia fotográfica.',
      '',
      `📷 Evidencia fotográfica: ${input.photoUrl}`,
    ];
    const eventContent = eventTextLines.join('\n');

    let smartHomeResult: { ok: boolean; reason?: string; prospectId?: string } | null = null;

    try {
      smartHomeResult = await postLeadSmartHomeManualEvent(lead, {
        authorName: currentAuthorName,
        actionLabel: input.actionLabel,
        context: input.context,
        eventContent,
        isAnEvent: input.isAnEvent,
        userId: smartHomeAccess.actorSmartHomeUserId,
        ...(input.scheduledDate ? { scheduledDate: input.scheduledDate } : {}),
      });
    } catch (shErr) {
      logger.warn('[PhotoEvidence] SmartHome event error', {
        error: shErr instanceof Error ? shErr.message : String(shErr),
      });
      smartHomeResult = {
        ok: false,
        reason: shErr instanceof Error ? shErr.message : 'Error al conectar con SmartHome',
      };
    }

    const now = FieldValue.serverTimestamp();
    const evidenceData = {
      companyId: input.companyId,
      leadId: input.leadId,
      leadName: lead.name || 'Sin nombre',
      leadPhone: lead.phone || '',
      photoUrl: input.photoUrl,
      storagePath: input.storagePath,
      notes: input.notes.trim(),
      actionLabel: input.actionLabel,
      context: input.context,
      isAnEvent: input.isAnEvent,
      scheduledDate: input.scheduledDate || null,
      authorId: ctx.uid,
      authorName: currentAuthorName,
      createdAt: now,
      smartHomeSynced: !!smartHomeResult?.ok,
      smartHomeResult: smartHomeResult ?? null,
    };

    // 1. Guardar en la subcolección del lead
    const leadEvidenceRef = await db.collection('companies').doc(input.companyId)
      .collection('leads').doc(input.leadId)
      .collection('photo_evidence')
      .add(evidenceData);

    // 2. Guardar en la colección global de photo_evidence de la empresa
    await db.collection('companies').doc(input.companyId)
      .collection('photo_evidence')
      .doc(leadEvidenceRef.id)
      .set({
        ...evidenceData,
        id: leadEvidenceRef.id,
      });

    // 3. Actualizar metadatos en el lead
    await db.collection('companies').doc(input.companyId)
      .collection('leads').doc(input.leadId)
      .set({
        lastPhotoEvidenceAt: now,
        lastPhotoEvidenceUrl: input.photoUrl,
        smartHomeLastBitacoraAt: now,
        smartHomeLastBitacoraBy: ctx.uid,
        smartHomeLastBitacoraByName: currentAuthorName,
        smartHomeLastBitacoraText: input.notes.slice(0, 240) || 'Registro fotográfico',
        smartHomeLastActionLabel: input.actionLabel,
        smartHomeTrackingUpdatedAt: now,
      }, { merge: true });

    logger.info('[PhotoEvidence] Evidencia guardada exitosamente', {
      companyId: input.companyId,
      leadId: input.leadId,
      evidenceId: leadEvidenceRef.id,
      smartHomeSynced: smartHomeResult?.ok,
    });

    return {
      ok: true,
      evidenceId: leadEvidenceRef.id,
      smartHomeSynced: !!smartHomeResult?.ok,
      smartHomeResult,
    };
  }
);

export const listPhotoEvidences = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const { companyId, leadId, limit = 20 } = z.object({
      companyId: z.string().min(1),
      leadId:    z.string().optional(),
      limit:     z.number().int().min(1).max(50).default(20),
    }).parse(request.data);

    assertCompany(ctx, companyId);

    let query = db.collection('companies').doc(companyId)
      .collection('photo_evidence')
      .orderBy('createdAt', 'desc')
      .limit(limit);

    if (leadId) {
      query = db.collection('companies').doc(companyId)
        .collection('leads').doc(leadId)
        .collection('photo_evidence')
        .orderBy('createdAt', 'desc')
        .limit(limit) as typeof query;
    }

    const snap = await query.get();
    const items = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        leadId: d.leadId,
        leadName: d.leadName ?? '',
        leadPhone: d.leadPhone ?? '',
        photoUrl: d.photoUrl,
        storagePath: d.storagePath,
        notes: d.notes ?? '',
        actionLabel: d.actionLabel ?? 'Registro fotográfico',
        context: d.context ?? 'Comercial',
        authorId: d.authorId,
        authorName: d.authorName,
        createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : (d.createdAt ?? null),
        smartHomeSynced: !!d.smartHomeSynced,
        smartHomeResult: d.smartHomeResult ?? null,
      };
    });

    return { items };
  }
);
