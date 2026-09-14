import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { storage, db } from '@/config/firebase';
import { listLeadsPage } from '@/features/leads/services/leadsPage.service';
import { listAdvisors, type Advisor } from '@/features/leads/services/advisors.service';
import { createContact } from '@/features/inbox/services/contacts.service';
import { generateLeadDossier } from '@/features/leads/services/leadDossier.service';
import { updateLead } from '@/features/leads/services/leads.service';
import {
  postSmartHomeLeadBitacora,
  listSmartHomeAdvisors,
  type SmartHomeAdvisor,
} from '@/features/leads/services/smartHome.service';
import type {
  PhotoEvidenceItem,
  SearchLeadResult,
  SubmitPhotoEvidenceInput,
  SubmitPhotoEvidenceResult,
} from '../types';

export interface UploadProgress {
  percent: number;
  state:   'running' | 'paused' | 'error' | 'success';
}

export interface UploadResult {
  downloadUrl: string;
  storagePath: string;
}

const STORAGE_KEY_PREFIX = 'meraki:photo_evidence:v1:';

function getStorageKey(companyId: string): string {
  return `${STORAGE_KEY_PREFIX}${companyId}`;
}

export function getLocalEvidenceRecords(companyId: string): PhotoEvidenceItem[] {
  try {
    const raw = localStorage.getItem(getStorageKey(companyId));
    if (!raw) return [];
    return JSON.parse(raw) as PhotoEvidenceItem[];
  } catch {
    return [];
  }
}

export function saveLocalEvidenceRecord(companyId: string, item: PhotoEvidenceItem): void {
  try {
    const list = getLocalEvidenceRecords(companyId);
    const updated = [item, ...list.filter((x) => x.id !== item.id)].slice(0, 100);
    localStorage.setItem(getStorageKey(companyId), JSON.stringify(updated));
  } catch (err) {
    console.warn('[photoEvidence.service] localStorage save error:', err);
  }
}

/** Obtiene las evidencias registradas en Firestore bajo la subcolección evidence del lead. */
export async function getLeadEvidencesFromFirestore(companyId: string, leadId: string): Promise<PhotoEvidenceItem[]> {
  try {
    const q = query(
      collection(db, 'companies', companyId, 'leads', leadId, 'evidence'),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      const rawCreatedAt = data.createdAt;
      const createdAtMs = rawCreatedAt?.toMillis
        ? rawCreatedAt.toMillis()
        : rawCreatedAt?.seconds
          ? rawCreatedAt.seconds * 1000
          : Date.now();

      return {
        id: d.id,
        leadId,
        photoUrl: (data.downloadUrl || data.photoUrl || '') as string,
        shortUrl: (data.shortUrl || '') as string,
        storagePath: (data.storagePath || '') as string,
        notes: (data.note || data.notes || '') as string,
        actionLabel: (data.actionLabel || 'Evidencia fotográfica') as string,
        context: (data.context || '') as string,
        isAnEvent: false,
        authorId: (data.uploadedBy || '') as string,
        authorName: (data.uploadedByName || 'Asesor') as string,
        createdAt: createdAtMs,
        smartHomeSynced: true,
      };
    });
  } catch (err) {
    console.warn('[photoEvidence.service] getLeadEvidencesFromFirestore error:', err);
    return [];
  }
}

function cleanText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Busca un contacto por número de teléfono cruzando el CRM local y SmartHome (BI en tiempo real).
 */
