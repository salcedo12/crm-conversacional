import type { Message } from '../messages/messages.types';

/**
 * Mensaje del seguimiento del mismo día (texto libre, sin plantilla). Antes lo redactaba el
 * modelo y salía siempre parecido ("Espero que esté teniendo un buen día. Quería saber si ha
 * tenido la oportunidad de pensar en su inversión…") y casi nadie respondía. Ahora es fijo y
 * concreto según lo último que se le envió al cliente, con una sola pregunta fácil.
 */

const CLUB_FROM_PORTFOLIO: Array<[RegExp, string]> = [
  [/LAGUNA\s*MAR/i, 'Laguna Mar'],
  [/R[IÍ]O\s*CLARO/i, 'Río Claro'],
  [/CA[NÑ][OÓ]N|ARIZONA/i, 'Cañón de Arizona'],
  [/LLANO\s*GRANDE/i, 'Llano Grande'],
];

function clubFromPortfolio(m: Message): string | null {
  const text = `${String(m.metadata?.project ?? '')} ${String(m.metadata?.title ?? '')} ${m.content ?? ''}`;
  return CLUB_FROM_PORTFOLIO.find(([re]) => re.test(text))?.[1] ?? null;
}

export function buildSameDayFollowUp(firstName: string, history: Message[]): string {
  const hi = firstName ? `Hola, ${firstName} 😊` : 'Hola 😊';
  const aiMsgs = history.filter((m) => m.direction === 'outbound' && m.senderType === 'ai');
  const last = (origin: string) => [...aiMsgs].reverse().find((m) => m.metadata?.origin === origin);
  const lastIdx = (m?: Message) => (m ? aiMsgs.indexOf(m) : -1);

  const quote = last('ai_cotizacion');
  const plano = last('ai_plano');
  const brochure = last('ai_portafolio');
  const newest = [quote, plano, brochure].sort((a, b) => lastIdx(b) - lastIdx(a))[0];

  if (newest && newest === quote) {
    const terreno = String(quote.metadata?.terreno ?? '').trim();
    const sector = String(quote.metadata?.sector ?? '').trim();
    const which = terreno ? `del terreno ${terreno}${sector ? ` de ${sector}` : ''}` : 'que le envié';
    return `${hi} ¿Pudo revisar la cotización ${which}? Si prefiere otro plazo o pagarlo de contado, con gusto se la ajusto.`;
  }
  if (newest && newest === plano) {
    const stage = String(plano.metadata?.stageName ?? plano.metadata?.projectName ?? '').trim();
    return `${hi} ¿Le llamó la atención algún terreno del plano${stage ? ` de ${stage}` : ''}? ` +
      'Dígame el número y se lo cotizo con el bono de $20 millones ya incluido.';
  }
  if (newest && newest === brochure) {
    const club = clubFromPortfolio(brochure);
    return club
      ? `${hi} ¿Pudo ver el brochure de ${club}? Si quiere, le envío el plano con los terrenos disponibles para que elija uno y se lo cotizo.`
      : `${hi} ¿Pudo ver nuestro portafolio? Con gusto le comparto el de la zona que más le guste: Melgar, Alvarado o Mariquita.`;
  }
  if (aiMsgs.some((m) => (m.content ?? '').includes('Con mucho gusto le comparto los precios'))) {
    return `${hi} Quedo pendiente para compartirle los precios del club que más le convenga. ¿Desde qué ciudad nos escribe?`;
  }
  return `${hi} Le escribo por su interés en nuestros terrenos campestres en el Tolima. ` +
    '¿Le comparto el brochure y los precios de Melgar, Alvarado o Mariquita?';
}
