import { db } from '../../lib/admin';
import { VICTORIA_BASE_PROMPT } from './defaultPrompt';
import type { AiConfig } from './ai.types';

const DEFAULT_AI_CONFIG: Omit<AiConfig, 'updatedAt' | 'companyId'> = {
  id:                 'default',
  // Apagada si la empresa no tiene configuración: nunca responder sin que alguien la encienda.
  enabled:            false,
  assistantName:      'Victoria Sarmiento',
  businessName:       'Grupo Constructor Meraki',
  basePrompt:         VICTORIA_BASE_PROMPT,
  tone:               'professional',
  knowledgeBase:      '',
  fallbackMessage:    'En este momento no puedo procesar tu mensaje. Un asesor se comunicará contigo muy pronto. 🙏',
  maxContextMessages: 20,
  transferKeywords:   ['hablar con un asesor', 'hablar con asesor', 'quiero un asesor', 'necesito un asesor', 'hablar con un humano', 'hablar con una persona', 'persona real', 'quiero hablar con alguien', 'con un agente'],
  blockedTopics:      [],
  followUpSequence:   [
    { delayMinutes: 1440,  enabled: true, templateName: 'seguimiento_inicial_prospecto' },
    { delayMinutes: 4320,  enabled: true, templateName: 'opciones_proyectos_meraki' },
    { delayMinutes: 11520, enabled: true, templateName: 'reactivacion_interes_meraki' },
  ],
  quoteMode:          'off',
};

/**
 * Carga la configuración de IA desde Firestore.
 * Ruta: companies/{companyId}/aiConfigs/default
 * Si no existe, devuelve el config por defecto (con el prompt de Victoria).
 */
export async function getAiConfig(companyId: string): Promise<AiConfig> {
  const snap = await db
    .collection('companies').doc(companyId)
    .collection('aiConfigs').doc('default')
    .get();

  if (snap.exists) {
    // Merge con defaults para que campos nuevos que aún no existen en Firestore
    // (e.g. followUpSequence) tengan valor en lugar de undefined.
    return {
      ...DEFAULT_AI_CONFIG,
      companyId,
      id: 'default',
      ...snap.data(),
    } as AiConfig;
  }

  // Fallback: config hardcodeado hasta que el admin configure via UI
  return {
    ...DEFAULT_AI_CONFIG,
    companyId,
  } as AiConfig;
}
