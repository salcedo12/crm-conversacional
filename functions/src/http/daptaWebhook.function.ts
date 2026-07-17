import { onRequest }  from 'firebase-functions/v2/https';
import { Timestamp }  from 'firebase-admin/firestore';
import { env }        from '../config/env';
import { logger }     from '../utils/logger';
import { toNormalizedPhone } from '../utils/phone';
import { leadsRepository }   from '../modules/leads/leads.repository';
import { callsRepository }   from '../modules/calls/calls.repository';
import type { CallStatus }   from '../modules/calls/calls.types';

/**
 * IPs públicas desde las que Dapta envía webhooks (docs.dapta.ai).
 * Se usan como validación blanda: si la petición no viene de aquí Y no trae
 * el secreto correcto, se rechaza. Actualizar si Dapta cambia sus IPs.
 */
const DAPTA_IPS = ['3.135.117.63', '3.143.158.83', '3.14.139.223'];

// ─── Helpers de extracción tolerante ────────────────────────────────────────
// El esquema exacto del webhook de Dapta no está documentado, así que buscamos
// el primer campo presente entre varios nombres candidatos.

type Json = Record<string, unknown>;

function pick(obj: Json, paths: string[]): unknown {
  for (const path of paths) {
    const value = path.split('.').reduce<unknown>(
      (acc, key) => (acc && typeof acc === 'object' ? (acc as Json)[key] : undefined),
      obj
    );
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v);
  return undefined;
}

function mapStatus(raw: string | undefined): CallStatus {
  const s = (raw ?? '').toLowerCase();
  if (s.includes('voicemail') || s.includes('buzón') || s.includes('no_concluida')) return 'voicemail';
  if (s.includes('transfer'))                          return 'transferred';
  if (s.includes('no-answer') || s.includes('no answer') || s.includes('noanswer') || s.includes('no_contesto')) return 'no-answer';
  if (s.includes('busy') || s.includes('ocupado'))     return 'busy';
  if (s.includes('fail') || s.includes('error'))       return 'failed';
  if (s.includes('complet') || s.includes('ended') || s.includes('finish') || s.includes('success')) return 'completed';
  return 'completed';
}

/**
 * Traduce el `stage` que clasifica el flujo de Dapta (Gemini) a una etiqueta
 * legible para mostrar como "Resultado" en la ficha del lead.
 */
function friendlyOutcome(stage: string | undefined): string | undefined {
  if (!stage) return undefined;
  const map: Record<string, string> = {
    'call-ia-interesado':      'Interesado',
    'call-ia-no_interesado':   'No interesado',
    'call-ia-no_contesto':     'No contestó',
    'call-ia-contesto':        'Contestó',
    'call-ia-recontactar':     'Recontactar',
    'call-ia-no_califica':     'No califica',
    'call-ia-no_concluida':    'No concluida',
    'call-ia-agendado':        'Agendó cita',
    'call-ia-citavirtual':     'Cita virtual',
    'call-ia-citapresencial':  'Cita presencial',
  };
  return map[stage.toLowerCase().trim()] ?? stage;
}

// ─── Webhook ─────────────────────────────────────────────────────────────────

