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
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY || '';
const CRM_WEBHOOK_URL = process.env.CRM_WEBHOOK_URL || '';
const CRM_WEBHOOK_SECRET = process.env.CRM_WEBHOOK_SECRET || '';
const SESSION_DIR = process.env.SESSION_DIR || './data/sessions';
// 20 MB: techo práctico para reflejar media como base64 sobre HTTP. El webhook
// del CRM corre en Cloud Run (límite de request ~32 MB); base64 infla ~33%, así
// que 20 MB de binario ≈ 27 MB de payload, que entra con margen. Videos más
// grandes necesitarían subida por URL (pendiente).
const MAX_MIRROR_MEDIA_BYTES = Number(process.env.MAX_MIRROR_MEDIA_MB || 20) * 1024 * 1024;

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

// WhatsApp migró los chats 1-a-1 a IDs de privacidad `@lid` que NO llevan el
// número. Los contactos de Baileys sí traen ambos (`id` = número @s.whatsapp.net
// y `lid` = @lid), así que aprendemos ese mapeo aquí para poder resolver el
// teléfono de mensajes `@lid` — sobre todo los SALIENTES (fromMe), cuya key no
// incluye `senderPn`. Sin esto se perdían (log "Mensaje sin telefono asociado").
function learnLidFromContacts(companyId, advisorId, record, contacts) {
  let changed = false;
  for (const contact of contacts || []) {
    const lid = contact?.lid ? String(contact.lid) : '';
    const pnJid = contact?.id ? String(contact.id) : '';
    if (!lid.endsWith('@lid') || !pnJid.endsWith('@s.whatsapp.net')) continue;
    const phone = jidToPhone(pnJid);
    if (!phone) continue;
    if (record.lidPhoneMap?.get(lid) !== phone) {
      record.lidPhoneMap?.set(lid, phone);
      record.phoneLidMap?.set(phone, lid);
      changed = true;
    }
  }
  if (changed) {
    saveLidMaps(companyId, advisorId, record).catch((err) =>
      log.warn({ err, companyId, advisorId }, 'No se pudo guardar mapa LID desde contactos'));
  }
}

