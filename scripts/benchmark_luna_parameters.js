const OpenAI = require('c:/crm-conversacional/functions/node_modules/openai');

const apiKey = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey });

async function runBenchmark() {
  console.log('=== 1. EVALUACIÓN DE REASONING_EFFORT EN gpt-5.6-luna ===');
  
  const testReasoningLevels = ['none', 'low', 'medium', 'high'];
  
  // A. Con Tools
  const toolDefinition = {
    type: 'function',
    function: {
      name: 'enviar_cotizacion',
      description: 'Envía cotización oficial de un terreno',
      parameters: {
        type: 'object',
        properties: {
          sector: { type: 'string' },
          terreno: { type: 'string' },
          tipo_pago: { type: 'string', enum: ['contado', 'cuotas'] },
          meses: { type: 'number', enum: [20, 30, 40] }
        },
        required: ['sector', 'terreno', 'tipo_pago']
      }
    }
  };

  for (const level of testReasoningLevels) {
    try {
      const t0 = Date.now();
      const res = await openai.chat.completions.create({
        model: 'gpt-5.6-luna',
        messages: [
          { role: 'system', content: 'Eres Victoria, asesora de Grupo Meraki. Cotiza si el cliente da terreno y forma de pago.' },
          { role: 'user', content: 'Quiero cotizar el lote 50 de Mar Canarias a 30 meses en cuotas' }
        ],
        tools: [toolDefinition],
        tool_choice: 'auto',
        reasoning_effort: level,
        max_completion_tokens: 350,
      });
      const ms = Date.now() - t0;
      console.log(`[CON TOOLS] reasoning_effort='${level}': ÉXITO (${ms}ms) -> Tool: ${res.choices[0]?.message?.tool_calls?.[0]?.function?.name}`);
    } catch (err) {
      console.log(`[CON TOOLS] reasoning_effort='${level}': FALLÓ -> ${err.message}`);
    }
  }

  // B. Sin Tools (Conversación pura)
  console.log('\n--- Probando reasoning_effort sin tools ---');
  for (const level of testReasoningLevels) {
    try {
      const t0 = Date.now();
      const res = await openai.chat.completions.create({
        model: 'gpt-5.6-luna',
        messages: [
          { role: 'system', content: 'Eres Victoria, asesora inmobiliaria de Meraki.' },
          { role: 'user', content: '¿Qué me recomiendas para inversión y descanso familiar entre Mar Santorini y Mar Canarias?' }
        ],
        reasoning_effort: level,
        max_completion_tokens: 350,
      });
      const ms = Date.now() - t0;
      console.log(`[SIN TOOLS] reasoning_effort='${level}': ÉXITO (${ms}ms), tokens: ${JSON.stringify(res.usage)}`);
      console.log(`Respuesta corta: "${res.choices[0]?.message?.content?.substring(0, 100)}..."\n`);
    } catch (err) {
      console.log(`[SIN TOOLS] reasoning_effort='${level}': FALLÓ -> ${err.message}`);
    }
  }

  console.log('\n=== 2. EVALUACIÓN DE LÍMITES DE TOKENS: 350 vs 600 vs 1000 ===');
  const tokenLimits = [350, 600, 1000];
  
  const complexPrompt = `Eres Victoria Sarmiento, asesora comercial de Grupo Constructor Meraki en Colombia.
DIRECTRICES:
1. Prohibido usar "financiación" o "financiar". Usa formas de pago, pago a plazos o pago en cuotas.
2. Precio publicitario desde $129.990.000 con modalidades: contado, 20 meses, 30 meses y 40 meses.
3. Explica detalladamente la propuesta de valor de Laguna Mar, comparando Mar Santorini y Mar Canarias, amenidades de club campestre, y asesora consultivamente identificando descanso vs inversión.`;

  const leadQuestion = `Hola Victoria, estoy muy interesado en invertir en un lote campestre en Tubará o cerca a Barranquilla. Cuéntame sobre los precios, las etapas de Laguna Mar, qué amenidades tienen y cómo son las formas de pago.`;

  for (const limit of tokenLimits) {
    const t0 = Date.now();
    const res = await openai.chat.completions.create({
      model: 'gpt-5.6-luna',
      messages: [
        { role: 'system', content: complexPrompt },
        { role: 'user', content: leadQuestion }
      ],
      reasoning_effort: 'none',
      max_completion_tokens: limit,
    });
    const ms = Date.now() - t0;
    const choice = res.choices[0];
    const text = choice?.message?.content || '';
    const finishReason = choice?.finish_reason;
    const usage = res.usage;

    console.log(`\n--- LÍMITE: ${limit} tokens ---`);
    console.log(`Latencia: ${ms}ms`);
    console.log(`Finish Reason: ${finishReason} (¿Truncado?: ${finishReason === 'length' ? 'SÍ' : 'NO'})`);
    console.log(`Tokens usados: Prompt=${usage?.prompt_tokens}, Completion=${usage?.completion_tokens}, Total=${usage?.total_tokens}`);
    console.log(`Longitud texto: ${text.length} caracteres, ${text.split(/\s+/).length} palabras`);
    console.log(`Muestra de inicio: "${text.substring(0, 180)}..."`);
    console.log(`Muestra de final: "...${text.substring(text.length - 120)}"`);
  }
}

runBenchmark().catch(console.error);
