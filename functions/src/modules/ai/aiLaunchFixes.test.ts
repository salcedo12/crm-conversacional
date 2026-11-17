import { describe, expect, it } from 'vitest';
import { detectAppointmentModality, leadPreferredModality } from './aiOrchestrator.service';
import { buildConfirmation, buildReminder2h, buildReminder30m } from '../appointments/appointmentMessages';
import { bogotaDay, sumUsage } from './aiUsage.service';
import { detectsTransferKeyword } from './aiContext.service';

describe('modalidad de la cita', () => {
  it('detecta lo que pide el cliente', () => {
    expect(detectAppointmentModality('1 por Meet')).toBe('videollamada');
    expect(detectAppointmentModality('mejor una videollamada')).toBe('videollamada');
    expect(detectAppointmentModality('prefiero que me llamen')).toBe('llamada');
    expect(detectAppointmentModality('1')).toBeNull();
    expect(leadPreferredModality(['quiero por meet', '2'])).toBe('videollamada');
    expect(leadPreferredModality(['hola', '2'])).toBeNull();
  });
  it('los mensajes dicen lo mismo que la modalidad', () => {
    const start = new Date('2026-11-10T20:30:00Z');
    expect(buildConfirmation('Meraki', 'Ana', start)).toMatch(/llamada telefónica/);
    expect(buildConfirmation('Meraki', 'Ana', start)).not.toMatch(/enlace/);
    expect(buildConfirmation('Meraki', 'Ana', start, 'videollamada')).toMatch(/Google Meet/);
    expect(buildReminder2h('Meraki', 'Ana', start)).not.toMatch(/videollamada/);
    expect(buildReminder30m('Ana', 'https://meet.google.com/x', 'llamada')).not.toMatch(/meet\.google/);
    expect(buildReminder30m('Ana', 'https://meet.google.com/x', 'videollamada')).toMatch(/meet\.google/);
  });
});

describe('consumo y traspaso', () => {
  it('suma el uso del turno y usa el día de Bogotá', () => {
    expect(sumUsage([{ prompt_tokens: 10, completion_tokens: 2 }, undefined, { prompt_tokens: 5 }])).toEqual({ calls: 2, input: 15, output: 2 });
    expect(bogotaDay(new Date('2026-11-10T03:00:00Z'))).toBe('2026-11-09');
  });
  it('preguntar por el asesor de la cita no es pedir traspaso', () => {
    const k = ['hablar con un asesor', 'quiero un asesor', 'persona real'];
    expect(detectsTransferKeyword('¿Cuándo me llama el asesor?', k)).toBe(false);
    expect(detectsTransferKeyword('Quiero hablar con un asesor', k)).toBe(true);
  });
});

import { leadChosePaymentTerm } from './aiOrchestrator.service';
describe('todas las modalidades', () => {
  it('"dame todas las opciones" autoriza cotizar contado y plazos', () => {
    expect(leadChosePaymentTerm(['Dame todas las opciones'], 'efectivo')).toBe(true);
    expect(leadChosePaymentTerm(['contado y a plazos'], 'cuotas', 30)).toBe(true);
    expect(leadChosePaymentTerm(['si por favor'], 'cuotas', 30)).toBe(false);
  });
});

import { brochureClubChoice } from './aiOrchestrator.service';
describe('brochure por municipio o club', () => {
  it('elige el club del brochure', () => {
    expect(brochureClubChoice('Mariquita')).toBe('Río Claro');
    expect(brochureClubChoice('Melgar')).toBe('Laguna Mar');
    expect(brochureClubChoice('me interesa Cañón')).toBe('Cañón de Arizona');
    expect(brochureClubChoice('Alvarado')).toBeNull();
    expect(brochureClubChoice('Sobre Montañas')).toBeNull();
  });
});

import { buildEventDescription, buildEventTitle, retitleForModality } from '../appointments/appointmentMessages';

