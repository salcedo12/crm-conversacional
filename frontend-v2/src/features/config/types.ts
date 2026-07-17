export type AiTone = 'professional' | 'friendly' | 'formal' | 'casual';

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
  updatedAt:          number | null; // millis
}

export type AiConfigDraft = Omit<AiConfig, 'updatedAt'>;
