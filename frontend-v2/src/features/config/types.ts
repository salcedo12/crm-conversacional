export type AiTone = 'professional' | 'friendly' | 'formal' | 'casual';

/** Cómo maneja la IA los precios/cotizaciones en el chat. */
export type QuoteMode = 'off' | 'on_request' | 'proactive';

/** 'consultive' = reglas comerciales nuevas (plazos 20/30/40, objeciones, modelo nuevo). */
export type AgentProfile = 'legacy' | 'consultive';

export interface FollowUpStep {
  delayMinutes:  number;
  enabled:       boolean;
  /** Plantilla aprobada por Meta que se envía en este seguimiento. */
  templateName?: string;
}

/**
 * Piloto: a quién responde la IA. null = a todos los leads con la IA activa.
 * Con piloto: los teléfonos de prueba siempre; y, si hay fecha, los leads creados
 * desde esa fecha (opcionalmente solo de ciertos orígenes).
 */
export interface AiRollout {
  testPhones: string[];
  startAt:    number | null; // millis
  sources:    string[];
}

export interface AiConfig {
  enabled:            boolean;
  assistantName:      string;
  businessName:       string;
  basePrompt:         string;
  tone:               AiTone;
  knowledgeBase:      string;
  fallbackMessage:    string;
  maxContextMessages: number;
  transferKeywords:   string[];
  blockedTopics:      string[];
  followUpSequence:   FollowUpStep[];
  quoteMode:          QuoteMode;
  agentProfile?:        AgentProfile;
  model?:               string;
  voiceEnabled?:        boolean;
  sobreMontanasQuotes?: boolean;
  advertisedPrice?:     number;
  quoteBonusBase?:      number;
  quoteBonusMax?:       number;
  /** Respuesta a "¿cuánto valen?" (como los asesores). Campos vacíos no se mencionan. */
  priceReference?:     number;   // precio promedio de referencia
  priceReferenceArea?: number;   // m² a los que corresponde ese promedio
  priceWithBonusFrom?: number;   // lo más bajo que queda con los bonos del mes
  bonusRangeMin?:      number;   // bono mínimo del mes
  separationAmount?:   number;   // valor de separación
  paymentPlanExample?: string;   // ejemplo de plan de pagos (se dice tal cual)
  rollout:            AiRollout | null;
  updatedAt:          number | null; // millis
}

export type AiConfigDraft = Omit<AiConfig, 'updatedAt'>;
