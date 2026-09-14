import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { env } from '../config/env';
import { db } from '../lib/admin';
import { leadsRepository } from '../modules/leads/leads.repository';
import { resolveOwnerId, syncLeadToSmartHome } from '../modules/smarthome/smarthomeSync.service';
import {
  changeLeadSmartHomeAdvisor,
  changeLeadSmartHomeSaleCycleStage,
  postLeadSmartHomeManualEvent,
} from '../modules/smarthome/smarthomeAdmin.service';
import { resolveSmartHomeProspectForLead } from '../modules/smarthome/smarthomeEvents.service';
import { getSmartHomeSaleCycleStages, getSmartHomeUsers } from '../integrations/smarthome/smarthome.client';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES, WRITE_ROLES } from '../lib/authContext';

async function crmUserName(companyId: string, uid: string): Promise<string> {
  const snap = await db.collection('companies').doc(companyId).collection('users').doc(uid).get();
  const data = snap.data() ?? {};
  return String(data.displayName || data.email || uid).trim();
}

const SHORT_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** Código corto aleatorio (base62) para el redireccionador de evidencia. */
function shortCode(length = 10): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += SHORT_CODE_ALPHABET[bytes[i] % SHORT_CODE_ALPHABET.length];
  return out;
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

async function assertSmartHomeProspectOwner(
  companyId: string,
  uid: string,
  lead: Awaited<ReturnType<typeof leadsRepository.findById>>
): Promise<{ actorSmartHomeUserId: string; authorName: string }> {
  if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');

  const actor = await resolveOwnerId(companyId, uid);
  if (!actor.ownerId) {
    throw new HttpsError('failed-precondition', 'Tu usuario no tiene asesor asociado en SmartHome.');
  }

  const ref = await resolveSmartHomeProspectForLead(lead);
  if (!ref) throw new HttpsError('failed-precondition', 'Prospecto de SmartHome no encontrado.');

  const prospect = ref.prospect as Record<string, unknown>;
  const ownerId = recordValue(prospect, [
    'ownerId',
    'OwnerId',
    'userId',
    'UserId',
    'sellerId',
    'SellerId',
    'advisorId',
    'AdvisorId',
    'asesorId',
    'AsesorId',
    'vendedorId',
    'VendedorId',
  ]);
  const storedAdvisorId = String(lead.smartHomeAdvisorId ?? '').trim();

  if (ownerId) {
    if (ownerId !== actor.ownerId) {
      throw new HttpsError('permission-denied', 'Este prospecto esta asignado a otro asesor en SmartHome. Solicita el cambio de asesor al administrador.');
    }
    return { actorSmartHomeUserId: actor.ownerId, authorName: await crmUserName(companyId, uid) };
  }

  if (storedAdvisorId) {
    if (storedAdvisorId !== actor.ownerId) {
      throw new HttpsError('permission-denied', 'Este prospecto esta asignado a otro asesor en SmartHome. Solicita el cambio de asesor al administrador.');
    }
    return { actorSmartHomeUserId: actor.ownerId, authorName: await crmUserName(companyId, uid) };
  }

  if (lead.assignedTo === uid && lead.smartHomeCustomerId) {
    return { actorSmartHomeUserId: actor.ownerId, authorName: await crmUserName(companyId, uid) };
  }

  const ownerName = cleanText(recordValue(prospect, [
    'ownerName',
    'OwnerName',
    'sellerName',
    'SellerName',
    'advisorName',
    'AdvisorName',
    'Asesor',
    'Vendedor',
  ]));

  const users = await getSmartHomeUsers(true);
  const smartHomeUser = users?.find((u) => u.userId === actor.ownerId);
  const authorName = await crmUserName(companyId, uid);
  const allowedNames = [
    `${smartHomeUser?.firstName ?? ''} ${smartHomeUser?.lastName ?? ''}`,
    smartHomeUser?.email,
    authorName,
  ].map(cleanText).filter(Boolean);

  if (!ownerName || !allowedNames.includes(ownerName)) {
    throw new HttpsError('permission-denied', 'Este prospecto esta asignado a otro asesor en SmartHome. Solicita el cambio de asesor al administrador.');
  }

  return { actorSmartHomeUserId: actor.ownerId, authorName };
}

