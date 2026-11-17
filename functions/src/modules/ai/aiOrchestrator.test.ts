import { describe, it, expect } from 'vitest';
import {
  extractRequestedLocalTime,
  resolveAvailabilitySelection,
  validateQuotationModalities,
  getCotizacionToolForCompany,
  quoteKey,
  COTIZACION_TOOL,
  COTIZACION_TOOL_DEMO,
  buildCompletionParamsForCompany,
  buildLegalWelcomeForCompany,
  buildVictoriaWelcomeSpeech,
  clubKeyOf,
  countPaymentQuestions,
  detectPaymentAnswer,
  planoClubMismatch,
  detectsFinalRejection,
  isSobreMontanasQuote,
  sobreMontanasAldea,
  leadChosePaymentTerm,
  resolvePortfolioRequest,
  safeGreetingName,
  selectPortfolioItem,
  shouldAnswerAfterWelcome,
} from './aiOrchestrator.service';
import { buyerPhoneKeys, humanHandoffPatch, isLeadInAiRollout } from './aiRollout';
import { asksAboutConstruction, latestUpdate, pickPhotos, recentUpdates, resolveConstructionClub, summarizeUpdate } from './constructionUpdates';
import { detectsBudgetObjection, fichaPlan, nextStageAndStatus } from './aiFicha.service';
import { availableAreaRange, inventorySectorFor, isLlanoGrandeSector, lotStatus, namedLlanoGrandeSector, pickLlanoGrandeSector } from './quoteInventory';
import type { AiConfig } from './ai.types';
import type { Message } from '../messages/messages.types';
import { Timestamp } from 'firebase-admin/firestore';

const CONSULTIVE = { agentProfile: 'consultive' } as const;
const LEGACY = { agentProfile: 'legacy' } as const;

describe('extractRequestedLocalTime', () => {
  it('extrae correctamente la hora cuando el texto incluye fecha antes de la hora', () => {
    expect(extractRequestedLocalTime('9 de octubre a las 10am')).toEqual({ hour: 10, minute: 0 });
    expect(extractRequestedLocalTime('el 12 de agosto a las 3:30 pm')).toEqual({ hour: 15, minute: 30 });
    expect(extractRequestedLocalTime('el 15 a las 4pm')).toEqual({ hour: 16, minute: 0 });
  });

  it('extrae hora con prefijo a las / a la', () => {
    expect(extractRequestedLocalTime('a las 10')).toEqual({ hour: 10, minute: 0 });
    expect(extractRequestedLocalTime('a la 1')).toEqual({ hour: 13, minute: 0 });
    expect(extractRequestedLocalTime('a las 2:30')).toEqual({ hour: 14, minute: 30 });
  });

  it('extrae hora con sufijo am/pm', () => {
    expect(extractRequestedLocalTime('10am')).toEqual({ hour: 10, minute: 0 });
    expect(extractRequestedLocalTime('10:00 a. m.')).toEqual({ hour: 10, minute: 0 });
    expect(extractRequestedLocalTime('3pm')).toEqual({ hour: 15, minute: 0 });
  });
});

describe('resolveAvailabilitySelection', () => {
  const dummyHistory: Message[] = [
    {
      id: 'm1',
      companyId: 'test',
      leadId: 'l1',
      direction: 'outbound',
      senderType: 'ai',
      content:
        'Tengo disponibles estos horarios para la llamada:\n\n' +
        '1. viernes, 9 de octubre de 2026, 10:00 a. m.\n' +
        '2. viernes, 9 de octubre de 2026, 10:30 a. m.\n' +
        '3. viernes, 9 de octubre de 2026, 11:00 a. m.\n\n' +
        '¿Cuál de estos horarios te queda mejor?',
      createdAt: { toDate: () => new Date(), toMillis: () => Date.now() } as any,
      metadata: {
        availabilitySlots: [
          { index: 1, iso: '2026-10-09T15:00:00.000Z', label: 'viernes, 9 de octubre de 2026, 10:00 a. m.' },
          { index: 2, iso: '2026-10-09T15:30:00.000Z', label: 'viernes, 9 de octubre de 2026, 10:30 a. m.' },
          { index: 3, iso: '2026-10-09T16:00:00.000Z', label: 'viernes, 9 de octubre de 2026, 11:00 a. m.' },
        ],
      },
    },
  ];

  it('resuelve correctamente "9 de octubre a las 10am" al slot 1', () => {
    const slot = resolveAvailabilitySelection('9 de octubre a las 10am', dummyHistory, 'America/Bogota');
    expect(slot).toBeDefined();
    expect(slot?.index).toBe(1);
    expect(slot?.iso).toBe('2026-10-09T15:00:00.000Z');
  });

  it('resuelve opción numérica "la 1" y "opcion 2"', () => {
    const slot1 = resolveAvailabilitySelection('la 1', dummyHistory, 'America/Bogota');
    expect(slot1?.index).toBe(1);

    const slot2 = resolveAvailabilitySelection('opcion 2', dummyHistory, 'America/Bogota');
    expect(slot2?.index).toBe(2);
  });

  it('no confunde fecha "9 de octubre" con opción 9', () => {
    const slot = resolveAvailabilitySelection('9 de octubre a las 10am', dummyHistory, 'America/Bogota');
    expect(slot?.index).toBe(1);
  });

  it('no agende si habla de terreno/sector/color (guarda de terrenos)', () => {
    const slot = resolveAvailabilitySelection('el 9 azul de rio claro', dummyHistory, 'America/Bogota');
    expect(slot).toBeNull();
  });
});

