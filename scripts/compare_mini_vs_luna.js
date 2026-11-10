const OpenAI = require('c:/crm-conversacional/functions/node_modules/openai');

const apiKey = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey });

// Tool para cotización oficial
const COTIZACION_TOOL = {
  type: 'function',
  function: {
    name: 'enviar_cotizacion',
    description: 'Envía la cotización oficial de un terreno en Grupo Constructor Meraki.',
    parameters: {
      type: 'object',
      properties: {
        sector: { type: 'string', description: 'Nombre del sector o etapa (p. ej. Mar Santorini, Mar Canarias, Los Angeles)' },
        terreno: { type: 'string', description: 'Número del terreno' },
        tipo_pago: { type: 'string', enum: ['contado', 'cuotas'] },
        meses: { type: 'number', enum: [20, 30, 40], description: 'Plazo en meses autorizado para formas de pago a plazos' },
      },
      required: ['sector', 'terreno', 'tipo_pago'],
    },
  },
};

const DISPONIBILIDAD_TOOL = {
  type: 'function',
  function: {
    name: 'consultar_horarios',
    description: 'Consulta los horarios disponibles para una llamada con un asesor comercial.',
    parameters: {
      type: 'object',
      properties: {
        dias: { type: 'number', description: 'Cantidad de días hacia adelante a consultar' },
      },
    },
  },
};

const AGENDAR_TOOL = {
  type: 'function',
  function: {
    name: 'agendar_cita',
    description: 'Agenda una llamada con un asesor comercial en un horario exacto confirmado por el lead.',
    parameters: {
      type: 'object',
      properties: {
        datetime_iso: { type: 'string', description: 'Fecha y hora en formato ISO 8601 con offset -05:00' },
      },
      required: ['datetime_iso'],
    },
  },
};

const TOOLS = [COTIZACION_TOOL, DISPONIBILIDAD_TOOL, AGENDAR_TOOL];

const BASE_SYSTEM_PROMPT = `Eres Victoria Sarmiento, asesora comercial virtual de Grupo Constructor Meraki.
Tu objetivo es asesorar cálida y consultivamente a interesados en proyectos campestres en Tubará, Atlántico (a 25 min de Barranquilla y 45 min de Cartagena).
DIRECTRICES DE ASESORÍA COMERCIAL CONSULTIVA:
1. VOCABULARIO OBLIGATORIO: PROHIBIDO utilizar las palabras "financiación", "financiar" o "financiado". Usa exclusivamente "formas de pago", "pago a plazos", "planes de pago" o "pago en cuotas".
2. PRECIO PUBLICITARIO OFICIAL: Cuando pregunten por precio de forma general ("¿Cuánto valen?", "¿Desde cuánto?", "precios"), responde que contamos con terrenos campestres desde $129.990.000 y explica las 4 formas de pago: contado, 20 meses, 30 meses y 40 meses. NO llames a la herramienta de cotización ante preguntas generales.
3. PROPUESTA DE VALOR: Presenta la propuesta de valor del club campestre (laguna cristalina, club house, piscinas, senderos, canchas de pádel, seguridad 24/7). Indaga de forma cálida la motivación de compra (descanso familiar, segunda vivienda o inversión para rentas).
4. ETAPAS: Mar Santorini (obra avanzada, 300 m², entrega próxima) vs. Mar Canarias (300 a 2.500 m², mayor holgura en plazos de 20, 30 o 40 meses y mayor proyección de valorización).
5. AL ELEGIR TERRENO: Confirma número y etapa y formula la opción: "¿prefieres pago de contado o pago a plazos? Si eliges cuotas, ¿a cuántos meses te gustaría el plan de pago: 20, 30 o 40 meses?". NUNCA dejes la pregunta abierta.
6. COTIZADOR: Exclusivamente contado, 20, 30 o 40 meses. Si el lead pide otro plazo (ej. 12, 18, 24, 36), explica amablemente las opciones autorizadas.
7. NO REPETICIÓN: Si el lead ya recibió cotización y dice "me gusta" o "listo", no repitas la cotización; avanza hacia agendar llamada.`;

