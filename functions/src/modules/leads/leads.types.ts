import { Timestamp } from 'firebase-admin/firestore';
import type { LeadAnalysis } from '../ai/leadAnalysis.types';

export type LeadStatus = 'new' | 'active' | 'qualified' | 'scheduled' | 'lost' | 'closed';
export type LeadSource = 'whatsapp' | 'manual' | 'web' | 'facebook' | 'instagram' | 'meta_ads' | 'advisor_whatsapp';

/** Proveedor/canal por el que entró y debe salir la conversación. */
export type InboxProvider = 'ycloud' | 'twilio';

/** Canal de mensajería del lead. Ausente = 'whatsapp' (leads creados antes de esta migración). */
export type LeadChannel = 'whatsapp' | 'messenger' | 'instagram';

/** Datos del anuncio de origen cuando source = 'meta_ads' (click to WhatsApp). */
export interface LeadSourceMeta {
  adId?:      string;   // referral.source_id
  headline?:  string;   // referral.headline
  sourceUrl?: string;   // referral.source_url
  mediaType?: string;   // referral.media_type
  ctwaClid?:  string;   // referral.ctwa_clid — click id para atribución de conversiones
}

export interface SmartHomeDuplicateMatch {
  prospectId?:    string;
  customerId?:    string;
  ownerId?:       string;
  ownerName?:     string;
  firstName?:     string;
  lastName?:      string;
  mobileNumber?:  string;
  phoneNumber?:   string;
  email?:         string;
  moduleName?:    string;
  projectName?:   string;
  stageName?:     string;
  saleCycleName?: string;
}

export interface Lead {
  id:               string;
  companyId:        string;
  name?:            string;
  /**
   * E.164 para leads de WhatsApp: +573213443603.
   * Sentinel '' para leads de Messenger/Instagram (no tienen teléfono) — ver `channel`/`externalId`.
   */
  phone:            string;
  normalizedPhone:  string;           // lowercase, para queries. '' si no aplica (ver `phone`)
  /** Últimos 10 dígitos del teléfono (número nacional), para deduplicar a la misma
   *  persona aunque cambie el indicativo (+1 del formulario vs +57 de WhatsApp). */
  phoneTail?:       string;
  status:           LeadStatus;
  source:           LeadSource;
  /** Detalle del anuncio de Meta que originó el lead (solo si source = 'meta_ads') */
  sourceMeta?:      LeadSourceMeta;
  /** Número de negocio (E.164) que recibió esta conversación. Ej: +573148209662 */
  inboxId?:         string;
  /** Proveedor por el que entró/sale la conversación (define el número de salida, solo WhatsApp) */
  inboxProvider?:   InboxProvider;
  /** Canal de mensajería. Ausente = 'whatsapp' (compatibilidad con leads existentes). */
  channel?:         LeadChannel;
  /** PSID (Messenger) o IGSID (Instagram) — id del usuario en la plataforma. Solo si channel !== 'whatsapp'. */
  externalId?:      string;
  /** Campo de búsqueda `${channel}:${externalId}` para lookup de un solo campo. Solo si channel !== 'whatsapp'. */
  channelExternalId?: string;
  /**
   * BSUID (Business-Scoped User ID) de WhatsApp: identidad del lead cuando escribió
   * OCULTANDO su número (privacidad de nombre de usuario de WhatsApp). En ese caso
   * `phone`/`normalizedPhone` van vacíos y este es el identificador para buscar y
   * ENVIAR (via campo `recipient` de YCloud). Debe usarse EXACTO (sin recortar). Ej:
   * "CO.2370523146805161". El lookup se hace por `channelExternalId` = `whatsapp:<BSUID>`.
   */
  whatsappUserId?:  string;
  /** Nombre de usuario público de WhatsApp (@usuario), si el lead lo tiene. Solo display. */
  username?:        string;
  assignedTo?:      string;           // userId del asesor asignado
  /** Inicio del tiempo de espera para que el asesor asignado haga primer contacto. */
  advisorAssignedAt?: Timestamp;
  /** Ultima reasignacion automatica por falta de primer contacto. */
  lastAutoReassignedAt?: Timestamp;
  /** Numero de reasignaciones automaticas realizadas antes del primer contacto. */
  advisorReassignmentCount?: number;
  /**
   * true mientras el lead espera el primer contacto humano del asesor asignado.
   * Se estampa en la asignación round-robin y se apaga en cuanto un asesor le
   * escribe. Permite que processFirstContactReassignments consulte SOLO los leads
   * pendientes (query filtrada) en vez de leer toda la colección cada minuto.
   */
  pendingFirstContact?: boolean;
  /**
   * true = asesor FIJADO manualmente por un admin. Bloquea de forma permanente la
   * reasignacion automatica por falta de primer contacto (processFirstContactReassignments
   * lo salta siempre, sin importar si nadie le escribe). Se activa/desactiva desde el
   * drawer del lead con el candado. Independiente de pendingFirstContact.
   */
  assignmentLocked?: boolean;
  aiEnabled:        boolean;          // true = IA responde automáticamente
  /** true = ya se envió el aviso legal de bienvenida (Ley 1581). Se manda una sola vez,
   *  de forma determinista, como primer mensaje a un lead nuevo de WhatsApp directo. */
  legalWelcomeSent?: boolean;
  takeoverBy?:      string;           // userId que tomó control manual
  /** Control de costo IA: nº de respuestas automáticas en la ventana horaria actual. */
  aiHourlyCount?:       number;
  /** Inicio de la ventana horaria del contador anti-loop de la IA. */
  aiHourlyWindowStart?: Timestamp;
  /** Nº de cotizaciones que la IA ha intentado/enviado para este lead. */
  aiQuotationCount?:    number;
  /** Terrenos ya cotizados o reservados por la IA, en formato sector:terreno. */
  aiQuotedTerrenos?:    string[];
  /** Momento en que la IA bloqueó nuevas cotizaciones por alcanzar el límite. */
  aiQuotationLimitReachedAt?: Timestamp;
  /** Última derivación automática a Servicio al Cliente. */
  customerServiceRedirectedAt?: Timestamp;
  /** Última escalada automática por solicitud sensible o posible competencia. */
  sensitiveInquiryEscalatedAt?: Timestamp;
  lastMessageText?: string;
  lastMessageAt?:   Timestamp;
  /** Primer mensaje humano enviado por un asesor. Bloquea la reasignacion automatica por falta de contacto. */
  advisorFirstContactAt?: Timestamp;
  /** Asesor que hizo el primer contacto humano con el lead. */
  advisorFirstContactBy?: string;
  /** Ultimo mensaje humano enviado por un asesor. */
  lastAdvisorMessageAt?:  Timestamp;
  /** Último mensaje ENTRANTE del lead — usado para calcular la ventana de 24h de WhatsApp */
  lastInboundAt?:   Timestamp;
  readBy?:          Record<string, Timestamp>;
  createdAt:        Timestamp;
  updatedAt:        Timestamp;
  tags:             string[];
  listIds?:         string[];
  metadata:         Record<string, string>;
  /** Permiso de llamada de voz WhatsApp otorgado por el lead (requerido para llamar saliente). */
  callPermission?:  LeadCallPermission;
  /** Radiografía IA más reciente del lead (score + análisis de la conversación). */
  aiAnalysis?:      LeadAnalysis;
  /** Contadores de mensajería denormalizados (mantenidos por onMessageCreated). */
  stats?:           LeadStats;
  /** Modo automático de llamadas IA: ya se programó el seguimiento a interesado (evita repetirlo). */
  autoCallFollowupDone?: boolean;
  /** Conversiones ya enviadas a Meta (CAPI) por nombre de evento — idempotencia. */
  capiEvents?:      Record<string, Timestamp>;
  /** Id del cliente/prospecto creado en SmartHome (idempotencia; ausente = no sincronizado). */
  smartHomeCustomerId?: string;
  /** Id real del prospecto en SmartHome, requerido para registrar bitacoras/eventos. */
  smartHomeProspectId?: string;
  /** Codigo de proyecto donde vive el prospecto en SmartHome. */
  smartHomeProjectCode?: string;
  /** Asesor SmartHome asociado al prospecto. */
  smartHomeAdvisorId?: string;
  /** Ultimo intento automatico de sincronizacion con SmartHome. */
  smartHomeSyncAttemptedAt?: Timestamp;
  /** Cuándo se creó en SmartHome. */
  smartHomeSyncedAt?:   Timestamp;
  /** Último error de sincronización con SmartHome (vacío = sin error). */
  smartHomeSyncError?:  string;
  /** Nº de reintentos automáticos del barrido ante errores transitorios de SmartHome. */
  smartHomeSyncRetries?: number;
  /** Coincidencias encontradas en SmartHome cuando se bloquea una creacion por duplicado. */
  smartHomeDuplicateMatches?: SmartHomeDuplicateMatch[];
}