/**
 * Crea (o previsualiza) un lead del CRM en SmartHome. Solo admin/manager.
 * - dryRun:true → resuelve el asesor (ownerId) y muestra qué se enviaría, SIN crear nada.
 * - dryRun:false → crea el cliente en SmartHome (Laguna Mar / cupo1 / WHATSAPP IA).
 */
export const syncLeadToSmartHomeCallable = onCall(
  { region: 'us-central1', timeoutSeconds: 180 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);

    const { companyId, leadId, dryRun } = z.object({
      companyId: z.string().min(1),
      leadId:    z.string().min(1),
      dryRun:    z.boolean().default(true),   // por seguridad, por defecto NO envía
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const lead = await leadsRepository.findById(companyId, leadId);
    if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');

    if (dryRun) {
      if (!lead.assignedTo) return { dryRun: true, wouldCreate: false, reason: 'lead-sin-asesor' };
      const { ownerId, email } = await resolveOwnerId(companyId, lead.assignedTo);
      return {
        dryRun: true,
        wouldCreate: !!ownerId,
        reason: ownerId ? 'listo' : (email ? 'asesor-no-existe-en-smarthome' : 'asesor-sin-email'),
        advisorEmail: email,
        ownerId,
        target: {
          project:          env.smartHomeProject(),
          moduleId:         env.smartHomeModuleId(),
          locationSourceId: env.smartHomeSourceId(),
          origin:           env.smartHomeAttendedIn(),
        },
        alreadySynced: !!lead.smartHomeCustomerId,
      };
    }

    const result = await syncLeadToSmartHome(lead);
    return { dryRun: false, ...result };
  }
);

/** Lista los asesores de SmartHome (para configurar/mapear). Admin/manager. */
export const listSmartHomeAdvisors = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(request.data);
    assertCompany(ctx, companyId);

    const users = await getSmartHomeUsers(true);
    if (!users) throw new HttpsError('unavailable', 'No se pudo consultar SmartHome.');
    return { advisors: users.map((u) => ({ userId: u.userId, name: `${u.firstName} ${u.lastName}`.trim(), email: u.email })) };
  }
);

export const listSmartHomeStages = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);
    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(request.data);
    assertCompany(ctx, companyId);

    const configuredSnap = await db
      .collection('companies')
      .doc(companyId)
      .collection('config')
      .doc('smartHome')
      .get();
    const configuredStages = Array.isArray(configuredSnap.data()?.stages)
      ? configuredSnap.data()?.stages as Array<{ stageId?: unknown; name?: unknown; cycleId?: unknown; cycleName?: unknown }>
      : [];

    const stages = await getSmartHomeSaleCycleStages();
    const rows = [
      ...configuredStages
        .map((stage) => ({
          stageId: String(stage.stageId ?? '').trim(),
          name: String(stage.name ?? '').trim(),
          cycleId: String(stage.cycleId ?? '').trim(),
          cycleName: String(stage.cycleName ?? '').trim(),
        }))
        .filter((stage) => stage.stageId && stage.name),
      ...(stages ?? []),
    ];

    const seen = new Set<string>();
    return {
      stages: rows.filter((stage) => {
        if (seen.has(stage.stageId)) return false;
        seen.add(stage.stageId);
        return true;
      }).map((stage) => ({
        stageId: stage.stageId,
        name: stage.name,
        cycleId: stage.cycleId ?? '',
        cycleName: stage.cycleName ?? '',
      })),
    };
  }
);

