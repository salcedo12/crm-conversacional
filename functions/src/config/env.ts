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
