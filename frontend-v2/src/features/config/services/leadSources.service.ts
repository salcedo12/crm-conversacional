import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Timestamp,
} from 'firebase/firestore';
import { db } from '@/config/firebase';

export interface LeadSourceItem {
  id: string;
  name: string;
  active: boolean;
  leadCount?: number;
  description?: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export function subscribeLeadSources(
  companyId: string,
  onUpdate: (sources: LeadSourceItem[]) => void,
  onError?: (err: Error) => void
): () => void {
  const colRef = collection(db, 'companies', companyId, 'leadSources');
  const q = query(colRef, orderBy('name', 'asc'));

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<LeadSourceItem, 'id'>),
      }));
      onUpdate(items);
    },
    (err) => {
      console.error('[leadSources.service] Error escuchando fuentes:', err);
      onError?.(err);
    }
  );
}

export async function createLeadSource(
  companyId: string,
  name: string,
  description?: string
): Promise<string> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error('El nombre de la fuente es obligatorio.');

  const slug = cleanName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'fuente_' + Date.now();

  const docRef = doc(db, 'companies', companyId, 'leadSources', slug);
  await setDoc(docRef, {
    name: cleanName,
    active: true,
    description: description?.trim() || '',
    leadCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return slug;
}

export async function toggleLeadSourceActive(
  companyId: string,
  sourceId: string,
  active: boolean
): Promise<void> {
  const docRef = doc(db, 'companies', companyId, 'leadSources', sourceId);
  await updateDoc(docRef, {
    active,
    updatedAt: serverTimestamp(),
  });
}

export async function updateLeadSourceName(
  companyId: string,
  sourceId: string,
  newName: string,
  description?: string
): Promise<void> {
  const cleanName = newName.trim();
  if (!cleanName) throw new Error('El nombre de la fuente no puede estar vacío.');

  const docRef = doc(db, 'companies', companyId, 'leadSources', sourceId);
  await updateDoc(docRef, {
    name: cleanName,
    ...(description !== undefined ? { description: description.trim() } : {}),
    updatedAt: serverTimestamp(),
  });
}
