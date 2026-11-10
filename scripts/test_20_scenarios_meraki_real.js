const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const OpenAI = require('c:/crm-conversacional/functions/node_modules/openai');
const apiKey = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey });

const { COTIZACION_TOOL_DEMO } = require('c:/crm-conversacional/functions/lib/modules/ai/aiOrchestrator.service');

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

const PLANO_TOOL = {
  type: 'function',
  function: {
    name: 'enviar_plano',
    description: 'Envía el PDF del plano arquitectónico oficial de un club o etapa.',
    parameters: {
      type: 'object',
      properties: {
        club: { type: 'string', description: 'Nombre del club campestre (Laguna Mar, Cañón de Arizona, etc.)' },
        etapa: { type: 'string', description: 'Etapa si aplica (Mar Santorini, Mar Canarias)' },
      },
      required: ['club'],
    },
  },
};

const TOOLS = [COTIZACION_TOOL_DEMO, DISPONIBILIDAD_TOOL, AGENDAR_TOOL, PLANO_TOOL];

// Tarifas de GPT-5.6 Luna
const PRICING = { input: 0.20, cached: 0.02, output: 1.20 };

async function getFullSystemPrompt() {
  const doc = await db.collection('companies').doc('empresa_demo').collection('aiConfigs').doc('default').get();
  const basePrompt = doc.data().basePrompt;
  const demoDirectives = 
    `DIRECTRICES DE ASESORÍA COMERCIAL CONSULTIVA (EMPRESA_DEMO):\n` +
    `1. VOCABULARIO OBLIGATORIO: PROHIBIDO utilizar las palabras "financiación", "financiar" o "financiado". ` +
    `Usa exclusivamente términos como "formas de pago", "pago a plazos", "planes de pago" o "pago en cuotas".\n` +
    `2. PRECIO PUBLICITARIO OFICIAL: Cuando el lead pregunte de manera general por precios ("¿Cuánto valen?", "¿Desde cuánto?", "Precio", "costos"), ` +
    `debes responder con naturalidad que contamos con terrenos campestres desde $129.990.000. ` +
    `En esa misma respuesta explica las cuatro formas de pago comerciales autorizadas: 1) Pago de contado, 2) Pago a plazos a 20 meses, 3) Pago a plazos a 30 meses, y 4) Pago a plazos a 40 meses. ` +
    `PROHIBIDO activar automáticamente la herramienta enviar_cotizacion ante preguntas generales de precios.\n` +
    `3. PROYECTOS Y UBICACIONES REALES DE MERAKI (ESTRICTO):\n` +
    `- Los únicos clubes campestres de Grupo Constructor Meraki son:\n` +
    `  * Ciudad Country Laguna Mar (Melgar / Ricaurte) - Etapas: Mar Santorini (300 m², entrega próxima) y Mar Canarias (300 a 2.500 m², mayor holgura en plazos a 20, 30 o 40 meses y mayor proyección de valorización).\n` +
    `  * Cañón de Arizona Bungalow Luxury Club (Alvarado, Tolima).\n` +
    `  * Llano Grande Luxury Living Club (Alvarado, Tolima).\n` +
    `  * Sobre Montañas (Alvarado, Tolima).\n` +
    `  * Río Claro Luxury Living Club (Mariquita, Tolima).\n` +
    `- PROHIBIDO inventar proyectos o ubicaciones inexistentes (como Tubará, Barranquilla u otras ajenas a Meraki).\n` +
    `- PROHIBIDO inventar amenidades, áreas o prometer rentabilidades o valorización fija sin soporte.\n` +
    `4. PROPUESTA DE VALOR Y MOTIVACIÓN DEL COMPRADOR:\n` +
    `- Indaga de manera cálida y natural su motivación de compra: ¿descanso familiar de fin de semana, segunda vivienda o inversión para rentas vacacionales?\n` +
    `- Selecciona amenidades relevantes según su motivación y explica sus beneficios (sin listas excesivas tipo catálogo).\n` +
    `5. PLANO Y DISPONIBILIDAD COMO HERRAMIENTA ÁGIL:\n` +
    `- Si el cliente pide directamente el plano, precios o cotización, entrégalos DE INMEDIATO sin cuestionarios previos.\n` +
    `6. MEMORIA Y CERO PREGUNTAS REDUNDANTES:\n` +
    `- Victoria NUNCA debe volver a preguntar información que el cliente ya proporcionó.\n` +
    `- Si el cliente YA indicó que quiere cuotas/plazos (o mencionó meses), NO preguntes si prefiere contado o cuotas.\n` +
    `- Si el cliente solicita un plazo no autorizado (p. ej. 24 meses), indícale amablemente que las opciones son 20, 30 o 40 meses y pregúntale directamente cuál de esos tres plazos prefiere.\n` +
    `- Si el cliente elige un terreno y aún no ha indicado forma de pago: "¿prefieres pago de contado o pago a plazos? Si eliges cuotas, ¿a cuántos meses te gustaría: 20, 30 o 40 meses?".\n` +
    `7. PROHIBICIÓN TOTAL DE PREGUNTAS ABIERTAS DE PLAZO (ANTI-BUCLE):\n` +
    `NUNCA preguntes "¿a cuántos meses le gustaría financiar?" ni dejes el plazo abierto.\n` +
    `8. MODALIDADES AUTORIZADAS: Exclusivamente contado, 20 meses, 30 meses y 40 meses.\n` +
    `9. PROTECCIÓN CONTRA DUPLICADOS Y CAMBIO DE MODALIDAD: Si el cliente ya recibió una cotización y solo dice "sí", "ese", "me gusta" o "listo", continúa la conversación hacia agendar llamada sin repetir la cotización. Si solicita cambiar de modalidad (ej. de contado a 20, 30 o 40 meses, o viceversa) o pide reenvío explícito, genera la nueva cotización con enviar_cotizacion.`;
  
  return `${basePrompt}\n\n${demoDirectives}`;
}

