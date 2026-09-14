import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import firestore from '@react-native-firebase/firestore';
import storage from '@react-native-firebase/storage';
import type {
  PhotoEvidenceItem,
  SearchLeadResult,
  SubmitPhotoEvidenceInput,
  SubmitPhotoEvidenceResult,
} from '../types';

const functionsInstance = getFunctions(undefined, 'us-central1');
const callable = <TInput, TResult>(name: string) =>
  httpsCallable<TInput, TResult>(functionsInstance, name);

const _searchLead = callable<{ companyId: string; phone: string }, SearchLeadResult>('searchLeadForPhotoEvidence');
const _submitEvidence = callable<SubmitPhotoEvidenceInput, SubmitPhotoEvidenceResult>('submitPhotoEvidence');
const _listEvidences = callable<{ companyId: string; leadId?: string; limit?: number }, { items: PhotoEvidenceItem[] }>('listPhotoEvidences');

export async function searchLeadForPhotoEvidence(companyId: string, phone: string): Promise<SearchLeadResult> {
  try {
    const result = await _searchLead({ companyId, phone });
    if (result.data) {
      return result.data;
    }
  } catch (err: any) {
    console.warn('[photoEvidence.service] Cloud function search error, running direct Firestore query:', err);
  }

  // Fallback directo a Firestore
  try {
    const cleanPhone = phone.trim();
    const digitsOnly = cleanPhone.replace(/\D/g, '');
    const tail = digitsOnly.length >= 7 ? digitsOnly.slice(-7) : digitsOnly;
    const colPhone = digitsOnly.length === 10 && digitsOnly.startsWith('3') ? `+57${digitsOnly}` : null;

    const leadsCol = firestore().collection('companies').doc(companyId).collection('leads');
    let doc: any = null;

    let snap = await leadsCol.where('phone', '==', cleanPhone).limit(1).get();
    if (!snap.empty) doc = snap.docs[0];

    if (!doc && colPhone) {
      snap = await leadsCol.where('phone', '==', colPhone).limit(1).get();
      if (!snap.empty) doc = snap.docs[0];
    }

    if (!doc && digitsOnly) {
      snap = await leadsCol.where('phone', '==', digitsOnly).limit(1).get();
      if (!snap.empty) doc = snap.docs[0];
    }

    if (!doc && (colPhone || cleanPhone)) {
      snap = await leadsCol.where('normalizedPhone', '==', colPhone || cleanPhone).limit(1).get();
      if (!snap.empty) doc = snap.docs[0];
    }

    if (!doc && tail) {
      snap = await leadsCol.where('phoneTail', '==', tail).limit(1).get();
      if (!snap.empty) doc = snap.docs[0];
    }

    if (!doc) {
      return {
        found: false,
        lead: null,
        canUpload: false,
        message: `No se encontró ningún contacto con el número "${cleanPhone}".`,
        evidences: [],
      };
    }

    const data = doc.data() || {};
    let assignedAdvisorName = 'Asesor';
    if (data.assignedTo) {
      try {
        const uDoc = await firestore().collection('companies').doc(companyId).collection('users').doc(data.assignedTo).get();
        if (uDoc.exists()) {
          const uData = uDoc.data();
          assignedAdvisorName = uData?.displayName || uData?.email || 'Asesor';
        }
      } catch {}
    }

    const evidences = await listRecentPhotoEvidences(companyId, doc.id, 20);

    return {
      found: true,
      lead: {
        id: doc.id,
        name: data.name || 'Sin nombre',
        phone: data.phone || cleanPhone,
        status: data.status || 'new',
        assignedTo: data.assignedTo ?? null,
        assignedAdvisorName,
        smartHomeCustomerId: data.smartHomeCustomerId ?? null,
        smartHomeSyncError: data.smartHomeSyncError ?? null,
      },
      canUpload: true,
      message: '',
      evidences,
    };
  } catch (fsErr: any) {
    console.warn('[photoEvidence.service] Firestore direct search error:', fsErr);
    return {
      found: false,
      lead: null,
      canUpload: false,
      message: 'No se pudo buscar el cliente. Verifica tu conexión.',
      evidences: [],
    };
  }
}

export async function uploadEvidencePhoto(
  companyId: string,
  leadId: string,
  file: { uri: string; fileName?: string; mimeType?: string },
  onProgress?: (percent: number) => void
): Promise<{ downloadUrl: string; storagePath: string }> {
  const timestamp = Date.now();
  const rawName = file.fileName || `foto_${timestamp}.jpg`;
  const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `companies/${companyId}/media/${leadId}/${timestamp}_evidence_${safeName}`;

  const ref = storage().ref(storagePath);
  const task = ref.putFile(file.uri, {
    contentType: file.mimeType || 'image/jpeg',
  });

  task.on('state_changed', (snapshot) => {
    if (snapshot.totalBytes > 0) {
      const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
      onProgress?.(pct);
    }
  });

  await task;
  const downloadUrl = await ref.getDownloadURL();
  return { downloadUrl, storagePath };
}

