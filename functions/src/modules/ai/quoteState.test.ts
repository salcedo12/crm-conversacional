import { describe, expect, it } from 'vitest';
import { checkLotInInventory, deriveQuoteState, isShortFollowUp, parseLotReply, parsePaymentReply, type ChatTurn } from './quoteState';
import { promisesQuote, shouldAnswerAfterVoiceWelcome } from './aiOrchestrator.service';

const ASK_LOT = '¿En cuál terreno y sector está interesado? 😊';
const ASK_PAY = 'El terreno 228 corresponde a la etapa *Mar Santorini*. ¿Prefiere recibir una cotización con pago de contado o a plazos? Si elige cuotas, puede escoger 20, 30 o 40 meses.';
const lead = (text: string): ChatTurn => ({ from: 'lead', text });
const ai = (text: string, origin?: string): ChatTurn => ({ from: 'ai', text, origin });

describe('estado de la cotización (conversación real de Prueba IA)', () => {
  const start: ChatTurn[] = [lead('Melgar'), ai('', 'ai_portafolio'), ai('', 'ai_plano'), ai(ASK_LOT)];

  it('"228" tras el plano es el terreno', () => {
    const s = deriveQuoteState([...start, lead('228')]);
    expect(s).toMatchObject({ terreno: '228', pago: null, lotThisTurn: true });
  });

  it('"30" tras la pregunta de pago es la forma de pago, no un terreno', () => {
    const s = deriveQuoteState([...start, lead('228'), ai(ASK_PAY), lead('30')]);
    expect(s).toMatchObject({ terreno: '228', pago: 'cuotas', meses: 30, paymentThisTurn: true });
  });

  it('"3" tras "¿qué otro terreno?" cambia el terreno y conserva la forma de pago', () => {
    const s = deriveQuoteState([...start, lead('228'), ai(ASK_PAY), lead('30'),
      ai('El terreno 228 de *Mar Santorini* ya fue vendido. Con gusto le genero la cotización a 30 meses. ¿Qué otro terreno le interesa?'), lead('3')]);
    expect(s).toMatchObject({ terreno: '3', pago: 'cuotas', meses: 30, quoted: false, lotThisTurn: true });
  });

  it('tras cotizar queda marcado; un plano nuevo y "30 verde" abren otro terreno', () => {
    const quoted = [...start, lead('8'), ai(ASK_PAY), lead('30'), ai('', 'ai_cotizacion'), ai('Te compartí la cotización del terreno 8')];
    expect(deriveQuoteState(quoted).quoted).toBe(true);
    const s = deriveQuoteState([...quoted, lead('Si'), ai('', 'ai_plano'), ai(ASK_LOT), lead('30 verde')]);
    expect(s).toMatchObject({ terreno: '30', color: 'VERDE', pago: 'cuotas', meses: 30, quoted: false, lotThisTurn: true });
  });

  it('el "1" de la lista de horarios no es un terreno', () => {
    const s = deriveQuoteState([...start, lead('8'), ai('Tengo disponibles estos horarios para la llamada: 1. lunes 3:30 p. m.'), lead('1')]);
    expect(s.terreno).toBe('8');
  });

  it('"Si 30 mesas" y "A 30" tras confirmar el plazo', () => {
    expect(parsePaymentReply('Si 30 mesas', 'algo')).toEqual({ pago: 'cuotas', meses: 30 });
    expect(parsePaymentReply('A 30', '¿es correcto que desea *pago a plazos a 30 meses*?')).toEqual({ pago: 'cuotas', meses: 30 });
    expect(parsePaymentReply('30', '¿Qué otro terreno le interesa?')).toBeNull();
    expect(parsePaymentReply('de contado', '')).toEqual({ pago: 'contado' });
  });

  it('reconoce terrenos escritos de varias formas', () => {
    expect(parseLotReply('el 59 rojo')).toEqual({ terreno: '59', color: 'ROJO' });
    expect(parseLotReply('Terreno 07')).toEqual({ terreno: '7', color: null });
    expect(parseLotReply('me interesa el 216')).toEqual({ terreno: '216', color: null });
    expect(parseLotReply('Cuando entregan el proyecto?')).toBeNull();
  });

  it('respuestas cortas de seguimiento', () => {
    for (const t of ['Ok', 'Si', 'listo', 'Y dónde está cuál es el precio?']) expect(isShortFollowUp(t)).toBe(true);
    expect(isShortFollowUp('Manejan escrituras individuales?')).toBe(false);
  });
});

