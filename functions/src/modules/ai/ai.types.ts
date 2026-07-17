import { Timestamp } from 'firebase-admin/firestore';

export interface FollowUpStep {
  delayMinutes: number;  // e.g. 20, 240 (4h), 1440 (24h)
  enabled:      boolean;
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
  updatedAt:           Timestamp;
}
