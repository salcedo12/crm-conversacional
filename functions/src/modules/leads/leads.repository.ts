import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';
import type { Lead, CreateLeadInput, UpdateLeadInput } from './leads.types';

// Ruta: companies/{companyId}/leads
const col = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('leads');

function cursorValueForClient(value: unknown): unknown {
  return value instanceof Timestamp ? value.toMillis() : value;
}

function cursorValueForStartAfter(field: string, value: unknown): unknown {
  if ((field === 'lastMessageAt' || field === 'createdAt') && typeof value === 'number') {
    return Timestamp.fromMillis(value);
  }
  return value;
}

export const leadsRepository = {
  async findByNormalizedPhone(
    companyId: string,
    normalizedPhone: string
  ): Promise<Lead | null> {
    const snap = await col(companyId)
      .where('normalizedPhone', '==', normalizedPhone)
      .limit(1)
      .get();
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as Lead;
  },

  /** Busca un lead de Messenger/Instagram por su PSID/IGSID. Usa el campo compuesto
   *  `channelExternalId` (`${channel}:${externalId}`) para que sea una query de un
   *  solo campo, igual que `findByNormalizedPhone`. */
  async findByExternalId(
    companyId: string,
    channel: Lead['channel'],
    externalId: string
  ): Promise<Lead | null> {
    const snap = await col(companyId)
      .where('channelExternalId', '==', `${channel}:${externalId}`)
      .limit(1)
      .get();
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as Lead;
  },

  async findById(companyId: string, leadId: string): Promise<Lead | null> {
    const snap = await col(companyId).doc(leadId).get();
    if (!snap.exists) return null;
    return { id: snap.id, ...snap.data() } as Lead;
  },

  /**
   * Resuelve la audiencia de un envío masivo según un filtro simple:
   *   - all    → todos los leads de la empresa
   *   - status → leads con un estado concreto
   *   - tag    → leads que tengan una etiqueta concreta
   *
   * Devuelve la lista completa de leads que cumplen el filtro.
   */
  async listByAudience(
    companyId: string,
    audience: { type: 'all' | 'status' | 'tag' | 'list'; value?: string }
  ): Promise<Lead[]> {
    let query: FirebaseFirestore.Query = col(companyId);
    if (audience.type === 'status' && audience.value) {
      query = query.where('status', '==', audience.value);
    } else if (audience.type === 'tag' && audience.value) {
      query = query.where('tags', 'array-contains', audience.value);
    } else if (audience.type === 'list' && audience.value) {
      query = query.where('listIds', 'array-contains', audience.value);
    }
    const snap = await query.get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Lead));
  },

  async countByAudience(
    companyId: string,
    audience: { type: 'all' | 'status' | 'tag' | 'list'; value?: string }
  ): Promise<number> {
    let query: FirebaseFirestore.Query = col(companyId);
    if (audience.type === 'status' && audience.value) {
      query = query.where('status', '==', audience.value);
    } else if (audience.type === 'tag' && audience.value) {
      query = query.where('tags', 'array-contains', audience.value);
    } else if (audience.type === 'list' && audience.value) {
      query = query.where('listIds', 'array-contains', audience.value);
    }
    const snap = await query.count().get();
    return snap.data().count;
  },

  async listAudiencePage(
    companyId: string,
    audience: { type: 'all' | 'status' | 'tag' | 'list'; value?: string },
    pageSize: number,
    cursor?: string
  ): Promise<{ leads: Lead[]; nextCursor?: string; hasMore: boolean }> {
    let query: FirebaseFirestore.Query = col(companyId);
    if (audience.type === 'status' && audience.value) {
      query = query.where('status', '==', audience.value);
    } else if (audience.type === 'tag' && audience.value) {
      query = query.where('tags', 'array-contains', audience.value);
    } else if (audience.type === 'list' && audience.value) {
      query = query.where('listIds', 'array-contains', audience.value);
    }

    query = query.orderBy(FieldPath.documentId());
    if (cursor) query = query.startAfter(cursor);

    const snap = await query.limit(pageSize + 1).get();
    const docs = snap.docs.slice(0, pageSize);
    const leads = docs.map((d) => ({ id: d.id, ...d.data() } as Lead));
    return {
      leads,
      nextCursor: docs.length > 0 ? docs[docs.length - 1].id : cursor,
      hasMore: snap.docs.length > pageSize,
    };
  },

  async listPage(
    companyId: string,
    input: {
      pageSize: number;
      cursor?: { id: string; value?: unknown };
      sortField: 'lastMessageAt' | 'createdAt' | 'name' | 'status';
      sortDir: 'asc' | 'desc';
      filters: {
        search?: string;
        status?: Lead['status'] | 'all';
        aiEnabled?: 'all' | 'active' | 'manual';
        assignedTo?: string;
        tags?: string[];
        inboxId?: string;
        listId?: string;
        source?: Lead['source'] | 'all';
      };
    }
  ): Promise<{ leads: Lead[]; nextCursor: { id: string; value?: unknown } | null; hasMore: boolean }> {
    let query: FirebaseFirestore.Query = col(companyId);
    const filters = input.filters;

    if (filters.status && filters.status !== 'all') {
      query = query.where('status', '==', filters.status);
    }
    if (filters.source && filters.source !== 'all') {
      query = query.where('source', '==', filters.source);
    }
    if (filters.aiEnabled === 'active') {
      query = query.where('aiEnabled', '==', true);
    } else if (filters.aiEnabled === 'manual') {
      query = query.where('aiEnabled', '==', false);
    }
    if (filters.assignedTo && filters.assignedTo !== 'all' && filters.assignedTo !== 'unassigned') {
      query = query.where('assignedTo', '==', filters.assignedTo);
    }
    if (filters.inboxId && filters.inboxId !== 'all') {
      query = query.where('inboxId', '==', filters.inboxId);
    }
    if (filters.listId && filters.listId !== 'all') {
      query = query.where('listIds', 'array-contains', filters.listId);
    } else if (filters.tags?.length) {
      query = query.where('tags', 'array-contains-any', filters.tags.slice(0, 10));
    }

    const search = filters.search?.trim();
    let orderField: 'lastMessageAt' | 'createdAt' | 'name' | 'status' | 'normalizedPhone' = input.sortField;
    if (search) {
      const phoneSearch = search.replace(/[^\d+]/g, '');
      if (/^\+?\d{3,}$/.test(phoneSearch)) {
        orderField = 'normalizedPhone';
        const normalizedPhoneSearch = phoneSearch.startsWith('+') ? phoneSearch : `+${phoneSearch}`;
        query = query
          .where('normalizedPhone', '>=', normalizedPhoneSearch)
          .where('normalizedPhone', '<=', `${normalizedPhoneSearch}\uf8ff`);
      } else {
        orderField = 'name';
        query = query.where('name', '>=', search).where('name', '<=', `${search}\uf8ff`);
      }
    }

    query = query.orderBy(orderField, input.sortDir);

    if (input.cursor) {
      const value = cursorValueForStartAfter(orderField, input.cursor.value);
      if (value !== undefined) query = query.startAfter(value);
    }

    const snap = await query.limit(input.pageSize + 1).get();
    const docs = snap.docs.slice(0, input.pageSize);
    const leads = docs.map((d) => ({ id: d.id, ...d.data() } as Lead));
    const last = docs[docs.length - 1];
    return {
      leads,
      nextCursor: last ? { id: last.id, value: cursorValueForClient(last.get(orderField)) } : null,
      hasMore: snap.docs.length > input.pageSize,
    };
  },

  async create(companyId: string, input: CreateLeadInput): Promise<Lead> {
    const ref = col(companyId).doc();
    await ref.set(input);
    return { id: ref.id, ...input };
  },

  async update(
    companyId: string,
    leadId: string,
    input: UpdateLeadInput
  ): Promise<void> {
    await col(companyId).doc(leadId).update({
      ...input,
      updatedAt: Timestamp.now(),
    });
  },
};