function extractText(message) {
  const content = message?.message;
  if (!content) return '';
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
  const content = message?.message;
  if (!content) return {};
  if (content.imageMessage) return { mediaType: content.imageMessage.mimetype || 'image/jpeg', mediaKind: 'image', node: content.imageMessage, downloadType: 'image' };
  if (content.videoMessage) return { mediaType: content.videoMessage.mimetype || 'video/mp4', mediaKind: 'video', node: content.videoMessage, downloadType: 'video' };
  if (content.audioMessage) return { mediaType: content.audioMessage.mimetype || 'audio/ogg', mediaKind: 'audio', node: content.audioMessage, downloadType: 'audio' };
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

async function handleMessages(companyId, advisorId, record, event) {
  if (event.type && event.type !== 'notify') {
    log.debug({ companyId, advisorId, type: event.type, count: event.messages?.length || 0 }, 'Lote de mensajes ignorado');
    return;
  }

  for (const message of event.messages || []) {
    const remoteJid = message.key?.remoteJid || '';
    if (remoteJid === 'status@broadcast') continue;
    if (!isChatJid(remoteJid)) {
      log.info({ companyId, advisorId, remoteJid, key: message.key }, 'Mensaje ignorado por JID no soportado');
      continue;
    }

    if (!message.message) {
      log.debug({ companyId, advisorId, remoteJid, key: message.key }, 'Mensaje sin contenido ignorado');
      continue;
    }

    const fromMe = !!message.key?.fromMe;
    let phone = '';
    if (remoteJid.endsWith('@lid')) {
      // ENTRANTE: el `senderPn` es el teléfono del CLIENTE — lo aprendemos.
      // SALIENTE (fromMe): el `senderPn` es el del PROPIO asesor, así que NO se
      // usa; el destinatario (cliente) se resuelve por el mapa LID↔teléfono
      // (poblado desde contactos y entrantes previos).
      if (!fromMe) {
        const senderPhone = jidToPhone(message.key?.senderPn);
        if (senderPhone && !isOwnNumber(senderPhone, record)) {
          record.lidPhoneMap?.set(remoteJid, senderPhone);
          record.phoneLidMap?.set(senderPhone, remoteJid);
          saveLidMaps(companyId, advisorId, record).catch((err) => log.warn({ err, companyId, advisorId }, 'No se pudo guardar mapa LID'));
          phone = senderPhone;
        }
      }
      if (!phone) {
        const mapped = record.lidPhoneMap?.get(remoteJid) || '';
        // Sanear entradas envenenadas por el bug anterior (mapeadas al número propio).
        if (mapped && isOwnNumber(mapped, record)) {
          record.lidPhoneMap?.delete(remoteJid);
          saveLidMaps(companyId, advisorId, record).catch(() => undefined);
        } else {
          phone = mapped;
        }
      }
    } else {
      phone = jidToPhone(remoteJid);
    }

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

    try {
      await postToCrm({
        companyId,
        advisorId,
        phone,
        advisorPhone: record.phone || undefined,
        direction: message.key?.fromMe ? 'outbound' : 'inbound',
        content,
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
        direction: message.key?.fromMe ? 'outbound' : 'inbound',
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

async function startSession(companyId, advisorId) {
  const key = sessionKey(companyId, advisorId);
  const existing = sessions.get(key);
  if (existing?.sock) return existing;

  await mkdir(sessionPath(companyId, advisorId), { recursive: true });
  const lidMaps = await loadLidMaps(companyId, advisorId);
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath(companyId, advisorId));
  const { version } = await fetchLatestBaileysVersion();

  const record = {
    status: 'qr_pending',
    qrCode: '',
    qrCodeDataUrl: '',
    phone: '',
    displayName: '',
    lastSeenAt: '',
    expiresAt: '',
    lidPhoneMap: lidMaps.lidPhoneMap,
    phoneLidMap: lidMaps.phoneLidMap,
    sock: null,
  };
  sessions.set(key, record);

  const sock = makeWASocket({
    auth: state,
    version,
    browser: Browsers.macOS('Meraki CRM'),
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
  });
  record.sock = sock;

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('messages.upsert', (event) => handleMessages(companyId, advisorId, record, event));
  // Acuses de entrega (enviado → entregado → leído / falló) de mensajes salientes.
  sock.ev.on('messages.update', (updates) => handleMessageStatusUpdates(companyId, advisorId, record, updates));
  // Aprender el mapeo LID↔teléfono desde los contactos (sincronización inicial y
  // actualizaciones) para resolver los chats `@lid`.
  sock.ev.on('contacts.upsert', (contacts) => learnLidFromContacts(companyId, advisorId, record, contacts));
  sock.ev.on('contacts.update', (contacts) => learnLidFromContacts(companyId, advisorId, record, contacts));
  sock.ev.on('messaging-history.set', ({ contacts }) => learnLidFromContacts(companyId, advisorId, record, contacts));
  sock.ev.on('connection.update', async (update) => {
    if (update.qr) {
      record.status = 'qr_pending';
      record.qrCode = update.qr;
      record.qrCodeDataUrl = await QRCode.toDataURL(update.qr, { margin: 1, width: 320 });
      record.expiresAt = new Date(Date.now() + 45_000).toISOString();
      log.info({ companyId, advisorId }, 'QR generado');
    }

    if (update.connection === 'open') {
      record.status = 'connected';
      record.qrCode = '';
      record.qrCodeDataUrl = '';
      record.phone = jidToPhone(sock.user?.id);
      record.displayName = sock.user?.name || '';
      record.lastSeenAt = new Date().toISOString();
      // Sanear el mapa LID: quitar entradas envenenadas por el bug anterior que
      // mapeaban chats de clientes al número PROPIO del asesor (se conocía solo
      // hasta ahora). Sin esto, los entrantes reales de esos clientes seguirían
      // resolviéndose mal.
      let poisoned = 0;
      for (const [lid, ph] of record.lidPhoneMap || []) {
        if (isOwnNumber(ph, record)) {
          record.lidPhoneMap.delete(lid);
          record.phoneLidMap?.delete(normalizePhone(ph));
          poisoned += 1;
        }
      }
      if (poisoned > 0) {
        saveLidMaps(companyId, advisorId, record).catch(() => undefined);
        log.info({ companyId, advisorId, poisoned }, 'Mapa LID saneado (entradas al numero propio)');
      }
      log.info({ companyId, advisorId, phone: record.phone }, 'WhatsApp conectado');
    }

    if (update.connection === 'close') {
      const statusCode = new Boom(update.lastDisconnect?.error).output.statusCode;
      record.sock = null;
      record.status = statusCode === DisconnectReason.loggedOut ? 'disconnected' : 'stale';
      log.warn({ companyId, advisorId, statusCode }, 'WhatsApp desconectado');
      postToCrm({
        eventType: 'status',
        companyId,
        advisorId,
        status: record.status,
        advisorPhone: record.phone || undefined,
        error: statusCode === DisconnectReason.loggedOut
          ? 'WhatsApp cerro la sesion. Debe volver a escanear QR.'
          : 'WhatsApp se desconecto. El puente intentara reconectar.',
        createdAt: Date.now(),
      }).catch((err) => log.warn({ err, companyId, advisorId }, 'No se pudo notificar desconexion al CRM'));
      if (statusCode !== DisconnectReason.loggedOut && statusCode !== 401) {
        sessions.delete(key);
        setTimeout(() => startSession(companyId, advisorId).catch((err) => log.error({ err }, 'Reconnect fallido')), 2000);
      }
    }
  });

  return record;
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
  };
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, sessions: sessions.size });
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
  const key = sessionKey(companyId, advisorId);
  const record = sessions.get(key);
  if (record?.sock) {
    await record.sock.logout().catch(() => undefined);
    record.sock.end?.(undefined);
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

  const key = sessionKey(companyId, advisorId);
  const record = sessions.get(key) || await startSession(companyId, advisorId);
  if (record.status !== 'connected' || !record.sock) {
    res.status(409).json({ message: 'El WhatsApp del asesor no esta conectado.' });
    return;
  }

  const normalizedTo = normalizePhone(to);
  const jid = record.phoneLidMap?.get(normalizedTo) || phoneToJid(to);
  if (!jid) {
    res.status(400).json({ message: 'Numero destino invalido.' });
    return;
  }

  try {
    let sent;
    if (mediaUrl && mediaType?.startsWith('image/')) {
      sent = await record.sock.sendMessage(jid, { image: { url: mediaUrl }, caption: content || undefined });
    } else if (mediaUrl && mediaType?.startsWith('video/')) {
      sent = await record.sock.sendMessage(jid, { video: { url: mediaUrl }, caption: content || undefined });
    } else if (mediaUrl && mediaType?.startsWith('audio/')) {
      sent = await record.sock.sendMessage(jid, { audio: { url: mediaUrl }, mimetype: mediaType });
    } else if (mediaUrl) {
      sent = await record.sock.sendMessage(jid, {
        document: { url: mediaUrl },
        mimetype: mediaType || 'application/octet-stream',
        fileName: fileName || 'archivo',
        caption: content || undefined,
      });
    } else {
      sent = await record.sock.sendMessage(jid, { text: content });
    }

    log.info({ companyId, advisorId, to, jid, phone: record.phone, externalMessageId: sent?.key?.id }, 'Mensaje enviado desde WhatsApp asesor');
    res.json({ id: sent?.key?.id, status: 'sent', phone: record.phone || undefined });
  } catch (err) {
    log.error({ err, companyId, advisorId, to }, 'No se pudo enviar desde WhatsApp asesor');
    res.status(500).json({ message: err instanceof Error ? err.message : 'No se pudo enviar el mensaje.' });
  }
});

app.listen(PORT, () => {
  log.info({ port: PORT }, 'Puente WhatsApp de asesor escuchando');
  restoreSessions().catch((err) => log.error({ err }, 'No se pudieron restaurar sesiones'));
});

async function restoreSessions() {
  await mkdir(SESSION_DIR, { recursive: true });
  const dirs = await readdir(SESSION_DIR, { withFileTypes: true });
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    if (dir.name.includes('.bak')) continue;
    const [companyId, advisorId] = dir.name.split('__');
    if (!companyId || !advisorId) continue;
    startSession(companyId, advisorId)
      .then(() => log.info({ companyId, advisorId }, 'Sesion restaurada'))
      .catch((err) => log.error({ err, companyId, advisorId }, 'No se pudo restaurar sesion'));
  }
}