export async function searchLeadForPhotoEvidence(
  companyId: string,
  phone: string,
  currentUserId?: string,
  currentUserName?: string,
  _isAdmin?: boolean
): Promise<SearchLeadResult> {
  const cleanPhone = phone.trim();
  const digits = cleanPhone.replace(/\D/g, '');

  if (!cleanPhone || digits.length < 7) {
    return {
      found: false,
      lead: null,
      canUpload: false,
      message: 'Por favor ingresa un número de teléfono válido (mínimo 7 dígitos).',
      evidences: [],
    };
  }

  // Formato internacional para Colombia si son 10 dígitos (ej. +573143144946)
  const formattedPhone = cleanPhone.startsWith('+')
    ? cleanPhone
    : digits.length === 10 && digits.startsWith('3')
      ? `+57${digits}`
      : cleanPhone;

  // 1. Buscar primero en los leads locales del CRM y asesores SmartHome
  const [leadResult, advisors, shAdvisors] = await Promise.all([
    listLeadsPage({
      companyId,
      pageSize: 20,
      sortField: 'lastMessageAt',
      sortDir: 'desc',
      filters: {
        search: cleanPhone,
        status: 'all',
        aiEnabled: 'all',
        assignedTo: 'all',
        tags: [],
        inboxId: 'all',
        listId: 'all',
        source: 'all',
      },
    }).catch((err) => {
      console.warn('[photoEvidence.service] listLeadsPage error:', err);
      return { leads: [] };
    }),
    listAdvisors(companyId).catch(() => [] as Advisor[]),
    listSmartHomeAdvisors(companyId).catch(() => [] as SmartHomeAdvisor[]),
  ]);

  let foundLead = leadResult.leads.find((l) => {
    const lDigits = (l.phone || '').replace(/\D/g, '');
    if (l.phone === cleanPhone || l.phone === formattedPhone) return true;
    if (digits.length >= 7 && lDigits.endsWith(digits.slice(-7))) return true;
    if (digits && lDigits === digits) return true;
    return false;
  }) ?? leadResult.leads[0];

  // 2. Si no existe en el CRM local, creamos el contacto en el CRM para poder consultar SmartHome
  if (!foundLead) {
    try {
      const createRes = await createContact({
        companyId,
        phone: formattedPhone,
        name: '',
      });
      if (createRes.leadId) {
        foundLead = {
          id: createRes.leadId,
          companyId,
          name: '',
          phone: formattedPhone,
          status: 'active',
          source: 'manual',
          createdAt: { toMillis: () => Date.now() } as never,
          updatedAt: { toMillis: () => Date.now() } as never,
          assignedTo: currentUserId ?? null,
        } as never;
      }
    } catch (createErr) {
      console.warn('[photoEvidence.service] createContact error:', createErr);
    }
  }

  if (!foundLead) {
    return {
      found: false,
      lead: null,
      canUpload: false,
      message: `No se encontró ningún contacto con el número "${cleanPhone}".`,
      evidences: [],
    };
  }

  // 3. Consultar radiografía en tiempo real en SmartHome (BI + bitácora)
  let smartHomeName = '';
  let smartHomeAdvisor = '';
  let smartHomeStage = '';
  let smartHomeScore: number | null = null;
  let smartHomeEvents: Array<{ date: string; content: string; action: string; system: boolean }> = [];
  let smartHomeFound = false;

  try {
    const dossier = await generateLeadDossier(companyId, foundLead.id, false);
    if (dossier?.smartHome && dossier.smartHome.found) {
      smartHomeFound = true;
      smartHomeName = dossier.smartHome.name || '';
      smartHomeAdvisor = dossier.smartHome.advisor || dossier.smartHome.seller || '';
      smartHomeStage = dossier.smartHome.stage || '';
      smartHomeScore = typeof dossier.smartHome.score === 'number' ? dossier.smartHome.score : null;
      if (Array.isArray(dossier.smartHome.events)) {
        smartHomeEvents = dossier.smartHome.events.slice(0, 15).map((e) => ({
          date: e.date || '',
          content: e.content || '',
          action: e.action || 'Bitácora',
          system: Boolean(e.system),
        }));

        // Analizar en tiempo real si el cliente fue reasignado o cambiado de asesor
        for (const evt of dossier.smartHome.events) {
          const text = (evt.content || '').trim();
          if (!text) continue;

          const changeMatch = text.match(/(?:cambiado\s+(?:el\s+)?asesor(?:\s+comercial)?|reasignado(?:\s+el\s+prospecto)?)\s+(?:de\s+.+?\s+)?a\s+([A-Za-zÁÉÍÓÚáéíóúñÑ\s]+?)(?:\s+desde\s+el\s+API|\.|$)/i)
            || text.match(/asesor\s+asignado(?:\s+es)?(?:\s*:)?\s+([A-Za-zÁÉÍÓÚáéíóúñÑ\s]+?)(?:\.|$)/i)
            || text.match(/(?:se\s+ha\s+asignado|asignado)(?:\s+el\s+asesor\s+comercial)?\s+(?:a\s+)?([A-Za-zÁÉÍÓÚáéíóúñÑ\s]+?)(?:\s+desde\s+el\s+API|\.|$)/i);

          if (changeMatch && changeMatch[1]?.trim()) {
            const candidateName = changeMatch[1].trim();
            if (shAdvisors.length > 0) {
              const matchedSh = shAdvisors.find((a) => {
                const full = cleanText(a.name);
                const cand = cleanText(candidateName);
                return full === cand || cand.includes(full) || full.includes(cand);
              });
              if (matchedSh?.name) {
                smartHomeAdvisor = matchedSh.name;
                break;
              }
            }
            smartHomeAdvisor = candidateName;
            break;
          }
        }

        // Si hay eventos de activación con userId, verificar contra asesores de SmartHome
        for (const evt of dossier.smartHome.events) {
          if (evt.userId && shAdvisors.length > 0) {
            if (/cliente asignado|se ha activado el prospecto|inicia el seguimiento|cambiado el asesor|reasignado/i.test(evt.content || '')) {
              const matchedSh = shAdvisors.find((a) => a.userId === evt.userId);
              if (matchedSh && matchedSh.name) {
                smartHomeAdvisor = matchedSh.name;
                break;
              }
            }
          }
        }
      }

      // Actualizar nombre o asesor en el CRM si lo descubrimos desde SmartHome
      if (smartHomeName && foundLead.name !== smartHomeName) {
        updateLead({
          companyId,
          leadId: foundLead.id,
          name: smartHomeName,
        }).catch(() => {});
        foundLead.name = smartHomeName;
      }
    }
  } catch (dossierErr) {
    console.warn('[photoEvidence.service] dossier query warning:', dossierErr);
  }

  const assignedAdvisorObj = advisors.find((a) => a.id === foundLead.assignedTo);
  const crmAdvisorName = assignedAdvisorObj?.displayName || assignedAdvisorObj?.email || '';

  // Priorizar siempre el asesor comercial real de SmartHome si el cliente existe allí
  const assignedAdvisorName = smartHomeAdvisor
    || (crmAdvisorName && !['Administrador', 'Admin'].includes(crmAdvisorName) ? crmAdvisorName : '')
    || crmAdvisorName
    || 'Sin asignar';

  // 4. Validar permisos estrictos para subir evidencia:
  // SmartHome solo permite subir bitácora si el asesor asignado al lead coincide con la sesión actual.
  const cleanCurrentName = cleanText(currentUserName);
  const cleanShAdvisor = cleanText(smartHomeAdvisor);

  let isAdvisorOwner = false;
  if (smartHomeAdvisor) {
    if (cleanCurrentName && cleanShAdvisor) {
      isAdvisorOwner = cleanCurrentName.includes(cleanShAdvisor) || cleanShAdvisor.includes(cleanCurrentName);
    }
  } else {
    isAdvisorOwner = Boolean(currentUserId && foundLead.assignedTo === currentUserId);
  }

  const canUpload = isAdvisorOwner;

  let permissionMessage = '';
  if (!canUpload) {
    if (smartHomeAdvisor) {
      permissionMessage = `Este contacto aparece asignado en SmartHome al asesor "${smartHomeAdvisor}". Como estás en la sesión de "${currentUserName || 'otro usuario'}", no tienes permiso para subir evidencias. Para registrar bitácora debes solicitar el cambio de asesor a tu nombre.`;
    } else if (assignedAdvisorName !== 'Sin asignar') {
      permissionMessage = `Este contacto está asignado al asesor ${assignedAdvisorName}. Solo el asesor asignado puede registrar evidencias fotográficas.`;
    } else {
      permissionMessage = 'No tienes permisos para registrar bitácora o evidencias en este cliente.';
    }
  }

  // Obtener evidencias registradas previamente (tanto de Firestore como del caché local)
  const firestoreEvidences = await getLeadEvidencesFromFirestore(companyId, foundLead.id);
  const localEvidences = getLocalEvidenceRecords(companyId).filter(
    (e) => e.leadId === foundLead.id || (e.leadPhone && (e.leadPhone === cleanPhone || e.leadPhone === formattedPhone))
  );

  const seenKeys = new Set<string>();
  const leadEvidences: PhotoEvidenceItem[] = [];
  for (const item of [...firestoreEvidences, ...localEvidences]) {
    const key = item.photoUrl || item.id;
    if (key && !seenKeys.has(key)) {
      seenKeys.add(key);
      leadEvidences.push(item);
    }
  }

  const displayName = smartHomeName || foundLead.name || `Contacto ${formattedPhone}`;

  return {
    found: true,
    lead: {
      id: foundLead.id,
      name: displayName,
      phone: foundLead.phone || formattedPhone,
      status: (smartHomeStage || foundLead.status || 'new') as never,
      assignedTo: foundLead.assignedTo ?? null,
      assignedAdvisorName,
      smartHomeCustomerId: smartHomeFound ? 'ok' : (foundLead.smartHomeCustomerId ?? null),
      smartHomeSyncError: foundLead.smartHomeSyncError ?? null,
      smartHomeAdvisor: smartHomeAdvisor || null,
      smartHomeStage: smartHomeStage || null,
      smartHomeScore,
      smartHomeEvents,
    },
    canUpload,
    message: permissionMessage,
    evidences: leadEvidences,
  };
}

