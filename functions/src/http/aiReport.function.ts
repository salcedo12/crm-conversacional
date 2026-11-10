import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from '../lib/admin';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES } from '../lib/authContext';
import { bogotaDay } from '../modules/ai/aiUsage.service';

const Schema = z.object({ companyId: z.string().min(1), days: z.number().int().min(1).max(90).default(7) });

export interface AiReportDay {
  day:          string;
  chats:        number;   // leads distintos que atendió la IA
  respuestas:   number;   // turnos respondidos
  cotizaciones: number;
  traspasos:    number;
  fallos:       number;
  fichas:       Record<string, number>;
  entrada:      number;   // tokens de entrada
  salida:       number;   // tokens de salida
}

/** Tablero de la IA: contadores diarios de companies/{id}/aiUsage (hora de Colombia). */
export const getAiReport = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
  const ctx = requireAuth(request);
  requireRole(ctx, ADMIN_ROLES);
  const parsed = Schema.parse(request.data ?? {});
  assertCompany(ctx, parsed.companyId);

  const from = bogotaDay(new Date(Date.now() - (parsed.days - 1) * 24 * 60 * 60 * 1000));
  const snap = await db.collection(`companies/${parsed.companyId}/aiUsage`)
    .where('day', '>=', from).orderBy('day', 'desc').get();

  const days: AiReportDay[] = snap.docs.map((doc) => {
    const d = doc.data();
    return {
      day:          String(d.day ?? doc.id),
      chats:        Array.isArray(d.leads) ? d.leads.length : 0,
      respuestas:   Number(d.turnos ?? 0),
      cotizaciones: Number(d.cotizaciones ?? 0),
      traspasos:    Number(d.traspasos ?? 0),
      fallos:       Number(d.fallos ?? 0),
      fichas:       (d.fichas ?? {}) as Record<string, number>,
      entrada:      Number(d.entrada ?? 0),
      salida:       Number(d.salida ?? 0),
    };
  });
  // Chats distintos en todo el periodo (un lead que escribe varios días cuenta una vez).
  const uniqueLeads = new Set<string>();
  snap.docs.forEach((doc) => (doc.data().leads ?? []).forEach((id: string) => uniqueLeads.add(id)));
  return { from, days, chatsPeriodo: uniqueLeads.size };
});
