import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/admin';
import type { Lead, Conversation } from '../types';

export class LeadAssignmentService {
  /**
   * Asigna un asesor usando Round-Robin por menor carga activa.
   */
  async assignLead(companyId: string, leadId: string): Promise<string | null> {
    // Sin orderBy para evitar índice compuesto — ordenamos en memoria
    const snapshot = await db.collection('users')
      .where('companyId', '==', companyId)
      .where('role', '==', 'ADVISER')
      .where('status', '==', 'ACTIVE')
      .get();

    if (snapshot.empty) {
      console.log('No hay asesores disponibles para asignar.');
      return null;
    }

    // Ordenar en memoria por assignedLeadsCount (Round-Robin por capacidad)
    const sorted = snapshot.docs.sort((a, b) =>
      (a.data().assignedLeadsCount ?? 0) - (b.data().assignedLeadsCount ?? 0)
    );
    const adviser = sorted[0];
    const adviserId = adviser.id;

    await db.runTransaction(async (tx) => {
      tx.update(db.collection('leads').doc(leadId), {
        assignedToId: adviserId,
        updatedAt: Timestamp.now(),
      });
      tx.update(db.collection('users').doc(adviserId), {
        assignedLeadsCount: FieldValue.increment(1),
      });
    });

    return adviserId;
  }

  /**
   * Busca o crea un Lead y su conversación activa al recibir mensaje de WhatsApp.
   */
  async findOrCreateLead(
    companyId: string,
    phoneNumber: string,
    name?: string
  ): Promise<{ lead: Lead; conversation: Conversation }> {
    const leadsRef = db.collection('leads');
    const conversationsRef = db.collection('conversations');

    // Buscar lead existente por companyId + phoneNumber
    const existingLeadSnap = await leadsRef
      .where('companyId', '==', companyId)
      .where('phoneNumber', '==', phoneNumber)
      .limit(1)
      .get();

    let lead: Lead;
    let isNewLead = false;

    if (!existingLeadSnap.empty) {
      lead = { id: existingLeadSnap.docs[0].id, ...existingLeadSnap.docs[0].data() } as Lead;
    } else {
      isNewLead = true;
      const now = Timestamp.now();
      const newLeadRef = leadsRef.doc();
      const newLead: Omit<Lead, 'id'> = {
        companyId,
        phoneNumber,
        name: name || `Lead ${phoneNumber}`,
        status: 'NEW',
        assignedLeadsCount: 0,
        createdAt: now,
        updatedAt: now,
      } as unknown as Omit<Lead, 'id'>;

      await newLeadRef.set(newLead);
      lead = { id: newLeadRef.id, ...newLead } as Lead;
    }

    if (isNewLead) {
      await this.assignLead(companyId, lead.id);
    }

    // Buscar o crear conversación activa
    const convSnap = await conversationsRef
      .where('leadId', '==', lead.id)
      .where('companyId', '==', companyId)
      .where('status', '==', 'ACTIVE')
      .limit(1)
      .get();

    let conversation: Conversation;

    if (!convSnap.empty) {
      conversation = { id: convSnap.docs[0].id, ...convSnap.docs[0].data() } as Conversation;
    } else {
      const now = Timestamp.now();
      const newConvRef = conversationsRef.doc();
      const newConv: Omit<Conversation, 'id'> = {
        leadId: lead.id,
        companyId,
        status: 'ACTIVE',
        aiActive: true,
        createdAt: now,
        updatedAt: now,
      };
      await newConvRef.set(newConv);
      conversation = { id: newConvRef.id, ...newConv };

      // Guardar referencia en el lead para acceso rápido desde el frontend
      await leadsRef.doc(lead.id).update({ activeConversationId: newConvRef.id });
    }

    return { lead, conversation };
  }
}
