import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';

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
    {
      id: 'no_interesado',
      label: 'NO INTERESADO',
      icon: '❌',
      desc: 'Prospecto sin interés, solicitud laboral, proveedor o fuera de presupuesto',
      defaultStageId: 'no_interesado_otra',
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
    no_interesado: [
      'PROVEEDOR OFRECIENDO SERVICIOS',
      'SOLICITUD DE TRABAJO',
      'QUIERE COMUNICARSE CON OTRA ÁREA DIFERENTE A COMERCIAL',
      'SE LE SALE DEL PRESUPUESTO',
      'NO LE INTERESA LA UBICACIÓN',
      'NO SOLICITÓ INFORMACIÓN',
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

export function subscribeFichaTecnicaConfig(
  companyId: string,
  onUpdate: (config: FichaTecnicaConfig) => void,
  onError?: (err: Error) => void
): () => void {
  const docRef = doc(db, 'companies', companyId, 'configs', 'fichaTecnica');
  return onSnapshot(
    docRef,
    (snap) => {
      if (!snap.exists()) {
        onUpdate(DEFAULT_FICHA_CONFIG);
        return;
      }
      const data = snap.data();
      const config: FichaTecnicaConfig = {
        actions: Array.isArray(data?.actions) && data.actions.length > 0 ? data.actions : DEFAULT_FICHA_CONFIG.actions,
        results: data?.results && typeof data.results === 'object' ? data.results : DEFAULT_FICHA_CONFIG.results,
        nextSteps: Array.isArray(data?.nextSteps) && data.nextSteps.length > 0 ? data.nextSteps : DEFAULT_FICHA_CONFIG.nextSteps,
      };
      onUpdate(config);
    },
    (err) => {
      console.warn('[fichaTecnicaConfig.service] Error escuchando cambios en tiempo real:', err);
      onError?.(err);
    }
  );
}

export async function fetchFichaTecnicaConfig(companyId: string): Promise<FichaTecnicaConfig> {
  try {
    const docRef = doc(db, 'companies', companyId, 'configs', 'fichaTecnica');
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      return DEFAULT_FICHA_CONFIG;
    }
    const data = snap.data();
    return {
      actions: Array.isArray(data?.actions) && data.actions.length > 0 ? data.actions : DEFAULT_FICHA_CONFIG.actions,
      results: data?.results && typeof data.results === 'object' ? data.results : DEFAULT_FICHA_CONFIG.results,
      nextSteps: Array.isArray(data?.nextSteps) && data.nextSteps.length > 0 ? data.nextSteps : DEFAULT_FICHA_CONFIG.nextSteps,
    };
  } catch (err) {
    console.warn('[fichaTecnicaConfig.service] Fallback a defaults:', err);
    return DEFAULT_FICHA_CONFIG;
  }
}

export async function saveFichaTecnicaConfig(
  companyId: string,
  config: FichaTecnicaConfig
): Promise<FichaTecnicaConfig> {
  const docRef = doc(db, 'companies', companyId, 'configs', 'fichaTecnica');
  await setDoc(docRef, {
    ...config,
    companyId,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return config;
}