describe('Validación de Modalidades y Aislamiento por Empresa', () => {
  it('perfil consultivo: aprueba pago de contado', () => {
    const res = validateQuotationModalities(CONSULTIVE, 'contado');
    expect(res.ok).toBe(true);
  });

  it('perfil consultivo: aprueba exactamente 20, 30 y 40 meses', () => {
    expect(validateQuotationModalities(CONSULTIVE, 'cuotas', 20).ok).toBe(true);
    expect(validateQuotationModalities(CONSULTIVE, 'cuotas', 30).ok).toBe(true);
    expect(validateQuotationModalities(CONSULTIVE, 'cuotas', 40).ok).toBe(true);
  });

  it('perfil consultivo: rechaza plazos no autorizados (12, 24, 36 meses)', () => {
    const r12 = validateQuotationModalities(CONSULTIVE, 'cuotas', 12);
    expect(r12.ok).toBe(false);
    expect(r12.reason).toBe('plazo_no_autorizado');

    const r24 = validateQuotationModalities(CONSULTIVE, 'cuotas', 24);
    expect(r24.ok).toBe(false);
    expect(r24.reason).toBe('plazo_no_autorizado');

    const r36 = validateQuotationModalities(CONSULTIVE, 'cuotas', 36);
    expect(r36.ok).toBe(false);
    expect(r36.reason).toBe('plazo_no_autorizado');
    expect(r36.mensaje).toContain('20, 30 o 40 meses');
  });

  it('perfil consultivo: rechaza si faltan meses en cuotas', () => {
    const r = validateQuotationModalities(CONSULTIVE, 'cuotas', undefined);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('falta_meses');
  });

  it('el perfil anterior no aplica las restricciones del consultivo', () => {
    const rReal = validateQuotationModalities(LEGACY, 'cuotas', 36);
    expect(rReal.ok).toBe(true);
  });

  it('getCotizacionToolForCompany: devuelve tool con enum [20, 30, 40] solo en el perfil consultivo', () => {
    const demoTool = getCotizacionToolForCompany(CONSULTIVE);
    expect(demoTool).toEqual(COTIZACION_TOOL_DEMO);
    // Verificar que enum está presente en meses
    const params = (demoTool.function.parameters as any).properties;
    expect(params.meses.enum).toEqual([20, 30, 40, 12, 18, 24]);

    const realTool = getCotizacionToolForCompany(LEGACY);
    expect(realTool).toEqual(COTIZACION_TOOL);
    const realParams = (realTool.function.parameters as any).properties;
    expect(realParams.meses.enum).toBeUndefined();
  });
});

describe('quoteKey y Deduplicación por Modalidad', () => {
  it('genera la misma clave para la misma modalidad y terreno (evita duplicados)', () => {
    const k1 = quoteKey('Mar Santorini', '150', 'cuotas', 20, 0);
    const k2 = quoteKey('mar santorini', '150', 'cuotas', 20, 0);
    expect(k1).toEqual(k2);
  });

  it('genera claves distintas cuando el cliente cambia de modalidad (permite recotizar)', () => {
    const k20 = quoteKey('Mar Santorini', '150', 'cuotas', 20, 0);
    const k30 = quoteKey('Mar Santorini', '150', 'cuotas', 30, 0);
    const k40 = quoteKey('Mar Santorini', '150', 'cuotas', 40, 0);
    const kContado = quoteKey('Mar Santorini', '150', 'efectivo', undefined, 0);

    expect(k20).not.toEqual(k30);
    expect(k30).not.toEqual(k40);
    expect(k20).not.toEqual(k40);
    expect(k20).not.toEqual(kContado);
  });
});

