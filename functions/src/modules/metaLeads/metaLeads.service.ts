import * as https from 'https';
import { Timestamp } from 'firebase-admin/firestore';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { db } from '../../lib/admin';
import { leadsRepository } from '../leads/leads.repository';
import { assignLead } from '../leads/leadAssignment.service';
import { messagesRepository } from '../messages/messages.repository';
import { templatesRepository } from '../templates/templates.repository';
import { sendTemplateToLead } from '../messages/templateSender.service';
import { leadFormsRepository } from './leadForms.repository';
import { resolveCompanyIdForChannel } from '../companies/companyRouting';
import { webhookEventExpireAt } from '../../utils/webhookTtl';
import { toNormalizedPhone, phoneTail } from '../../utils/phone';
import type { Lead } from '../leads/leads.types';

/**
 * Valor del cambio `leadgen` que envía Meta cuando alguien completa una pauta de
 * FORMULARIO (Lead Ads / formulario instantáneo). Trae solo IDs; los datos del
 * formulario se traen aparte con la Graph API usando `leadgen_id`.
 */
export interface LeadgenValue {
  leadgen_id:  string;
  form_id?:    string;
  ad_id?:      string;
  adgroup_id?: string;
  page_id?:    string;
  created_time?: number;
}

interface LeadgenData {
  fields:      Record<string, string>;
  ad_id?:      string;
  form_id?:    string;
  campaign_id?: string;
}

/** GET a la Graph API de Meta (devuelve JSON). */
function graphGet<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    https.get(`https://graph.facebook.com/${path}`, (res) => {
      let data = '';
      res.on('data', (c: string) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data) as T); }
        catch (err) { reject(err); }
      });
    }).on('error', reject);
  });
}

/** Trae los datos del formulario (nombre, teléfono, email y respuestas) desde Meta. */
async function fetchLeadgenData(leadgenId: string): Promise<LeadgenData> {
  const token   = env.metaPageAccessToken();
  const version = env.metaGraphVersion();
  const fields  = 'field_data,ad_id,form_id,campaign_id,created_time';
  const raw = await graphGet<{
    field_data?: { name: string; values?: string[] }[];
    ad_id?: string; form_id?: string; campaign_id?: string;
    error?: { message?: string };
  }>(`${version}/${leadgenId}?fields=${fields}&access_token=${encodeURIComponent(token)}`);

  if (raw.error) throw new Error(`Graph API: ${raw.error.message ?? 'error'}`);

  const fieldsMap: Record<string, string> = {};
  for (const f of raw.field_data ?? []) {
    fieldsMap[f.name] = (f.values ?? []).join(', ');
  }
  return { fields: fieldsMap, ad_id: raw.ad_id, form_id: raw.form_id, campaign_id: raw.campaign_id };
}