export const changeSmartHomeLeadAdvisor = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);

    const { companyId, leadId, advisorId } = z.object({
      companyId: z.string().min(1),
      leadId:    z.string().min(1),
      advisorId: z.string().min(1),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const lead = await leadsRepository.findById(companyId, leadId);
    if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');

    const result = await changeLeadSmartHomeAdvisor(lead, advisorId);
    if (!result.ok) throw new HttpsError('failed-precondition', result.reason);
    await db.collection('companies').doc(companyId).collection('leads').doc(leadId).set({
      smartHomeAdvisorId: advisorId,
      smartHomeTrackingUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return result;
  }
);

export const changeSmartHomeLeadStage = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);

    const { companyId, leadId, stageId } = z.object({
      companyId: z.string().min(1),
      leadId:    z.string().min(1),
      stageId:   z.string().min(1),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const lead = await leadsRepository.findById(companyId, leadId);
    if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');

    const result = await changeLeadSmartHomeSaleCycleStage(lead, stageId);
    if (!result.ok) {
      throw new HttpsError('failed-precondition', result.reason);
    }
    await db.collection('companies').doc(companyId).collection('leads').doc(leadId).set({
      smartHomeStageId: stageId,
      smartHomeTrackingUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return result;
  }
);

export const getSmartHomeLeadBitacoraAccess = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const { companyId, leadId } = z.object({
      companyId: z.string().min(1),
      leadId:    z.string().min(1),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const lead = await leadsRepository.findById(companyId, leadId);
    if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');

    try {
      await assertSmartHomeProspectOwner(companyId, ctx.uid, lead);
      return { allowed: true, message: '' };
    } catch (err) {
      if (err instanceof HttpsError) {
        return { allowed: false, message: err.message };
      }
      throw err;
    }
  }
);

/**
 * Sube evidencia fotográfica de un lead: guarda el registro en el CRM (subcolección
 * `evidence` del lead) y publica una bitácora en SmartHome con el enlace de Firebase,
 * ya que la API de SmartHome (postEvent) solo acepta texto, no archivos.
 *
 * El archivo lo sube el cliente directamente a Firebase Storage (bajo
 * companies/{companyId}/media/{leadId}/…, permitido por storage.rules para la misma
 * empresa) y aquí solo se reciben las URLs ya subidas. Se valida que cada storagePath
 * pertenezca a la ruta de media del propio lead para no aceptar enlaces arbitrarios.
 */
export const postSmartHomeLeadEvidence = onCall(
  { region: 'us-central1', timeoutSeconds: 120 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const { companyId, leadId, note, actionLabel, context, attachments } = z.object({
      companyId:   z.string().min(1),
      leadId:      z.string().min(1),
      note:        z.string().trim().max(1000).optional(),
      actionLabel: z.string().trim().max(120).optional(),
      context:     z.string().trim().max(120).optional(),
      attachments: z.array(z.object({
        downloadUrl: z.string().url().max(2000),
        storagePath: z.string().min(1).max(500),
        contentType: z.string().max(120).optional(),
        fileName:    z.string().max(300).optional(),
      })).min(1).max(10),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const lead = await leadsRepository.findById(companyId, leadId);
    if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');
    const { actorSmartHomeUserId, authorName } = await assertSmartHomeProspectOwner(companyId, ctx.uid, lead);

    // Anti-inyección: cada archivo debe vivir bajo la carpeta de media de este lead.
    const expectedPrefix = `companies/${companyId}/media/${leadId}/`;
    for (const file of attachments) {
      if (!file.storagePath.startsWith(expectedPrefix)) {
        throw new HttpsError('invalid-argument', 'Evidencia con ruta de almacenamiento no válida.');
      }
    }

    // 1) Guardar en el CRM (subcolección evidence del lead) + un enlace corto por
    //    cada foto (evidenceLinks/{code}) para que la bitácora de SmartHome no lleve
    //    la URL larguísima de Firebase, sino .../ev/{code}.
    const leadRef = db.collection('companies').doc(companyId).collection('leads').doc(leadId);
    const linkBase = env.evidenceLinkBase();
    const batch = db.batch();
    const createdAt = FieldValue.serverTimestamp();
    const shortUrls = attachments.map((file) => {
      const code = shortCode();
      const shortUrl = `${linkBase}/${code}`;

      batch.set(db.collection('evidenceLinks').doc(code), {
        downloadUrl: file.downloadUrl,
        storagePath: file.storagePath,
        companyId,
        leadId,
        createdAt,
      });
      batch.set(leadRef.collection('evidence').doc(), {
        downloadUrl: file.downloadUrl,
        shortUrl,
        shortCode: code,
        storagePath: file.storagePath,
        contentType: file.contentType ?? 'image/jpeg',
        fileName:    file.fileName ?? 'evidencia.jpg',
        note:        note ?? '',
        actionLabel: actionLabel ?? 'Evidencia fotografica',
        context:     context ?? '',
        uploadedBy:  ctx.uid,
        uploadedByName: authorName,
        createdAt,
      });
      return shortUrl;
    });
    await batch.commit();

    // 2) Publicar bitácora en SmartHome con el enlace CORTO (SmartHome no acepta
    //    archivos, solo texto → se adjunta el/los enlace(s)).
    const linkLines = shortUrls.map((shortUrl, index) =>
      `Foto ${index + 1}${attachments[index].fileName ? ` (${attachments[index].fileName})` : ''}: ${shortUrl}`
    );
    const eventContent = [
      'Evidencia fotografica adjunta desde CRM Meraki',
      note ? note : '',
      ...linkLines,
    ].filter(Boolean).join('\n');

    const result = await postLeadSmartHomeManualEvent(lead, {
      eventContent,
      isAnEvent: false,
      actionLabel: actionLabel ?? 'Evidencia fotografica',
      context,
      authorName,
      userId: actorSmartHomeUserId,
    });

    await leadRef.set({
      smartHomeLastEvidenceAt: FieldValue.serverTimestamp(),
      smartHomeLastEvidenceBy: ctx.uid,
      smartHomeLastEvidenceByName: authorName,
      smartHomeLastEvidenceCount: attachments.length,
      smartHomeTrackingUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    if (!result.ok) {
      // La evidencia SÍ quedó guardada en el CRM; solo falló el envío a SmartHome.
      return { savedToCrm: true, sentToSmartHome: false, reason: result.reason };
    }
    return { savedToCrm: true, sentToSmartHome: true, reason: result.reason };
  }
);

export const postSmartHomeLeadBitacora = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);

    const { companyId, leadId, ...input } = z.object({
      companyId:      z.string().min(1),
      leadId:         z.string().min(1),
      userId:         z.string().min(1).nullish(),
      actionId:       z.string().min(1).nullable().optional(),
      actionLabel:    z.string().trim().max(120).optional(),
      context:        z.string().trim().max(120).optional(),
      eventContent:   z.string().trim().min(1).max(2000),
      isAnEvent:      z.boolean().default(false),
      scheduledDate:  z.string().trim().max(32).nullish(),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const lead = await leadsRepository.findById(companyId, leadId);
    if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');
    const { actorSmartHomeUserId, authorName } = await assertSmartHomeProspectOwner(companyId, ctx.uid, lead);

    const { userId: _ignoredUserId, scheduledDate, ...eventInput } = input;
    const result = await postLeadSmartHomeManualEvent(lead, {
      ...eventInput,
      authorName,
      userId: actorSmartHomeUserId,
      ...(scheduledDate ? { scheduledDate } : {}),
    });
    if (!result.ok) throw new HttpsError('failed-precondition', result.reason);
    await db.collection('companies').doc(companyId).collection('leads').doc(leadId).set({
      smartHomeLastBitacoraAt: FieldValue.serverTimestamp(),
      smartHomeLastBitacoraBy: ctx.uid,
      smartHomeLastBitacoraByName: authorName,
      smartHomeLastBitacoraText: input.eventContent.slice(0, 240),
      smartHomeLastActionLabel: input.actionLabel ?? (input.isAnEvent ? 'Evento' : 'Bitacora'),
      smartHomeTrackingUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return result;
  }
);