describe('modalidad visible en el título de la cita', () => {
  it('agrega la modalidad al título y la cambia sin duplicar', () => {
    expect(buildEventTitle('Ana', 'llamada')).toBe('Cita con Ana · Llamada');
    expect(buildEventTitle('Ana', 'videollamada')).toBe('Cita con Ana · Videollamada Meet');
    expect(buildEventTitle('Ana')).toBe('Cita con Ana');
    expect(retitleForModality('Cita con Ana · Llamada', 'videollamada')).toBe('Cita con Ana · Videollamada Meet');
    expect(retitleForModality('Cita con Ana', 'llamada')).toBe('Cita con Ana · Llamada');
  });

  it('la descripción del evento dice cómo contactar al cliente', () => {
    const d = buildEventDescription('Meraki', 'Ana', true, { phone: '+573001112233', modality: 'llamada' });
    expect(d).toContain('llamada telefónica');
    expect(d).toContain('+573001112233');
    expect(buildEventDescription('Meraki', 'Ana', false, { modality: 'videollamada' })).toContain('Google Meet');
  });
});

import { leadMentionedPaymentTerm } from './aiOrchestrator.service';

describe('cotización a 40 meses si no dijo la forma de pago', () => {
  it('detecta cuándo el lead ya habló de forma de pago', () => {
    expect(leadMentionedPaymentTerm(['me gusta el 88'])).toBe(false);
    expect(leadMentionedPaymentTerm(['qué precio tiene el 23'])).toBe(false);
    expect(leadMentionedPaymentTerm(['lo quiero de contado'])).toBe(true);
    expect(leadMentionedPaymentTerm(['a 30 meses'])).toBe(true);
    expect(leadMentionedPaymentTerm(['a veinticuatro meses'])).toBe(true);
    expect(leadMentionedPaymentTerm(['en 36 cuotas'])).toBe(true);
  });
});

describe('voz: horas y fechas habladas', () => {
  it('lee a. m. / p. m. como palabras y quita el año', async () => {
    const { cleanTextForSpeech } = await import('./voiceSynthesis.service');
    const slots = 'Tengo disponibles estos horarios para la llamada:\n\n1. martes, 10 de noviembre de 2026, 1:00 p. m.\n2. martes, 10 de noviembre de 2026, 1:30 p. m.\n3. miércoles, 11 de noviembre de 2026, 9:15 a. m.';
    expect(cleanTextForSpeech(slots)).toBe(
      'Tengo disponibles estos horarios para la llamada: 1, martes, 10 de noviembre, la una de la tarde. 2, martes, 10 de noviembre, la una y media de la tarde. 3, miércoles, 11 de noviembre, las nueve y cuarto de la mañana');
    expect(cleanTextForSpeech('Su cita es a las 3:45 pm')).toBe('Su cita es a las tres y 45 de la tarde');
    expect(cleanTextForSpeech('a la 1 p.m. o a las 12:00 p. m. o 7:00 p. m.')).toBe('a la una de la tarde o a las doce del mediodía o las siete de la noche');
    expect(cleanTextForSpeech('Lo llamo a mediados de mes, a mí me sirve')).toBe('Lo llamo a mediados de mes, a mí me sirve');
  });
});

describe('no le interesa: pregunta el motivo una vez', () => {
  it('distingue "no me escriban" de un "no me interesa" sin motivo', async () => {
    const m = await import('./aiOrchestrator.service');
    expect(m.detectsOptOut('no me vuelvan a escribir')).toBe(true);
    expect(m.detectsOptOut('borren mi numero')).toBe(true);
    expect(m.detectsOptOut('no me interesa')).toBe(false);
    expect(m.detectsPlainNoInterest('No gracias, ya no me interesa')).toBe(true);
    expect(m.detectsPlainNoInterest('no me interesa Río Claro')).toBe(false);
    expect(m.noInterestReasonQuestion('Luz')).toMatch(/^Entiendo, Luz, gracias por contarme\. ¿Me podría decir el motivo\?/);
    expect(m.noInterestReasonQuestion('')).toMatch(/^Entiendo, gracias/);
    expect(Object.keys(m.NO_INTEREST_LABELS)).toEqual(['precio', 'ubicacion', 'competencia', 'tiempo', 'no_califica', 'atencion', 'otro']);
  });
});

