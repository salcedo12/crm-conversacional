import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';
import type { Lead, CreateLeadInput, UpdateLeadInput } from './leads.types';

// Ruta: companies/{companyId}/leads
const col = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('leads');

function cursorValueForClient(value: unknown): unknown {
  return value instanceof Timestamp ? value.toMillis() : value;
}

/** Normaliza un nombre para comparar: minúsculas, sin tildes/emojis, solo letras y espacios. */
function normName(name: string): string {
  return (name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')     // quitar tildes
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')                             // solo letras
    .replace(/\s+/g, ' ')
    .trim();
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

  /** Busca un lead por los últimos 10 dígitos del teléfono (número nacional), para
   *  deduplicar a la misma persona aunque el indicativo difiera (+1 del formulario
   *  vs +57 de WhatsApp). Excluye el propio lead si se pasa `excludeId`. */
  async findByPhoneTail(
    companyId: string,
    tail: string,
    excludeId?: string
  ): Promise<Lead | null> {
    if (!tail) return null;
    const snap = await col(companyId)
      .where('phoneTail', '==', tail)
      .limit(2)
      .get();
    for (const d of snap.docs) {
      if (d.id !== excludeId) return { id: d.id, ...d.data() } as Lead;
    }
    return null;
  },

  /**
   * Para el caso raro de un lead de WhatsApp SIN número (usuario oculto): busca
   * otro lead CON número que tenga (casi) el mismo nombre, para marcar "posible
   * duplicado". No se puede unir automático (no hay número que comparar), así que
   * solo se usa como pista para que el asesor lo revise. Coincidencia laxa por
   * nombre normalizado (sin tildes/emojis, minúsculas), incluyendo subcadenas.
   */
  async findNameTwinWithPhone(companyId: string, name: string): Promise<Lead | null> {
    const key = normName(name);
    if (key.length < 4) return null;
    const snap = await col(companyId).orderBy('createdAt', 'desc').limit(400).get();
    for (const d of snap.docs) {
      const x = d.data() as Lead;
      if (!x.phone) continue;                        // solo leads CON número
      const k2 = normName(x.name || '');
      if (k2.length < 4) continue;
      if (k2 === key || k2.includes(key) || key.includes(k2)) {
        return { ...x, id: d.id } as Lead;
      }
    }
    return null;
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

  /**
   * Crea un lead RECLAMANDO de forma atómica una identidad (teléfono normalizado
   * o BSUID) para cerrar la carrera de duplicados: si dos mensajes de un cliente
   * NUEVO llegan casi a la vez, cada webhook corre en paralelo, ambos hacen
   * "buscar-o-crear", ambos ven "no existe" y ambos crean un lead. Con el reclamo,
   * el primero gana y el segundo REUSA ese mismo lead.
   *
   * La transacción escribe el doc índice y el lead en UN solo commit atómico, así
   * el perdedor —al leer el índice ya reclamado— siempre encuentra el lead ganador
   * ya persistido (sin ventana intermedia).
   *
   * Índice: companies/{companyId}/leadIndex/{claimKey}
   *
   * @returns { lead, created }. created=false ⇒ ya existía (reusado), NO reasignar.
   */
  async createWithIdentityClaim(
    companyId: string,
    claimKey: string,
    input: CreateLeadInput,
  ): Promise<{ lead: Lead; created: boolean }> {
    // Sin identidad estable para reclamar (ni teléfono ni BSUID): se cae al create
    // normal — no queda peor que el comportamiento histórico.
    if (!claimKey) return { lead: await this.create(companyId, input), created: true };

    const leadRef  = col(companyId).doc();
    const indexRef = db
      .collection('companies').doc(companyId)
      .collection('leadIndex').doc(claimKey);

    const result = await db.runTransaction(async (tx) => {
      const idxSnap = await tx.get(indexRef);
      if (idxSnap.exists) {
        return { leadId: (idxSnap.data() as { leadId: string }).leadId, created: false };
      }
      tx.set(indexRef, { leadId: leadRef.id, createdAt: Timestamp.now() });
      tx.set(leadRef, input);
      return { leadId: leadRef.id, created: true };
    });

    if (result.created) return { lead: { id: leadRef.id, ...input }, created: true };

    const winner = await col(companyId).doc(result.leadId).get();
    if (winner.exists) {
      return { lead: { id: winner.id, ...(winner.data() as object) } as Lead, created: false };
    }
    // Índice huérfano (lead borrado): crear normal como último recurso.
    return { lead: await this.create(companyId, input), created: true };
  },

  /** Actualiza SOLO la identidad de teléfono (para unificar un duplicado al número
   *  real de WhatsApp). `update()` normal no permite tocar phone/normalizedPhone. */
  async updatePhoneIdentity(
    companyId: string,
    leadId: string,
    phone: string,
    normalizedPhone: string,
    tail: string
  ): Promise<void> {
    await col(companyId).doc(leadId).update({
      phone,
      normalizedPhone,
      ...(tail ? { phoneTail: tail } : {}),
      updatedAt: Timestamp.now(),
    });
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
