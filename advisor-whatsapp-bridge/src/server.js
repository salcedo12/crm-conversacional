import 'dotenv/config';
import express from 'express';
import QRCode from 'qrcode';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadContentFromMessage,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PORT = Number(process.env.PORT || 3333);
// En la VPS el CRM entra por nginx (HTTPS) → basta escuchar en 127.0.0.1 para no
// exponer el puerto 3333 a internet. Por defecto se mantiene 0.0.0.0 (local/ngrok).
const HOST = process.env.HOST || '0.0.0.0';
// Tiempo máximo por intento al webhook del CRM: sin esto un fetch colgado
// bloqueaba el reflejo de mensajes de esa sesión indefinidamente.
const CRM_POST_TIMEOUT_MS = Number(process.env.CRM_POST_TIMEOUT_MS || 60000);
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY || '';
const CRM_WEBHOOK_URL = process.env.CRM_WEBHOOK_URL || '';
const CRM_WEBHOOK_SECRET = process.env.CRM_WEBHOOK_SECRET || '';
const SESSION_DIR = process.env.SESSION_DIR || './data/sessions';
// 20 MB: techo práctico para reflejar media como base64 sobre HTTP. El webhook
// del CRM corre en Cloud Run (límite de request ~32 MB); base64 infla ~33%, así
// que 20 MB de binario ≈ 27 MB de payload, que entra con margen. Videos más
// grandes necesitarían subida por URL (pendiente).
const MAX_MIRROR_MEDIA_BYTES = Number(process.env.MAX_MIRROR_MEDIA_MB || 20) * 1024 * 1024;
// Pausa mínima entre envíos de una misma sesión (+ jitter aleatorio). Ráfagas de
// envíos desde un cliente no oficial es lo que más dispara bloqueos de WhatsApp.
const SEND_MIN_GAP_MS = Number(process.env.SEND_MIN_GAP_MS || 1500);
const SEND_JITTER_MS = Number(process.env.SEND_JITTER_MS || 1500);
// Reconexión con backoff exponencial: 2s, 4s, 8s ... hasta 5 min.
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 5 * 60 * 1000;
// Mensajes recientes por sesión para responder reintentos de cifrado (getMessage).
const MESSAGE_CACHE_SIZE = 300;

const log = pino({ level: process.env.LOG_LEVEL || 'info' });
const app = express();
const sessions = new Map();

app.use(express.json({ limit: '1mb' }));

function requireBridgeKey(req, res, next) {
  if (!BRIDGE_API_KEY || req.get('X-Bridge-Key') !== BRIDGE_API_KEY) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }
  next();
}

function safeId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function sessionKey(companyId, advisorId) {
  return `${safeId(companyId)}__${safeId(advisorId)}`;
}

function sessionPath(companyId, advisorId) {
  return path.join(SESSION_DIR, sessionKey(companyId, advisorId));
}

function lidMapPath(companyId, advisorId) {
  return path.join(sessionPath(companyId, advisorId), 'lid-phone-map.json');
}

function jidToPhone(jid) {
  const raw = String(jid || '').split('@')[0].split(':')[0];
  if (!raw || raw === 'status') return '';
  return `+${raw.replace(/\D/g, '')}`;
}

function isChatJid(jid) {
  return String(jid || '').endsWith('@s.whatsapp.net') || String(jid || '').endsWith('@lid');
}

function isPnJid(jid) {
  return String(jid || '').endsWith('@s.whatsapp.net');
}

function phoneToJid(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  return `${digits}@s.whatsapp.net`;
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits ? `+${digits}` : '';
}

// ¿El teléfono resuelto es el número PROPIO del asesor (el de la sesión)? Sirve
// para no crear "leads fantasma" con el propio número: en un chat `@lid`, el
// `senderPn` de un mensaje SALIENTE es el del asesor, no el del cliente.
function isOwnNumber(phone, record) {
  return !!record?.phone && normalizePhone(phone) === normalizePhone(record.phone);
}

async function loadLidMaps(companyId, advisorId) {
  try {
    const raw = await readFile(lidMapPath(companyId, advisorId), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      lidPhoneMap: new Map(Object.entries(parsed.lidToPhone || {})),
      phoneLidMap: new Map(Object.entries(parsed.phoneToLid || {})),
    };
  } catch {
    return { lidPhoneMap: new Map(), phoneLidMap: new Map() };
  }
}

async function saveLidMaps(companyId, advisorId, record) {
  await writeFile(lidMapPath(companyId, advisorId), JSON.stringify({
    lidToPhone: Object.fromEntries(record.lidPhoneMap || []),
    phoneToLid: Object.fromEntries(record.phoneLidMap || []),
  }, null, 2));
}