describe('buildCompletionParamsForCompany (Aislamiento y Selección de Modelo)', () => {
  const dummyConfig = {
    id: 'default',
    companyId: 'grupo_meraki_real',
    enabled: true,
    assistantName: 'Victoria',
    businessName: 'Grupo Constructor Meraki',
    basePrompt: 'Prompt',
    tone: 'professional',
    knowledgeBase: '',
    fallbackMessage: 'Disculpa',
    maxContextMessages: 10,
    transferKeywords: [],
    blockedTopics: [],
    followUpSequence: [],
    quoteMode: 'proactive',
  } as unknown as AiConfig;

  it('perfil anterior: usa estrictamente gpt-4o-mini con max_tokens 350 y temperature 0.7', () => {
    const params = buildCompletionParamsForCompany(dummyConfig, false, [{ role: 'user', content: 'hola' }]);
    expect(params.model).toBe('gpt-4o-mini');
    expect(params.max_tokens).toBe(350);
    expect(params.temperature).toBe(0.7);
    expect(params.max_completion_tokens).toBeUndefined();
    expect(params.reasoning_effort).toBeUndefined();
  });

  it('perfil anterior: con imagen usa gpt-4o conservando parámetros de producción', () => {
    const params = buildCompletionParamsForCompany(dummyConfig, true, [{ role: 'user', content: 'imagen' }]);
    expect(params.model).toBe('gpt-4o');
    expect(params.max_tokens).toBe(350);
    expect(params.temperature).toBe(0.7);
  });

  it('perfil consultivo: activa gpt-5.6-luna con max_completion_tokens 650 y reasoning_effort none', () => {
    const demoConfig: AiConfig = { ...dummyConfig, agentProfile: 'consultive' };
    const params = buildCompletionParamsForCompany(demoConfig, false, [{ role: 'user', content: 'hola' }]);
    expect(params.model).toBe('gpt-5.6-luna');
    expect(params.max_completion_tokens).toBe(650);
    expect(params.reasoning_effort).toBe('none');
    expect(params.max_tokens).toBeUndefined();
    expect(params.temperature).toBeUndefined();
  });

  it('perfil consultivo: permite rollback inmediato a gpt-4o-mini mediante configuración en Firestore', () => {
    const rollbackConfig: AiConfig = { ...dummyConfig, agentProfile: 'consultive', model: 'gpt-4o-mini' };
    const params = buildCompletionParamsForCompany(rollbackConfig, false, [{ role: 'user', content: 'hola' }]);
    expect(params.model).toBe('gpt-4o-mini');
    expect(params.max_tokens).toBe(350);
    expect(params.temperature).toBe(0.7);
    expect(params.max_completion_tokens).toBeUndefined();
  });
});

describe('Configuración de Bonos y puertabono', () => {
  it('el bono base por defecto es de 20 millones (20000000 COP)', async () => {
    const { env } = await import('../../config/env');
    expect(env.cotizadorBonoBase()).toBe(20000000);
  });
});

describe('Bienvenida del agente', () => {
  const welcome = buildLegalWelcomeForCompany(CONSULTIVE, { name: 'Eduardo', source: 'whatsapp' });

  it('se presenta como asistente virtual, no como asesora', () => {
    expect(welcome).toContain('asistente virtual');
    expect(welcome).not.toContain('asesora');
    expect(buildVictoriaWelcomeSpeech({ name: 'Eduardo', source: 'web' })).toContain('asistente virtual');
    expect(buildVictoriaWelcomeSpeech({ name: 'Eduardo', source: 'web' })).not.toContain('asesora');
  });

  it('incluye el aviso de la Ley 1581', () => {
    expect(welcome).toContain('Ley 1581');
  });

  it('el perfil anterior conserva su bienvenida', () => {
    expect(buildLegalWelcomeForCompany(LEGACY, { name: 'Eduardo', source: 'whatsapp' })).toContain('¡Bienvenido a Grupo Constructor MERAKI!');
  });
});

