import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../../lib/admin';
import { logger } from '../../utils/logger';
import { appointmentsRepository } from '../appointments/appointments.repository';
import { leadsRepository } from '../leads/leads.repository';
import type { Lead } from '../leads/leads.types';
import { postLeadSmartHomeBitacora } from '../smarthome/smarthomeEvents.service';
import { runAndStoreLeadAnalysis } from './leadAnalysis.service';
import { isTestLead } from './aiRollout';
import { bumpAiDaily } from './aiUsage.service';

/**
 * Ficha Técnica que registra la IA ("Victoria IA") en los momentos clave del chat.
 *
 * Diferencias con la ficha del asesor (reportAppointmentFicha), a propósito:
 *  - NO toca lastFollowUpAt / lastAdvisorMessageAt / aiTakeoverSlaStatus: la ficha
 *    de la IA no cumple el SLA del asesor ni detiene la reasignación.
 *  - Se guarda con authorId 'ai', así los informes la muestran como "IA" y no como
 *    gestión del asesor asignado.
 */
export const AI_AUTHOR_ID = 'ai';
export const AI_AUTHOR_NAME = 'Victoria IA';

export type AiFichaKind =
  | 'envio_informacion'
  | 'cotizacion'
  | 'cita'
  | 'servicio_cliente'
  | 'comprador'
  | 'objecion_presupuesto'
  | 'pidio_asesor'
  | 'desistimiento'
  | 'proveedor';

export interface AiFichaInput {
  kind:        AiFichaKind;
  result:      string;
  nextAction:  string;
  notes?:      string;
  /** Etapa del embudo a usar en lugar de la del tipo de ficha (p. ej. no_interesado_ubicacion). */
  pipelineStage?: string;
  /** Si se repite la clave, la ficha no se vuelve a registrar. */
  dedupeKey?:  string;
}

interface FichaPlan {
  actionType:     string;
  actionTitle:    string;
  pipelineStage?: string;
  status?:        Lead['status'];
  tag?:           string;
  smartHome:      boolean;
}

/** Orden del embudo: la IA solo avanza la etapa, nunca la devuelve. */
const STAGE_ORDER = ['prospecto', 'contactado', 'envio_info', 'cotizacion', 'cita', 'visita_realizada', 'negociacion', 'documentacion', 'firma'];

export function fichaPlan(kind: AiFichaKind, lead: Pick<Lead, 'tags'>): FichaPlan {
  switch (kind) {
    case 'envio_informacion':
      return { actionType: 'envio_informacion', actionTitle: 'Envío de Información', pipelineStage: 'envio_info', status: 'active', smartHome: true };
    case 'cotizacion':
      return { actionType: 'envio_informacion', actionTitle: 'Envío de Información', pipelineStage: 'cotizacion', status: 'qualified', smartHome: true };
    case 'cita':
      // La cita ya se reporta a SmartHome al crearse (appointments.service).
      return { actionType: 'cita_reunion', actionTitle: 'Cita / Videollamada', pipelineStage: 'cita', status: 'scheduled', smartHome: false };
    case 'servicio_cliente':
      return { actionType: 'seguimiento_general', actionTitle: 'Derivado a Servicio al Cliente', tag: 'servicio_cliente', smartHome: true };
    case 'comprador':
      return { actionType: 'seguimiento_general', actionTitle: 'Cliente actual (comprador)', tag: 'comprador', smartHome: true };
    case 'objecion_presupuesto':
      return { actionType: 'seguimiento_general', actionTitle: 'Objeción de presupuesto', tag: 'objecion_presupuesto', smartHome: true };
    case 'pidio_asesor':
      return { actionType: 'seguimiento_general', actionTitle: 'Pidió hablar con un asesor', smartHome: true };
    case 'proveedor':
      return { actionType: 'seguimiento_general', actionTitle: 'No es cliente (proveedor ofreciendo servicios)', pipelineStage: 'no_interesado_otra', status: 'lost', tag: 'proveedor', smartHome: false };
    case 'desistimiento': {
      const budget = (lead.tags ?? []).includes('objecion_presupuesto');
      return {
        actionType: 'seguimiento_general',
        actionTitle: budget ? 'Desistimiento (sin presupuesto)' : 'Desistimiento (no interesado)',
        pipelineStage: budget ? 'no_interesado_dinero' : 'no_interesado',
        status: 'lost',
        smartHome: true,
      };
    }
  }
}

/** Etapa y estado que corresponden, sin retroceder el embudo ni tocar ventas cerradas. */
export function nextStageAndStatus(
  lead: Pick<Lead, 'status'> & { pipelineStage?: string },
  plan: Pick<FichaPlan, 'pipelineStage' | 'status'>
): { pipelineStage?: string; status?: Lead['status'] } {
  if (lead.status === 'closed') return {};
  if (plan.status === 'lost') return { pipelineStage: plan.pipelineStage, status: 'lost' };
  if (!plan.pipelineStage) return {};
  const current = STAGE_ORDER.indexOf(String(lead.pipelineStage ?? ''));
  const next = STAGE_ORDER.indexOf(plan.pipelineStage);
  if (current >= next) return {};
  return { pipelineStage: plan.pipelineStage, status: plan.status };
}

/** Detecta en el mensaje del lead que el precio o su presupuesto es la objeción. */
export function detectsBudgetObjection(text: string): boolean {
  const t = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return /\bno me alcanza\b|\b(muy|demasiado|super) caro\b|\bes (mucha|demasiada) plata\b|\bno tengo (tanto|esa plata|ese dinero|para eso)\b|\b(solo|apenas|a penas) tengo\b|\btengo (apenas |a penas |solo )?\d+ ?(millones|m)\b|\bmi presupuesto (es|son|no)\b|\bfuera de mi presupuesto\b|\bse (me )?sale (de|del) (mi )?presupuesto\b|\bpresupuesto (maximo|limite)\b|\bno me alca(n)?za\b|\bfuera de (mi )?alcance\b|\bno (tengo|cuento con) (el|ese|tanto) (dinero|presupuesto|capital)\b/.test(t);
}