async function callLuna(messages) {
  const t0 = Date.now();
  const res = await openai.chat.completions.create({
    model: 'gpt-5.6-luna',
    messages,
    tools: TOOLS,
    tool_choice: 'auto',
    max_completion_tokens: 650,
    reasoning_effort: 'none',
  });
  const ms = Date.now() - t0;
  const choice = res.choices[0]?.message;
  const finishReason = res.choices[0]?.finish_reason;
  const usage = res.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens || 0;
  const normalInputTokens = Math.max(0, usage.prompt_tokens - cachedTokens);
  const cost = ((normalInputTokens * PRICING.input) + (cachedTokens * PRICING.cached) + (usage.completion_tokens * PRICING.output)) / 1_000_000;

  return {
    choice,
    finishReason,
    latencyMs: ms,
    usage,
    costUsd: cost,
  };
}

async function run20Scenarios() {
  console.log('=== BATERÍA DE 20 CONVERSACIONES COMPLETAS REALES DE MERAKI (GPT-5.6 LUNA) ===\n');
  const fullPrompt = await getFullSystemPrompt();

  const scenarios = [
    { id: 1, title: 'Consulta General de Precios', turns: ['Hola, buenas tardes. ¿Cuánto valen los terrenos campestres que tienen?'] },
    { id: 2, title: 'Motivación Inversión en Laguna Mar (Melgar/Ricaurte)', turns: ['Estoy buscando un terreno para construir y rentar por Airbnb en Melgar o Ricaurte.', '¿Qué amenidades tiene Laguna Mar para los huéspedes?'] },
    { id: 3, title: 'Motivación Descanso Familiar en Cañón de Arizona (Alvarado)', turns: ['Hola Victoria, quiero un terreno para descansar los fines de semana con mi familia en clima cálido cerca a Ibagué.', '¿Qué concepto y amenidades tiene Cañón de Arizona?'] },
    { id: 4, title: 'Diferencia Verificada entre Mar Santorini y Mar Canarias', turns: ['Estoy mirando Laguna Mar, ¿cuál es la diferencia real entre la etapa Mar Santorini y Mar Canarias?'] },
    { id: 5, title: 'Solicitud Directa de Plano de Laguna Mar (Sin Cuestionarios)', turns: ['Buenas, por favor envíame el plano de Laguna Mar.'] },
    { id: 6, title: 'Cotización Mar Canarias a 20 Meses', turns: ['Me interesa cotizar el terreno 85 en Mar Canarias a 20 meses en cuotas.'] },
    { id: 7, title: 'Cotización Mar Santorini de Contado', turns: ['Quiero cotizar el terreno 42 de Mar Santorini para pago de contado.'] },
    { id: 8, title: 'Plazo No Autorizado (Solicita 24 meses)', turns: ['Me gusta el terreno 110 de Mar Canarias, ¿me dan plan de pago a 24 meses?'] },
    { id: 9, title: 'Cliente responde solo "a plazos" (Anti-bucle)', turns: ['Quiero cotizar el lote 55 de Cañón de Arizona a plazos.'] },
    { id: 10, title: 'Objeción de Distancia a Melgar', turns: ['Me gusta Laguna Mar pero vivo en Bogotá, ¿no queda muy lejos para ir los fines de semana?'] },
    { id: 11, title: 'Objeción de Presupuesto', turns: ['El proyecto se ve espectacular pero $130 millones se me sale un poco del presupuesto que tenía previsto...'] },
    { id: 12, title: 'Pregunta sobre Rentabilidad o Valorización Garantizada', turns: ['¿Cuánto me garantizan de rentabilidad anual si compro en Mar Canarias?'] },
    { id: 13, title: 'Cambio de Modalidad (de Contado a 40 Meses)', turns: ['Ya me cotizaste de contado el 150 de Mar Canarias, pero mejor cotízamelo a 40 meses a plazos.'] },
    { id: 14, title: 'Lead dice "me gusta" tras cotización (Avanzar a llamada)', turns: ['Recibí la cotización del terreno 120. ¡Me gusta mucho!'] },
    { id: 15, title: 'Interés en Glamping en Sobre Montañas (Alvarado)', turns: ['Vi que tienen un proyecto llamado Sobre Montañas, ¿de qué se trata?'] },
    { id: 16, title: 'Consulta sobre Llano Grande (Alvarado)', turns: ['¿Qué características tiene Llano Grande Luxury Living Club?'] },
    { id: 17, title: 'Consulta sobre Río Claro (Mariquita)', turns: ['Me interesa Mariquita, ¿qué tienen en Río Claro?'] },
    { id: 18, title: 'Pregunta por Bono de Descuento (Puertabono)', turns: ['¿Tienen algún bono de descuento o promoción para los terrenos?'] },
    { id: 19, title: 'Agendamiento de Llamada Comercial con Asesor', turns: ['Quiero hablar con un asesor comercial mañana.', 'A las 10:00 am me queda perfecto.'] },
    { id: 20, title: 'Transferencia a Asesor Humano', turns: ['Por favor comunícame con un asesor humano ya mismo.'] },
  ];

  let totalLatency = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedTokens = 0;
  let totalCost = 0;
  let totalTurns = 0;
  let truncatedCount = 0;
  let hallucinationIssues = [];

  for (const sc of scenarios) {
    console.log(`--- [Escenario ${sc.id}/20] ${sc.title} ---`);
    let conversation = [{ role: 'system', content: fullPrompt }];

    for (let t = 0; t < sc.turns.length; t++) {
      const userMsg = sc.turns[t];
      conversation.push({ role: 'user', content: userMsg });
      
      const step = await callLuna(conversation);
      totalTurns++;
      totalLatency += step.latencyMs;
      totalInputTokens += step.usage.prompt_tokens;
      totalOutputTokens += step.usage.completion_tokens;
      totalCachedTokens += (step.usage.prompt_tokens_details?.cached_tokens || 0);
      totalCost += step.costUsd;

      if (step.finishReason === 'length') {
        truncatedCount++;
        console.log(`  [ALERTA] Respuesta truncada por límite de tokens!`);
      }

      console.log(`  Turno ${t + 1} Lead: "${userMsg}"`);

      // Verificación de alucinaciones
      const replyText = step.choice?.content || '';
      if (/tubar[aá]|barranquilla/i.test(replyText)) {
        hallucinationIssues.push(`Escenario ${sc.id}: Mencionó Tubará/Barranquilla`);
      }
      if (/financiaci[oó]n|financiar/i.test(replyText)) {
        hallucinationIssues.push(`Escenario ${sc.id}: Usó palabra prohibida financiación`);
      }
      if (/93\s*millones/i.test(replyText)) {
        hallucinationIssues.push(`Escenario ${sc.id}: Mencionó precio no autorizado $93M`);
      }

      if (step.choice?.tool_calls && step.choice.tool_calls.length > 0) {
        for (const tc of step.choice.tool_calls) {
          console.log(`  -> TOOL: ${tc.function.name}(${tc.function.arguments})`);
          let toolResult = { ok: true, mensaje: 'Acción completada con éxito' };
          conversation.push(step.choice);
          conversation.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) });

          // Follow-up
          const followUp = await callLuna(conversation);
          totalTurns++;
          totalLatency += followUp.latencyMs;
          totalInputTokens += followUp.usage.prompt_tokens;
          totalOutputTokens += followUp.usage.completion_tokens;
          totalCachedTokens += (followUp.usage.prompt_tokens_details?.cached_tokens || 0);
          totalCost += followUp.costUsd;
          console.log(`  -> Victoria: "${followUp.choice?.content?.substring(0, 150)}..." (${step.latencyMs + followUp.latencyMs}ms)`);
          conversation.push(followUp.choice);
        }
      } else {
        console.log(`  -> Victoria: "${replyText.substring(0, 150)}..." (${step.latencyMs}ms)`);
        conversation.push(step.choice);
      }
    }
    console.log('');
  }

  console.log('===============================================================');
  console.log('           RESULTADOS DE LA SUITE DE 20 ESCENARIOS             ');
  console.log('===============================================================');
  console.log(`- Total conversaciones: 20`);
  console.log(`- Total turnos ejecutados: ${totalTurns}`);
  console.log(`- Respuestas truncadas: ${truncatedCount} (0 es óptimo)`);
  console.log(`- Alucinaciones detectadas: ${hallucinationIssues.length === 0 ? '0 (NINGUNA)' : hallucinationIssues.join(', ')}`);
  console.log(`- Latencia promedio por llamada: ${Math.round(totalLatency / totalTurns)} ms`);
  console.log(`- Tokens de Entrada promedio por llamada: ${Math.round(totalInputTokens / totalTurns)}`);
  console.log(`- Tokens en Caché promedio por llamada: ${Math.round(totalCachedTokens / totalTurns)} (${Math.round((totalCachedTokens / totalInputTokens) * 100)}% en caché)`);
  console.log(`- Tokens de Salida promedio por llamada: ${Math.round(totalOutputTokens / totalTurns)}`);
  console.log(`- Costo total de las 20 conversaciones: $${totalCost.toFixed(5)} USD`);
  console.log(`- Costo promedio por conversación completa: $${(totalCost / 20).toFixed(5)} USD (~$${((totalCost / 20) * 4000).toFixed(1)} COP)`);
  
  // Proyección mensual real para 700 leads con todo el prompt completo e historial:
  const costPerLeadComplete = (totalCost / 20);
  const monthly700Leads = 700 * costPerLeadComplete;
  console.log(`\n===============================================================`);
  console.log(`   PROYECCIÓN MENSUAL DEFINITIVA PARA 700 LEADS (PROMPT COMPLETO)`);
  console.log(`===============================================================`);
  console.log(`- Costo mensual proyectado: $${monthly700Leads.toFixed(2)} USD`);
  console.log(`- En pesos colombianos (TRM ~4.000): ~$${(monthly700Leads * 4000).toLocaleString('es-CO')} COP`);
  console.log(`===============================================================`);
}

run20Scenarios().catch(console.error);