// Tarifas por millón de tokens
const PRICING = {
  'gpt-4o-mini': { input: 0.15, cached: 0.075, output: 0.60 },
  'gpt-5.6-luna': { input: 0.20, cached: 0.02, output: 1.20 },
};

async function callModel(modelId, messages) {
  const isLuna = modelId === 'gpt-5.6-luna';
  const t0 = Date.now();
  
  const params = {
    model: modelId,
    messages,
    tools: TOOLS,
    tool_choice: 'auto',
  };

  if (isLuna) {
    params.max_completion_tokens = 650;
    params.reasoning_effort = 'none';
  } else {
    params.max_tokens = 350;
    params.temperature = 0.7;
  }

  const res = await openai.chat.completions.create(params);
  const latencyMs = Date.now() - t0;
  
  const choice = res.choices[0]?.message;
  const usage = res.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  
  const pricing = PRICING[modelId];
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens || 0;
  const normalInputTokens = Math.max(0, usage.prompt_tokens - cachedTokens);
  const cost = ((normalInputTokens * pricing.input) + (cachedTokens * pricing.cached) + (usage.completion_tokens * pricing.output)) / 1_000_000;

  return {
    content: choice?.content || null,
    tool_calls: choice?.tool_calls || null,
    latencyMs,
    usage,
    costUsd: cost,
    rawChoice: choice,
  };
}

async function runScenario(scenarioTitle, userTurns) {
  console.log(`\n======================================================`);
  console.log(`ESCENARIO: ${scenarioTitle}`);
  console.log(`======================================================`);

  const results = {
    'gpt-4o-mini': { turns: [], totalLatency: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalCost: 0 },
    'gpt-5.6-luna': { turns: [], totalLatency: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalCost: 0 },
  };

  for (const model of ['gpt-4o-mini', 'gpt-5.6-luna']) {
    console.log(`\n--- Evaluando ${model} ---`);
    let conversation = [{ role: 'system', content: BASE_SYSTEM_PROMPT }];

    for (let i = 0; i < userTurns.length; i++) {
      const userText = userTurns[i];
      conversation.push({ role: 'user', content: userText });
      
      const step = await callModel(model, conversation);
      results[model].turns.push({ user: userText, step });
      results[model].totalLatency += step.latencyMs;
      results[model].totalPromptTokens += step.usage.prompt_tokens;
      results[model].totalCompletionTokens += step.usage.completion_tokens;
      results[model].totalCost += step.costUsd;

      console.log(`[Turno ${i + 1}] Lead: "${userText}"`);
      if (step.tool_calls) {
        for (const tc of step.tool_calls) {
          console.log(`  -> TOOL CALL: ${tc.function.name}(${tc.function.arguments})`);
          // Simular respuesta de la herramienta para continuar conversación multi-turno
          let toolResult = { ok: true };
          if (tc.function.name === 'enviar_cotizacion') {
            toolResult = { ok: true, mensaje: 'Cotización enviada con éxito por WhatsApp con imagen adjunta.' };
          } else if (tc.function.name === 'consultar_horarios') {
            toolResult = { ok: true, horarios: ['2026-10-10T10:00:00-05:00', '2026-10-10T15:00:00-05:00'] };
          }
          conversation.push(step.rawChoice);
          conversation.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) });
          
          // Generar follow-up de la IA
          const followUp = await callModel(model, conversation);
          results[model].totalLatency += followUp.latencyMs;
          results[model].totalPromptTokens += followUp.usage.prompt_tokens;
          results[model].totalCompletionTokens += followUp.usage.completion_tokens;
          results[model].totalCost += followUp.costUsd;
          console.log(`  -> Victoria: "${followUp.content}" (${step.latencyMs + followUp.latencyMs}ms)`);
          conversation.push(followUp.rawChoice);
        }
      } else {
        console.log(`  -> Victoria: "${step.content}" (${step.latencyMs}ms)`);
        conversation.push(step.rawChoice);
      }
    }
  }

  return results;
}