// Registra un par LID↔teléfono en el mapa propio (persistido en disco). Ignora
// pares inválidos o que apunten al número del propio asesor.
function rememberLid(companyId, advisorId, record, lid, phone) {
  if (!String(lid || '').endsWith('@lid') || !phone || isOwnNumber(phone, record)) return false;
  if (record.lidPhoneMap.get(lid) === phone) return false;
  record.lidPhoneMap.set(lid, phone);
  record.phoneLidMap.set(phone, lid);
  return true;
}

function persistLidMaps(companyId, advisorId, record) {
  saveLidMaps(companyId, advisorId, record).catch((err) =>
    log.warn({ err, companyId, advisorId }, 'No se pudo guardar mapa LID'));
}

// WhatsApp migró los chats 1-a-1 a IDs de privacidad `@lid` que NO llevan el
// número. Los contactos traen ambos (v7: `id`/`lid` + `phoneNumber`; v6: `id` =
// número y `lid`), así que aprendemos el mapeo aquí además del almacén nativo de
// Baileys, para resolver el teléfono de mensajes `@lid` (sobre todo SALIENTES).
function learnLidFromContacts(companyId, advisorId, record, contacts) {
  let changed = false;
  for (const contact of contacts || []) {
    const ids = [contact?.id, contact?.lid, contact?.phoneNumber].map((v) => String(v || ''));
    const lid = ids.find((v) => v.endsWith('@lid'));
    const pnJid = ids.find(isPnJid);
    if (!lid || !pnJid) continue;
    if (rememberLid(companyId, advisorId, record, lid, jidToPhone(pnJid))) changed = true;
  }
  if (changed) persistLidMaps(companyId, advisorId, record);
}

// Resuelve el teléfono del CLIENTE de un mensaje. Orden:
// 1) remoteJid ya es un número (@s.whatsapp.net).
// 2) `remoteJidAlt` (Baileys v7): dirección alterna del chat, vale para entrantes
//    y salientes.
// 3) Almacén LID nativo de Baileys (signalRepository.lidMapping).
// 4) `senderPn` (solo entrantes: en salientes es el número del asesor).
// 5) Mapa propio persistido (contactos y mensajes previos).
async function resolveCustomerPhone(companyId, advisorId, record, message) {
  const key = message.key || {};
  const remoteJid = key.remoteJid || '';
  const fromMe = !!key.fromMe;

  if (!remoteJid.endsWith('@lid')) return jidToPhone(remoteJid);

  const candidates = [];
  if (isPnJid(key.remoteJidAlt)) candidates.push(jidToPhone(key.remoteJidAlt));
  try {
    const pn = await record.sock?.signalRepository?.lidMapping?.getPNForLID(remoteJid);
    if (isPnJid(pn)) candidates.push(jidToPhone(pn));
  } catch (err) {
    log.debug({ err, remoteJid }, 'lidMapping.getPNForLID fallo');
  }
  if (!fromMe && key.senderPn) candidates.push(jidToPhone(key.senderPn));

  const resolved = candidates.find((phone) => phone && !isOwnNumber(phone, record));
  if (resolved) {
    if (rememberLid(companyId, advisorId, record, remoteJid, resolved)) persistLidMaps(companyId, advisorId, record);
    return resolved;
  }

  const mapped = record.lidPhoneMap.get(remoteJid) || '';
  if (mapped && isOwnNumber(mapped, record)) {
    // Sanear entradas envenenadas por un bug anterior (mapeadas al número propio).
    record.lidPhoneMap.delete(remoteJid);
    persistLidMaps(companyId, advisorId, record);
    return '';
  }
  return mapped;
}

function unwrapMessage(content) {
  let cur = content;
  while (cur) {
    if (cur.ephemeralMessage?.message) {
      cur = cur.ephemeralMessage.message;
    } else if (cur.viewOnceMessage?.message) {
      cur = cur.viewOnceMessage.message;
    } else if (cur.viewOnceMessageV2?.message) {
      cur = cur.viewOnceMessageV2.message;
    } else if (cur.viewOnceMessageV2Extension?.message) {
      cur = cur.viewOnceMessageV2Extension.message;
    } else if (cur.documentWithCaptionMessage?.message) {
      cur = cur.documentWithCaptionMessage.message;
    } else {
      break;
    }
  }
  return cur;
}

