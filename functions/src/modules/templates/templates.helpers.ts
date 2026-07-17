import type { YcloudTemplateComponent, YcloudTemplateButton } from '../../integrations/ycloud/ycloud.client';
import type { WhatsAppTemplate, TemplateButton, TemplateHeaderType } from './templates.types';

/** Mapea el estado de ycloud/Meta al estado interno de la plantilla. */
export function mapYcloudStatus(status?: string): WhatsAppTemplate['status'] {
  switch (status) {
    case 'APPROVED': return 'approved';
    case 'REJECTED': return 'rejected';
    case 'PENDING':
    case 'IN_APPEAL': return 'pending';
    default:          return 'pending';
  }
}

/** Mapea el `format` del HEADER de ycloud al tipo interno. */
export function ycloudHeaderType(format?: string): TemplateHeaderType {
  switch (format) {
    case 'TEXT':     return 'text';
    case 'IMAGE':    return 'image';
    case 'VIDEO':    return 'video';
    case 'DOCUMENT': return 'document';
    default:         return 'none';
  }
}

/** Campos que necesita el builder de creación (subconjunto de la plantilla). */
export interface CreateComponentsFields {
  header?:         string;
  headerType?:     TemplateHeaderType;
  headerMediaUrl?: string;
  body:            string;
  footer?:         string;
  buttons?:        TemplateButton[];
  variables:       { key: string; example: string }[];
}

/**
 * Construye los components para crear una plantilla en ycloud (formato Meta).
 * Las variables nombradas {{nombre}} se convierten a posicionales {{1}}, {{2}}
 * en el orden en que aparecen en `variables`.
 */
export function buildYcloudCreateComponents(fields: CreateComponentsFields): YcloudTemplateComponent[] {
  const components: YcloudTemplateComponent[] = [];

  // ── HEADER ──────────────────────────────────────────────────────────────
  const headerType = fields.headerType ?? (fields.header ? 'text' : 'none');

  if (headerType === 'text' && fields.header) {
    components.push({ type: 'HEADER', format: 'TEXT', text: fields.header });
  } else if (headerType === 'image' || headerType === 'video' || headerType === 'document') {
    if (fields.headerMediaUrl) {
      components.push({
        type:    'HEADER',
        format:  headerType.toUpperCase() as 'IMAGE' | 'VIDEO' | 'DOCUMENT',
        example: { header_url: [fields.headerMediaUrl] },
      });
    }
  }

  // ── BODY (variables {{nombre}} → {{1}}, {{2}}) ────────────────────────────
  let body = fields.body;
  fields.variables.forEach((v, i) => {
    body = body.split(`{{${v.key}}}`).join(`{{${i + 1}}}`);
  });

  const bodyComp: YcloudTemplateComponent = { type: 'BODY', text: body };
  if (fields.variables.length > 0) {
    bodyComp.example = {
      body_text: [fields.variables.map((v) => v.example || v.key)],
    };
  }
  components.push(bodyComp);

  // ── FOOTER ────────────────────────────────────────────────────────────────
  if (fields.footer) {
    components.push({ type: 'FOOTER', text: fields.footer });
  }

  // ── BUTTONS ─────────────────────────────────────────────────────────────
  if (fields.buttons && fields.buttons.length > 0) {
    const buttons: YcloudTemplateButton[] = fields.buttons.map((b) => {
      switch (b.type) {
        case 'URL':
          return { type: 'URL', text: b.text, url: b.url };
        case 'PHONE_NUMBER':
          return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phoneNumber };
        case 'COPY_CODE':
          return { type: 'COPY_CODE', example: [b.text || '12345'] };
        case 'QUICK_REPLY':
        default:
          return { type: 'QUICK_REPLY', text: b.text };
      }
    });
    components.push({ type: 'BUTTONS', buttons });
  }

  return components;
}

/**
 * Construye los components de ENVÍO (formato Meta, type en minúscula) ordenando
 * los parámetros del body según el orden de `template.variables`, que coincide
 * con las posiciones {{1}}, {{2}} de la plantilla aprobada.
 *
 * Nota: los botones estáticos (quick reply, URL fija, teléfono, copy code) NO
 * requieren parámetros al enviar — se renderizan automáticamente.
 */
export function buildPositionalComponents(
  template:  WhatsAppTemplate,
  variables: Record<string, string>
): { type: 'header' | 'body'; parameters: unknown[] }[] {
  const components: { type: 'header' | 'body'; parameters: unknown[] }[] = [];

  // ── Header con media ──────────────────────────────────────────────────────
  const headerType = template.headerType
    ?? (template.header?.startsWith('http') ? 'image' : 'none');
  const mediaUrl = template.headerMediaUrl
    ?? (template.header?.startsWith('http') ? template.header : undefined);

  if ((headerType === 'image' || headerType === 'video' || headerType === 'document') && mediaUrl) {
    const mediaObj: Record<string, string> = { link: mediaUrl };
    // Para documentos, el filename es el título que muestra WhatsApp.
    if (headerType === 'document') {
      mediaObj.filename = template.headerMediaFilename
        || `${template.displayName || 'documento'}.pdf`;
    }
    components.push({
      type:       'header',
      parameters: [{ type: headerType, [headerType]: mediaObj }],
    });
  }

  // ── Body ──────────────────────────────────────────────────────────────────
  const bodyParams = template.variables.map((v) => ({
    type: 'text',
    text: String(variables[v.key] ?? v.example ?? ''),
  }));

  if (bodyParams.length > 0) {
    components.push({ type: 'body', parameters: bodyParams });
  }

  return components;
}