async function runAllComparisons() {
  console.log('INICIANDO SUITE DE COMPARACIÓN MULTI-TURNO: GPT-4o-mini vs. GPT-5.6-Luna\n');

  // Escenario 1: Asesoría Consultiva + Precios Generales + Motivación
  const s1 = await runScenario('1. Consulta General de Precios y Asesoría Consultiva', [
    'Hola, buenas tardes. ¿Cuánto valen los lotes campestres que tienen?',
    'Me interesa para tener una casa de campo con mi familia los fines de semana',
    '¿Qué diferencia hay entre Santorini y Canarias?',
  ]);

  // Escenario 2: Cotización Específica con Selección Ambigua y Manejo de Plazo no Autorizado
  const s2 = await runScenario('2. Cotización, Ambigüedad y Plazo no Autorizado', [
    'Me gustó el terreno 120 de Mar Canarias. ¿Me lo puedes financiar a 24 meses?',
    'Ah entiendo, entonces pongámoslo a 30 meses en cuotas',
    'Listo, me encanta la propuesta',
  ]);

  // Escenario 3: Manejo de Objeción de Ubicación y Distancia
  const s3 = await runScenario('3. Manejo de Objeciones (Distancia / Ubicación)', [
    'Me gusta mucho el proyecto, pero Tubará me parece que queda muy lejos de Barranquilla...',
    '¿Y qué garantías de seguridad y valorización tiene?',
  ]);

  // Escenario 4: Agendamiento de Cita Comercial
  const s4 = await runScenario('4. Agendamiento Comercial y Cierre', [
    'Quisiera hablar con un asesor para revisar planos disponibles este fin de semana',
    'El sábado a las 10 de la mañana me queda perfecto',
  ]);

  // Resumen Global
  console.log('\n======================================================');
  console.log('RESUMEN COMPARATIVO GLOBAL DE RENDIMIENTO Y COSTOS');
  console.log('======================================================');
  
  const allScenarios = [s1, s2, s3, s4];
  for (const model of ['gpt-4o-mini', 'gpt-5.6-luna']) {
    let totLat = 0, totPrompt = 0, totComp = 0, totCost = 0, turnsCount = 0;
    for (const sc of allScenarios) {
      totLat += sc[model].totalLatency;
      totPrompt += sc[model].totalPromptTokens;
      totComp += sc[model].totalCompletionTokens;
      totCost += sc[model].totalCost;
      turnsCount += sc[model].turns.length;
    }
    const avgLat = Math.round(totLat / turnsCount);
    console.log(`\nMODELO: ${model}`);
    console.log(`- Turnos evaluados: ${turnsCount}`);
    console.log(`- Latencia promedio por turno: ${avgLat} ms`);
    console.log(`- Tokens Entrada promedio por turno: ${Math.round(totPrompt / turnsCount)}`);
    console.log(`- Tokens Salida promedio por turno: ${Math.round(totComp / turnsCount)}`);
    console.log(`- Costo total de las 4 conversaciones: $${totCost.toFixed(5)} USD`);
    console.log(`- Costo promedio por conversación (3 turnos): $${(totCost / 4).toFixed(5)} USD`);
    
    // Proyección 700 leads con promedio 6 turnos por lead:
    const costPerTurn = totCost / turnsCount;
    const monthly700Leads = 700 * 6 * costPerTurn;
    console.log(`- PROYECCIÓN MENSUAL (700 leads x 6 turnos = 4.200 turnos): $${monthly700Leads.toFixed(2)} USD (~$${(monthly700Leads * 4000).toLocaleString('es-CO')} COP)`);
  }
}

runAllComparisons().catch(console.error);