function extractText(message) {
  const content = unwrapMessage(message?.message);
  if (!content) return '';

  if (content.reactionMessage) {
    const emoji = content.reactionMessage.text?.trim();
    return emoji ? `Reaccionó con ${emoji}` : 'Quitó su reacción';
  }

  if (content.locationMessage) {
    const loc = content.locationMessage;
    const name = loc.name || loc.address;
    const coords = `${loc.degreesLatitude}, ${loc.degreesLongitude}`;
    return `📍 Ubicación: ${name ? `${name} (${coords})` : coords}`;
  }

  if (content.liveLocationMessage) {
    return '📍 Ubicación en tiempo real compartida';
  }

  if (content.contactMessage) {
    return `👤 Contacto compartido: ${content.contactMessage.displayName || 'Contacto'}`;
  }

  if (content.contactsArrayMessage) {
    return `👤 Contactos compartidos (${content.contactsArrayMessage.contacts?.length || 0})`;
  }

  if (content.pollCreationMessage || content.pollCreationMessageV2 || content.pollCreationMessageV3) {
    const poll = content.pollCreationMessage || content.pollCreationMessageV2 || content.pollCreationMessageV3;
    return `📊 Encuesta: ${poll.name || 'Encuesta'}`;
  }

  if (content.protocolMessage?.type === 0 || content.protocolMessage?.type === 'REVOKE') {
    return '🚫 Mensaje eliminado';
  }

  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.buttonsResponseMessage?.selectedDisplayText ||
    content.listResponseMessage?.title ||
    ''
  );
}

function mediaKindFromContent(message) {
  const content = unwrapMessage(message?.message);
  if (!content) return {};
  if (content.imageMessage) return { mediaType: content.imageMessage.mimetype || 'image/jpeg', mediaKind: 'image', node: content.imageMessage, downloadType: 'image' };
  if (content.videoMessage) return { mediaType: content.videoMessage.mimetype || 'video/mp4', mediaKind: 'video', node: content.videoMessage, downloadType: 'video' };
  if (content.audioMessage) return { mediaType: content.audioMessage.mimetype || 'audio/ogg', mediaKind: 'audio', node: content.audioMessage, downloadType: 'audio' };
  if (content.ptvMessage) return { mediaType: content.ptvMessage.mimetype || 'video/mp4', mediaKind: 'video', node: content.ptvMessage, downloadType: 'video' };
  if (content.stickerMessage) return { mediaType: content.stickerMessage.mimetype || 'image/webp', mediaKind: 'sticker', node: content.stickerMessage, downloadType: 'sticker' };
  if (content.documentMessage) {
    return {
      mediaType: content.documentMessage.mimetype || 'application/octet-stream',
      mediaKind: 'document',
      fileName: content.documentMessage.fileName,
      node: content.documentMessage,
      downloadType: 'document',
    };
  }
  return {};
}

async function streamToBuffer(stream, limitBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > limitBytes) {
      const err = new Error(`Media supera el limite de ${Math.round(limitBytes / 1024 / 1024)} MB`);
      err.code = 'MEDIA_TOO_LARGE';
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function extractMedia(message) {
  const media = mediaKindFromContent(message);
  if (!media.node || !media.downloadType) return media;

  try {
    const stream = await downloadContentFromMessage(media.node, media.downloadType);
    const buffer = await streamToBuffer(stream, MAX_MIRROR_MEDIA_BYTES);
    return {
      mediaType: media.mediaType,
      mediaKind: media.mediaKind,
      fileName: media.fileName,
      mediaBase64: buffer.toString('base64'),
    };
  } catch (err) {
    log.warn({
      err,
      mediaKind: media.mediaKind,
      mediaType: media.mediaType,
      messageId: message.key?.id,
    }, 'No se pudo descargar media de WhatsApp para reflejarla');
    return {
      mediaType: media.mediaType,
      mediaKind: media.mediaKind,
      fileName: media.fileName,
    };
  }
}

const CRM_POST_MAX_ATTEMPTS = Number(process.env.CRM_POST_MAX_ATTEMPTS || 4);
const CRM_POST_BASE_DELAY_MS = Number(process.env.CRM_POST_BASE_DELAY_MS || 1000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function postToCrm(payload) {
  if (!CRM_WEBHOOK_URL) {
    log.warn({ payload }, 'CRM_WEBHOOK_URL no configurado; mensaje no enviado al CRM');
    return;
  }

  // Reintentos con backoff exponencial. El CRM puede responder 5xx transitorio
  // (p. ej. arranque en frio o pico de memoria al re-alojar media). Sin reintento
  // el mensaje se perderia para siempre porque WhatsApp no lo reenvia.
  let lastError;
  for (let attempt = 1; attempt <= CRM_POST_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(CRM_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Advisor-Whatsapp-Secret': CRM_WEBHOOK_SECRET,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(CRM_POST_TIMEOUT_MS),
      });

      if (response.ok) return;

      const text = await response.text();
      const error = new Error(`CRM webhook HTTP ${response.status}: ${text.slice(0, 300)}`);
      // 4xx (salvo 429) es un error del payload: reintentar no ayuda.
      if (response.status < 500 && response.status !== 429) throw error;
      lastError = error;
    } catch (err) {
      // Errores de red/timeout tambien son transitorios y se reintentan.
      lastError = err;
      if (err instanceof Error && err.message.startsWith('CRM webhook HTTP 4')) throw err;
    }

    if (attempt < CRM_POST_MAX_ATTEMPTS) {
      const delay = CRM_POST_BASE_DELAY_MS * 2 ** (attempt - 1);
      log.warn({ attempt, delay, err: lastError }, 'Reintentando envio al CRM');
      await sleep(delay);
    }
  }

  throw lastError || new Error('CRM webhook fallo tras reintentos');
}

