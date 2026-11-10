import { Timestamp } from 'firebase-admin/firestore';

export interface FollowUpStep {
  delayMinutes:  number;  // e.g. 20, 240 (4h), 1440 (24h), 4320 (3d), 11520 (8d)
  enabled:       boolean;
  templateName?: string;  // Nombre de la plantilla de WhatsApp aprobada por Meta
}

export interface AiConfig {
  id:                  'default';
  companyId:           string;
  enabled:             boolean;
  assistantName:       string;
  businessName:        string;          // Nombre del negocio (citas, recordatorios)
  basePrompt:          string;          // Prompt principal del asistente
  tone:                'professional' | 'friendly' | 'formal' | 'casual';
  knowledgeBase:       string;          // Información adicional de la empresa
  fallbackMessage:     string;          // Mensaje si OpenAI falla
  maxContextMessages:  number;          // Máximo de mensajes a enviar como contexto
  transferKeywords:    string[];        // Palabras que activan transferencia a humano
  blockedTopics:       string[];        // Temas que la IA debe rechazar
  followUpSequence:    FollowUpStep[];  // Secuencia de seguimientos automáticos (máx 5)
  /**
   * Cotización de precios en el chat:
   *  - 'off'        → no da precios exactos (solo rangos, empuja a la llamada).
   *  - 'on_request' → cotiza solo cuando el cliente pregunta por el precio.
   *  - 'proactive'  → ofrece la cotización apenas el cliente elige un terreno.
   */
  quoteMode:           'off' | 'on_request' | 'proactive';
  /** 'consultive' activa las reglas comerciales, plazos 20/30/40 y el modelo nuevo. */
  agentProfile?:       'legacy' | 'consultive';
  /** Modelo de OpenAI. El perfil consultivo usa gpt-5.6-luna si no se indica. */
  model?:              string;
  maxCompletionTokens?: number;
  /** Nota de voz de bienvenida y respuesta en audio cuando el lead envía audio. */
  voiceEnabled?:       boolean;
  /** Cotizar aldeas de Sobre Montañas (requiere la página de cotización corregida). */
  sobreMontanasQuotes?: boolean;
  /** Precio "desde" (de contado) que la IA menciona ante preguntas generales de precio. */
  advertisedPrice?:    number;
  /** Bono que trae toda cotización (COP). Si falta, se usa COTIZADOR_BONO_BASE. */
  quoteBonusBase?:     number;
  /** Tope del bono que el cliente dice haber ganado en el juego (COP). */
  quoteBonusMax?:      number;
  /** Respuesta a "¿cuánto valen?" (como los asesores). Campos vacíos no se mencionan. */
  priceReference?:     number;   // precio promedio de referencia
  priceReferenceArea?: number;   // m² a los que corresponde ese promedio
  priceWithBonusFrom?: number;   // lo más bajo que queda con los bonos del mes
  bonusRangeMin?:      number;   // bono mínimo del mes
  separationAmount?:   number;   // valor de separación
  paymentPlanExample?: string;   // ejemplo de plan de pagos (se dice tal cual)
  /** Piloto: si existe, la IA solo atiende a estos leads (ver isLeadInAiRollout). */
  rollout?: {
    testPhones?: string[];
    startAt?:    Timestamp;
    sources?:    string[];
  };
  updatedAt:           Timestamp;
}