/** Texto de la próxima cita del lead para la ficha ("10 nov, 3:00 p. m."). */
export async function nextAppointmentLabel(companyId: string, leadId: string, timeZone: string): Promise<string> {
  const appts = await appointmentsRepository.findByLead(companyId, leadId).catch(() => []);
  const next = appts
    .filter((a) => a.status === 'scheduled' && a.startTime.toMillis() > Date.now())
    .sort((a, b) => a.startTime.toMillis() - b.startTime.toMillis())[0];
  if (!next) return '';
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(next.startTime.toDate());
}

/**
 * Registra la ficha. Nunca lanza: si algo falla se registra en el log y la
 * conversación sigue. Devuelve true si escribió una ficha nueva.
 */
export async function recordAiFicha(companyId: string, leadId: string, input: AiFichaInput): Promise<boolean> {
  try {
    const leadRef = db.collection('companies').doc(companyId).collection('leads').doc(leadId);
    const snap = await leadRef.get();
    if (!snap.exists) return false;
    const lead = { id: leadId, ...snap.data() } as Lead & { aiFichaKeys?: string[]; bitacoras?: unknown[]; metadata?: Record<string, unknown>; pipelineStage?: string };
    if (input.dedupeKey && (lead.aiFichaKeys ?? []).includes(input.dedupeKey)) return false;

    const plan = fichaPlan(input.kind, lead);
    if (input.pipelineStage) plan.pipelineStage = input.pipelineStage;
    const now = Timestamp.now();
    const text =
      `📋 FICHA TÉCNICA (IA) · ${plan.actionTitle}\n• Resultado: ${input.result}\n• Próximo paso: ${input.nextAction}` +
      (input.notes ? `\n• Observaciones: ${input.notes}` : '');

    await leadRef.collection('notes').add({
      companyId,
      leadId,
      authorId:      AI_AUTHOR_ID,
      authorName:    AI_AUTHOR_NAME,
      text,
      kind:          'note',
      type:          'ficha_tecnica',
      source:        'ai',
      actionType:    plan.actionType,
      result:        input.result,
      nextAction:    input.nextAction,
      notes:         input.notes ?? null,
      pipelineStage: plan.pipelineStage ?? null,
      createdAt:     now,
    });

    const fecha = new Date(Date.now() - 5 * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
    const entry = {
      id_registro: `crm_ia_${Date.now()}`,
      origen:      'CRM IA',
      fecha,
      action:      `${plan.actionTitle}: ${input.result}`,
      description: `${input.notes ? `${input.notes} — ` : ''}Próximo paso: ${input.nextAction}`,
      asesor:      AI_AUTHOR_NAME,
      lastDate:    fecha,
    };
    const existing = [
      ...(Array.isArray(lead.bitacoras) ? lead.bitacoras : []),
      ...(Array.isArray(lead.metadata?.smarthomeBitacoras) ? (lead.metadata?.smarthomeBitacoras as unknown[]) : []),
    ];
    const seen = new Set<string>();
    const merged = [entry, ...existing].filter((b) => {
      const r = b as { action?: string; description?: string; fecha?: string; lastDate?: string };
      const key = `${r.action ?? ''}|${r.description ?? ''}|${String(r.fecha ?? r.lastDate ?? '').slice(0, 16)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 60);

    const move = nextStageAndStatus(lead, plan);
    const update: Record<string, unknown> = {
      bitacoras: merged,
      'metadata.smarthomeBitacoras': merged,
      lastAiFichaAt: now,
      lastAiFichaSummary: `${plan.actionTitle}: ${input.result}`.slice(0, 240),
      updatedAt: now,
      ...(move.pipelineStage ? { pipelineStage: move.pipelineStage } : {}),
      ...(move.status ? { status: move.status } : {}),
      ...(input.dedupeKey ? { aiFichaKeys: FieldValue.arrayUnion(input.dedupeKey) } : {}),
      ...(plan.tag ? { tags: FieldValue.arrayUnion(plan.tag) } : {}),
    };
    await leadRef.update(update);

    if (plan.smartHome && !isTestLead(lead)) {
      const content = `${plan.actionTitle}: ${input.result}. Próximo paso: ${input.nextAction}. (Registrado por ${AI_AUTHOR_NAME})`;
      await postLeadSmartHomeBitacora({ ...lead, companyId }, content).catch((err) => {
        logger.warn('[AiFicha] No se pudo enviar la bitácora a SmartHome', { leadId, error: String(err) });
      });
    }
    await bumpAiDaily(companyId, { [`fichas.${input.kind}`]: 1 });
    logger.info('[AiFicha] Ficha registrada', { companyId, leadId, kind: input.kind, stage: move.pipelineStage, status: move.status });
    return true;
  } catch (err) {
    logger.error('[AiFicha] No se pudo registrar la ficha', { companyId, leadId, kind: input.kind, error: String(err) });
    return false;
  }
}

/** Recalcula el análisis IA del lead (puntaje, temperatura, presupuesto). Nunca lanza. */
export async function refreshLeadAnalysis(companyId: string, leadId: string): Promise<void> {
  try {
    const lead = await leadsRepository.findById(companyId, leadId);
    if (lead) await runAndStoreLeadAnalysis({ ...lead, companyId }, AI_AUTHOR_NAME);
  } catch (err) {
    logger.warn('[AiFicha] No se pudo actualizar el análisis del lead', { leadId, error: String(err) });
  }
}