function cacheMessage(record, message) {
  const id = message?.key?.id;
  if (!id || !message.message) return;
  record.messageCache.set(id, message.message);
  if (record.messageCache.size > MESSAGE_CACHE_SIZE) {
    record.messageCache.delete(record.messageCache.keys().next().value);
  }
}

async function handleMessages(companyId, advisorId, record, event) {
  if (event.type && event.type !== 'notify') {
    log.debug({ companyId, advisorId, type: event.type, count: event.messages?.length || 0 }, 'Lote de mensajes ignorado');
    return;
  }

  for (const message of event.messages || []) {
    const remoteJid = message.key?.remoteJid || '';
    if (remoteJid === 'status@broadcast') continue;
    if (!isChatJid(remoteJid)) {
      log.debug({ companyId, advisorId, remoteJid }, 'Mensaje ignorado por JID no soportado');
      continue;
    }

    if (!message.message) {
      log.debug({ companyId, advisorId, remoteJid, key: message.key }, 'Mensaje sin contenido ignorado');
      continue;
    }

    const fromMe = !!message.key?.fromMe;
    if (fromMe) cacheMessage(record, message);

    const phone = await resolveCustomerPhone(companyId, advisorId, record, message);

    // Nunca reflejar contra el número PROPIO del asesor (evita leads fantasma).
    if (phone && isOwnNumber(phone, record)) {
      log.info({ companyId, advisorId, remoteJid, fromMe }, 'Mensaje ignorado: destinatario = numero propio del asesor');
      continue;
    }
    if (!phone) {
      log.warn({ companyId, advisorId, remoteJid, fromMe, key: message.key }, 'Mensaje sin telefono asociado');
      continue;
    }

    const content = extractText(message);
    const media = await extractMedia(message);
    const externalMessageId = message.key?.id;
    if (!externalMessageId) continue;
    const finalContent = content || (media?.mediaType ? '' : '[Reacción o mensaje no compatible]');

    try {
      await postToCrm({
        companyId,
        advisorId,
        phone,
        advisorPhone: record.phone || undefined,
        direction: fromMe ? 'outbound' : 'inbound',
        content: finalContent,
        externalMessageId,
        ...(message.pushName ? { customerName: message.pushName } : {}),
        createdAt: Number(message.messageTimestamp || 0) * 1000 || Date.now(),
        ...media,
      });
      log.info({
        companyId,
        advisorId,
        phone,
        remoteJid,
        direction: fromMe ? 'outbound' : 'inbound',
        externalMessageId,
      }, 'Mensaje reflejado en CRM');
    } catch (err) {
      log.error({ err, companyId, advisorId, externalMessageId }, 'No se pudo reflejar mensaje en CRM');
    }
  }
}

// Estado de recibo de Baileys (proto.WebMessageInfo.Status) → estado del CRM.
// 0 ERROR · 1 PENDING · 2 SERVER_ACK · 3 DELIVERY_ACK · 4 READ · 5 PLAYED.
// PENDING (1) se ignora para no hacer retroceder el estado ya mostrado.
function mapBaileysStatus(status) {
  switch (status) {
    case 0: return 'failed';
    case 2: return 'sent';
    case 3: return 'delivered';
    case 4:
    case 5: return 'read';
    default: return null;
  }
}