/**
 * Contadores de mensajería denormalizados, mantenidos por el trigger
 * onMessageCreated (ver leadStats.service.ts). Permiten que getAdvisorReports
 * calcule tiempos de respuesta / mensajes del asesor / "esperando" sin leer la
 * subcolección de mensajes. Ausente en leads previos al backfill (el informe
 * cae a recalcular desde mensajes para esos).
 */
export interface LeadStats {
  /** Nº de mensajes salientes enviados por un asesor humano. */
  advisorMsgCount:  number;
  /** true si el último mensaje del hilo es del lead (esperando respuesta). */
  waitingReply:     boolean;
  /** Inicio del inbound sin responder (para medir el tiempo de respuesta). null = ninguno pendiente. */
  pendingInboundAt: Timestamp | null;
  /** Nº de respuestas del asesor cronometradas (muestras del tiempo de respuesta). */
  responseCount:    number;
  /** Suma de tiempos de respuesta (ms) → promedio = responseSumMs / responseCount. */
  responseSumMs:    number;
  /** Nº de respuestas del asesor dentro de 1 hora. */
  responseWithin1h: number;
  /** Histograma de tiempos de respuesta por balde, para estimar la mediana. */
  responseBuckets:  number[];
  updatedAt:        Timestamp;
}

export interface LeadCallPermission {
  granted:          boolean;
  isPermanent?:     boolean;
  expiresAt?:       Timestamp | null;
  grantedAt?:       Timestamp;
  lastRequestedAt?: Timestamp;
}

export type CreateLeadInput = Omit<Lead, 'id'>;
export type UpdateLeadInput = Partial<Omit<Lead, 'id' | 'companyId' | 'createdAt'>>;