export async function submitPhotoEvidence(input: SubmitPhotoEvidenceInput): Promise<SubmitPhotoEvidenceResult> {
  try {
    const result = await _submitEvidence(input);
    if (result.data) {
      return result.data;
    }
  } catch (fnErr) {
    console.warn('[photoEvidence.service] Cloud function submit error, falling back to Firestore & SmartHome bitacora:', fnErr);
  }

  // Fallback directo a Firestore y SmartHome
  try {
    const evidenceData: any = {
      companyId: input.companyId,
      leadId: input.leadId,
      photoUrl: input.photoUrl,
      storagePath: input.storagePath,
      notes: input.notes.trim(),
      actionLabel: input.actionLabel || 'Visita Terreno Realizada',
      context: input.context || 'Comercial',
      isAnEvent: !!input.isAnEvent,
      scheduledDate: input.scheduledDate || null,
      createdAt: firestore.FieldValue.serverTimestamp(),
      smartHomeSynced: false,
    };

    const leadEvidenceRef = await firestore()
      .collection('companies')
      .doc(input.companyId)
      .collection('leads')
      .doc(input.leadId)
      .collection('photo_evidence')
      .add(evidenceData);

    await firestore()
      .collection('companies')
      .doc(input.companyId)
      .collection('photo_evidence')
      .doc(leadEvidenceRef.id)
      .set({
        ...evidenceData,
        id: leadEvidenceRef.id,
      });

    let smartHomeSynced = false;
    try {
      const postEvidenceFn = callable<any, any>('postSmartHomeLeadEvidence');
      const res = await postEvidenceFn({
        companyId: input.companyId,
        leadId: input.leadId,
        note: input.notes.trim() || undefined,
        actionLabel: input.actionLabel,
        context: input.context,
        attachments: [
          {
            downloadUrl: input.photoUrl,
            storagePath: input.storagePath,
            contentType: 'image/jpeg',
            fileName: 'evidencia.jpg',
          },
        ],
      });
      smartHomeSynced = !!res.data?.sentToSmartHome;
    } catch {
      try {
        const postBitacoraFn = callable<any, any>('postSmartHomeLeadBitacora');
        const res = await postBitacoraFn({
          companyId: input.companyId,
          leadId: input.leadId,
          actionLabel: input.actionLabel,
          context: input.context,
          eventContent: `${input.notes.trim()}\n\n📷 Evidencia: ${input.photoUrl}`,
          isAnEvent: input.isAnEvent,
          scheduledDate: input.scheduledDate,
        });
        smartHomeSynced = !!res.data?.ok;
      } catch {}
    }

    await firestore()
      .collection('companies')
      .doc(input.companyId)
      .collection('leads')
      .doc(input.leadId)
      .set({
        lastPhotoEvidenceAt: firestore.FieldValue.serverTimestamp(),
        lastPhotoEvidenceUrl: input.photoUrl,
      }, { merge: true });

    return {
      ok: true,
      evidenceId: leadEvidenceRef.id,
      smartHomeSynced,
      smartHomeResult: { ok: smartHomeSynced },
    };
  } catch (fsSubmitErr: any) {
    console.error('[photoEvidence.service] submitPhotoEvidence fallback error:', fsSubmitErr);
    throw new Error(fsSubmitErr?.message || 'Error al registrar la evidencia.');
  }
}

export async function listRecentPhotoEvidences(
  companyId: string,
  leadId?: string,
  limitCount = 30
): Promise<PhotoEvidenceItem[]> {
  try {
    const res = await _listEvidences({ companyId, leadId, limit: limitCount });
    if (res.data?.items) return res.data.items;
  } catch (fnErr) {
    console.warn('[photoEvidence.service] function call fallback to firestore:', fnErr);
  }

  // Fallback directo a Firestore
  try {
    let queryRef = leadId
      ? firestore()
          .collection('companies')
          .doc(companyId)
          .collection('leads')
          .doc(leadId)
          .collection('photo_evidence')
          .orderBy('createdAt', 'desc')
          .limit(limitCount)
      : firestore()
          .collection('companies')
          .doc(companyId)
          .collection('photo_evidence')
          .orderBy('createdAt', 'desc')
          .limit(limitCount);

    const snap = await queryRef.get();
    return snap.docs.map((d) => {
      const data = d.data();
      const rawCreatedAt = data.createdAt;
      const createdAtMs = rawCreatedAt?.toMillis
        ? rawCreatedAt.toMillis()
        : typeof rawCreatedAt === 'number'
          ? rawCreatedAt
          : Date.now();

      return {
        id: d.id,
        leadId: data.leadId || leadId,
        leadName: data.leadName || '',
        leadPhone: data.leadPhone || '',
        photoUrl: data.photoUrl || '',
        storagePath: data.storagePath || '',
        notes: data.notes || '',
        actionLabel: data.actionLabel || 'Registro fotográfico',
        context: data.context || 'Comercial',
        authorId: data.authorId || '',
        authorName: data.authorName || 'Asesor',
        createdAt: createdAtMs,
        smartHomeSynced: !!data.smartHomeSynced,
        smartHomeResult: data.smartHomeResult || null,
      };
    });
  } catch (fsErr) {
    console.warn('[photoEvidence.service] firestore fallback error:', fsErr);
    return [];
  }
}