// Reenvía al CRM los acuses de entrega de mensajes SALIENTES del asesor, para que
// la app muestre si cada mensaje se entregó / leyó o falló.
async function handleMessageStatusUpdates(companyId, advisorId, record, updates) {
  for (const entry of updates || []) {
    const key = entry.key || {};
    if (!key.fromMe) continue;                       // solo nuestros mensajes salientes
    if (key.remoteJid === 'status@broadcast') continue;
    const rawStatus = entry.update?.status;
    if (rawStatus === undefined || rawStatus === null) continue;
    const status = mapBaileysStatus(rawStatus);
    if (!status) continue;
    const externalMessageId = key.id;
    if (!externalMessageId) continue;

    try {
      await postToCrm({
        eventType: 'message_status',
        companyId,
        advisorId,
        externalMessageId,
        status,
        createdAt: Date.now(),
      });
      log.debug({ companyId, advisorId, externalMessageId, status }, 'Acuse de entrega reflejado en CRM');
    } catch (err) {
      log.warn({ err, companyId, advisorId, externalMessageId, status }, 'No se pudo reflejar acuse de entrega');
    }
  }
}

function notifyCrmStatus(companyId, advisorId, record) {
  postToCrm({
    eventType: 'status',
    companyId,
    advisorId,
    status: record.status,
    advisorPhone: record.phone || undefined,
    error: record.error || undefined,
    createdAt: Date.now(),
  }).catch((err) => log.warn({ err, companyId, advisorId }, 'No se pudo notificar estado al CRM'));
}

// Cierres DEFINITIVOS: reintentar no sirve (y con 403 insistir empeora el bloqueo).
// Se borran las credenciales para que el siguiente QR arranque limpio.
const TERMINAL_CLOSES = {
  [DisconnectReason.loggedOut]: {
    status: 'disconnected',
    error: 'WhatsApp cerro la sesion vinculada. Debe volver a escanear el QR.',
  },
  [DisconnectReason.forbidden]: {
    status: 'error',
    error: 'WhatsApp rechazo esta cuenta (403): posible restriccion o bloqueo del numero. Revisa el WhatsApp del asesor antes de reconectar.',
  },
  [DisconnectReason.multideviceMismatch]: {
    status: 'disconnected',
    error: 'Sesion incompatible con WhatsApp multidispositivo. Debe volver a escanear el QR.',
  },
};

function newRecord(lidMaps) {
  return {
    status: 'qr_pending',
    error: '',
    qrCode: '',
    qrCodeDataUrl: '',
    phone: '',
    displayName: '',
    lastSeenAt: '',
    expiresAt: '',
    lidPhoneMap: lidMaps.lidPhoneMap,
    phoneLidMap: lidMaps.phoneLidMap,
    messageCache: new Map(),
    sendChain: Promise.resolve(),
    lastSendAt: 0,
    reconnectAttempts: 0,
    reconnectTimer: null,
    starting: null,
    sock: null,
  };
}

function releaseSocket(record) {
  const sock = record.sock;
  record.sock = null;
  if (!sock) return;
  // Sin esto cada reconexión dejaba vivo el socket viejo con sus listeners
  // (fuga de memoria: el proceso llegaba a ~1.6 GB).
  try { sock.ev.removeAllListeners(); } catch { /* noop */ }
  try { sock.end?.(undefined); } catch { /* noop */ }
}