describe('bienvenida y leads del exterior', () => {
  it('detecta números de fuera de Colombia y dice el país solo si es seguro', async () => {
    const m = await import('./aiOrchestrator.service');
    expect(m.isForeignPhone('+12038183786')).toBe(true);
    expect(m.isForeignPhone('+34612345678')).toBe(true);
    expect(m.isForeignPhone('+573143144946')).toBe(false);
    expect(m.isForeignPhone('3143144946')).toBe(false);
    expect(m.isForeignPhone(undefined)).toBe(false);
    expect(m.abroadPhrase('+12038183786')).toBe('desde el exterior');
    expect(m.abroadPhrase('+34612345678')).toBe('desde España');
    expect(m.abroadPhrase('+50761234567')).toBe('desde Panamá');
  });
  it('la nota de voz corta saluda sin preguntar el municipio', async () => {
    const m = await import('./aiOrchestrator.service');
    const short = m.buildVictoriaWelcomeSpeech({ name: 'Rocio', source: 'meta_ads' } as never, true);
    expect(short).not.toMatch(/\?/);
    expect(short).toMatch(/ya mismo le respondo por aquí/);
    expect(m.buildVictoriaWelcomeSpeech({ name: 'Rocio', source: 'meta_ads' } as never)).toMatch(/municipios le gustaría invertir/);
    expect(m.VICTORIA_DATA_NOTICE).not.toMatch(/Hola|Victoria/);
  });
});

describe('nombre para saludar y rango de áreas', () => {
  it('solo saluda con nombres de persona conocidos', async () => {
    const { personFirstName } = await import('./personName');
    expect(personFirstName('Dios Bendiga Mi Familia 😇')).toBe('');
    expect(personFirstName('Confecciones LALA INNOVA')).toBe('');
    expect(personFirstName('ApuRito')).toBe('');
    expect(personFirstName('FAMAFORI')).toBe('');
    expect(personFirstName('🤪😝 Luz Mora')).toBe('Luz');
    expect(personFirstName('Germán')).toBe('Germán');
    expect(personFirstName('ANDRÉS HERNÁNDEZ')).toBe('Andrés');
    expect(personFirstName('linda....💕')).toBe('Linda');
    expect(personFirstName('Lead 3001234567')).toBe('');
  });
  it('un terreno atípico no se muestra como tope del rango', async () => {
    const { availableAreaRange } = await import('./quoteInventory');
    const lots = (areas: number[]) => areas.map((a, i) => ({ n: String(i), sec: '', s: 'DISPONIBLE', a }));
    expect(availableAreaRange(lots([292.84, 300, 310, 320, 350, 380, 400, 419, 419, 737, 6000, 6000]))).toBe('desde unos 293 m²');
    expect(availableAreaRange(lots([313, 400, 500, 612, 700, 822, 1565, 1833, 1962, 2315]))).toBe('de 313 m² a 2.315 m²');
  });
});

describe('solo agradece', () => {
  it('reconoce agradecimientos y confirmaciones sin pregunta', async () => {
    const { isCourtesyOnly } = await import('./aiOrchestrator.service');
    for (const t of ['Muchas gracias', 'Gracias.', 'Voy a revisarlo.', 'Ok, gracias', 'Listo, lo reviso', '👍', 'Muy amable, bendiciones']) {
      expect(isCourtesyOnly(t)).toBe(true);
    }
    for (const t of ['Gracias, ¿y el precio?', 'Melgar', 'Sí', 'gracias, quiero ver el plano', 'Gracias pero no me interesa']) {
      expect(isCourtesyOnly(t)).toBe(false);
    }
  });
});

describe('seguimientos', () => {
  it('solo salen entre 8 a. m. y 8 p. m. de Bogotá', async () => {
    const { nextAllowedFollowUpTime } = await import('../../scheduled/processFollowUps');
    const bog = (iso: string) => Date.parse(`${iso}-05:00`);
    expect(nextAllowedFollowUpTime(bog('2026-11-12T10:00:00'))).toBeNull();
    expect(nextAllowedFollowUpTime(bog('2026-11-12T04:28:00'))).toBe(bog('2026-11-12T08:00:00'));
    expect(nextAllowedFollowUpTime(bog('2026-11-12T21:15:00'))).toBe(bog('2026-11-13T08:00:00'));
    expect(nextAllowedFollowUpTime(bog('2026-11-12T19:59:00'))).toBeNull();
  });
  it('nombre de la plantilla filtrado', async () => {
    const { followUpGreetingName } = await import('../../scheduled/processFollowUps');
    expect(followUpGreetingName('🤪😝 Luz Mora')).toBe('Luz');
    expect(followUpGreetingName('casimorezz23')).toBe('nuevamente');
    expect(followUpGreetingName('FAMAFORI')).toBe('nuevamente');
  });
  it('SÍ / NO a la plantilla', async () => {
    const { templateYesNo } = await import('./aiOrchestrator.service');
    expect(templateYesNo('SÍ')).toBe('si');
    expect(templateYesNo('Si por favor')).toBe('si');
    expect(templateYesNo('No')).toBe('no');
    expect(templateYesNo('No gracias')).toBe('no');
    expect(templateYesNo('si, pero quiero saber el precio de melgar')).toBeNull();
    expect(templateYesNo('Melgar')).toBeNull();
  });
});

