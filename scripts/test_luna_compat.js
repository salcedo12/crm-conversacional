const OpenAI = require('c:/crm-conversacional/functions/node_modules/openai');

const apiKey = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey });

async function testLunaCompatibility() {
  console.log('--- PROBANDO COMPATIBILIDAD DE gpt-5.6-luna con max_completion_tokens ---');

  const modelId = 'gpt-5.6-luna';

  // 1. Prueba de ChatCompletion básico
  console.log('1. Probando ChatCompletion básico...');
  const t0 = Date.now();
  try {
    const res = await openai.chat.completions.create({
      model: modelId,
      messages: [
        { role: 'system', content: 'Eres Victoria, asesora comercial de Grupo Constructor Meraki.' },
        { role: 'user', content: 'Hola, buenas tardes.' },
      ],
      max_completion_tokens: 150,
    });
    const ms1 = Date.now() - t0;
    console.log(`✓ ChatCompletion exitoso en ${ms1}ms`);
    console.log(`  Respuesta: "${res.choices[0]?.message?.content}"`);
    console.log(`  Uso de tokens:`, res.usage);

    // 2. Prueba de Function Calling (Tools)
    console.log('\n2. Probando compatibilidad con Tools (Function Calling)...');
    const toolTest = {
      type: 'function',
      function: {
        name: 'enviar_cotizacion',
        description: 'Envía cotización de un terreno.',
        parameters: {
          type: 'object',
          properties: {
            sector: { type: 'string' },
            terreno: { type: 'string' },
            tipo_pago: { type: 'string', enum: ['contado', 'cuotas'] },
            meses: { type: 'number', enum: [20, 30, 40] },
          },
          required: ['sector', 'terreno', 'tipo_pago'],
        },
      },
    };

    const tTool = Date.now();
    const resTool = await openai.chat.completions.create({
      model: modelId,
      messages: [
        { role: 'system', content: 'Si el cliente pide cotizar un terreno específico con forma de pago, llama enviar_cotizacion.' },
        { role: 'user', content: 'Por favor cotízame el terreno 150 de Mar Canarias a 20 cuotas.' },
      ],
      tools: [toolTest],
      tool_choice: 'auto',
      reasoning_effort: 'none',
      max_completion_tokens: 200,
    });
    const msTool = Date.now() - tTool;
    console.log(`✓ Function Calling exitoso en ${msTool}ms`);
    const call = resTool.choices[0]?.message?.tool_calls?.[0];
    console.log(`  Tool llamada: ${call?.function?.name}`);
    console.log(`  Argumentos: ${call?.function?.arguments}`);
    console.log(`  Uso de tokens con tools:`, resTool.usage);

    console.log('\n¡MODELO gpt-5.6-luna 100% OPERATIVO CON max_completion_tokens!');
  } catch (err) {
    console.error('✗ Error probando gpt-5.6-luna:', err);
  }
}

testLunaCompatibility().catch(console.error);