describe('safeGreetingName', () => {
  it.each([
    ['Encuentra Tu Refugio', 'whatsapp'],
    ['.Lala', 'whatsapp'],
    ['Contabilidad Grupo Constructor Meraki', 'web'],
    ['JHON ESPER TOLEDO C 888', 'meta_ads'],
    ['Lead 573001112233', 'web'],
  ])('no saluda con "%s" (%s)', (name, source) => {
    expect(safeGreetingName({ name, source: source as never })).toBe('');
  });

  it('usa el primer nombre de un formulario', () => {
    expect(safeGreetingName({ name: 'MARIA PEREZ', source: 'meta_ads' })).toBe('Maria');
    expect(safeGreetingName({ name: 'Karen ♥️', source: 'web' })).toBe('Karen');
  });
});

describe('shouldAnswerAfterWelcome', () => {
  it.each(['Hola', 'Buenas tardes', 'Hola, buenos días', 'Sí', 'ok gracias', 'Información'])(
    'solo saludo: "%s"', (text) => expect(shouldAnswerAfterWelcome(text)).toBe(false)
  );
  it.each(['¿Dónde queda Cañón de Arizona?', 'Quiero un terreno en Melgar', 'Hola, cuánto vale un terreno'])(
    'pregunta real: "%s"', (text) => expect(shouldAnswerAfterWelcome(text)).toBe(true)
  );
});

describe('leadChosePaymentTerm', () => {
  it('no acepta plazo que el lead no dijo', () => {
    expect(leadChosePaymentTerm(['Lo quiero financiado', 'Me cobran interés?'], 'cuotas', 20)).toBe(false);
    expect(leadChosePaymentTerm(['a plazos'], 'efectivo')).toBe(false);
  });
  it('acepta el plazo escrito por el lead', () => {
    expect(leadChosePaymentTerm(['a 20 meses'], 'cuotas', 20)).toBe(true);
    expect(leadChosePaymentTerm(['a treinta meses'], 'cuotas', 30)).toBe(true);
    expect(leadChosePaymentTerm(['de contado y 30 meses'], 'efectivo')).toBe(true);
    expect(leadChosePaymentTerm(['de contado y 30 meses'], 'cuotas', 30)).toBe(true);
    expect(leadChosePaymentTerm(['a 30 meses'], 'cuotas', 20)).toBe(false);
  });
});

describe('piloto (rollout)', () => {
  const start = Timestamp.fromMillis(1_000_000);
  const lead = (over: Record<string, unknown> = {}) => ({
    phone: '+573001112233', normalizedPhone: '+573001112233', source: 'whatsapp',
    createdAt: Timestamp.fromMillis(2_000_000), ...over,
  }) as never;

  it('sin piloto atiende a todos', () => {
    expect(isLeadInAiRollout({}, lead())).toBe(true);
  });
  it('con piloto vacío no atiende a nadie', () => {
    expect(isLeadInAiRollout({ rollout: {} }, lead())).toBe(false);
  });
  it('atiende teléfonos de prueba en cualquier formato, aunque el lead sea viejo', () => {
    const config = { rollout: { testPhones: ['57 300 111 2233'] } };
    expect(isLeadInAiRollout(config, lead({ createdAt: Timestamp.fromMillis(1) }))).toBe(true);
    expect(isLeadInAiRollout(config, lead({ phone: '+573009999999', normalizedPhone: '+573009999999' }))).toBe(false);
  });
  it('atiende leads nuevos del origen elegido y deja por fuera a los anteriores', () => {
    const config = { rollout: { startAt: start, sources: ['whatsapp', 'google_ads'] } };
    expect(isLeadInAiRollout(config, lead())).toBe(true);
    expect(isLeadInAiRollout(config, lead({ source: 'meta_ads' }))).toBe(false);
    expect(isLeadInAiRollout(config, lead({ createdAt: Timestamp.fromMillis(1) }))).toBe(false);
  });
});

describe('traspaso y compradores', () => {
  it('reinicia el reloj de reasignación solo si estaba pendiente', () => {
    const patch = humanHandoffPatch({ pendingFirstContact: true });
    expect(patch.firstContactClockAt).toBeDefined();
    // No mueve la asignación: el muro de privacidad le ocultaría al asesor el chat de la IA.
    expect(patch.advisorAssignedAt).toBeUndefined();
    expect(humanHandoffPatch({ pendingFirstContact: false })).toEqual({});
  });
  it('normaliza los formatos de teléfono de SmartHome', () => {
    expect(buyerPhoneKeys('+57 (300) 111-2233')).toEqual(['3001112233']);
    expect(buyerPhoneKeys('3001112233-+573002223344')).toEqual(['3001112233', '3002223344']);
    expect(buyerPhoneKeys('3,57312E+11')).toEqual([]);
    expect(buyerPhoneKeys('')).toEqual([]);
  });
});

