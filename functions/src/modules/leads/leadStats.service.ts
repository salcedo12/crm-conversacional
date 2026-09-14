import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';
import { logger } from '../../utils/logger';
import type { LeadStats } from './leads.types';
import type { Message } from '../messages/messages.types';

/**
 * Contadores de mensajería denormalizados por lead (`lead.stats`).
 *
 * Problema que resuelve: getAdvisorReports calculaba tiempos de respuesta,
 * mensajes del asesor y "esperando respuesta" recorriendo hasta 300 mensajes
 * POR CADA lead en CADA apertura del informe (O(leads × mensajes) de lecturas
 * Firestore, con riesgo de timeout en bases grandes).
 *
 * Solución: mantener esas cifras ya sumadas en el documento del lead,
 * actualizándolas de a un mensaje cuando llega (trigger onMessageCreated). El
 * informe pasa a leer solo los docs de lead (que ya leía) y nunca toca la
 * subcolección de mensajes.
 *
 * La lógica de `applyMessageToStats` es una réplica EXACTA del bucle que antes
 * vivía en getAdvisorReports, para que los números no cambien.
 */

const HOUR_MS = 3_600_000;
const MSG_STATS_TX_MAX_ATTEMPTS = 3;

/** Bordes superiores (ms) de cada balde de tiempo de respuesta; el último es abierto. */
const BUCKET_UPPER_MS = [
  1 * 60_000,    // < 1 min
  5 * 60_000,    // 1–5 min
  15 * 60_000,   // 5–15 min
  30 * 60_000,   // 15–30 min
  60 * 60_000,   // 30–60 min
  120 * 60_000,  // 1–2 h
  360 * 60_000,  // 2–6 h
  1440 * 60_000, // 6–24 h
  Number.POSITIVE_INFINITY, // > 24 h
];
/** Valor representativo (min) de cada balde, para estimar la mediana. */
const BUCKET_REP_MIN = [1, 3, 10, 22, 45, 90, 240, 720, 2160];

export const STATS_BUCKET_COUNT = BUCKET_UPPER_MS.length;

function bucketIndex(deltaMs: number): number {
  for (let i = 0; i < BUCKET_UPPER_MS.length; i++) {
    if (deltaMs < BUCKET_UPPER_MS[i]) return i;
  }
  return BUCKET_UPPER_MS.length - 1;
}

export function emptyStats(): LeadStats {
  return {
    advisorMsgCount:  0,
    waitingReply:     false,
    pendingInboundAt: null,
    responseCount:    0,
    responseSumMs:    0,
    responseWithin1h: 0,
    responseBuckets:  new Array(STATS_BUCKET_COUNT).fill(0),
    updatedAt:        Timestamp.now(),
  };
}

/** Normaliza un stats leído de Firestore rellenando campos ausentes/corruptos. */
function coerceStats(raw: Partial<LeadStats> | undefined): LeadStats {
  const base = emptyStats();
  if (!raw) return base;
  const buckets = Array.isArray(raw.responseBuckets)
    ? BUCKET_UPPER_MS.map((_, i) => Number(raw.responseBuckets?.[i] ?? 0))
    : base.responseBuckets;
  return {
    advisorMsgCount:  Number(raw.advisorMsgCount  ?? 0),
    waitingReply:     Boolean(raw.waitingReply     ?? false),
    pendingInboundAt: (raw.pendingInboundAt as Timestamp | null | undefined) ?? null,
    responseCount:    Number(raw.responseCount    ?? 0),
    responseSumMs:    Number(raw.responseSumMs    ?? 0),
    responseWithin1h: Number(raw.responseWithin1h ?? 0),
    responseBuckets:  buckets,
    updatedAt:        (raw.updatedAt as Timestamp | undefined) ?? base.updatedAt,
  };
}

type StatsMessage = Pick<Message, 'senderType' | 'direction' | 'createdAt' | 'advisorId'>;

/**
 * ¿Es un mensaje HUMANO del asesor? senderType 'advisor' cubre tanto las
 * respuestas manuales del asesor (llevan `advisorId`) como las PLANTILLAS
 * automáticas (primer contacto, seguimientos, broadcasts) que envía el sistema
 * SIN `advisorId`. Para medir tiempos de respuesta y "atendido por humano" solo
 * cuentan las manuales — si no, una plantilla que dispara en segundos hace ver a
 * cualquier asesor como si respondiera al instante.
 */
