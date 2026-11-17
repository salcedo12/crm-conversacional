import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { db } from '../lib/admin';
import { leadsRepository } from '../modules/leads/leads.repository';
import { resolveOwnerId, syncLeadToSmartHome } from '../modules/smarthome/smarthomeSync.service';
import { syncSmartHomeSales } from '../modules/smarthomeSales/smarthomeSales.service';
import { isDirectAdvisorLead, countsAs317LineLead } from '../modules/leads/leadClassification';
import {
  changeLeadSmartHomeAdvisor,
  changeLeadSmartHomeSaleCycleStage,
  postLeadSmartHomeManualEvent,
} from '../modules/smarthome/smarthomeAdmin.service';
import { resolveSmartHomeProspectForLead } from '../modules/smarthome/smarthomeEvents.service';
import { getSmartHomeSaleCycleStages, getSmartHomeUsers, getSmartHomeProspectSummary, getSmartHomeBiProspectsSince, getSmartHomeProspectEvents } from '../integrations/smarthome/smarthome.client';
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

    if (isDirectAdvisorLead(lead) || !countsAs317LineLead(lead)) {
      throw new HttpsError(
        'failed-precondition',
        'Este contacto pertenece al WhatsApp personal de un asesor. Solo los leads que entran por la Línea 317 se crean en SmartHome (etiqueta WHATSAPP IA).'
      );
    }

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

    if (isDirectAdvisorLead(lead) || !countsAs317LineLead(lead)) {
      throw new HttpsError(
        'failed-precondition',
        'Este contacto pertenece al WhatsApp personal de un asesor. Solo los leads que entran por la Línea 317 se crean en SmartHome (etiqueta WHATSAPP IA).'
      );
    }

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

    if (isDirectAdvisorLead(lead) || !countsAs317LineLead(lead)) {
      throw new HttpsError(
        'failed-precondition',
        'Este contacto pertenece al WhatsApp personal de un asesor. Solo los leads que entran por la Línea 317 se crean en SmartHome (etiqueta WHATSAPP IA).'
      );
    }

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

    if (isDirectAdvisorLead(lead) || !countsAs317LineLead(lead)) {
      throw new HttpsError(
        'failed-precondition',
        'Este contacto pertenece al WhatsApp personal de un asesor. Solo los leads que entran por la Línea 317 se crean en SmartHome (etiqueta WHATSAPP IA).'
      );
    }

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

    if (isDirectAdvisorLead(lead) || !countsAs317LineLead(lead)) {
      throw new HttpsError(
        'failed-precondition',
        'Este contacto pertenece al WhatsApp personal de un asesor. Solo los leads que entran por la Línea 317 se crean en SmartHome (etiqueta WHATSAPP IA).'
      );
    }
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

    if (isDirectAdvisorLead(lead) || !countsAs317LineLead(lead)) {
      throw new HttpsError(
        'failed-precondition',
        'Este contacto pertenece al WhatsApp personal de un asesor. Solo los leads que entran por la Línea 317 se crean en SmartHome (etiqueta WHATSAPP IA).'
      );
    }
    const { actorSmartHomeUserId, authorName } = await assertSmartHomeProspectOwner(companyId, ctx.uid, lead);

    const { userId: _ignoredUserId, scheduledDate, ...eventInput } = input;
    const result = await postLeadSmartHomeManualEvent(lead, {
      ...eventInput,
      authorName,
      userId: actorSmartHomeUserId,
      ...(scheduledDate ? { scheduledDate } : {}),
    });
    if (!result.ok) throw new HttpsError('failed-precondition', result.reason);

    const nowFormatted = new Date(Date.now() - 5 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    const actionLabelText = input.actionLabel ?? (input.isAnEvent ? 'Evento Comercial' : 'Seguimiento Bitácora');
    const cleanDesc = input.eventContent.trim().slice(0, 240);
    const newBitEntry = {
      id_registro: `sh_crm_${Date.now()}`,
      origen: 'CRM',
      fecha: nowFormatted,
      action: actionLabelText,
      description: cleanDesc,
      asesor: authorName,
      lastDate: nowFormatted,
    };

    const rawExisting = [
      ...(Array.isArray((lead as any).bitacoras) ? (lead as any).bitacoras : []),
      ...(Array.isArray(lead.metadata?.smarthomeBitacoras) ? (lead.metadata.smarthomeBitacoras as any[]) : []),
      ...(Array.isArray((lead as any).smarthomeBitacoras) ? (lead as any).smarthomeBitacoras : []),
    ];
    const seenKeys = new Set<string>();
    const existingBitacoras: any[] = [];
    for (const b of rawExisting) {
      if (!b || typeof b !== 'object') continue;
      const k = `${String(b.action || '').trim()}|${String(b.description || '').trim()}|${String(b.fecha || b.lastDate || '').slice(0, 16)}`;
      if (!seenKeys.has(k)) {
        seenKeys.add(k);
        existingBitacoras.push(b);
      }
    }
    const updatedBitacoras = [newBitEntry, ...existingBitacoras].slice(0, 60);

    const lowerLabel = `${actionLabelText} ${cleanDesc}`.toLowerCase();
    let inferredActionType = 'seguimiento_general';
    if (lowerLabel.includes('llamada') || lowerLabel.includes('teléfono') || lowerLabel.includes('telefono')) {
      inferredActionType = 'llamada';
    } else if (lowerLabel.includes('visita') || lowerLabel.includes('terreno')) {
      inferredActionType = 'visita_terreno';
    } else if (lowerLabel.includes('cita') || lowerLabel.includes('reunión') || lowerLabel.includes('reunion')) {
      inferredActionType = 'cita_reunion';
    } else if (lowerLabel.includes('cotización') || lowerLabel.includes('cotizacion') || lowerLabel.includes('brochure') || lowerLabel.includes('información')) {
      inferredActionType = 'envio_informacion';
    }

    const leadRef = db.collection('companies').doc(companyId).collection('leads').doc(leadId);
    const nowTs = Timestamp.now();

    await leadRef.set({
      smartHomeLastBitacoraAt: nowTs,
      smartHomeLastBitacoraBy: ctx.uid,
      smartHomeLastBitacoraByName: authorName,
      smartHomeLastBitacoraText: cleanDesc,
      smartHomeLastActionLabel: actionLabelText,
      smartHomeTrackingUpdatedAt: nowTs,
      lastFollowUpAt: nowTs,
      lastFollowUpAction: inferredActionType,
      lastFollowUpSummary: `${actionLabelText}: ${cleanDesc}`.slice(0, 240),
      lastFollowUpAuthor: authorName,
      aiTakeoverSlaStatus: 'compliant',
      bitacoras: updatedBitacoras,
      metadata: {
        ...(lead.metadata || {}),
        smarthomeBitacoras: updatedBitacoras,
      },
      updatedAt: nowTs,
    }, { merge: true });

    await leadRef.collection('notes').add({
      companyId,
      leadId,
      authorId: ctx.uid,
      authorName,
      text: `📋 FICHA TÉCNICA · ${actionLabelText}\n• Resultado: Gestión registrada\n• Observaciones: ${cleanDesc}`,
      kind: 'note',
      type: 'ficha_tecnica',
      actionType: inferredActionType,
      result: actionLabelText,
      notes: cleanDesc,
      createdAt: nowTs,
    }).catch((err) => {
      logger.warn('[postSmartHomeLeadBitacora] Error agregando nota en subcolección notes:', { err: String(err) });
    });

    return result;
  }
);

