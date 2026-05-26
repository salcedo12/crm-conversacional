import { onRequest } from 'firebase-functions/v2/https';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import cors from 'cors';
import { db } from '../lib/admin';
import { AgendaService } from '../services/agenda.service';

const corsMiddleware = cors({ origin: true });
const agendaService = new AgendaService();

// ── GET /conversations/:id/messages  ────────────────────────────────────────
// POST /conversations/:id/messages   (asesor envía mensaje)
// POST /conversations/:id/takeover   (toggle aiActive)
export const conversations = onRequest(
  { region: 'us-central1', invoker: 'public' },
  (req, res) => {
    corsMiddleware(req, res, async () => {
      // Extraer segmentos del path: /conversations/{id}/{action}
      const segments = req.path.replace(/^\//, '').split('/');
      const conversationId = segments[0];
      const action = segments[1]; // 'messages' | 'takeover'

      if (!conversationId) {
        res.status(400).json({ error: 'conversationId requerido en el path' });
        return;
      }

      // GET /conversations/:id/messages
      if (req.method === 'GET' && action === 'messages') {
        const snap = await db
          .collection('conversations')
          .doc(conversationId)
          .collection('messages')
          .orderBy('timestamp', 'asc')
          .get();

        const messages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        res.status(200).json(messages);
        return;
      }

      // POST /conversations/:id/messages  — asesor envía mensaje manual
      if (req.method === 'POST' && action === 'messages') {
        const { content, senderType = 'ADVISER' } = req.body;
        if (!content) {
          res.status(400).json({ error: 'content requerido' });
          return;
        }

        const now = Timestamp.now();
        const msgRef = await db
          .collection('conversations')
          .doc(conversationId)
          .collection('messages')
          .add({ conversationId, senderType, content, timestamp: now });

        await db.collection('conversations').doc(conversationId).update({
          lastMessageText: content,
          lastMessageAt: now,
          updatedAt: now,
        });

        res.status(201).json({ id: msgRef.id, status: 'sent' });
        return;
      }

      // POST /conversations/:id/takeover  — toggle IA on/off
      if (req.method === 'POST' && action === 'takeover') {
        const convSnap = await db.collection('conversations').doc(conversationId).get();
        if (!convSnap.exists) {
          res.status(404).json({ error: 'Conversación no encontrada' });
          return;
        }

        const currentAiActive = convSnap.data()!.aiActive as boolean;
        await db.collection('conversations').doc(conversationId).update({
          aiActive: !currentAiActive,
          updatedAt: Timestamp.now(),
        });

        res.status(200).json({ aiActive: !currentAiActive });
        return;
      }

      res.sendStatus(404);
    });
  }
);

// ── Callable Function: bookAppointment ──────────────────────────────────────
// Llamada desde el frontend con Firebase SDK (no fetch/axios directo)
export const bookAppointment = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Se requiere autenticación.');
    }

    const { leadId, adviserId, companyId, title, startTimeISO, durationMinutes } =
      request.data as {
        leadId: string;
        adviserId: string;
        companyId: string;
        title: string;
        startTimeISO: string;
        durationMinutes?: number;
      };

    if (!leadId || !adviserId || !companyId || !title || !startTimeISO) {
      throw new HttpsError('invalid-argument', 'Parámetros incompletos.');
    }

    const appointment = await agendaService.bookAppointment(
      leadId,
      adviserId,
      companyId,
      title,
      new Date(startTimeISO),
      durationMinutes ?? 30
    );

    return { appointmentId: appointment.id, googleMeetLink: appointment.googleMeetLink };
  }
);