async function startSession(companyId, advisorId) {
  const key = sessionKey(companyId, advisorId);
  let record = sessions.get(key);
  if (record?.sock) return record;
  if (record?.starting) return record.starting;

  if (!record) {
    await mkdir(sessionPath(companyId, advisorId), { recursive: true });
    record = newRecord(await loadLidMaps(companyId, advisorId));
    sessions.set(key, record);
  }
  if (record.reconnectTimer) {
    clearTimeout(record.reconnectTimer);
    record.reconnectTimer = null;
  }

  record.starting = (async () => {
    await mkdir(sessionPath(companyId, advisorId), { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath(companyId, advisorId));
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
    const wasRegistered = !!state.creds?.me?.id;
    if (!wasRegistered) record.status = 'qr_pending';
    record.error = '';

    const sock = makeWASocket({
      auth: state,
      ...(version ? { version } : {}),
      browser: Browsers.macOS('Meraki CRM'),
      logger: pino({ level: 'silent' }),
      // No marcar "en línea" al conectar: el celular del asesor sigue recibiendo
      // notificaciones y la sesión se parece menos a un bot.
      markOnlineOnConnect: false,
      syncFullHistory: false,
      // Responder reintentos de cifrado con el mensaje original (evita el
      // "Esperando este mensaje" del lado del cliente).
      getMessage: async (msgKey) => record.messageCache.get(msgKey.id) || undefined,
    });
    record.sock = sock;

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('messages.upsert', (event) => {
      handleMessages(companyId, advisorId, record, event)
        .catch((err) => log.error({ err, companyId, advisorId }, 'Error procesando mensajes'));
    });
    // Acuses de entrega (enviado → entregado → leído / falló) de mensajes salientes.
    sock.ev.on('messages.update', (updates) => handleMessageStatusUpdates(companyId, advisorId, record, updates));
    // Aprender el mapeo LID↔teléfono para resolver los chats `@lid`.
    sock.ev.on('lid-mapping.update', ({ lid, pn }) => {
      if (rememberLid(companyId, advisorId, record, lid, jidToPhone(pn))) persistLidMaps(companyId, advisorId, record);
    });
    sock.ev.on('contacts.upsert', (contacts) => learnLidFromContacts(companyId, advisorId, record, contacts));
    sock.ev.on('contacts.update', (contacts) => learnLidFromContacts(companyId, advisorId, record, contacts));
    sock.ev.on('messaging-history.set', ({ contacts }) => learnLidFromContacts(companyId, advisorId, record, contacts));
    sock.ev.on('connection.update', (update) => {
      handleConnectionUpdate(companyId, advisorId, record, sock, update)
        .catch((err) => log.error({ err, companyId, advisorId }, 'Error en connection.update'));
    });

    return record;
  })();

  try {
    return await record.starting;
  } finally {
    record.starting = null;
  }
}

function scheduleReconnect(companyId, advisorId, record, immediate = false) {
  if (record.reconnectTimer) return;
  const delay = immediate
    ? 500
    : Math.min(RECONNECT_BASE_MS * 2 ** record.reconnectAttempts, RECONNECT_MAX_MS);
  record.reconnectAttempts += 1;
  log.info({ companyId, advisorId, delay, attempt: record.reconnectAttempts }, 'Reconexion programada');
  record.reconnectTimer = setTimeout(() => {
    record.reconnectTimer = null;
    startSession(companyId, advisorId).catch((err) => {
      log.error({ err, companyId, advisorId }, 'Reconnect fallido');
      scheduleReconnect(companyId, advisorId, record);
    });
  }, delay);
}

async function handleConnectionUpdate(companyId, advisorId, record, sock, update) {
  // Eventos tardíos de un socket ya reemplazado: ignorar.
  if (record.sock !== sock) return;

  if (update.qr) {
    record.status = 'qr_pending';
    record.qrCode = update.qr;
    record.qrCodeDataUrl = await QRCode.toDataURL(update.qr, { margin: 1, width: 320 });
    record.expiresAt = new Date(Date.now() + 45_000).toISOString();
    log.info({ companyId, advisorId }, 'QR generado');
  }

  if (update.connection === 'open') {
    record.status = 'connected';
    record.error = '';
    record.qrCode = '';
    record.qrCodeDataUrl = '';
    record.reconnectAttempts = 0;
    record.phone = jidToPhone(sock.user?.id);
    record.displayName = sock.user?.name || '';
    record.lastSeenAt = new Date().toISOString();
    // Sanear el mapa LID: quitar entradas envenenadas por un bug anterior que
    // mapeaban chats de clientes al número PROPIO del asesor.
    let poisoned = 0;
    for (const [lid, ph] of record.lidPhoneMap) {
      if (isOwnNumber(ph, record)) {
        record.lidPhoneMap.delete(lid);
        record.phoneLidMap.delete(normalizePhone(ph));
        poisoned += 1;
      }
    }
    if (poisoned > 0) {
      persistLidMaps(companyId, advisorId, record);
      log.info({ companyId, advisorId, poisoned }, 'Mapa LID saneado (entradas al numero propio)');
    }
    log.info({ companyId, advisorId, phone: record.phone }, 'WhatsApp conectado');
    notifyCrmStatus(companyId, advisorId, record);
  }

  if (update.connection !== 'close') return;

  const statusCode = new Boom(update.lastDisconnect?.error).output.statusCode;
  const wasConnected = record.status === 'connected';
  const neverLinked = !sock.authState?.creds?.me?.id;
  releaseSocket(record);
  record.qrCode = '';
  record.qrCodeDataUrl = '';
  log.warn({ companyId, advisorId, statusCode, wasConnected }, 'WhatsApp desconectado');

  const terminal = TERMINAL_CLOSES[statusCode];
  if (terminal) {
    record.status = terminal.status;
    record.error = terminal.error;
    record.reconnectAttempts = 0;
    await rm(sessionPath(companyId, advisorId), { recursive: true, force: true }).catch(() => undefined);
    log.warn({ companyId, advisorId, statusCode }, 'Sesion cerrada definitivamente; se requiere QR nuevo');
    notifyCrmStatus(companyId, advisorId, record);
    return;
  }

  if (statusCode === DisconnectReason.connectionReplaced) {
    record.status = 'stale';
    record.error = 'La sesion se abrio en otro lugar. Genera el QR de nuevo si quieres usarla aqui.';
    notifyCrmStatus(companyId, advisorId, record);
    return;
  }

  // QR mostrado y nadie lo escaneó: parar. Antes se regeneraba para siempre
  // (un QR cada 20 s, día y noche). El asesor pide uno nuevo desde el CRM.
  if (neverLinked && statusCode !== DisconnectReason.restartRequired) {
    record.status = 'disconnected';
    record.error = 'El QR expiro sin escanearse. Genera uno nuevo.';
    record.reconnectAttempts = 0;
    await rm(sessionPath(companyId, advisorId), { recursive: true, force: true }).catch(() => undefined);
    log.info({ companyId, advisorId, statusCode }, 'QR expirado sin escanear; sesion detenida');
    return;
  }

  // 515 llega justo después de escanear el QR: hay que reconectar ya.
  if (statusCode === DisconnectReason.restartRequired) {
    scheduleReconnect(companyId, advisorId, record, true);
    return;
  }

  record.status = 'stale';
  record.error = 'WhatsApp se desconecto. El puente intentara reconectar.';
  // Avisar solo en la transición conectado → caído, no en cada reintento.
  if (wasConnected) notifyCrmStatus(companyId, advisorId, record);
  scheduleReconnect(companyId, advisorId, record);
}

// Serializa los envíos de una sesión y los espacia (gap + jitter).
function enqueueSend(record, task) {
  const run = record.sendChain.then(async () => {
    const gap = SEND_MIN_GAP_MS + Math.floor(Math.random() * SEND_JITTER_MS);
    const wait = record.lastSendAt + gap - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await task();
    } finally {
      record.lastSendAt = Date.now();
    }
  });
  record.sendChain = run.catch(() => undefined);
  return run;
}

