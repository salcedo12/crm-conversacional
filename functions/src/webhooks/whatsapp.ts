import { onRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/admin';
import { LeadAssignmentService } from '../services/lead-assignment.service';
import { OpenAIService } from '../services/openai.service';
import { WhatsAppSenderService } from '../services/whatsapp-sender.service';

const VERIFY_TOKEN = defineString('WHATSAPP_VERIFY_TOKEN');
const DEFAULT_COMPANY_ID = defineString('DEFAULT_COMPANY_ID');

const assignmentService = new LeadAssignmentService();
const aiService = new OpenAIService();
const whatsappSender = new WhatsAppSenderService();

export const webhookWhatsapp = onRequest(
  { region: 'us-central1', cors: false, timeoutSeconds: 60, invoker: 'public' },
  async (req, res) => {
    // ── GET: Verificación del webhook por Meta ──────────────────────────────
    if (req.method === 'GET') {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      if (mode === 'subscribe' && token === VERIFY_TOKEN.value()) {
        console.log('WhatsApp webhook verificado.');
        res.status(200).send(challenge);
      } else {
        res.sendStatus(403);
      }
      return;
    }

    // ── POST: Mensaje entrante de WhatsApp ──────────────────────────────────
    if (req.method === 'POST') {
      const body = req.body;

      if (!body.object) {
        res.sendStatus(404);
        return;
      }

      // Responder 200 a Meta de inmediato (evita reenvíos por timeout)
      res.sendStatus(200);

      try {
        const value = body.entry?.[0]?.changes?.[0]?.value;
        if (!value?.messages?.length) return;

        const messageObj = value.messages[0];
        const contactObj = value.contacts?.[0];

        const phoneNumber: string = messageObj.from;
        const contactName: string | undefined = contactObj?.profile?.name;
        const metaMessageId: string = messageObj.id;
        const textBody: string =
          messageObj.type === 'text' ? messageObj.text.body : '[Multimedia]';

        const companyId = DEFAULT_COMPANY_ID.value();

        console.log(`[WhatsApp] Mensaje de ${phoneNumber}: "${textBody}"`);

        // 1. Encontrar o crear lead y conversación
        const { conversation } = await assignmentService.findOrCreateLead(
          companyId,
          phoneNumber,
          contactName
        );

        const now = Timestamp.now();

        // 2. Guardar mensaje del lead en Firestore
        await db
          .collection('conversations')
          .doc(conversation.id)
          .collection('messages')
          .add({
            conversationId: conversation.id,
            senderType: 'LEAD',
            content: textBody,
            metaMessageId,
            timestamp: now,
          });

        await db.collection('conversations').doc(conversation.id).update({
          lastMessageText: textBody,
          lastMessageAt: now,
          updatedAt: now,
        });

        // 3. Si la IA está activa, generar y enviar respuesta
        if (conversation.aiActive) {
          console.log(`[IA] Generando respuesta para conversación ${conversation.id}...`);

          const aiReply = await aiService.generateReply(
            conversation.id,
            companyId,
            textBody
          );

          console.log(`[IA] Respuesta generada: "${aiReply}"`);

          const aiNow = Timestamp.now();

          // 4. Guardar respuesta de la IA en Firestore (aparece en el chat en tiempo real)
          await db
            .collection('conversations')
            .doc(conversation.id)
            .collection('messages')
            .add({
              conversationId: conversation.id,
              senderType: 'AI',
              content: aiReply,
              timestamp: aiNow,
            });

          await db.collection('conversations').doc(conversation.id).update({
            lastMessageText: aiReply,
            lastMessageAt: aiNow,
            updatedAt: aiNow,
          });

          // 5. Enviar por WhatsApp al lead
          await whatsappSender.sendText(phoneNumber, aiReply);

        } else {
          console.log(`[IA] Conversación ${conversation.id} en modo manual — sin respuesta automática.`);
        }

      } catch (err) {
        console.error('[Webhook] Error procesando evento:', err);
      }
      return;
    }

    res.sendStatus(405);
  }
);