/**
 * Sube una fotografía de evidencia a Firebase Storage con seguimiento de progreso.
 */
export async function uploadEvidencePhoto(
  file: File,
  companyId: string,
  leadId: string,
  onProgress?: (p: UploadProgress) => void
): Promise<UploadResult> {
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `companies/${companyId}/media/${leadId}/${timestamp}_evidence_${safeName}`;
  const storageRef = ref(storage, storagePath);

  return new Promise((resolve, reject) => {
    const uploadTask = uploadBytesResumable(storageRef, file, {
      contentType: file.type || 'image/jpeg',
    });

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        const percent = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        onProgress?.({ percent, state: snapshot.state as UploadProgress['state'] });
      },
      (error) => {
        console.error('[photoEvidence.service] Upload error:', error);
        reject(error);
      },
      async () => {
        const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
        resolve({ downloadUrl, storagePath });
      }
    );
  });
}

/**
 * Envía la evidencia fotográfica: publica en SmartHome (con enlace corto) y guarda en Firestore.
 */
export async function submitPhotoEvidence(
  input: SubmitPhotoEvidenceInput & {
    leadName?: string;
    leadPhone?: string;
    authorName?: string;
    authorId?: string;
    fileName?: string;
    contentType?: string;
  }
): Promise<SubmitPhotoEvidenceResult> {
  let smartHomeSynced = true;
  let reason = '';

  const attachments = (input.attachments && input.attachments.length > 0)
    ? input.attachments
    : [
        {
          downloadUrl: input.photoUrl || '',
          storagePath: input.storagePath || '',
          contentType: input.contentType || 'image/jpeg',
          fileName: input.fileName || 'evidencia.jpg',
        },
      ];

  try {
    const linkLines = attachments.map((att, idx) => `Foto ${idx + 1} (${att.fileName || 'imagen.jpg'}): ${att.downloadUrl}`);
    await postSmartHomeLeadBitacora({
      companyId: input.companyId,
      leadId: input.leadId,
      actionLabel: input.actionLabel || 'Visita Terreno Realizada',
      context: input.context || 'Comercial',
      eventContent: [
        'Evidencia fotografica adjunta desde CRM Meraki',
        input.notes.trim() ? input.notes.trim() : '',
        ...linkLines,
      ].filter(Boolean).join('\n'),
      isAnEvent: input.isAnEvent || false,
      scheduledDate: input.scheduledDate,
    });
    smartHomeSynced = true;
  } catch (fbErr) {
    smartHomeSynced = false;
    reason = (fbErr as { message?: string })?.message || 'No se pudo sincronizar con SmartHome';
  }

  const evidenceId = `ev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    const subId = `${evidenceId}_${i}`;
    const record: PhotoEvidenceItem = {
      id: subId,
      leadId: input.leadId,
      leadName: input.leadName || 'Cliente',
      leadPhone: input.leadPhone || '',
      photoUrl: att.downloadUrl,
      storagePath: att.storagePath,
      notes: input.notes.trim(),
      actionLabel: input.actionLabel || 'Visita Terreno Realizada',
      context: input.context || 'Comercial',
      isAnEvent: input.isAnEvent,
      scheduledDate: input.scheduledDate || null,
      authorId: input.authorId || '',
      authorName: input.authorName || 'Asesor',
      createdAt: Date.now(),
      smartHomeSynced,
      smartHomeResult: { ok: smartHomeSynced, reason },
    };
    saveLocalEvidenceRecord(input.companyId, record);
  }

  return {
    ok: true,
    evidenceId,
    smartHomeSynced,
    smartHomeResult: { ok: smartHomeSynced, reason },
  };
}

/**
 * Lista las evidencias más recientes de la empresa o filtradas por lead.
 */
export async function listPhotoEvidences(
  companyId: string,
  leadId?: string,
  limit = 20
): Promise<PhotoEvidenceItem[]> {
  if (leadId) {
    const firestoreItems = await getLeadEvidencesFromFirestore(companyId, leadId);
    if (firestoreItems.length > 0) return firestoreItems.slice(0, limit);
  }
  const all = getLocalEvidenceRecords(companyId);
  const filtered = leadId ? all.filter((x) => x.leadId === leadId) : all;
  return filtered.slice(0, limit);
}