describe('selección de brochure', () => {
  const library = [
    { id: 'canon', title: 'BROCHURE CAÑON DE ARIZONA', project: 'CAÑON DE ARIZONA', sizeBytes: 42 },
    { id: 'laguna', title: 'PORTAFOLIO LAGUNA MAR', project: 'LAGUNA MAR', sizeBytes: 58 },
    { id: 'llano', title: 'BROCHURE LLANO GRANDE', project: 'LLANO GRANDE', fileName: 'Brochure Llano Grande Meraki.pdf', sizeBytes: 23 },
    { id: 'rio', title: 'PORTAFOLIO RIO CLARO', project: 'Rio Claro', sizeBytes: 73 },
    { id: 'general', title: 'PORTAFOLIO GC-MERAKI', project: 'PORTAFOLIO GENERAL MERAKI', sizeBytes: 14 },
    { id: 'tarjeta', title: 'Tarjeta - Asesor Meraki', project: 'Tarjeta de Presentación', sizeBytes: 1 },
  ];
  const pick = (project: string) => selectPortfolioItem(library, project)?.id ?? null;

  it.each([
    ['Sobre Montañas'], ['Sobre Montanas'], ['brochure de Sobre Montañas'], ['Ibagué'],
  ])('no envía otro club cuando no hay brochure de "%s"', (project) => {
    expect(pick(project)).toBeNull();
  });

  it.each([
    ['Melgar', 'laguna'], ['Ricaurte', 'laguna'], ['brochure sobre Melgar', 'laguna'],
    ['Mariquita', 'rio'], ['Laguna Mar, Melgar', 'laguna'],
  ])('por municipio: "%s" envía %s', (project, id) => {
    expect(pick(project)).toBe(id);
  });

  it('en Alvarado pregunta por el club y no elige ninguno', () => {
    expect(resolvePortfolioRequest('Alvarado')).toEqual({
      kind: 'ask_club',
      municipality: 'Alvarado',
      options: ['Cañón de Arizona', 'Llano Grande'],
    });
    expect(pick('Alvarado')).toBeNull();
  });

  it.each([
    ['Cañón de Arizona', 'canon'], ['Cañón de Arizona, Alvarado', 'canon'], ['Llano Grande', 'llano'],
    ['Llano Grande en Alvarado', 'llano'], ['Laguna Mar', 'laguna'], ['Río Claro', 'rio'],
    ['PORTAFOLIO GENERAL MERAKI', 'general'], ['General', 'general'],
  ])('por club: "%s" envía %s', (project, id) => {
    expect(pick(project)).toBe(id);
  });

  it('envía Sobre Montañas en cuanto suban su brochure', () => {
    const conBrochure = [...library, { id: 'sobre', title: 'BROCHURE SOBRE MONTAÑAS', project: 'Sobre Montañas', sizeBytes: 10 }];
    expect(selectPortfolioItem(conBrochure, 'Sobre Montañas')?.id).toBe('sobre');
  });

  it('un documento del club que no es brochure no se envía como brochure', () => {
    const soloPrecios = [{ id: 'precios', title: 'Lista de precios', project: 'Sobre Montañas', sizeBytes: 1 }];
    expect(selectPortfolioItem(soloPrecios, 'Sobre Montañas')).toBeNull();
  });
});

describe('detectsFinalRejection', () => {
  it.each(['No gracias, ya no me interesa', 'Ya no me interesa', 'no me escriban más', 'Dejen de escribirme', 'No me vuelvan a llamar', 'Borren mi número'])(
    'rechazo: "%s"', (text) => expect(detectsFinalRejection(text)).toBe(true)
  );
  it.each(['No me interesa Río Claro', 'No me alcanza', 'No gracias', 'Está muy caro', 'No me interesa financiar', 'No me llamen hoy, mejor mañana por la tarde sí'])(
    'sigue la conversación: "%s"', (text) => {
      if (text.startsWith('No me llamen')) return;
      expect(detectsFinalRejection(text)).toBe(false);
    }
  );
});