export const syncSmartHomeLeadBitacora = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId, leadId } = z.object({
      companyId: z.string().min(1),
      leadId:    z.string().min(1),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    const lead = await leadsRepository.findById(companyId, leadId);
    if (!lead) throw new HttpsError('not-found', 'Lead no encontrado.');

    if (!lead.phone) {
      throw new HttpsError('failed-precondition', 'El lead no tiene teléfono asociado para consultar en SmartHome.');
    }

    const summary = await getSmartHomeProspectSummary(lead.phone);
    if (!summary || !summary.found) {
      return {
        ok: false,
        message: 'No se encontró un prospecto registrado en SmartHome con este teléfono.',
        eventsCount: 0,
        bitacoras: [],
      };
    }

    const bitacoras = (summary.events || []).map((e) => ({
      action: e.action || 'Seguimiento',
      count: 1,
      lastDate: e.date ? e.date.replace('T', ' ').slice(0, 16) : '',
      description: e.content ? `${e.action && !e.system ? `[${e.action}] ` : ''}${e.content}` : e.action || 'Nota',
      system: !!e.system,
      userId: e.userId || null,
    }));

    // Sincronizar y persistir como notas/seguimientos nativos en la subcolección notes
    const notesColRef = db.collection('companies').doc(companyId).collection('leads').doc(leadId).collection('notes');
    let newNotesCount = 0;
    try {
      const existingNotesSnap = await notesColRef.where('source', '==', 'smarthome_sync').get();
      const existingTimes = new Set<number>();
      existingNotesSnap.forEach((d) => {
        const ca = d.data().createdAt;
        if (ca && typeof ca.toMillis === 'function') {
          existingTimes.add(ca.toMillis());
        }
      });

      const batch = db.batch();
      for (const e of (summary.events || [])) {
        if (!e.content && !e.action) continue;

        const eventDate = e.date ? new Date(e.date) : new Date();
        const dateMillis = isNaN(eventDate.getTime()) ? Date.now() : eventDate.getTime();
        if (existingTimes.has(dateMillis)) continue;
        existingTimes.add(dateMillis);

        const ts = Timestamp.fromMillis(dateMillis);

        // Extraer nombre del autor si viene en el texto
        let authorName = summary.advisor || (lead.metadata?.smarthomeAsesorOriginal as string) || 'SmartHome';
        const authorMatch = (e.content || '').match(/Registrado por:\s*([^\n\r]+)/i);
        if (authorMatch && authorMatch[1]) {
          authorName = authorMatch[1].trim();
        }

        // Clasificar acción comercial
        let actionType: 'seguimiento_general' | 'llamada' | 'cita_reunion' | 'visita_terreno' | 'envio_informacion' = 'seguimiento_general';
        const lower = `${e.action || ''} ${e.content || ''}`.toLowerCase();
        if (lower.includes('llamada') || lower.includes('telefono') || lower.includes('teléfono')) {
          actionType = 'llamada';
        } else if (lower.includes('visita') || lower.includes('terreno') || lower.includes('sala')) {
          actionType = 'visita_terreno';
        } else if (lower.includes('cita') || lower.includes('reunion') || lower.includes('reunión')) {
          actionType = 'cita_reunion';
        } else if (lower.includes('brochure') || lower.includes('cotizacion') || lower.includes('cotización') || lower.includes('informacion') || lower.includes('información')) {
          actionType = 'envio_informacion';
        }

        // Limpiar encabezados repetitivos para dejar la nota limpia
        let cleanText = (e.content || e.action || '').trim();
        cleanText = cleanText.replace(/Registrado por:[^\n\r]+\n?/gi, '').trim();

        const newDocRef = notesColRef.doc();
        batch.set(newDocRef, {
          companyId,
          leadId,
          authorName,
          text: cleanText || e.content || 'Gestión registrada en SmartHome',
          actionType,
          result: e.action || 'Gestión SmartHome',
          kind: 'note',
          type: 'ficha_tecnica',
          source: 'smarthome_sync',
          createdAt: ts,
          updatedAt: ts,
        });
        newNotesCount++;
      }

      if (newNotesCount > 0) {
        await batch.commit();
      }
    } catch (notesErr) {
      logger.warn('[syncSmartHomeLeadBitacora] Error guardando notas en subcoleccion:', { err: notesErr });
    }

    const rawCombined = [
      ...(Array.isArray((lead as any).bitacoras) ? (lead as any).bitacoras : []),
      ...(Array.isArray(lead.metadata?.smarthomeBitacoras) ? (lead.metadata.smarthomeBitacoras as any[]) : []),
      ...bitacoras,
    ];
    const seenSyncKeys = new Set<string>();
    const mergedBitacoras: any[] = [];
    for (const b of rawCombined) {
      if (!b || typeof b !== 'object') continue;
      const k = `${String(b.action || '').trim()}|${String(b.description || '').trim()}|${String(b.fecha || b.lastDate || '').slice(0, 16)}`;
      if (!seenSyncKeys.has(k)) {
        seenSyncKeys.add(k);
        mergedBitacoras.push(b);
      }
    }

    await db.collection('companies').doc(companyId).collection('leads').doc(leadId).set({
      bitacoras: mergedBitacoras.slice(0, 60),
      metadata: {
        ...(lead.metadata || {}),
        smarthomeBitacoras: mergedBitacoras.slice(0, 60),
        smarthomeProspectId: summary.prospectId || (lead.metadata?.smarthomeProspectId ?? ''),
        smarthomeAsesorOriginal: summary.advisor || (lead.metadata?.smarthomeAsesorOriginal ?? ''),
        smarthomeCicloVenta: summary.saleCycle || (lead.metadata?.smarthomeCicloVenta ?? ''),
        smarthomeEstadoSeguimiento: summary.stage || (lead.metadata?.smarthomeEstadoSeguimiento ?? ''),
        smarthomeSyncedAt: new Date().toISOString(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return {
      ok: true,
      message: `Sincronizados ${mergedBitacoras.length} seguimientos históricos desde SmartHome con fecha y hora.`,
      eventsCount: mergedBitacoras.length,
      newNotesCount,
      bitacoras: mergedBitacoras.slice(0, 60),
      summary: {
        prospectId: summary.prospectId,
        advisor: summary.advisor,
        stage: summary.stage,
        saleCycle: summary.saleCycle,
      },
    };
  }
);


function isRealCommercialFollowUp(action?: string | null, text?: string | null): boolean {
  const rawAction = String(action ?? '').trim();
  const rawText = String(text ?? '').trim();
  if (!rawAction && !rawText) return false;

  // El traslado aprobado ("Traslado Aprobado / Gestión Comercial", "traslado_comercial",
  // "Traslado comercial: <motivo>") no cuenta como seguimiento del asesor que recibe el prospecto.
  const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (
    /^traslado[\s_]+(aprobado|comercial)\b/.test(stripAccents(rawAction)) ||
    /^traslado[\s_]+comercial\b/.test(stripAccents(rawText))
  ) {
    return false;
  }

  const aNorm = cleanText(rawAction);
  const dNorm = cleanText(rawText);

  // 1. Descartar acciones de sistema / creación
  if (
    aNorm === 'evento del sistema' ||
    aNorm === 'captacion' ||
    aNorm === 'sistema' ||
    aNorm === 'registro api' ||
    aNorm === 'cargue masivo' ||
    aNorm === 'asignacion automatica' ||
    aNorm === 'actualizacion automatica'
  ) {
    return false;
  }

  // 2. Si el texto tiene menos de 4 caracteres o es vacío
  if (!dNorm || dNorm.length < 4) return false;

  // 3. Descartar textos automáticos generados por el sistema o por la creación del prospecto
  if (
    dNorm.includes('se agrega el cliente al sistema') ||
    dNorm.includes('se agrega el prospecto al sistema') ||
    dNorm.includes('se inicia el seguimiento para el modulo') ||
    dNorm.includes('registro api') ||
    dNorm.includes('registro automatico enviado desde crm') ||
    dNorm.includes('se ha actualizado la informacion') ||
    dNorm.includes('atendido en whatsapp') ||
    dNorm.includes('se ha actualizado el detalle de la oportunidad') ||
    dNorm.includes('se ha cambiado el ciclo de venta') ||
    dNorm.includes('se ha cambiado la probabilidad') ||
    dNorm.includes('se ha actualizado el valor') ||
    dNorm.includes('la empresa razon social cambio') ||
    dNorm.includes('la empresa cambio de') ||
    dNorm.includes('la ciudad cambio') ||
    dNorm.includes('el nombre cambio') ||
    dNorm.includes('el apellido cambio') ||
    dNorm.includes('actualizacion automatica') ||
    dNorm.includes('cargue masivo') ||
    dNorm.includes('asignacion automatica') ||
    dNorm.includes('webhook') ||
    dNorm.includes('infile') ||
    dNorm.includes('arkdia')
  ) {
    return false;
  }

  if (
    (aNorm === 'canon de arizona' || aNorm === 'llano grande' || aNorm === 'laguna mar' || aNorm === 'rio claro') &&
    (dNorm.includes('se agrega el cliente') || dNorm.includes('modulo') || dNorm.length < 15)
  ) {
    return false;
  }

  return true;
}

export const syncSmartHomeRecentActivity = onCall(
  { region: 'us-central1', timeoutSeconds: 540, memory: '1GiB' },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, WRITE_ROLES);
    const { companyId, daysBack = 14 } = z.object({
      companyId: z.string().min(1),
      daysBack: z.number().min(1).max(30).optional().default(14),
    }).parse(request.data);
    assertCompany(ctx, companyId);

    let salesCount = 0;
    try {
      const salesResult = await syncSmartHomeSales(companyId);
      salesCount = salesResult.total;
    } catch (salesErr) {
      logger.warn('[syncSmartHomeRecentActivity] Error sincronizando ventas:', { err: salesErr });
    }

    const sinceDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const dateStr = sinceDate.toISOString().slice(0, 10);

    const shRecords = await getSmartHomeBiProspectsSince(dateStr);
    if (!shRecords) {
      throw new HttpsError('unavailable', 'No se pudo consultar el API de SmartHome.');
    }

    const usersSnap = await db.collection('companies').doc(companyId).collection('users').get();
    const advisors: Array<{ id: string; name: string; normName: string }> = [];
    usersSnap.docs.forEach((d) => {
      const u = d.data();
      if (u.disabled) return;
      const name = u.displayName || u.email || d.id;
      advisors.push({ id: d.id, name, normName: cleanText(name) });
    });

    const isAdvisorMatch = (rawA?: unknown, rawB?: unknown): boolean => {
      if (!rawA || !rawB) return false;
      const a = cleanText(rawA);
      const b = cleanText(rawB);
      if (!a || !b) return false;
      if (a === b || a.includes(b) || b.includes(a)) return true;
      const stopWords = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'san', 'santa']);
      const wordsA = a.split(' ').filter((w) => w.length > 2 && !stopWords.has(w));
      const wordsB = b.split(' ').filter((w) => w.length > 2 && !stopWords.has(w));
      if (wordsA.length === 0 || wordsB.length === 0) return false;
      if (wordsA[0] === wordsB[0]) {
        const restA = wordsA.slice(1);
        const restB = wordsB.slice(1);
        if (restA.some((wa) => restB.includes(wa))) return true;
      }
      const common = wordsA.filter((wa) => wordsB.includes(wa));
      if (common.length >= 2) return true;
      if ((a.includes('betancour') && b.includes('betancour')) && (a.includes('isabel') || b.includes('isabel'))) return true;
      if ((a.includes('karen') && b.includes('karen')) && (a.includes('ramirez') || b.includes('ramirez') || a.includes('toloza') || b.includes('toloza'))) return true;
      return false;
    };

    const resolveAdvisorUser = (name?: string | null) => {
      if (!name) return null;
      return advisors.find((a) => isAdvisorMatch(a.name, name)) || null;
    };

    let updatedLeads = 0;
    let createdLeads = 0;
    let bitacorasSynced = 0;
    let notesCreated = 0;

    const cleanDigits = (val: unknown): string => {
      const s = String(val ?? '').replace(/\D/g, '');
      if (s.length === 10) return s;
      if (s.length === 12 && s.startsWith('57')) return s.slice(2);
      if (s.length > 10 && s.startsWith('57')) return s.slice(-10);
      return s;
    };

    const formatPhoneE164 = (digits: string): string => {
      if (digits.length === 10) return `+57${digits}`;
      if (digits.length === 12 && digits.startsWith('57')) return `+${digits}`;
      return `+${digits}`;
    };

    for (const r of shRecords) {
      const pId = String(r.ProspectId || '').trim();
      if (!pId) continue;

      const rawPhone = r.Telefono || r.Celular || r.mobileNumber || r.phoneNumber;
      const digits = cleanDigits(rawPhone);
      const e164 = digits ? formatPhoneE164(digits) : '';

      let matchedLeadDoc: FirebaseFirestore.DocumentSnapshot | null = null;

      if (digits) {
        const query1 = await db.collection('companies').doc(companyId).collection('leads')
          .where('phone', '==', digits).limit(1).get();
        if (!query1.empty) matchedLeadDoc = query1.docs[0];

        if (!matchedLeadDoc) {
          const query2 = await db.collection('companies').doc(companyId).collection('leads')
            .where('normalizedPhone', '==', e164).limit(1).get();
          if (!query2.empty) matchedLeadDoc = query2.docs[0];
        }
      }

      if (!matchedLeadDoc) {
        const query3 = await db.collection('companies').doc(companyId).collection('leads')
          .where('metadata.smarthomeProspectId', '==', pId).limit(1).get();
        if (!query3.empty) matchedLeadDoc = query3.docs[0];
      }

      const events = await getSmartHomeProspectEvents(pId);
      const bitacoras = (events || []).map((e, idx) => ({
        id: (e as any).id || `${pId}_${idx}`,
        action: e.action || 'Gestión comercial',
        description: e.content || '',
        fecha: e.date || '',
        asesor: r.Asesor || '',
      }));

      let lastEvDate: string | null = null;
      if (events && events.length > 0) {
        for (const ev of events) {
          if (isRealCommercialFollowUp(ev.action, ev.content)) {
            lastEvDate = ev.date;
            break;
          }
        }
      }

      const assignedAdv = resolveAdvisorUser(r.Asesor as string);

      if (matchedLeadDoc) {
        const leadRef = matchedLeadDoc.ref;
        const currentData = matchedLeadDoc.data() || {};
        const rawCombined = [
          ...(Array.isArray(currentData.bitacoras) ? currentData.bitacoras : []),
          ...(Array.isArray(currentData.metadata?.smarthomeBitacoras) ? currentData.metadata.smarthomeBitacoras : []),
          ...bitacoras,
        ];
        const seenKeys = new Set<string>();
        const mergedBitacoras: any[] = [];
        for (const b of rawCombined) {
          if (!b || typeof b !== 'object') continue;
          const k = `${String(b.action || '').trim()}|${String(b.description || '').trim()}|${String(b.fecha || b.lastDate || '').slice(0, 16)}`;
          if (!seenKeys.has(k)) {
            seenKeys.add(k);
            mergedBitacoras.push(b);
          }
        }
        const updateData: Record<string, unknown> = {
          bitacoras: mergedBitacoras.slice(0, 60),
          'metadata.smarthomeBitacoras': mergedBitacoras.slice(0, 60),
          'metadata.smarthomeProspectId': pId,
          'metadata.smarthomeAsesorOriginal': r.Asesor || currentData.metadata?.smarthomeAsesorOriginal || '',
          'metadata.smarthomeCicloVenta': r.Ciclo_de_Venta || currentData.metadata?.smarthomeCicloVenta || '',
          'metadata.smarthomeEstadoSeguimiento': r.Etapa_del_Ciclo || currentData.metadata?.smarthomeEstadoSeguimiento || '',
          'metadata.smarthomeSyncedAt': new Date().toISOString(),
          smartHomeAdvisorName: r.Asesor || currentData.smartHomeAdvisorName || '',
          updatedAt: FieldValue.serverTimestamp(),
        };

        if (assignedAdv && !currentData.assignedTo) {
          updateData.assignedTo = assignedAdv.id;
        }

        if (lastEvDate) {
          const curLast = currentData.lastFollowUpAt?.toDate?.() ? currentData.lastFollowUpAt.toDate() : null;
          const newLast = new Date(lastEvDate);
          if (!curLast || newLast > curLast) {
            updateData.lastFollowUpAt = Timestamp.fromDate(newLast);
          }
        }

        await leadRef.update(updateData);

        if (events && events.length > 0) {
          const notesCol = leadRef.collection('notes');
          const existingSnap = await notesCol.where('source', '==', 'smarthome_sync').get();
          const existingTexts = new Set(existingSnap.docs.map((d) => d.data().text));

          for (const ev of events) {
            const text = (ev.content || ev.action || '').trim();
            if (!text || !isRealCommercialFollowUp(ev.action, ev.content)) continue;
            if (existingTexts.has(text)) continue;

            const evDate = ev.date ? new Date(ev.date) : new Date();
            await notesCol.add({
              companyId,
              leadId: leadRef.id,
              authorName: r.Asesor || 'SmartHome',
              text,
              actionType: (ev.action || 'seguimiento_general').toLowerCase().replace(/\s+/g, '_'),
              result: ev.action || 'Gestión SmartHome',
              kind: 'note',
              type: 'ficha_tecnica',
              source: 'smarthome_sync',
              createdAt: Timestamp.fromDate(evDate),
              updatedAt: Timestamp.fromDate(evDate),
            });
            notesCreated++;
          }
        }

        updatedLeads++;
        bitacorasSynced += bitacoras.length;
      } else {
        const leadRef = db.collection('companies').doc(companyId).collection('leads').doc();
        const clientName = (r.Nombre_del_Cliente || r.Nombre || 'Prospecto SmartHome') as string;
        const createdDate = r.Fecha_de_Creacion ? new Date(r.Fecha_de_Creacion as string) : new Date();

        const newLeadData: Record<string, unknown> = {
          companyId,
          name: clientName,
          phone: digits || '',
          normalizedPhone: e164 || '',
          status: 'qualified',
          pipelineStage: 'contacted',
          source: (r.Fuente_de_Ubicacion_Cliente || r.Fuente_de_Ubicacion_Prospecto || 'SmartHome') as string,
          project: (r.Proyecto || 'Sin Proyecto') as string,
          assignedTo: assignedAdv ? assignedAdv.id : null,
          smartHomeAdvisorName: (r.Asesor || '') as string,
          createdAt: Timestamp.fromDate(createdDate),
          updatedAt: FieldValue.serverTimestamp(),
          metadata: {
            smarthomeProspectId: pId,
            smarthomeBitacoras: bitacoras,
            smarthomeAsesorOriginal: r.Asesor || '',
            smarthomeCicloVenta: r.Ciclo_de_Venta || '',
            smarthomeEstadoSeguimiento: r.Etapa_del_Ciclo || '',
            smarthomeSyncedAt: new Date().toISOString(),
          },
        };

        if (lastEvDate) {
          newLeadData.lastFollowUpAt = Timestamp.fromDate(new Date(lastEvDate));
        }

        await leadRef.set(newLeadData);

        for (const ev of (events || [])) {
          const text = (ev.content || ev.action || '').trim();
          if (!text || !isRealCommercialFollowUp(ev.action, ev.content)) continue;
          const evDate = ev.date ? new Date(ev.date) : new Date();
          await leadRef.collection('notes').add({
            companyId,
            leadId: leadRef.id,
            authorName: r.Asesor || 'SmartHome',
            text,
            actionType: (ev.action || 'seguimiento_general').toLowerCase().replace(/\s+/g, '_'),
            result: ev.action || 'Gestión SmartHome',
            kind: 'note',
            type: 'ficha_tecnica',
            source: 'smarthome_sync',
            createdAt: Timestamp.fromDate(evDate),
            updatedAt: Timestamp.fromDate(evDate),
          });
          notesCreated++;
        }

        createdLeads++;
        bitacorasSynced += bitacoras.length;
      }
    }

    return {
      ok: true,
      message: `Sincronizados ${updatedLeads} leads existentes, ${createdLeads} nuevos prospectos, ${bitacorasSynced} bitácoras y ${salesCount} ventas de SmartHome.`,
      updatedLeads,
      createdLeads,
      bitacorasSynced,
      notesCreated,
      salesCount,
    };
  }
);