/** Nombre legible del formulario en Meta (para mostrar en la config), best-effort. */
async function fetchFormName(formId: string): Promise<string | undefined> {
  const token = env.metaPageAccessToken();
  if (!token) return undefined;
  const version = env.metaGraphVersion();
  try {
    const raw = await graphGet<{ name?: string; error?: unknown }>(
      `${version}/${formId}?fields=name&access_token=${encodeURIComponent(token)}`
    );
    return raw.name || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resuelve nombres LEGIBLES del anuncio/campaña/conjunto/formulario que originó
 * el lead, usando el token de la API de Ads (ads_read). Best-effort: si falta el
 * token o alguna llamada falla, devuelve lo que haya podido resolver. Así el
 * asesor ve "Campaña: X · Anuncio: Y" en vez de IDs, para evaluar cada pauta.
 */
async function resolveAttributionNames(input: {
  adId?: string; campaignId?: string; formId?: string;
}): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const token = env.metaAdsAccessToken();
  if (!token) return out;
  const version = env.metaGraphVersion();
  const enc = encodeURIComponent(token);

  // Una sola llamada al anuncio trae también su campaña y conjunto de anuncios.
  if (input.adId) {
    try {
      const ad = await graphGet<{
        name?: string; campaign?: { name?: string }; adset?: { name?: string };
      }>(`${version}/${input.adId}?fields=name,campaign{name},adset{name}&access_token=${enc}`);
      if (ad.name)          out.metaAdName       = ad.name;
      if (ad.campaign?.name) out.metaCampaignName = ad.campaign.name;
      if (ad.adset?.name)    out.metaAdsetName    = ad.adset.name;
    } catch { /* best-effort */ }
  }
  // Campaña por separado si no vino con el anuncio.
  if (!out.metaCampaignName && input.campaignId) {
    try {
      const c = await graphGet<{ name?: string }>(
        `${version}/${input.campaignId}?fields=name&access_token=${enc}`
      );
      if (c.name) out.metaCampaignName = c.name;
    } catch { /* best-effort */ }
  }
  // Nombre del formulario (el token de Ads con ads_management puede leerlo).
  if (input.formId) {
    try {
      const f = await graphGet<{ name?: string }>(
        `${version}/${input.formId}?fields=name&access_token=${enc}`
      );
      if (f.name) out.metaFormName = f.name;
    } catch { /* best-effort */ }
  }
  return out;
}

function firstName(name?: string): string {
  if (!name) return '';
  return name.trim().split(/\s+/)[0] ?? '';
}

/** Normaliza una clave de campo: sin acentos, minúsculas. */
function normKey(k: string): string {
  return k.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Lee un campo del formulario tolerando nombres personalizados/idiomas: primero
 * por claves EXACTAS estándar de Meta; si no, busca una clave de CONTACTO (no
 * pregunta) que contenga alguno de los patrones (p.ej. "telefono" cae en
 * "número_de_teléfono", "nombre" en "nombre_completo"). Ignora las preguntas (con '?').
 */
function pickField(fields: Record<string, string>, exact: string[], patterns: string[]): string {
  for (const k of exact) if (fields[k]) return fields[k];
  for (const [key, val] of Object.entries(fields)) {
    if (!val || key.includes('?')) continue;   // saltar preguntas del formulario
    const nk = normKey(key);
    if (patterns.some((p) => nk.includes(p))) return val;
  }
  return '';
}

/** Resumen legible de las respuestas del formulario, para mostrar en el chat. */
function formSummary(fields: Record<string, string>): string {
  const labels: Record<string, string> = {
    full_name: 'Nombre', first_name: 'Nombre', last_name: 'Apellido',
    phone_number: 'Teléfono', email: 'Correo', city: 'Ciudad', company_name: 'Empresa',
  };
  const lines = Object.entries(fields)
    .filter(([, v]) => v)
    .map(([k, v]) => `• ${labels[k] ?? k.replace(/_/g, ' ')}: ${v}`);
  return `📋 *Nuevo lead de formulario (Meta Ads)*\n${lines.join('\n')}`;
}

/**
 * Procesa un envío de formulario de Meta: trae los datos, crea el lead con toda
 * su información y el anuncio de origen, deja constancia en el chat y —si hay
 * plantilla de bienvenida configurada— abre la conversación por WhatsApp.
 * Idempotente por `leadgen_id`.
 */
export async function processLeadgenEvent(value: LeadgenValue): Promise<void> {
  const leadgenId = value.leadgen_id;
  if (!leadgenId) return;

  const companyId = await resolveCompanyIdForChannel('meta', value.page_id);

  // Idempotencia: no procesar el mismo formulario dos veces.
  const dedupRef = db.collection('companies').doc(companyId)
    .collection('webhookEvents').doc(`leadgen_${leadgenId}`);
  try {
    await dedupRef.create({ leadgenId, processedAt: Timestamp.now(), expireAt: webhookEventExpireAt(), channel: 'meta_leadgen' });
  } catch {
    logger.warn('[MetaLeads] Formulario duplicado ignorado', { leadgenId });
    return;
  }

  // A partir de aquí el evento ya está "reclamado". Si algo falla, liberamos la
  // marca anti-duplicado (catch al final) para que el reintento automático de Meta
  // sí recupere este lead de pauta en vez de descartarlo como duplicado.
  try {
  if (!env.metaPageAccessToken()) {
    logger.warn('[MetaLeads] Sin META_PAGE_ACCESS_TOKEN — no se pueden traer los datos del formulario', { leadgenId });
    return;
  }

  const data = await fetchLeadgenData(leadgenId);

  // Autorregistrar el formulario (pauta) para que aparezca en la config y el
  // admin pueda asignarle su propia plantilla de bienvenida. Best-effort.
  if (data.form_id) {
    const formId = data.form_id;
    await leadFormsRepository
      .recordSeen(companyId, formId, () => fetchFormName(formId))
      .catch((err) => logger.warn('[MetaLeads] No se pudo registrar el formulario', {
        formId, error: err instanceof Error ? err.message : String(err),
      }));
  }

  // Nombre/teléfono tolerando campos personalizados en español (nombre_completo,
  // número_de_teléfono, correo_electrónico) además de los estándar de Meta.
  const name  = pickField(data.fields, ['full_name'], ['nombre', 'name'])
    || [data.fields.first_name, data.fields.last_name].filter(Boolean).join(' ')
    || undefined;
  const phoneRaw = pickField(data.fields, ['phone_number', 'phone'], ['telefono', 'celular', 'movil', 'whatsapp']);
  const phone    = phoneRaw ? (phoneRaw.startsWith('+') ? phoneRaw : `+${phoneRaw.replace(/\D/g, '')}`) : '';
  const normPhone = phone ? toNormalizedPhone(phone) : '';

  const now = Timestamp.now();

  // Atribución de la pauta: IDs + nombres legibles (best-effort con token de Ads).
  const adId = value.ad_id ?? data.ad_id ? String(value.ad_id ?? data.ad_id) : undefined;
  const attribution = await resolveAttributionNames({
    adId, campaignId: data.campaign_id, formId: data.form_id,
  });

  // Metadatos del lead: todas las respuestas + atribución de la pauta.
  const metadata: Record<string, string> = { ...data.fields };
  if (data.form_id)     metadata.metaFormId     = data.form_id;
  if (data.campaign_id) metadata.metaCampaignId = data.campaign_id;
  if (adId)             metadata.metaAdId       = adId;
  Object.assign(metadata, attribution);  // metaAdName, metaCampaignName, metaAdsetName, metaFormName

  // sourceMeta: adId + headline (nombre del anuncio) para que la ficha lo muestre.
  const sourceMeta = adId
    ? { adId, ...(attribution.metaAdName ? { headline: attribution.metaAdName } : {}) }
    : undefined;

  // Buscar lead existente por teléfono; si no, crearlo.
  let lead: Lead | null = normPhone
    ? await leadsRepository.findByNormalizedPhone(companyId, normPhone)
    : null;

  // Anti-duplicado: si el mismo número nacional (últimos 9 dígitos) ya existe —p.ej.
  // la persona escribió por WhatsApp segundos antes—, se une a ese lead en vez de
  // crear otro (típico del flujo "enviar por WhatsApp" tras el formulario).
  if (!lead && normPhone) {
    const tail = phoneTail(normPhone);
    if (tail) {
      const twin = await leadsRepository.findByPhoneTail(companyId, tail);
      if (twin) {
        lead = twin;
        logger.info('[MetaLeads] Formulario unido a lead existente por número nacional', {
          leadId: twin.id, tail, leadgenId,
        });
      }
    }
  }

  if (!lead) {
    lead = await leadsRepository.create(companyId, {
      companyId,
      phone,
      normalizedPhone: normPhone,
      ...(normPhone && phoneTail(normPhone) ? { phoneTail: phoneTail(normPhone) } : {}),
      name: name ?? (phone ? `Lead ${phone}` : 'Lead de formulario'),
      status: 'new',
      source: 'meta_ads',
      ...(sourceMeta ? { sourceMeta } : {}),
      inboxProvider: 'ycloud',
      aiEnabled: true,
      tags: [],
      metadata,
      createdAt: now,
      updatedAt: now,
    });
    logger.info('[MetaLeads] Lead de formulario creado', { leadId: lead.id, leadgenId, hasPhone: !!phone });
    lead.assignedTo = (await assignLead(companyId, lead.id)) ?? undefined;
    // Los leads de FORMULARIO se QUEDAN con el asesor que les tocó al entrar: NO
    // entran a la reasignación automática por falta de primer contacto (a
    // diferencia de WhatsApp/click-to-WhatsApp). Se apaga pendingFirstContact para
    // que processFirstContactReassignments los ignore.
    if (lead.assignedTo) {
      await leadsRepository.update(companyId, lead.id, { pendingFirstContact: false });
    }
  } else {
    await leadsRepository.update(companyId, lead.id, {
      metadata: { ...lead.metadata, ...metadata },
      ...(name && (!lead.name || lead.name.startsWith('Lead ')) ? { name } : {}),
    });
    logger.info('[MetaLeads] Formulario asociado a lead existente', { leadId: lead.id, leadgenId });
  }

  // Dejar constancia del formulario en el hilo del chat (mensaje de sistema).
  await messagesRepository.create({
    companyId,
    leadId:      lead.id,
    direction:   'inbound',
    senderType:  'system',
    content:     formSummary(data.fields),
    channel:     'whatsapp',
    status:      'delivered',
    aiProcessed: true, // no dispara IA (solo los mensajes 'lead' la disparan)
    createdAt:   now,
  });
  await leadsRepository.update(companyId, lead.id, {
    lastMessageText: '📋 Lead de formulario (Meta Ads)',
    lastMessageAt:   now,
  });

  // Abrir la conversación por WhatsApp con una plantilla de bienvenida (si existe).
  if (!phone) {
    logger.info('[MetaLeads] Formulario sin teléfono — no se puede iniciar WhatsApp', { leadId: lead.id });
    return;
  }
  // Plantilla de bienvenida: primero la específica de ESTE formulario (pauta);
  // si no tiene, la global por defecto (env META_LEAD_WELCOME_TEMPLATE).
  const mapping = data.form_id ? await leadFormsRepository.get(companyId, data.form_id) : null;
  const tplName = mapping?.templateName || env.metaLeadWelcomeTemplate();
  if (!tplName) {
    logger.info('[MetaLeads] Sin plantilla de bienvenida configurada — el asesor debe contactar al lead', { leadId: lead.id, formId: data.form_id });
    return;
  }
  const template = await templatesRepository.findByName(companyId, tplName);
  if (!template || template.status !== 'approved') {
    logger.warn('[MetaLeads] Plantilla de bienvenida no encontrada o no aprobada', { leadId: lead.id, tplName });
    return;
  }
  try {
    // Rellenar la PRIMERA variable del body con el nombre. Las plantillas
    // sincronizadas desde Meta/YCloud usan claves POSICIONALES ("1", "2"...), no
    // "nombre"; por eso hay que apuntar a template.variables[0].key además de
    // "nombre" (mismo patrón que el flujo de formulario web, webLeadIntake). Sin
    // esto el parámetro del body no se rellena: WhatsApp recibe la plantilla con
    // el placeholder {{1}} sin valor y Meta descarta el envío (no llega al lead).
    const nombre = firstName(name) || 'Hola';
    const variables: Record<string, string> = { nombre };
    const firstVar = template.variables[0];
    if (firstVar) variables[firstVar.key] = nombre;
    await sendTemplateToLead({
      companyId, lead, template, variables,
    });
    logger.info('[MetaLeads] Bienvenida enviada por WhatsApp al lead de formulario', { leadId: lead.id });
  } catch (err) {
    logger.warn('[MetaLeads] No se pudo enviar la bienvenida', {
      leadId: lead.id, error: err instanceof Error ? err.message : String(err),
    });
  }
  } catch (err) {
    // Falló el procesamiento tras reclamar el evento: liberamos la marca para que
    // el reintento automático de Meta pueda recuperar este lead de pauta.
    await dedupRef.delete().catch(() => { /* best-effort */ });
    throw err;
  }
}
