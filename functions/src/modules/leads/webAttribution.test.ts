import { describe, it, expect } from 'vitest';
import { parseWebRefTag, webAttributionToMetadata, resolveTrafficOrigin } from './webAttribution';

/**
 * Simula lo que hace el botón de WhatsApp de la web: añade el tag [meraki-ref:…]
 * al final del texto precargado SOLO si el visitante llegó con señal de pauta.
 * Es la contraparte de `buildRefTag()` en Merakipage/WhatsAppMenu.tsx.
 */
function buildButtonText(area: string, attrib: Record<string, string>): string {
  const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid'];
  const parts = keys.filter((k) => attrib[k]).map((k) => `${k}=${attrib[k]}`);
  const tag = parts.length ? `\n\n[meraki-ref: ${parts.join('&')}]` : '';
  return `Hola, me gustaría hablar con el área de ${area}${tag}`;
}

describe('atribución del botón de WhatsApp de la web (round-trip web → CRM)', () => {
  it('lead de pauta de Meta: parsea, limpia el chat y mapea a metadata de la ficha', () => {
    const text = buildButtonText('Ventas', {
      utm_source: 'facebook',
      utm_medium: 'cpc',
      utm_campaign: 'lotes-melgar',
      utm_content: 'video-anuncio1',
      fbclid: 'IwAR123abc',
    });

    const { attribution, cleanText } = parseWebRefTag(text);
    // El asesor NO debe ver el tag en el chat.
    expect(cleanText).toBe('Hola, me gustaría hablar con el área de Ventas');
    expect(cleanText).not.toContain('meraki-ref');

    // La ficha del lead ("Origen del tráfico") lee estas claves.
    const meta = webAttributionToMetadata(attribution);
    expect(meta).toMatchObject({
      webUtmSource: 'facebook',
      webUtmCampaign: 'lotes-melgar',
      webUtmContent: 'video-anuncio1',
      webFbclid: 'IwAR123abc',
      webCameFrom: 'Meta (Facebook/Instagram)',
    });
  });

  it('lead de Google Ads: gclid ⇒ "Vino de: Google"', () => {
    const text = buildButtonText('Ventas', { utm_source: 'google', gclid: 'Cj0KxyZ' });
    const { attribution, cleanText } = parseWebRefTag(text);
    expect(cleanText).toBe('Hola, me gustaría hablar con el área de Ventas');
    expect(webAttributionToMetadata(attribution)).toMatchObject({
      webUtmSource: 'google',
      webGclid: 'Cj0KxyZ',
      webCameFrom: 'Google',
    });
  });

  it('tráfico orgánico: sin tag, mensaje intacto y sin metadata de atribución', () => {
    const text = buildButtonText('Ventas', {});
    expect(text).not.toContain('meraki-ref');
    const { attribution, cleanText } = parseWebRefTag(text);
    expect(cleanText).toBe(text);
    expect(attribution).toEqual({});
    expect(webAttributionToMetadata(attribution)).toEqual({});
  });

  it('ignora claves no permitidas y valores vacíos dentro del tag', () => {
    const text = 'Hola, me gustaría hablar con el área de Ventas\n\n[meraki-ref: utm_source=facebook&evil=hack&utm_term=]';
    const { attribution } = parseWebRefTag(text);
    expect(attribution).toEqual({ utm_source: 'facebook' });
  });

  it('resolveTrafficOrigin detecta Meta por Instagram y cae a utm_source si no reconoce', () => {
    expect(resolveTrafficOrigin({ utm_source: 'instagram' })).toBe('Meta (Facebook/Instagram)');
    expect(resolveTrafficOrigin({ utm_source: 'newsletter' })).toBe('newsletter');
    expect(resolveTrafficOrigin({})).toBeUndefined();
  });
});
