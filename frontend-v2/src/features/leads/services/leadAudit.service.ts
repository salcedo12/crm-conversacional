import {
  doc,
  getDoc,
  updateDoc,
  collection,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { formatFullDateTime } from '@/shared/utils/date';

export interface LeadAuditBitacoraEntry {
  action: string;
  lastDate: string;
  description: string;
  author: string;
  authorId?: string;
  authorRole?: string;
  type: 'cambio_asesor' | 'cambio_fuente';
  system: boolean;
  createdAt: string;
}

export interface RecordLeadAuditParams {
  companyId: string;
  leadId: string;
  adminId: string;
  adminName: string;
  changeType: 'advisor' | 'source';
  previousValue: string;
  newValue: string;
}

export async function recordLeadAudit({
  companyId,
  leadId,
  adminId,
  adminName,
  changeType,
  previousValue,
  newValue,
}: RecordLeadAuditParams): Promise<{
  bitacoraEntry: LeadAuditBitacoraEntry;
  updatedBitacoras: LeadAuditBitacoraEntry[];
  noteText: string;
}> {
  const now = new Date();
  const dateFormatted = formatFullDateTime(now);
  const cleanAdmin = adminName.trim() || 'Administrador';
  const prevClean = previousValue.trim() || 'Sin especificar';
  const newClean = newValue.trim() || 'Sin especificar';

  const isAdvisor = changeType === 'advisor';
  const action = isAdvisor ? 'Cambio de Asesor (Admin)' : 'Actualización de Fuente (Admin)';
  const description = isAdvisor
    ? `Asesor reasignado por el administrador ${cleanAdmin}: De "${prevClean}" a "${newClean}" el ${dateFormatted}.`
    : `Fuente/Medio actualizado por el administrador ${cleanAdmin}: De "${prevClean}" a "${newClean}" el ${dateFormatted}.`;

  const noteText = isAdvisor
    ? `🔄 Cambio de Asesor: Reasignado de "${prevClean}" a "${newClean}". Realizado por Administrador: ${cleanAdmin}.`
    : `🧭 Actualización de Fuente/Medio: De "${prevClean}" a "${newClean}". Realizado por Administrador: ${cleanAdmin}.`;

  const bitacoraEntry: LeadAuditBitacoraEntry = {
    action,
    lastDate: dateFormatted,
    description,
    author: cleanAdmin,
    authorId: adminId || '',
    authorRole: 'admin',
    type: isAdvisor ? 'cambio_asesor' : 'cambio_fuente',
    system: true,
    createdAt: now.toISOString(),
  };

  // 1. Obtener bitácoras existentes del lead para prepender
  const leadRef = doc(db, 'companies', companyId, 'leads', leadId);
  let existingBitacoras: any[] = [];
  try {
    const snap = await getDoc(leadRef);
    if (snap.exists()) {
      const data = snap.data();
      const raw = [
        ...(Array.isArray(data.bitacoras) ? data.bitacoras : []),
        ...(Array.isArray(data.metadata?.smarthomeBitacoras) ? data.metadata.smarthomeBitacoras : []),
        ...(Array.isArray(data.smarthomeBitacoras) ? data.smarthomeBitacoras : []),
      ];
      const seen = new Set<string>();
      for (const b of raw) {
        if (!b || typeof b !== 'object') continue;
        const k = `${String(b.action || '').trim()}|${String(b.description || '').trim()}|${String(b.fecha || b.lastDate || '').slice(0, 16)}`;
        if (!seen.has(k)) {
          seen.add(k);
          existingBitacoras.push(b);
        }
      }
    }
  } catch (err) {
    console.warn('[leadAudit] No se pudo leer bitácoras previas:', err);
  }

  const updatedBitacoras = [bitacoraEntry, ...existingBitacoras];

  // 2. Guardar en el documento del lead (para ficha y resumen en tiempo real)
  await updateDoc(leadRef, {
    'metadata.smarthomeBitacoras': updatedBitacoras,
    bitacoras: updatedBitacoras,
    lastFollowUpAction: isAdvisor ? 'cambio_asesor' : 'cambio_fuente',
    lastFollowUpDate: dateFormatted,
    lastFollowUpAuthor: cleanAdmin,
    hasFicha: true,
    updatedAt: serverTimestamp(),
  });

  // 3. Registrar nota en subcolección 'notes' (para useLeadNotes y pestaña Historial de Ficha Técnica)
  try {
    await addDoc(collection(db, 'companies', companyId, 'leads', leadId, 'notes'), {
      kind: 'note',
      type: 'ficha_tecnica',
      actionType: isAdvisor ? 'cambio_asesor' : 'cambio_fuente',
      result: isAdvisor ? `Reasignado a: ${newClean}` : `Fuente: ${newClean}`,
      text: noteText,
      authorId: adminId || 'admin',
      authorName: cleanAdmin,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('[leadAudit] Error guardando nota en subcolección:', err);
  }

  return { bitacoraEntry, updatedBitacoras, noteText };
}