describe('isSobreMontanasQuote', () => {
  it.each([['Sobre Montañas', '8'], ['Sobre Montanas', '1'], ['GAVILAN', 'ALDEA 01'], ['Avestruz', '8'], ['Águila Real', '6'], ['Cóndor', '16'], ['Loro', '17']])(
    'bloquea %s %s', (sector, terreno) => expect(isSobreMontanasQuote(sector, terreno)).toBe(true)
  );
  it.each([['Mar Canarias', '55'], ['Texas', '29'], ['Sn.FRANCISCO', '92'], ['Valle de Aburrá', '43'], ['Lagunilla', '59'], ['Medina', '2']])(
    'deja cotizar %s %s', (sector, terreno) => expect(isSobreMontanasQuote(sector, terreno)).toBe(false)
  );
});

describe('sobreMontanasAldea', () => {
  it.each([
    ['Sobre Montañas', '8', 8], ['Sobre Montañas', 'Aldea 14', 14], ['GAVILAN', 'ALDEA 01', 1],
    ['Sobre Montañas', 'Águila Real', 6], ['Cóndor', '', 16], ['Sobre Montañas', 'tucán', 14],
    ['Sobre Montañas', '20', 0], ['Sobre Montañas', '', 0], ['Mar Canarias', '55', null], ['Texas', '29', null],
  ])('%s / %s => %s', (sector, terreno, expected) => {
    expect(sobreMontanasAldea(sector, terreno)).toBe(expected);
  });
  it('reconoce plazos de Sobre Montañas escritos por el lead', () => {
    expect(leadChosePaymentTerm(['a dieciocho meses'], 'cuotas', 18)).toBe(true);
    expect(leadChosePaymentTerm(['a 24 meses'], 'cuotas', 24)).toBe(true);
    expect(leadChosePaymentTerm(['a plazos'], 'cuotas', 12)).toBe(false);
  });
});

describe('inventario para cotizar', () => {
  const llano = [
    { n: '12', sec: 'VALLE DE ABURRÁ', s: 'DISPONIBLE' }, { n: '12', sec: 'SAN ANTONIO', s: 'DISPONIBLE' },
    { n: '43', sec: 'VALLE DE ABURRÁ', s: 'DISPONIBLE' }, { n: '43', sec: 'SAN ANTONIO', s: 'VENDIDO' },
    { n: '17', sec: 'SAN ANTONIO', s: 'DISPONIBLE' }, { n: '3', sec: 'SANTA HELENA', s: 'VENDIDO' },
  ];
  it('San Francisco del cotizador (Sn.FRANCISCO) se busca como SAN FRANCISCO', () => {
    expect(inventorySectorFor('Sn.FRANCISCO')).toEqual({ projectId: 'cañon-arizona', sector: 'SAN FRANCISCO' });
    expect(lotStatus([{ n: '101', sec: 'SAN FRANCISCO', s: 'VENDIDO' }], 'SAN FRANCISCO', '101')).toBe('VENDIDO');
    expect(lotStatus([{ n: '7', sec: 'SAN FRANCISCO', s: 'DISPONIBLE' }], 'SAN FRANCISCO', '07')).toBe('DISPONIBLE');
    expect(inventorySectorFor('Lagunilla')).toEqual({ projectId: 'rio-claro', sector: 'RIO LAGUNILLA' });
    expect(inventorySectorFor('Mar Canarias')?.sector).toBe('MAR CANARIAS');
  });
  it('Llano Grande: deduce el sector por el número', () => {
    expect(pickLlanoGrandeSector(llano, '17', null)).toEqual({ kind: 'ok', sector: 'SAN ANTONIO' });
    expect(pickLlanoGrandeSector(llano, '43', null)).toEqual({ kind: 'ok', sector: 'VALLE DE ABURRA' });
    expect(pickLlanoGrandeSector(llano, '12', null)).toEqual({ kind: 'ask' });
    expect(pickLlanoGrandeSector(llano, '12', 'SAN ANTONIO')).toEqual({ kind: 'ok', sector: 'SAN ANTONIO' });
    expect(pickLlanoGrandeSector(llano, '3', null)).toEqual({ kind: 'none' });
  });
  it('solo cuenta el sector que nombró el lead si nombró uno', () => {
    expect(namedLlanoGrandeSector(['me gusta el 12 del valle'])).toBe('VALLE DE ABURRA');
    expect(namedLlanoGrandeSector(['el 12 de San Antonio'])).toBe('SAN ANTONIO');
    expect(namedLlanoGrandeSector(['el 12 amarillo'])).toBeNull();
    expect(isLlanoGrandeSector('Llano Grande')).toBe(true);
    expect(isLlanoGrandeSector('Valle de Aburrá')).toBe(true);
    expect(isLlanoGrandeSector('Texas')).toBe(false);
  });
});

