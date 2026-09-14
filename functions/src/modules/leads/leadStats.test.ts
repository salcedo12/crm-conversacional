import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import {
  computeStatsFromMessages,
  medianMinFromBuckets,
  emptyStats,
  STATS_BUCKET_COUNT,
} from './leadStats.service';
import type { Message } from '../messages/messages.types';

type Kind = 'lead' | 'advisor' | 'ai' | 'system';

/** Helper: construye un mensaje mínimo en el minuto `min` desde t0. */
function msg(kind: Kind, min: number): Pick<Message, 'senderType' | 'direction' | 'createdAt'> {
  return {
    senderType: kind,
    direction: kind === 'lead' ? 'inbound' : 'outbound',
    createdAt: Timestamp.fromMillis(min * 60_000),
  };
}

describe('computeStatsFromMessages', () => {
  it('cuenta un tiempo de respuesta del asesor a un inbound', () => {
    const s = computeStatsFromMessages([msg('lead', 0), msg('advisor', 10)]);
    expect(s.responseCount).toBe(1);
    expect(s.responseSumMs).toBe(10 * 60_000);
    expect(s.responseWithin1h).toBe(1);      // 10 min ≤ 1h
    expect(s.advisorMsgCount).toBe(1);
    expect(s.waitingReply).toBe(false);       // último mensaje es del asesor
    expect(s.pendingInboundAt).toBeNull();
  });

  it('un outbound de IA consume el inbound pendiente SIN registrar tiempo de respuesta', () => {
    const s = computeStatsFromMessages([msg('lead', 0), msg('ai', 5)]);
    expect(s.responseCount).toBe(0);          // la IA no cuenta como respuesta del asesor
    expect(s.advisorMsgCount).toBe(0);
    expect(s.pendingInboundAt).toBeNull();    // pero sí cerró el pendiente
    expect(s.waitingReply).toBe(false);
  });

  it('solo el PRIMER inbound sin responder marca el pendiente', () => {
    // lead(0), lead(2), advisor(12) → respuesta medida contra el inbound de t=0
    const s = computeStatsFromMessages([msg('lead', 0), msg('lead', 2), msg('advisor', 12)]);
    expect(s.responseCount).toBe(1);
    expect(s.responseSumMs).toBe(12 * 60_000);
  });

  it('marca waitingReply cuando el último mensaje es del lead', () => {
    const s = computeStatsFromMessages([msg('advisor', 0), msg('lead', 3)]);
    expect(s.waitingReply).toBe(true);
    expect(s.pendingInboundAt).not.toBeNull();
  });

  it('clasifica respuestas > 1h fuera de within1h', () => {
    const s = computeStatsFromMessages([msg('lead', 0), msg('advisor', 90)]); // 1.5h
    expect(s.responseCount).toBe(1);
    expect(s.responseWithin1h).toBe(0);
  });

  it('acumula varios ciclos inbound→respuesta', () => {
    const s = computeStatsFromMessages([
      msg('lead', 0),  msg('advisor', 5),   // 5 min
      msg('lead', 20), msg('advisor', 26),  // 6 min
      msg('lead', 40), msg('ai', 41),       // IA: no cuenta
    ]);
    expect(s.advisorMsgCount).toBe(2);
    expect(s.responseCount).toBe(2);
    expect(s.responseSumMs).toBe((5 + 6) * 60_000);
    expect(s.responseWithin1h).toBe(2);
    expect(s.responseBuckets.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('lead sin mensajes del asesor queda handled=0 y waiting', () => {
    const s = computeStatsFromMessages([msg('lead', 0)]);
    expect(s.advisorMsgCount).toBe(0);
    expect(s.waitingReply).toBe(true);
    expect(s.responseCount).toBe(0);
  });
});

describe('medianMinFromBuckets', () => {
  it('devuelve 0 sin muestras', () => {
    expect(medianMinFromBuckets(new Array(STATS_BUCKET_COUNT).fill(0))).toBe(0);
  });

  it('cae en el balde que contiene la posición central', () => {
    // 3 muestras en el balde [1,5)min (rep 3) y 1 en [5,15) → mediana en el 1er balde
    const s = emptyStats();
    s.responseBuckets = [0, 3, 1, 0, 0, 0, 0, 0, 0];
    expect(medianMinFromBuckets(s.responseBuckets)).toBe(3);
  });
});