export const daptaWebhook = onRequest(
  {
    region:         'us-central1',
    cors:           false,
    timeoutSeconds: 30,
    memory:         '256MiB',
    invoker:        'public',
  },
  async (req, res) => {
    if (req.method !== 'POST') { res.sendStatus(405); return; }

    // ── Validación de origen ──────────────────────────────────────────────
    const secret = env.daptaWebhookSecret();
    if (secret) {
      const provided = (req.query.secret as string | undefined)
        ?? (req.header('x-dapta-secret') ?? undefined);
      if (provided !== secret) {
        logger.warn('[Dapta Webhook] Secreto inválido — rechazado');
        res.sendStatus(401);
        return;
      }
    } else {
      // Sin secreto configurado: validar por IP de origen (blando).
      const fwd = (req.header('x-forwarded-for') ?? '').split(',').map((s) => s.trim());
      const sourceIp = fwd[0] || req.ip || '';
      if (sourceIp && !DAPTA_IPS.includes(sourceIp)) {
        logger.warn('[Dapta Webhook] IP no reconocida — se procesa igual, configura DAPTA_WEBHOOK_SECRET para reforzar', { sourceIp });
      }
    }

    // Responder rápido; el procesamiento puede continuar.
    res.sendStatus(200);

    const body = (req.body ?? {}) as Json;

    try {
      await processDaptaCall(body);
    } catch (err) {
      logger.error('[Dapta Webhook] Error procesando llamada', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
);

async function processDaptaCall(body: Json): Promise<void> {
  const companyId = env.defaultCompanyId();

  // Algunos webhooks envuelven el contenido en data/payload/call/event.
  const root: Json = (
    (body.data ?? body.payload ?? body.call ?? body.event ?? body) as Json
  );

  // ── Teléfono del contacto ────────────────────────────────────────────────
  const rawPhone = asString(pick(root, [
    'phone', 'to', 'phoneNumber', 'contactPhone', 'customerNumber',
    'contact.phone', 'contact.phoneNumber', 'customer.number', 'customer.phone',
    'lead.phone', 'recipient', 'recipient_phone',
  ]));

  // ── leadId/contact_id reenviado por nosotros al iniciar la llamada ───────
  // En el webhook del agente de voz viaja anidado en call.dynamic_variables.contact_id
  // (lo confirma el flujo webhook_call de Dapta). Cubrimos varias ubicaciones.
  const leadIdHint = asString(pick(root, [
    'leadId', 'lead_id', 'contact_id', 'contactId',
    'metadata.leadId', 'variables.leadId', 'contact.leadId',
    'dynamic_variables.contact_id', 'call.dynamic_variables.contact_id',
    'variables.contact_id', 'metadata.contact_id',
  ])) ?? asString(pick(body, [
    'call.dynamic_variables.contact_id', 'data.call.dynamic_variables.contact_id',
  ]));

  if (!rawPhone && !leadIdHint) {
    logger.warn('[Dapta Webhook] Sin teléfono ni leadId en el payload — ignorado', {
      keys: Object.keys(root).slice(0, 20),
    });
    return;
  }

  // ── Localizar el lead ────────────────────────────────────────────────────
  let lead = leadIdHint
    ? await leadsRepository.findById(companyId, leadIdHint)
    : null;

  if (!lead && rawPhone) {
    const phone     = rawPhone.startsWith('+') ? rawPhone : `+${rawPhone.replace(/\D/g, '')}`;
    const normPhone = toNormalizedPhone(phone);
    lead = await leadsRepository.findByNormalizedPhone(companyId, normPhone);
  }

  if (!lead) {
    logger.warn('[Dapta Webhook] Lead no encontrado para la llamada', { rawPhone, leadIdHint });
    return;
  }

  // ── Campos de la llamada ─────────────────────────────────────────────────
  const externalId = asString(pick(root, [
    'callId', 'call_id', 'id', 'callSid', 'executionId', 'sessionId',
  ])) ?? `dapta_${Date.now()}`;

  const rawStage   = asString(pick(root, ['stage', 'outcome', 'disposition', 'result', 'tag']));
  const status     = mapStatus(asString(pick(root, ['status', 'callStatus', 'result', 'disposition'])) ?? rawStage);
  const summary    = asString(pick(root, [
    'summary', 'callSummary', 'call_analysis.call_summary', 'callAnalysis.callSummary',
    'analysis.summary', 'analysis', 'description', 'notes', 'aiSummary',
  ]));
  const transcript = asString(pick(root, ['transcript', 'transcription', 'conversation', 'fullTranscript']));
  const recordingUrl = asString(pick(root, ['recordingUrl', 'recording_url', 'recording', 'audioUrl', 'recordingURL']));
  const durationSec  = asNumber(pick(root, ['duration', 'durationSec', 'duration_seconds', 'total_duration_seconds', 'callDuration', 'length']));
  const outcome      = friendlyOutcome(rawStage);
  const agentName    = asString(pick(root, ['agentName', 'agent', 'from', 'fromNumber', 'agentNumber']));

  // ── Idempotencia: ¿ya existe una llamada (initiated o previa) con ese ID? ──
  // El payload de nuestro nodo action_14 no trae un ID de llamada que coincida
  // con el externalId guardado al iniciar (Dapta no lo reenvía) — si no hay
  // match por ID, se cae al 'initiated' más reciente del lead para no duplicar.
  const existing = (await callsRepository.findByExternalId(companyId, lead.id, externalId))
    ?? (await callsRepository.findLatestInitiated(companyId, lead.id));

  const now = Timestamp.now();
  const callData = {
    status,
    ...(summary      !== undefined && { summary }),
    ...(transcript   !== undefined && { transcript }),
    ...(recordingUrl !== undefined && { recordingUrl }),
    ...(durationSec  !== undefined && { durationSec }),
    ...(outcome      !== undefined && { outcome }),
    ...(agentName    !== undefined && { agentName }),
    raw: root,
  };

  if (existing) {
    await callsRepository.update(companyId, lead.id, existing.id, callData);
    logger.info('[Dapta Webhook] Llamada actualizada', { leadId: lead.id, externalId, status });
  } else {
    await callsRepository.create({
      companyId,
      leadId:    lead.id,
      direction: 'outbound',
      provider:  'dapta',
      externalId,
      createdAt: now,
      ...callData,
    });
    logger.info('[Dapta Webhook] Llamada registrada', { leadId: lead.id, externalId, status });
  }

  // Reflejar la actividad en el lead (para ordenar/mostrar última actividad).
  await leadsRepository.update(companyId, lead.id, {
    lastMessageText: summary ? `📞 ${summary.slice(0, 80)}` : '📞 Llamada IA',
    lastMessageAt:   now,
  });
}
