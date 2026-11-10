import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../lib/admin';
import { requireAuth, requireRole, assertCompany, ADMIN_ROLES } from '../lib/authContext';

export interface FichaActionTypeOption {
  id: string;
  label: string;
  icon: string;
  desc?: string;
  defaultStageId?: string;
  active: boolean;
}

export interface FichaNextStepOption {
  id: string;
  label: string;
  icon: string;
  requiresSchedule: boolean;
  isDesistimiento?: boolean;
  isReferralProgram?: boolean;
  defaultStageId?: string;
  active: boolean;
}

export interface FichaTecnicaConfig {
  actions: FichaActionTypeOption[];
  results: Record<string, string[]>;
  nextSteps: FichaNextStepOption[];
}

export const DEFAULT_FICHA_CONFIG: FichaTecnicaConfig = {
  actions: [
    {
      id: 'envio_informacion',
      label: 'Envío de Información',
      icon: '📩',
      desc: 'Brochure, cotización o planos por WhatsApp/Email',
      defaultStageId: 'envio_info',
      active: true,
    },
    {
      id: 'llamada',
      label: 'Llamada Telefónica',
      icon: '📞',
      desc: 'Contacto telefónico directo con el cliente',
      defaultStageId: '',
      active: true,
    },
    {
      id: 'cita_reunion',
      label: 'Cita / Videollamada',
      icon: '🎥',
      desc: 'Reunión virtual por Google Meet o WhatsApp',
      defaultStageId: 'cita',
      active: true,
    },
    {
      id: 'visita_terreno',
      label: 'Visita Terreno / Sala',
      icon: '🏡',
      desc: 'Visita presencial a sala de ventas o proyecto',
      defaultStageId: 'visita_realizada',
      active: true,
    },
    {
      id: 'seguimiento_general',
      label: 'Seguimiento General',
      icon: '💬',
      desc: 'Chat de WhatsApp o recontacto comercial',
      defaultStageId: '',
      active: true,
    },
  ],
  results: {
    envio_informacion: [
      'Se envió Brochure y Ficha',
      'Se enviaron Planos y Disponibilidad',
      'Se envió Cotización Formal',
      'Se envió Video del Proyecto',
    ],
    llamada: [
      'Contestó y conversamos',
      'No contestó',
      'Ocupado / Llamar luego',
      'Buzón de mensajes / Equivocado',
    ],
    cita_reunion: [
      'Asistió a la videollamada',
      'No asistió (No-Show)',
      'Reprogramó reunión',
    ],
    visita_terreno: [
      'Asistió a sala de ventas / terreno',
      'No asistió (No-Show)',
      'Reprogramó visita',
    ],
    seguimiento_general: [
      'Cliente muy interesado (Caliente)',
      'Esperando prima o desembolso',
      'Revisando con familia / cónyuge',
      'Comparando con otros proyectos',
    ],
  },
  nextSteps: [
    {
      id: 'llamada_seguimiento',
      label: 'Próxima Llamada de Seguimiento',
      icon: '📞',
      requiresSchedule: true,
      defaultStageId: '',
      active: true,
    },
    {
      id: 'visita_terreno',
      label: 'Visita a Terreno (Sala de Ventas)',
      icon: '🏠',
      requiresSchedule: true,
      defaultStageId: 'visita_realizada',
      active: true,
    },
    {
      id: 'enviar_cotizacion',
      label: 'Enviar Cotización Detallada',
      icon: '📄',
      requiresSchedule: true,
      defaultStageId: 'cotizacion',
      active: true,
    },
    {
      id: 'plan_referidos',
      label: 'Derivación a Plan de Referidos',
      icon: '🤝',
      requiresSchedule: false,
      isReferralProgram: true,
      defaultStageId: '',
      active: true,
    },
    {
      id: 'cierre_pago',
      label: 'Cierre de Venta / Separación de Lote',
      icon: '💳',
      requiresSchedule: true,
      defaultStageId: 'negociacion',
      active: true,
    },
    {
      id: 'desistimiento',
      label: 'Desistimiento Definitivo (Sin presupuesto)',
      icon: '❌',
      requiresSchedule: false,
      isDesistimiento: true,
      defaultStageId: 'no_interesado_dinero',
      active: true,
    },
    {
      id: 'sin_proximo_contacto',
      label: 'Sin Próximo Contacto (Cierre de Gestión)',
      icon: '⏹️',
      requiresSchedule: false,
      isDesistimiento: true,
      defaultStageId: '',
      active: true,
    },
  ],
};

const configDocRef = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('configs').doc('fichaTecnica');

export const getFichaTecnicaConfig = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(request.data);
    assertCompany(ctx, companyId);

    const snap = await configDocRef(companyId).get();
    if (!snap.exists) {
      return { config: DEFAULT_FICHA_CONFIG, isDefault: true };
    }

    const data = snap.data();
    const config: FichaTecnicaConfig = {
      actions: Array.isArray(data?.actions) && data.actions.length > 0 ? data.actions : DEFAULT_FICHA_CONFIG.actions,
      results: data?.results && typeof data.results === 'object' ? data.results : DEFAULT_FICHA_CONFIG.results,
      nextSteps: Array.isArray(data?.nextSteps) && data.nextSteps.length > 0 ? data.nextSteps : DEFAULT_FICHA_CONFIG.nextSteps,
    };

    return { config, isDefault: false };
  }
);

const ActionItemSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  icon: z.string().default('📋'),
  desc: z.string().optional().default(''),
  defaultStageId: z.string().optional().default(''),
  active: z.boolean().default(true),
});

const NextStepItemSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  icon: z.string().default('🎯'),
  requiresSchedule: z.boolean().default(true),
  isDesistimiento: z.boolean().optional().default(false),
  isReferralProgram: z.boolean().optional().default(false),
  defaultStageId: z.string().optional().default(''),
  active: z.boolean().default(true),
});

export const saveFichaTecnicaConfig = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);

    const schema = z.object({
      companyId: z.string().min(1),
      config: z.object({
        actions: z.array(ActionItemSchema).min(1),
        results: z.record(z.string(), z.array(z.string().trim().min(1))),
        nextSteps: z.array(NextStepItemSchema).min(1),
      }),
    });

    const parsed = schema.safeParse(request.data);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new HttpsError('invalid-argument', `Configuración inválida de Ficha Técnica: ${issues}`);
    }

    const { companyId, config } = parsed.data;
    assertCompany(ctx, companyId);

    await configDocRef(companyId).set(
      {
        companyId,
        ...config,
        updatedBy: ctx.uid,
        updatedAt: Timestamp.now(),
      },
      { merge: true }
    );

    return { ok: true, config };
  }
);