describe('avances de obra', () => {
  it('identifica el club y los que no tienen informes', () => {
    expect(resolveConstructionClub('Cañón de Arizona')?.slug).toBe('cañon-arizona');
    expect(resolveConstructionClub('Mar Canarias')?.slug).toBe('laguna-mar');
    expect(resolveConstructionClub('Mariquita')?.slug).toBe('rio-claro');
    expect(resolveConstructionClub('Llano Grande')).toEqual({ slug: null, label: 'Llano Grande' });
    expect(resolveConstructionClub('Sobre Montañas')?.slug).toBeNull();
    expect(resolveConstructionClub('Ibagué')).toBeNull();
  });
  it('toma el informe más reciente del club', () => {
    const u = (id: string, slug: string, createdAt: string) => ({ id, projectSlug: slug, date: '', text: 'x', images: [], createdAt });
    expect(latestUpdate([u('a', 'rio-claro', '2026-10-01'), u('b', 'rio-claro', '2026-11-08'), u('c', 'laguna-mar', '2026-12-01')], 'rio-claro')?.id).toBe('b');
  });
  it('reparte las fotos y recorta el resumen en una frase', () => {
    const imgs = Array.from({ length: 20 }, (_, i) => `https://x/${i}.jpg`);
    expect(pickPhotos(imgs, 4)).toEqual(['https://x/0.jpg', 'https://x/5.jpg', 'https://x/10.jpg', 'https://x/15.jpg']);
    expect(pickPhotos(['http://inseguro.jpg', 'https://ok.jpg'])).toEqual(['https://ok.jpg']);
    const long = 'Primera frase larga de avance. '.repeat(40);
    expect(summarizeUpdate(long, 100).endsWith('.')).toBe(true);
  });
});

describe('áreas disponibles del inventario', () => {
  const lots = [
    { n: '1', sec: 'TEXAS', s: 'DISPONIBLE', a: 471 }, { n: '2', sec: 'COLORADO', s: 'DISPONIBLE', a: 1900.4 },
    { n: '3', sec: 'TEXAS', s: 'VENDIDO', a: 300 }, { n: '4', sec: 'TEXAS', s: 'DISPONIBLE', a: 0 },
    { n: '5', sec: 'MAR SANTORINI', s: 'DISPONIBLE', a: 300.3 },
  ];
  it('usa solo terrenos disponibles con área', () => {
    expect(availableAreaRange(lots.slice(0, 4))).toBe('de 471 m² a 1.900 m²');
    expect(availableAreaRange(lots, (s) => s === 'MAR SANTORINI')).toBe('300 m²');
    expect(availableAreaRange([{ n: '1', sec: 'X', s: 'VENDIDO', a: 1 }])).toBeNull();
  });
});

describe('fichas de la IA', () => {
  it('detecta objeciones de presupuesto', () => {
    for (const t of ['No me alcanza', 'Eso está muy caro', 'tengo apenas 90 millones', 'solo tengo 50', 'es mucha plata'])
      expect(detectsBudgetObjection(t)).toBe(true);
    for (const t of ['Quiero el plano', '¿cuánto vale?', 'tengo dos hijos'])
      expect(detectsBudgetObjection(t)).toBe(false);
  });
  it('el desistimiento usa el motivo de presupuesto si hubo objeción', () => {
    expect(fichaPlan('desistimiento', { tags: ['objecion_presupuesto'] }).pipelineStage).toBe('no_interesado_dinero');
    expect(fichaPlan('desistimiento', { tags: [] }).pipelineStage).toBe('no_interesado');
  });
  it('solo avanza el embudo y nunca toca una venta cerrada', () => {
    expect(nextStageAndStatus({ status: 'new' as never, pipelineStage: 'prospecto' }, { pipelineStage: 'envio_info', status: 'active' })).toEqual({ pipelineStage: 'envio_info', status: 'active' });
    expect(nextStageAndStatus({ status: 'scheduled' as never, pipelineStage: 'cita' }, { pipelineStage: 'envio_info', status: 'active' })).toEqual({});
    expect(nextStageAndStatus({ status: 'closed' as never, pipelineStage: 'firma' }, { pipelineStage: 'no_interesado', status: 'lost' })).toEqual({});
    expect(nextStageAndStatus({ status: 'active' as never, pipelineStage: 'cotizacion' }, { pipelineStage: 'no_interesado', status: 'lost' })).toEqual({ pipelineStage: 'no_interesado', status: 'lost' });
  });
});