function publicSession(record) {
  return {
    status: record.status,
    qrCode: record.qrCode || undefined,
    qrCodeDataUrl: record.qrCodeDataUrl || undefined,
    phone: record.phone || undefined,
    displayName: record.displayName || undefined,
    lastSeenAt: record.lastSeenAt || undefined,
    expiresAt: record.expiresAt || undefined,
    error: record.error || undefined,
  };
}

app.get('/health', (_req, res) => {
  const byStatus = {};
  for (const record of sessions.values()) byStatus[record.status] = (byStatus[record.status] || 0) + 1;
  res.json({
    ok: true,
    sessions: sessions.size,
    byStatus,
    rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  });
});

app.post('/advisor-whatsapp/session/qr', requireBridgeKey, async (req, res) => {
  const { companyId, advisorId } = req.body || {};
  if (!companyId || !advisorId) {
    res.status(400).json({ message: 'companyId y advisorId son requeridos' });
    return;
  }

  try {
    const record = await startSession(companyId, advisorId);
    res.json(publicSession(record));
  } catch (err) {
    log.error({ err, companyId, advisorId }, 'No se pudo iniciar sesion');
    res.status(500).json({ message: err instanceof Error ? err.message : 'No se pudo iniciar sesion' });
  }
});

app.post('/advisor-whatsapp/session/status', requireBridgeKey, async (req, res) => {
  const { companyId, advisorId } = req.body || {};
  if (!companyId || !advisorId) {
    res.status(400).json({ message: 'companyId y advisorId son requeridos' });
    return;
  }

  const record = sessions.get(sessionKey(companyId, advisorId));
  if (!record) {
    res.json({ status: 'disconnected' });
    return;
  }

  res.json(publicSession(record));
});

app.post('/advisor-whatsapp/session/disconnect', requireBridgeKey, async (req, res) => {
  const { companyId, advisorId } = req.body || {};
  if (!companyId || !advisorId) {
    res.status(400).json({ message: 'companyId y advisorId son requeridos' });
    return;
  }
  const key = sessionKey(companyId, advisorId);
  const record = sessions.get(key);
  if (record) {
    if (record.reconnectTimer) clearTimeout(record.reconnectTimer);
    // Guardar la referencia: logout() dispara 'close' y el handler deja
    // record.sock en null (antes eso tumbaba el proceso con "reading 'end'").
    const sock = record.sock;
    if (sock) {
      try { sock.ev.removeAllListeners(); } catch { /* noop */ }
      await sock.logout().catch(() => undefined);
      try { sock.end?.(undefined); } catch { /* noop */ }
    }
    record.sock = null;
  }
  sessions.delete(key);
  await rm(sessionPath(companyId, advisorId), { recursive: true, force: true });
  res.json({ status: 'disconnected' });
});

