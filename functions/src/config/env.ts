function firebaseConfigStorageBucket(): string | undefined {
  try {
    const raw = process.env.FIREBASE_CONFIG;
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { storageBucket?: string };
    return nonEmpty(parsed.storageBucket);
  } catch {
    return undefined;
  }
}

const PRODUCTION_APP_BASE_URL = 'https://crm.grupoconstructormeraki.com.co';

function nonEmpty(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeAppBaseUrl(value?: string): string {
  const raw = value?.trim();
  if (!raw) return PRODUCTION_APP_BASE_URL;

  try {
    const url = new URL(raw);
    const isLocalHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const isHttp = url.protocol === 'http:' || url.protocol === 'https:';

    if (!isHttp || isLocalHost) return PRODUCTION_APP_BASE_URL;

    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/+$/, '');
  } catch {
    return PRODUCTION_APP_BASE_URL;
  }
}

/**
 * Acceso centralizado a variables de entorno.
 * Todas las vars se leen en runtime (no en module load) para
 * evitar timeouts de despliegue en Firebase Functions Gen2.
 */
export const env = {

  // ── ycloud BSP ────────────────────────────────────────────────────────────
  ycloudApiKey:    () => process.env.YCLOUD_API_KEY    ?? '',
  ycloudFromNumber:() => process.env.YCLOUD_FROM_NUMBER ?? '',
  /**
   * Secreto compartido para autenticar el webhook entrante de ycloud.
   * Si está definido, el webhook exige ?secret=... o header X-Webhook-Secret coincidente.
   * Se configura en la URL del webhook dentro del panel de ycloud.
   */
  ycloudWebhookSecret: () => process.env.YCLOUD_WEBHOOK_SECRET ?? '',
  /** ID de la cuenta de WhatsApp Business en ycloud (para crear/listar plantillas) */
  ycloudWabaId:    () => process.env.YCLOUD_WABA_ID    ?? '',
  /** true = usar ycloud como canal de envío/recepción */
  useYcloud:       () => !!process.env.YCLOUD_API_KEY,
  /** ID numérico del número de WhatsApp en ycloud habilitado para llamadas de voz (Calling API) */
  ycloudCallingPhoneId: () => process.env.YCLOUD_CALLING_PHONE_ID ?? '',
  /** true = la llamada de voz por WhatsApp está configurada (hay phoneId de calling) */
  ycloudCallingEnabled: () => !!process.env.YCLOUD_CALLING_PHONE_ID,
  /**
   * Número E.164 desde el que se hacen las llamadas salientes y se piden permisos.
   * Útil para probar con un número aparte (ej. una SIM nueva, sin coexistencia)
   * sin mover la mensajería normal, que sigue en YCLOUD_FROM_NUMBER. Si no se
   * define, cae al número principal.
   */
  ycloudCallingFromNumber: () => process.env.YCLOUD_CALLING_FROM_NUMBER || process.env.YCLOUD_FROM_NUMBER || '',

  // WhatsApp de asesor (modo espejo por QR)
  advisorWhatsappBridgeBaseUrl: () => process.env.ADVISOR_WHATSAPP_BRIDGE_BASE_URL ?? '',
  advisorWhatsappBridgeApiKey:  () => process.env.ADVISOR_WHATSAPP_BRIDGE_API_KEY ?? '',
  advisorWhatsappWebhookSecret: () => process.env.ADVISOR_WHATSAPP_WEBHOOK_SECRET ?? '',
  advisorWhatsappBridgeConfigured: () =>
    !!process.env.ADVISOR_WHATSAPP_BRIDGE_BASE_URL && !!process.env.ADVISOR_WHATSAPP_BRIDGE_API_KEY,

  // ── Google OAuth (Calendar + Meet, por asesor) ─────────────────────────────
  googleClientId:     () => process.env.GOOGLE_CLIENT_ID     ?? '',
  googleClientSecret: () => process.env.GOOGLE_CLIENT_SECRET ?? '',
  /** URL pública de la function googleOAuthCallback (debe coincidir con la registrada en Google Cloud) */
  googleOAuthRedirect:() => process.env.GOOGLE_OAUTH_REDIRECT ?? '',
  /** URL del frontend a la que se vuelve tras conectar/desconectar */
  appBaseUrl:         () => normalizeAppBaseUrl(process.env.APP_BASE_URL),
  // ── Alertas de error interpretadas por IA (webhook desde Google Cloud) ─────
  /** Secreto que debe traer la URL del webhook de alertas (?secret=...) para aceptarlo. */
  errorAlertWebhookSecret: () => process.env.ERROR_ALERT_WEBHOOK_SECRET ?? '',
  /** Número WhatsApp (E.164) que recibe las alertas de error interpretadas por IA. */
  errorAlertPhone:         () => process.env.ERROR_ALERT_PHONE ?? '',
  /** (Opcional) Plantilla aprobada para enviar la alerta fuera de la ventana de 24h. */
  errorAlertTemplate:      () => process.env.ERROR_ALERT_TEMPLATE ?? '',

  /**
   * (Opcional, PENDIENTE de crear la plantilla) Nombre de la plantilla de WhatsApp
   * aprobada para saludar a un lead que llegó por una pauta de FORMULARIO de Meta
   * (Lead Ads). Como el lead no escribió primero, la única forma de abrir la
   * conversación es una plantilla. Con 1 variable = nombre ({{1}}). Si no se define,
   * el lead se crea igual (con sus datos) y el asesor lo contacta a mano.
   */
  metaLeadWelcomeTemplate: () => process.env.META_LEAD_WELCOME_TEMPLATE ?? '',

  // ── Formulario de la página web (leadWebhook) ──────────────────────────────
  /**
   * Secreto compartido que debe enviar la página web (header `X-Lead-Key`) para
   * poder crear un lead por el endpoint público `leadWebhook`. Si está vacío, el
   * endpoint queda deshabilitado (rechaza todo). Evita que cualquiera cree leads
   * o dispare envíos de WhatsApp (que cuestan dinero) desde fuera.
   */
  leadWebhookSecret:   () => process.env.LEAD_WEBHOOK_SECRET ?? '',
  /**
   * Empresa a la que entran los leads del formulario web. Por defecto la empresa
   * global (DEFAULT_COMPANY_ID). Para Meraki debe ser `grupo_meraki_real`.
   */
  leadWebhookCompanyId: () => process.env.LEAD_WEBHOOK_COMPANY_ID || process.env.DEFAULT_COMPANY_ID || 'empresa_demo',
  /**
   * Orígenes permitidos (CORS) del formulario web, separados por coma. Si está
   * vacío se refleja cualquier origen (el secreto sigue siendo la barrera real).
   */
  leadWebhookOrigins:  () => (process.env.LEAD_WEBHOOK_ORIGINS ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean),
  /**
   * Plantilla de bienvenida para leads del formulario web. Si no se define, cae a
   * META_LEAD_WELCOME_TEMPLATE. Si ninguna existe, el lead entra igual sin envío.
   */
  leadWebWelcomeTemplate: () => process.env.LEAD_WEB_WELCOME_TEMPLATE || process.env.META_LEAD_WELCOME_TEMPLATE || '',

  /**
   * URL del índice de planos de disponibilidad (proyecto tour-meraki /
   * disponibilidad-e8a81). La IA lo consulta para enviar sola el PDF del plano del
   * club/etapa que le interesa al lead. Es el mismo índice que usa la Bandeja.
   */
  planosIndexUrl:     () => process.env.PLANOS_INDEX_URL
    ?? 'https://us-central1-disponibilidad-e8a81.cloudfunctions.net/planosIndex',

  /**
   * Endpoint que genera BAJO DEMANDA la imagen de una cotización (tour-meraki /
   * disponibilidad-e8a81). La IA lo llama para enviar la cotización de un terreno.
   */
  cotizadorUrl:       () => process.env.COTIZADOR_URL
    ?? 'https://us-central1-disponibilidad-e8a81.cloudfunctions.net/cotizacionNow',
  /** Bono/descuento base (COP) que la IA aplica en cada cotización. Default $30.000.000. */
  cotizadorBonoBase:  () => Number(process.env.COTIZADOR_BONO_BASE ?? '30000000') || 0,
  /** Tope del bono GANADO que la IA acepta del cliente (evita montos absurdos). Default $100M. */
  cotizadorBonoMax:   () => Number(process.env.COTIZADOR_BONO_MAX ?? '100000000') || 100000000,
  /**
   * Tope anti-loop/costo: máximo de respuestas automáticas de la IA a un mismo lead
   * por hora. Si se supera, se pausa la IA del lead. Default 60 (clientes muy activos).
   */
  aiHourlyCap:        () => Number(process.env.AI_HOURLY_CAP ?? '60') || 60,
  /** URL del juego de bonos (puertabono) que la IA ofrece para ganar un bono adicional. */
  puertabonoUrl:      () => process.env.PUERTABONO_URL
    ?? 'https://puertabono.grupoconstructormeraki.com.co/',

  /** Zona horaria para los eventos de calendario */
  calendarTimeZone:   () => process.env.CALENDAR_TIMEZONE ?? 'America/Bogota',
  googleConfigured:   () => !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
  /**
   * Nombre de la plantilla de WhatsApp aprobada para confirmar una cita cuando la
   * ventana de 24h está cerrada (p. ej. citas agendadas en una llamada IA). Debe
   * existir y estar aprobada en la colección de plantillas de la empresa, con
   * variables nombradas {{nombre}}, {{fecha}} y {{hora}}. Si no se define, fuera
   * de la ventana no se envía confirmación (solo se registra la advertencia).
   */
  appointmentConfirmationTemplate: () => process.env.APPOINTMENT_CONFIRMATION_TEMPLATE ?? '',

  // ── Dapta (llamadas con IA) ────────────────────────────────────────────────
  /** URL del trigger en Dapta (Flow Studio / API) que inicia una llamada saliente. */
  daptaCallTriggerUrl: () => process.env.DAPTA_CALL_TRIGGER_URL ?? '',
  /** API key / token Bearer para autenticar el POST a Dapta (opcional según el trigger). */
  daptaApiKey:         () => process.env.DAPTA_API_KEY ?? '',
  /**
   * Secreto compartido para validar el webhook entrante de Dapta.
   * Si está definido, el webhook exige ?secret=... o header X-Dapta-Secret coincidente.
   */
  daptaWebhookSecret:  () => process.env.DAPTA_WEBHOOK_SECRET ?? '',
  /** true = la integración de llamadas con Dapta está habilitada (hay URL de trigger). */
  daptaConfigured:     () => !!process.env.DAPTA_CALL_TRIGGER_URL,

  // ── Meta (Messenger / Instagram Direct) ────────────────────────────────────
  /** App Secret de la App de Meta — usado para verificar la firma X-Hub-Signature-256 del webhook */
  metaAppSecret:       () => process.env.META_APP_SECRET ?? '',
  /** Page Access Token de larga duración (Messenger + Instagram usan el mismo, vía la Página) */
  metaPageAccessToken: () => process.env.META_PAGE_ACCESS_TOKEN ?? '',
  /** Verify Token elegido al configurar el webhook en Meta for Developers */
  metaVerifyToken:     () => process.env.META_VERIFY_TOKEN ?? '',
  /** ID de la Página de Facebook conectada */
  metaPageId:          () => process.env.META_PAGE_ID ?? '',
  /** ID de la cuenta de Instagram Business vinculada a la Página */
  metaIgBusinessId:    () => process.env.META_IG_BUSINESS_ID ?? '',
  /** true = Messenger/Instagram Direct están configurados (hay Page Access Token) */
  metaConfigured:      () => !!process.env.META_PAGE_ACCESS_TOKEN,

  // ── Meta Marketing API (gasto de anuncios / ROI) ───────────────────────────
  /** Token de acceso con permiso `ads_read` (System User o de larga duración). */
  metaAdsAccessToken:  () => process.env.META_ADS_ACCESS_TOKEN ?? '',
  /** ID de la cuenta publicitaria (con o sin prefijo `act_`). Ej: act_123456789 */
  metaAdAccountId:     () => (process.env.META_AD_ACCOUNT_ID ?? '').replace(/^act_/, ''),
  /** Versión del Graph API a usar para insights. */
  metaGraphVersion:    () => process.env.META_GRAPH_VERSION ?? 'v21.0',
  /** true = se puede traer el gasto de anuncios (hay token de ads + cuenta). */
  metaAdsConfigured:   () => !!process.env.META_ADS_ACCESS_TOKEN && !!process.env.META_AD_ACCOUNT_ID,

  // ── Meta Conversions API (CAPI) — devolver cierres a Meta (CTWA) ───────────
  /** Dataset/Pixel id asociado a la WABA para eventos de conversión de CTWA. */
  metaCapiDatasetId:   () => process.env.META_CAPI_DATASET_ID ?? '',
  /** Token para enviar eventos CAPI (cae al token de ads si no se define uno propio). */
  metaCapiAccessToken: () => process.env.META_CAPI_ACCESS_TOKEN || process.env.META_ADS_ACCESS_TOKEN || '',
  /** Código de prueba opcional (Events Manager → Probar eventos) para depurar sin afectar métricas. */
  metaCapiTestCode:    () => process.env.META_CAPI_TEST_CODE ?? '',
  /** Moneda para el valor de las conversiones (venta). */
  metaCapiCurrency:    () => process.env.META_CAPI_CURRENCY ?? 'COP',
  /** true = se pueden enviar conversiones a Meta (hay dataset + token). */
  metaCapiConfigured:  () => !!process.env.META_CAPI_DATASET_ID
    && (!!process.env.META_CAPI_ACCESS_TOKEN || !!process.env.META_ADS_ACCESS_TOKEN),

  // ── SmartHome (asinpro) — crear leads/clientes en el CRM inmobiliario ──────
  /** Base de la API de SmartHome. */
  smartHomeApiBase:   () => process.env.SMARTHOME_API_BASE ?? 'https://api.smart-home.com.co',
  /** Código de compañía en SmartHome (Grupo Constructor Meraki). */
  smartHomeCompany:   () => process.env.SMARTHOME_COMPANY_CODE ?? 'ac00771c',
  /** Código de proyecto destino (Laguna Mar). Todos los leads del CRM caen aquí. */
  smartHomeProject:   () => process.env.SMARTHOME_PROJECT_CODE ?? '48c9266a',
  /** moduleId de la unidad destino (cupo1). */
  smartHomeModuleId:  () => process.env.SMARTHOME_MODULE_ID ?? 'b99d0adc-86f5-41a5-9991-3a1b70cdcee3',
  /** locationSourceId de la fuente "WHATSAPP IA". */
  smartHomeSourceId:  () => process.env.SMARTHOME_LOCATION_SOURCE_ID ?? '867605f8-7b33-4953-936f-17ddb6f6642a',
  /** Valor del campo "Atendido En" en SmartHome. */
  smartHomeAttendedIn: () => process.env.SMARTHOME_ATTENDED_IN ?? 'WhatsApp',
  /** true = el trigger crea automáticamente cada lead nuevo en SmartHome. Empieza APAGADO. */
  smartHomeBiBase: () => process.env.SMARTHOME_BI_BASE ?? 'https://manage.smart-home.com.co',
  smartHomeBiUserId: () => process.env.SMARTHOME_BI_USER_ID ?? 'e4995136-7a0a-433c-8df6-b612a3e07c38',
  smartHomeSyncEnabled: () => process.env.SMARTHOME_SYNC_ENABLED === 'true',

  /**
   * Base del redireccionador de evidencia fotográfica (función `ev`). La bitácora
   * de SmartHome lleva `${evidenceLinkBase}/${code}` en vez de la URL larga de
   * Firebase Storage, para que el enlace sea corto y fácil de revisar. Se puede
   * apuntar a un dominio corto propio con EVIDENCE_LINK_BASE si más adelante se
   * configura uno.
   */
  evidenceLinkBase: () => nonEmpty(process.env.EVIDENCE_LINK_BASE)
    ?? 'https://crm.grupoconstructormeraki.com.co/e',

  smtpHost:       () => process.env.SMTP_HOST ?? '',
  smtpPort:       () => Number(process.env.SMTP_PORT ?? '465'),
  smtpUser:       () => process.env.SMTP_USER ?? '',
  smtpPass:       () => process.env.SMTP_PASS ?? '',
  smtpSecure:     () => process.env.SMTP_SECURE !== 'false',
  mailFrom:       () => process.env.MAIL_FROM ?? 'Meraki CRM <alertas@grupoconstructormeraki.com.co>',
  mailConfigured: () => !!process.env.SMTP_HOST && !!process.env.SMTP_USER && !!process.env.SMTP_PASS,

  // ── Comunes ───────────────────────────────────────────────────────────────
  openaiApiKey:      () => process.env.OPENAI_API_KEY      ?? '',
  /** DSN de Sentry para monitoreo de errores. Vacío = desactivado (no-op). */
  sentryDsn:         () => process.env.SENTRY_DSN ?? '',
  /**
   * Proveedores/números cuyos leads reciben respuesta automática de IA (lista por coma).
   * Default: solo 'ycloud' (sistemas meraki).
   */
  aiProviders: () => (process.env.AI_PROVIDERS ?? 'ycloud')
    .split(',').map((s) => s.trim()).filter(Boolean),
  defaultCompanyId:  () => process.env.DEFAULT_COMPANY_ID  ?? 'empresa_demo',
  nodeEnv:           () => process.env.NODE_ENV ?? 'production',
  storageBucket:     () => nonEmpty(process.env.STORAGE_BUCKET)
    ?? firebaseConfigStorageBucket()
    ?? `${process.env.GCLOUD_PROJECT ?? 'crm-conversacional'}.firebasestorage.app`,
} as const;