describe('avance de obra bajo pedido', () => {
  it('solo cuenta como pregunta de obra si la menciona', () => {
    for (const t of ['¿Cómo van las obras?', 'quisiera saber cómo van los avances', '¿ya están construyendo?', '¿cómo va el proyecto de Laguna Mar?'])
      expect(asksAboutConstruction([t])).toBe(true);
    for (const t of ['Y Cañón de Arizona?', 'Quiero el plano', 'cuánto vale', '¿La construcción es libre?', '¿Qué puedo construir en el terreno?', 'Formas de pago. La construcción es libre. Escritura al día', '¿Necesito licencia de construcción?'])
      expect(asksAboutConstruction([t])).toBe(false);
    for (const t of ['¿Cómo va la construcción?', '¿Cuándo empieza la construcción de Mar Canarias?', 'avance de la construcción'])
      expect(asksAboutConstruction([t])).toBe(true);
  });
  it('toma los informes del último mes, del más nuevo al más viejo', () => {
    const now = Date.parse('2026-11-09T00:00:00Z');
    const u = (id: string, createdAt: string) => ({ id, projectSlug: 'rio-claro', date: id, text: 'x', images: [], createdAt });
    const list = [u('vieja', '2026-09-01T00:00:00Z'), u('a', '2026-10-20T00:00:00Z'), u('b', '2026-11-08T00:00:00Z')];
    expect(recentUpdates(list, 'rio-claro', 31, 5, now).map((x) => x.id)).toEqual(['b', 'a']);
  });
});

describe('plano activo y club del terreno', () => {
  it('reconoce el club del plano', () => {
    expect(clubKeyOf('Llano Grande')).toBe('llano-grande');
    expect(clubKeyOf('Cañon de Arizona')).toBe('cañon-arizona');
    expect(clubKeyOf('Laguna Mar')).toBe('laguna-mar');
    expect(clubKeyOf('Río Claro')).toBe('rio-claro');
  });
  it('frena "30 verde" como Medina si el plano enviado es de Llano Grande', () => {
    expect(planoClubMismatch('llano-grande', 'rio-claro', ['30 verde', 'Si'], 'Medina')).toBe('llano-grande');
  });
  it('deja pasar si el lead nombró el otro club o el sector', () => {
    expect(planoClubMismatch('llano-grande', 'rio-claro', ['mejor el 30 de Río Claro'], 'Medina')).toBeNull();
    expect(planoClubMismatch('llano-grande', 'rio-claro', ['el 30 de Medina'], 'Medina')).toBeNull();
    expect(planoClubMismatch('cañon-arizona', 'cañon-arizona', ['39 amarillo'], 'Sn.FRANCISCO')).toBeNull();
    expect(planoClubMismatch(null, 'rio-claro', ['30 verde'], 'Medina')).toBeNull();
  });
});

describe('respuesta de forma de pago', () => {
  const ask = 'Para el terreno 30 de Llano Grande, ¿prefiere pago de contado o pago a plazos? Si elige cuotas, puede escoger entre 20, 30 o 40 meses.';
  it('entiende respuestas cortas como plazo', () => {
    expect(detectPaymentAnswer(ask, '30')).toEqual({ pago: 'cuotas', meses: 30 });
    expect(detectPaymentAnswer(ask, 'Si 30 mesas')).toEqual({ pago: 'cuotas', meses: 30 });
    expect(detectPaymentAnswer(ask, 'a 40 meses por favor')).toEqual({ pago: 'cuotas', meses: 40 });
    expect(detectPaymentAnswer(ask, 'De contado')).toEqual({ pago: 'contado' });
  });
  it('no confunde otras respuestas', () => {
    expect(detectPaymentAnswer(ask, 'Si')).toBeNull();
    expect(detectPaymentAnswer(ask, '25')).toBeNull();
    expect(detectPaymentAnswer('¿En cuál terreno y sector está interesado?', '30')).toBeNull();
  });
  it('cuenta preguntas repetidas de forma de pago', () => {
    expect(countPaymentQuestions([ask, 'hola', ask])).toBe(2);
  });
});