describe('texto automático de precios del anuncio', () => {
  it('lo reconoce y responde sin cifras con una sola pregunta', async () => {
    const m = await import('./aiOrchestrator.service');
    expect(m.isAdPrefilledPriceRequest('Hola, quiero conocer precios de los lotes. Ref. USA-LEE')).toBe(true);
    expect(m.isAdPrefilledPriceRequest('Hola, quiero conocer precios de los lotes. Ref. MI-USA-02')).toBe(true);
    expect(m.isAdPrefilledPriceRequest('Hola, quiero conocer precios de los lotes.')).toBe(true);
    expect(m.isAdPrefilledPriceRequest('¿Cuánto vale un lote en Melgar?')).toBe(false);
    expect(m.isAdPrefilledPriceRequest('¡Hola! Quiero más información.')).toBe(false);
    const ext = m.buildPriceHoldReply('', 'desde el exterior');
    expect(ext).toBe('Qué bueno que nos escriba desde el exterior 😊 Con mucho gusto le comparto los precios. Para recomendarle el terreno que mejor se ajuste a lo que busca, ¿me cuenta con quién tengo el gusto y desde qué ciudad nos escribe?');
    expect(m.buildPriceHoldReply('Rocio', null)).toBe('Con mucho gusto le comparto los precios, Rocio 😊 Para recomendarle el terreno que mejor se ajuste a lo que busca, ¿me cuenta desde qué ciudad nos escribe?');
    expect(ext).not.toMatch(/\$|millones/);
  });
});

describe('cuando el lead dice que no', () => {
  it('casos reales de Jorge y Jeison', async () => {
    const m = await import('./aiOrchestrator.service');
    expect(m.detectsDeclineCue('A q pena no quiero para este lado')).toBe(true);
    expect(m.detectsDeclineCue('No gracias')).toBe(true);
    expect(m.detectsDeclineCue('Está muy caro')).toBe(true);
    expect(m.detectsDeclineCue('Melgar por favor')).toBe(false);
    expect(m.detectsDeclineCue('Voy a revisarlo')).toBe(false);
    expect(m.lastAiOfferedCita('Para ver las opciones de pago y separarlo, lo mejor es una llamada con un asesor. ¿Le gustaría que la agendemos?')).toBe(true);
    expect(m.lastAiOfferedCita('¿Le gustaría revisar el plano de disponibilidad?')).toBe(false);
    expect(m.isFarewellReply('Entiendo, gracias por su tiempo 😊 Si más adelante desea retomar la información del terreno en Laguna Mar, con gusto le atenderé.')).toBe(true);
    expect(m.isFarewellReply('Entiendo, Jorge. Gracias por avisarme 😊 Si más adelante desea conocer opciones de terrenos en otra zona, con gusto le brindaré información. Quedo atenta para ayudarle.')).toBe(true);
    expect(m.isFarewellReply('¿Le gustaría revisar el plano?')).toBe(false);
    expect(m.inferNoInterestCategory(['A q pena no quiero para este lado', 'Si gracias'])).toBe('ubicacion');
    expect(m.inferNoInterestCategory(['muy caro'])).toBe('precio');
    expect(m.inferNoInterestCategory(['por ahora no'])).toBe('tiempo');
  });
});