function isHumanAdvisorMsg(m: StatsMessage): boolean {
  return m.senderType === 'advisor' && !!(m.advisorId && String(m.advisorId).trim());
}

/**
 * Aplica un mensaje al acumulador `s` (mutándolo). Réplica exacta de la lógica
 * que recorría los mensajes en getAdvisorReports:
 *  - `waitingReply` refleja si el ÚLTIMO mensaje fue del lead.
 *  - `pendingInboundAt` marca el primer inbound sin responder.
 *  - un outbound del asesor con inbound pendiente registra el tiempo de
 *    respuesta; CUALQUIER outbound (asesor/IA/sistema) "consume" el pendiente.
 *
 * Debe llamarse en orden cronológico (el trigger recibe los mensajes según se
 * crean; el backfill los ordena por createdAt ASC).
 */
export function applyMessageToStats(s: LeadStats, m: StatsMessage): void {
  const createdMs = m.createdAt?.toMillis?.() ?? Date.now();

  // El último mensaje procesado define si el lead está esperando respuesta.
  s.waitingReply = m.senderType === 'lead';

  if (m.senderType === 'lead') {
    if (s.pendingInboundAt == null) {
      s.pendingInboundAt = m.createdAt ?? Timestamp.fromMillis(createdMs);
    }
    return;
  }

  if (m.direction === 'outbound') {
    const human = isHumanAdvisorMsg(m);
    if (human) s.advisorMsgCount += 1;   // solo mensajes manuales del asesor (no plantillas/IA)
    if (s.pendingInboundAt != null) {
      if (human) {
        const delta = createdMs - s.pendingInboundAt.toMillis();
        // Guarda contra desorden de eventos: solo cuenta deltas no negativos.
        if (delta >= 0) {
          s.responseCount += 1;
          s.responseSumMs += delta;
          if (delta <= HOUR_MS) s.responseWithin1h += 1;
          s.responseBuckets[bucketIndex(delta)] += 1;
        }
      }
      // Cualquier outbound (humano, IA, plantilla o sistema) cierra el inbound
      // pendiente: solo se cronometra si quien respondió primero fue el humano.
      s.pendingInboundAt = null;
    }
  }
}

/** Calcula los stats de un lead desde su lista completa de mensajes (ASC). Para el backfill. */
export function computeStatsFromMessages(messages: StatsMessage[]): LeadStats {
  const s = emptyStats();
  for (const m of messages) applyMessageToStats(s, m);
  s.updatedAt = Timestamp.now();
  return s;
}

/**
 * Estima la mediana (en minutos) del tiempo de respuesta a partir del histograma
 * de baldes. Es APROXIMADA: devuelve el valor representativo del balde que
 * contiene la posición central (no se guardan las muestras individuales, que
 * eran justo el costo que este cambio elimina).
 */
export function medianMinFromBuckets(buckets: number[]): number {
  const total = buckets.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const mid = Math.floor(total / 2);
  let cum = 0;
  for (let i = 0; i < buckets.length; i++) {
    cum += buckets[i];
    if (cum > mid) return BUCKET_REP_MIN[i] ?? BUCKET_REP_MIN[BUCKET_REP_MIN.length - 1];
  }
  return BUCKET_REP_MIN[BUCKET_REP_MIN.length - 1];
}

/**
 * Actualiza `lead.stats` de forma atómica al crear un mensaje. Transacción para
 * no perder actualizaciones cuando el inbound y su respuesta llegan casi a la vez.
 * No-op si el lead ya no existe. Nunca lanza: es telemetría, no debe tumbar el
 * flujo de mensajería.
 */
export async function recordMessageInLeadStats(
  companyId: string,
  leadId: string,
  message: StatsMessage,
): Promise<void> {
  const leadRef = db
    .collection('companies').doc(companyId)
    .collection('leads').doc(leadId);

  try {
    await db.runTransaction(
      async (tx) => {
        const snap = await tx.get(leadRef);
        if (!snap.exists) return; // lead borrado: nada que mantener
        const stats = coerceStats(snap.get('stats') as Partial<LeadStats> | undefined);
        applyMessageToStats(stats, message);
        stats.updatedAt = Timestamp.now();
        tx.update(leadRef, { stats });
      },
      { maxAttempts: MSG_STATS_TX_MAX_ATTEMPTS },
    );
  } catch (err) {
    logger.warn('[leadStats] No se pudo actualizar lead.stats', {
      companyId,
      leadId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