describe('terreno en el inventario', () => {
  const lots = [
    { n: '228', sec: 'MAR SANTORINI', s: 'VENDIDO', a: 300 },
    { n: '228', sec: 'MAR CANARIAS', s: 'DISPONIBLE', a: 610 },
    { n: '229', sec: 'MAR SANTORINI', s: 'DISPONIBLE', a: 300 },
    { n: '221', sec: 'MAR SANTORINI', s: 'DISPONIBLE', a: 300 },
    { n: '3', sec: 'MAR SANTORINI', s: 'DISPONIBLE', a: 330 },
    { n: '30', sec: 'RIO MEDINA', s: 'DISPONIBLE', a: 400 },
    { n: '30', sec: 'RIO LAGUNILLA', s: 'VENDIDO', a: 400 },
  ];
  it('usa la etapa del plano de Laguna Mar y sugiere cercanos si está vendido', () => {
    expect(checkLotInInventory(lots, 'laguna-mar', 'Mar Santorini', '228', null))
      .toMatchObject({ kind: 'found', sector: 'MAR SANTORINI', available: false, nearby: ['3', '221', '229'] });
    expect(checkLotInInventory(lots, 'laguna-mar', 'Mar Santorini', '3', null))
      .toMatchObject({ kind: 'found', available: true });
  });
  it('usa el color en Río Claro y, sin color, el único disponible', () => {
    expect(checkLotInInventory(lots, 'rio-claro', null, '30', 'AZUL')).toMatchObject({ sector: 'RIO LAGUNILLA', available: false });
    expect(checkLotInInventory(lots, 'rio-claro', null, '30', null)).toMatchObject({ sector: 'RIO MEDINA', available: true });
  });
});

describe('bienvenida y promesas', () => {
  it('tras la nota de voz no repite si solo pidió información', () => {
    expect(shouldAnswerAfterVoiceWelcome('Hola, vi su anuncio en Google y quiero información sobre los lotes campestres en Tolima')).toBe(false);
    expect(shouldAnswerAfterVoiceWelcome('Hola, me interesa Melgar')).toBe(true);
    expect(shouldAnswerAfterVoiceWelcome('Cuánto vale un lote?')).toBe(true);
  });
  it('detecta cuando promete la cotización sin enviarla', () => {
    expect(promisesQuote('Perfecto, confirma pago a plazos a 30 meses para el terreno 30 de Llano Grande. Generaré la cotización con esa modalidad.')).toBe(true);
    expect(promisesQuote('La cotización no se envió correctamente. Para el terreno 30 procederé a generarla ahora.')).toBe(true);
    expect(promisesQuote('Para generar la cotización, ¿prefiere pago de contado o a plazos?')).toBe(false);
  });
});

describe('terreno leído de la imagen del plano', () => {
  it('toma el terreno y el sector que la IA leyó', () => {
    const s = deriveQuoteState([
      { from: 'ai', text: '', origin: 'ai_plano' },
      { from: 'ai', text: '¿En cuál terreno y sector está interesado?' },
      { from: 'lead', text: '', hasImage: true },
      { from: 'ai', text: 'El terreno marcado es el número *09*, de 300 m², en el sector *Lagunilla* de Río Claro. ¿Prefiere pago de contado o pago a plazos? Si elige cuotas, las opciones son 20, 30 o 40 meses.' },
      { from: 'lead', text: 'de contado' },
    ]);
    expect(s).toMatchObject({ terreno: '9', sectorHint: 'RIO LAGUNILLA', pago: 'contado', paymentThisTurn: true });
  });
});
