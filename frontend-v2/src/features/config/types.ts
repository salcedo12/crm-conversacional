export type AiTone = 'professional' | 'friendly' | 'formal' | 'casual';

/** Cómo maneja la IA los precios/cotizaciones en el chat. */
export type QuoteMode = 'off' | 'on_request' | 'proactive';

export interface FollowUpStep {
  delayMinutes: number;
  enabled:      boolean;
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
  updatedAt:          number | null; // millis
}

export type AiConfigDraft = Omit<AiConfig, 'updatedAt'>;