app.post('/advisor-whatsapp/message/send', requireBridgeKey, async (req, res) => {
  const { companyId, advisorId, to, content, mediaUrl, mediaType, fileName } = req.body || {};
  if (!companyId || !advisorId || !to || (!content && !mediaUrl)) {
    res.status(400).json({ message: 'companyId, advisorId, to y content/mediaUrl son requeridos' });
    return;
  }

  const record = sessions.get(sessionKey(companyId, advisorId));
  if (!record || record.status !== 'connected' || !record.sock) {
    res.status(409).json({ message: 'El WhatsApp del asesor no esta conectado.' });
    return;
  }

  const normalizedTo = normalizePhone(to);
  const jid = record.phoneLidMap.get(normalizedTo) || phoneToJid(to);
  if (!jid) {
    res.status(400).json({ message: 'Numero destino invalido.' });
    return;
  }

  let payload;
  if (mediaUrl && mediaType?.startsWith('image/')) {
    payload = { image: { url: mediaUrl }, caption: content || undefined };
  } else if (mediaUrl && mediaType?.startsWith('video/')) {
    payload = { video: { url: mediaUrl }, caption: content || undefined };
  } else if (mediaUrl && mediaType?.startsWith('audio/')) {
    payload = { audio: { url: mediaUrl }, mimetype: mediaType };
  } else if (mediaUrl) {
    payload = {
      document: { url: mediaUrl },
      mimetype: mediaType || 'application/octet-stream',
      fileName: fileName || 'archivo',
      caption: content || undefined,
    };
  } else {
    payload = { text: content };
  }

  try {
    const sent = await enqueueSend(record, () => {
      if (!record.sock) throw new Error('El WhatsApp del asesor se desconecto.');
      return record.sock.sendMessage(jid, payload);
    });
    if (sent) cacheMessage(record, sent);

    log.info({ companyId, advisorId, to, jid, phone: record.phone, externalMessageId: sent?.key?.id }, 'Mensaje enviado desde WhatsApp asesor');
    res.json({ id: sent?.key?.id, status: 'sent', phone: record.phone || undefined });
  } catch (err) {
    log.error({ err, companyId, advisorId, to }, 'No se pudo enviar desde WhatsApp asesor');
    res.status(500).json({ message: err instanceof Error ? err.message : 'No se pudo enviar el mensaje.' });
  }
});

const server = app.listen(PORT, HOST, () => {
  log.info({ port: PORT, host: HOST }, 'Puente WhatsApp de asesor escuchando');
  restoreSessions().catch((err) => log.error({ err }, 'No se pudieron restaurar sesiones'));
});

// Solo se restauran sesiones ya vinculadas (creds registradas). Carpetas vacías o
// de QR nunca escaneados se ignoran: antes reabrían QRs infinitos en cada reinicio.
async function restoreSessions() {
  await mkdir(SESSION_DIR, { recursive: true });
  const dirs = await readdir(SESSION_DIR, { withFileTypes: true });
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    if (dir.name.includes('.bak')) continue;
    const [companyId, advisorId] = dir.name.split('__');
    if (!companyId || !advisorId) continue;

    let registered = false;
    try {
      const creds = JSON.parse(await readFile(path.join(SESSION_DIR, dir.name, 'creds.json'), 'utf8'));
      registered = !!creds?.registered || !!creds?.me?.id;
    } catch { /* sin creds */ }
    if (!registered) {
      log.info({ companyId, advisorId }, 'Sesion sin vincular; no se restaura');
      continue;
    }

    startSession(companyId, advisorId)
      .then(() => log.info({ companyId, advisorId }, 'Sesion restaurada'))
      .catch((err) => log.error({ err, companyId, advisorId }, 'No se pudo restaurar sesion'));
  }
}

// Apagado limpio (pm2 restart/stop): cerrar sockets SIN logout para conservar
// las sesiones vinculadas.
function shutdown(signal) {
  log.info({ signal }, 'Apagando puente');
  for (const record of sessions.values()) {
    if (record.reconnectTimer) clearTimeout(record.reconnectTimer);
    releaseSocket(record);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Una promesa rechazada sin capturar (p. ej. dentro de un evento de Baileys) no
// debe tumbar el proceso y con él TODAS las sesiones: se registra y se sigue.
process.on('unhandledRejection', (reason) => {
  log.error({ err: reason }, 'Promesa rechazada sin capturar');
});
// Una excepción síncrona deja el proceso en estado incierto: registrar y salir
// para que pm2 lo reinicie limpio (las sesiones vinculadas se restauran solas).
process.on('uncaughtException', (err) => {
  log.fatal({ err }, 'Excepcion no capturada; reiniciando');
  setTimeout(() => process.exit(1), 500).unref();
});