describe('calificación inmediata', () => {
  it('reconoce proveedores sin confundir compradores', async () => {
    const m = await import('./aiOrchestrator.service');
    expect(m.detectsVendorPitch('Hola, buen día. Le escribo de ConnextData para *Grupo Constructor Meraki*. Apoyamos a constructoras en la primera asamblea de sus proyectos al entregar la propiedad horizontal, todo en una sola plataforma')).toBe(true);
    expect(m.detectsVendorPitch('Buenas, somos una empresa de marketing digital y queremos ofrecerles nuestros servicios de publicidad para sus proyectos')).toBe(true);
    expect(m.detectsVendorPitch('Hola, le escribo de Bogotá, quiero información de los lotes en Melgar')).toBe(false);
    expect(m.detectsVendorPitch('Quiero saber qué servicios tienen los terrenos de Río Claro y el precio')).toBe(false);
  });
  it('agradecimientos que no reviven un lead perdido', async () => {
    const m = await import('./aiOrchestrator.service');
    for (const t of ['Muy amable señorita', 'Gracias a ti', 'Dios le bendiga', 'Bendiciones', '🙏']) expect(m.isCourtesyOnly(t)).toBe(true);
    expect(m.isCourtesyOnly('Hola, quiero retomar lo del lote')).toBe(false);
  });
  it('objeciones de presupuesto con otras palabras', async () => {
    const { detectsBudgetObjection } = await import('./aiFicha.service');
    for (const t of ['Ok gracias, se me sale del presupuesto muy amable', 'Tengo un presupuesto máximo de 30 millones', 'Que pena se sale de mi presupuesto', 'Buen dia, no me alcaza el presupuesto']) {
      expect(detectsBudgetObjection(t)).toBe(true);
    }
    expect(detectsBudgetObjection('Melgar por favor')).toBe(false);
  });
});

describe('ronda 17-nov', () => {
  it('no cotiza un terreno que el lead no nombró (caso peña)', async () => {
    const m = await import('./aiOrchestrator.service');
    expect(m.leadNamedLot('21', ['Y Precios', 'Pero ese no es libre para construir la casa'])).toBe(false);
    expect(m.leadNamedLot('88', ['88 o 212'])).toBe(true);
    expect(m.leadNamedLot('20', ['El 20 y el 61 que área y precios tienen'])).toBe(true);
    expect(m.leadNamedLot('471', ['Un terreno de 471 metros que precio'])).toBe(false);
    expect(m.leadNamedLot('30', ['Tengo un presupuesto máximo de 30 millones'])).toBe(false);
  });
  it('áreas en m² y enlace oficial', async () => {
    const m = await import('./aiOrchestrator.service');
    expect(m.mentionsAreaNotLot('Y el valor de uno de 400 o 500')).toBe(true);
    expect(m.mentionsAreaNotLot('Un terreno de 471 metros que precio')).toBe(true);
    expect(m.mentionsAreaNotLot('El 294')).toBe(false);
    expect(m.fixMerakiLinks('vea https://grupoconstructormeraki.co.uk/proyectos/laguna-mar')).toBe('vea https://grupoconstructormeraki.com.co/proyectos/laguna-mar');
    expect(m.fixMerakiLinks('https://grupoconstructormeraki.com.co/referidos')).toBe('https://grupoconstructormeraki.com.co/referidos');
  });
  it('seguimiento del mismo día según lo último enviado', async () => {
    const { buildSameDayFollowUp } = await import('./followUpText');
    const ai = (origin: string, metadata: Record<string, unknown>, content = '') => ({ direction: 'outbound', senderType: 'ai', content, metadata: { origin, ...metadata } }) as never;
    expect(buildSameDayFollowUp('Luz', [ai('ai_portafolio', { project: 'LAGUNA MAR', title: 'PORTAFOLIO LAGUNA MAR' })]))
      .toBe('Hola, Luz 😊 ¿Pudo ver el brochure de Laguna Mar? Si quiere, le envío el plano con los terrenos disponibles para que elija uno y se lo cotizo.');
    expect(buildSameDayFollowUp('', [ai('ai_portafolio', { project: 'LAGUNA MAR' }), ai('ai_plano', { stageName: 'Mar Santorini' })]))
      .toMatch(/^Hola 😊 ¿Le llamó la atención algún terreno del plano de Mar Santorini\?/);
    expect(buildSameDayFollowUp('Juan', [ai('ai_plano', { stageName: 'Mar Santorini' }), ai('ai_cotizacion', { terreno: '20', sector: 'Mar Santorini' })]))
      .toMatch(/cotización del terreno 20 de Mar Santorini/);
    expect(buildSameDayFollowUp('', [])).toMatch(/Melgar, Alvarado o Mariquita\?$/);
  });
});
