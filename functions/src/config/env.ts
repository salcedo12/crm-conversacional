function firebaseConfigStorageBucket(): string | undefined {
  try {
    const raw = process.env.FIREBASE_CONFIG;
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { storageBucket?: string };
    return parsed.storageBucket;
  } catch {
    return undefined;
  }
}

/**
 * Acceso centralizado a variables de entorno.
 * Todas las vars se leen en runtime (no en module load) para
 * evitar timeouts de despliegue en Firebase Functions Gen2.
 */
export const env = {
  // ── Twilio (sandbox / fallback) ───────────────────────────────────────────
  twilioAccountSid:  () => process.env.TWILIO_ACCOUNT_SID  ?? '',
  twilioAuthToken:   () => process.env.TWILIO_AUTH_TOKEN   ?? '',
  twilioFromNumber:  () => process.env.TWILIO_WHATSAPP_NUMBER ?? 'whatsapp:+14155238886',
  validateSignature: () => process.env.VALIDATE_TWILIO_SIGNATURE === 'true',

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

  // ── Google OAuth (Calendar + Meet, por asesor) ─────────────────────────────
  googleClientId:     () => process.env.GOOGLE_CLIENT_ID     ?? '',
  googleClientSecret: () => process.env.GOOGLE_CLIENT_SECRET ?? '',
  /** URL pública de la function googleOAuthCallback (debe coincidir con la registrada en Google Cloud) */
  googleOAuthRedirect:() => process.env.GOOGLE_OAUTH_REDIRECT ?? '',
  /** URL del frontend a la que se vuelve tras conectar/desconectar */
  appBaseUrl:         () => process.env.APP_BASE_URL ?? '',
  /** Zona horaria para los eventos de calendario */
  calendarTimeZone:   () => process.env.CALENDAR_TIMEZONE ?? 'America/Bogota',
  googleConfigured:   () => !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,

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

  smtpHost:       () => process.env.SMTP_HOST ?? '',
  smtpPort:       () => Number(process.env.SMTP_PORT ?? '465'),
  smtpUser:       () => process.env.SMTP_USER ?? '',
  smtpPass:       () => process.env.SMTP_PASS ?? '',
  smtpSecure:     () => process.env.SMTP_SECURE !== 'false',
  mailFrom:       () => process.env.MAIL_FROM ?? 'Meraki CRM <alertas@grupoconstructormeraki.com.co>',
  mailConfigured: () => !!process.env.SMTP_HOST && !!process.env.SMTP_USER && !!process.env.SMTP_PASS,

  // ── Comunes ───────────────────────────────────────────────────────────────
  openaiApiKey:      () => process.env.OPENAI_API_KEY      ?? '',
  /**
   * Proveedores/números cuyos leads reciben respuesta automática de IA (lista por coma).
   * Default: solo 'ycloud' (sistemas meraki).
   */
  aiProviders: () => (process.env.AI_PROVIDERS ?? 'ycloud')
    .split(',').map((s) => s.trim()).filter(Boolean),
  defaultCompanyId:  () => process.env.DEFAULT_COMPANY_ID  ?? 'empresa_demo',
  nodeEnv:           () => process.env.NODE_ENV ?? 'production',
  storageBucket:     () => process.env.STORAGE_BUCKET
    ?? firebaseConfigStorageBucket()
    ?? `${process.env.GCLOUD_PROJECT ?? 'crm-conversacional'}.firebasestorage.app`,
} as const;
