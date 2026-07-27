import { Timestamp } from 'firebase-admin/firestore';

export type CallDirection = 'outbound' | 'inbound';
export type CallProvider  = 'dapta' | 'ycloud_whatsapp';

/**
 * Estado de la llamada. 'initiated' lo crea el CRM al disparar la llamada con IA (Dapta);
 * 'ringing'/'connecting'/'in-progress'/'missed'/'rejected' son del ciclo de vida de una
 * llamada de voz WhatsApp (YCloud) en vivo. El resto lo actualiza el webhook al terminar.
 */
export type CallStatus =
  | 'initiated'
  | 'ringing'
  | 'connecting'
  | 'in-progress'
  | 'missed'
  | 'rejected'
  | 'completed'
  | 'no-answer'
  | 'voicemail'
  | 'busy'
  | 'failed'
  | 'transferred';

export interface Call {
  id:            string;
  companyId:     string;
  leadId:        string;
  direction:     CallDirection;
  provider:      CallProvider;
  status:        CallStatus;
  /** Resumen/descripción de la llamada — lo que el asesor ve en la ficha del lead. */
  summary?:      string;
  /** Transcripción completa de la conversación. */
  transcript?:   string;
  /** URL de la grabación (si Dapta la entrega). */
  recordingUrl?: string;
  /** Duración en segundos. */
  durationSec?:  number;
  /** Resultado/etiqueta de negocio (ej: "interesado", "agendó", "no contesta"). */
  outcome?:      string;
  /** Número de negocio/agente desde el que se llamó. */
  agentName?:    string;
  /** ID de la llamada en Dapta, o wacid en YCloud (para correlación e idempotencia). */
  externalId?:   string;
  /** userId del asesor que disparó la llamada desde el CRM (si aplica). */
  triggeredBy?:  string;
  /** Payload crudo del webhook, por si hace falta mapear campos nuevos sin redeploy. */
  raw?:          Record<string, unknown>;
  /** Bitacora de SmartHome ya enviada para esta llamada. */
  smartHomeBitacoraAt?: Timestamp;
  // ── Señalización WebRTC (solo provider = 'ycloud_whatsapp') ────────────────
  /** SDP offer — de quien inicia la llamada. */
  sdpOffer?:     string;
  /** SDP answer — de quien la contesta. */
  sdpAnswer?:    string;
  /** ID numérico del número de WhatsApp en YCloud (requerido por preAccept/accept/reject/terminate). */
  phoneId?:      string;
  /** uid del asesor que reclamó una llamada entrante, evita que dos la contesten a la vez. */
  claimedBy?:    string;
  /** userId del asesor asignado al lead al momento de la llamada (denormalizado para el banner global). */
  assignedTo?:   string;
  /** Nombre/teléfono del lead denormalizados (evita un lookup extra en el banner global). */
  leadName?:     string;
  leadPhone?:    string;
  createdAt:     Timestamp;
  updatedAt?:    Timestamp;
}

export type CreateCallInput = Omit<Call, 'id'>;
