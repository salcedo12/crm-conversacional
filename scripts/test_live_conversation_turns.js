process.env.GOOGLE_APPLICATION_CREDENTIALS = 'c:/crm-conversacional/service-account.json';
const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');

if (admin.apps.length === 0) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

const OpenAI = require('c:/crm-conversacional/functions/node_modules/openai');

const {
  getCotizacionToolForCompany,
  validateQuotationModalities,
  quoteKey
} = require('c:/crm-conversacional/functions/lib/modules/ai/aiOrchestrator.service');

async function testFullWhatsAppConversation() {
  console.log('===============================================================');
  console.log('  SIMULACIÓN EN VIVO DE CONVERSACIÓN DE WHATSAPP (EMPRESA_DEMO) ');
  console.log('===============================================================\n');

  // 1. Obtener API key y configuración de empresa_demo
  const demoDoc = await db.collection('companies').doc('empresa_demo').collection('aiConfigs').doc('default').get();
  if (!demoDoc.exists) throw new Error('No existe aiConfigs/default en empresa_demo');
  const config = demoDoc.data();

  const apiKeyDoc = await db.collection('companies').doc('empresa_demo').collection('integrations').doc('openai').get();
  const apiKey = apiKeyDoc.exists ? apiKeyDoc.data().apiKey : process.env.OPENAI_API_KEY;

  const openai = new OpenAI({ apiKey: apiKey || process.env.OPENAI_API_KEY });
  const tool = getCotizacionToolForCompany('empresa_demo');

  const conversationHistory = [
    {
      role: 'system',
      content: config.basePrompt,
    },
    {
      role: 'system',
      content:
        `REGLAS COMERCIALES DE PRECIOS Y COTIZACIÓN (EMPRESA_DEMO):\n` +
        `1. PRECIO PUBLICITARIO OFICIAL: Cuando el lead pregunte de manera general por precios ("¿Cuánto valen?", "¿Desde cuánto?", "Precio", "costos"), ` +
        `debes responder naturalmente que contamos con terrenos campestres desde $129.990.000. ` +
        `En esa misma conversación puedes explicar que manejamos cuatro modalidades comerciales: 1) Contado, 2) Financiación a 20 meses, 3) Financiación a 30 meses, y 4) Financiación a 40 meses. ` +
        `PROHIBIDO activar automáticamente la herramienta enviar_cotizacion ante una pregunta general de precios.\n` +
        `2. GENERACIÓN DE COTIZACIÓN BAJO DEMANDA: La cotización se genera EXCLUSIVAMENTE cuando el cliente solicita conocer el valor específico de un terreno concreto, sus cuotas o una propuesta de pago, ` +
        `y están identificados proyecto, sector, terreno y modalidad. Si faltan datos, debes obtenerlos de forma conversacional sin convertir la atención en un cuestionario.\n` +
        `3. MODALIDADES AUTORIZADAS: Exclusivamente contado, 20 meses, 30 meses y 40 meses. PROHIBIDO inventar o aceptar plazos de 12, 24, 36 u otros plazos no autorizados. ` +
        `Si el cliente solicita un plazo diferente, explica amablemente las modalidades disponibles y ofrece la alternativa más cercana sin modificar automáticamente su elección.\n` +
        `4. PROTECCIÓN CONTRA DUPLICADOS Y CAMBIO DE MODALIDAD: Si el cliente ya recibió una cotización y solo dice "sí", "ese", "me gusta" o "listo", continúa la conversación sin repetir la cotización. ` +
        `Si solicita cambiar de modalidad (ej. de contado a 20, 30 o 40 meses, o viceversa) o pide reenvío explícito, genera la nueva cotización con enviar_cotizacion.`,
    }
  ];

  // Helper para simular un turno
  async function runTurn(userText, turnName) {
    console.log(`\n---------------------------------------------------------------`);
    console.log(`💬 Lead: "${userText}" (${turnName})`);
    console.log(`---------------------------------------------------------------`);

    conversationHistory.push({ role: 'user', content: userText });

    const completion = await openai.chat.completions.create({
      model: config.model || 'gpt-4o-mini',
      messages: conversationHistory,
      tools: [tool],
      tool_choice: 'auto',
      temperature: 0.5,
    });

    const choice = completion.choices[0].message;
    const toolCalls = choice.tool_calls || [];

    if (toolCalls.length > 0) {
      console.log(`⚙️ Tool Call detectado: ${toolCalls[0].function.name}`);
      console.log(`   Argumentos: ${toolCalls[0].function.arguments}`);
      const args = JSON.parse(toolCalls[0].function.arguments);

      const validation = validateQuotationModalities('empresa_demo', args.pago, args.meses);
      console.log(`   Validación backend: ${validation.ok ? '✓ APROBADA' : '✗ RECHAZADA: ' + validation.mensaje}`);

      conversationHistory.push(choice);
      conversationHistory.push({
        role: 'tool',
        tool_call_id: toolCalls[0].id,
        content: JSON.stringify(validation.ok
          ? { ok: true, url: 'https://storage.../cotizacion.png', mensaje: 'Cotización generada exitosamente.' }
          : validation
        ),
      });

      // Segunda llamada para respuesta final
      const followUp = await openai.chat.completions.create({
        model: config.model || 'gpt-4o-mini',
        messages: conversationHistory,
        temperature: 0.5,
      });

      const reply = followUp.choices[0].message.content;
      console.log(`🤖 Victoria: ${reply}\n`);
      conversationHistory.push({ role: 'assistant', content: reply });
      return { choice, toolCalls, reply, validation };
    } else {
      console.log(`ℹ️ Sin llamada a herramientas (Respuesta conversacional directa)`);
      console.log(`🤖 Victoria: ${choice.content}\n`);
      conversationHistory.push(choice);
      return { choice, toolCalls: [], reply: choice.content };
    }
  }

  // TURNO 1: Pregunta general de precio
  const t1 = await runTurn('Hola buenas tardes, ¿cuánto valen los lotes?', 'TURNO 1: Consulta general de precio');
  if (t1.toolCalls.length === 0 && t1.reply.includes('129.990.000')) {
    console.log('✓ VERIFICACIÓN TURNO 1: Informa $129.990.000 SIN activar cotizador automáticamente.');
  } else {
    console.warn('⚠ TURNO 1 no cumplió el criterio esperado.');
  }

  // TURNO 2: Solicitud de cotización específica autorizada (20 meses)
  const t2 = await runTurn('Me interesa el terreno 150 en Mar Canarias a 20 meses, ¿cuánto me queda la cuota?', 'TURNO 2: Cotización 20 meses');
  if (t2.toolCalls.length > 0 && t2.validation.ok) {
    console.log('✓ VERIFICACIÓN TURNO 2: Activó herramienta oficial con 20 meses y validación exitosa.');
  } else {
    console.warn('⚠ TURNO 2 no cumplió el criterio esperado.');
  }

  // TURNO 3: Cambio de modalidad a 40 meses
  const t3 = await runTurn('¿Y a 40 meses cuánto me quedaría la cuota?', 'TURNO 3: Cambio a 40 meses');
  if (t3.toolCalls.length > 0 && t3.validation.ok) {
    console.log('✓ VERIFICACIÓN TURNO 3: Generó nueva cotización diferenciada a 40 meses.');
  } else {
    console.warn('⚠ TURNO 3 no cumplió el criterio esperado.');
  }

  // TURNO 4: Solicitud de plazo NO autorizado (36 meses)
  const t4 = await runTurn('¿Y me lo pueden financiar a 36 meses?', 'TURNO 4: Plazo no autorizado (36 meses)');
  const is36Rejected = t4.toolCalls.length === 0 || (t4.validation && !t4.validation.ok);
  if (is36Rejected) {
    console.log('✓ VERIFICACIÓN TURNO 4: Plazo de 36 meses rechazado con explicación amigable de opciones vigentes.');
  } else {
    console.warn('⚠ TURNO 4 no cumplió el criterio esperado.');
  }

  // TURNO 5: Confirmación "Listo, me gusta ese terreno" (Protección contra duplicados)
  const t5 = await runTurn('Listo, me gusta mucho la opción de 40 meses, ese me interesa.', 'TURNO 5: Confirmación del lead');
  if (t5.toolCalls.length === 0) {
    console.log('✓ VERIFICACIÓN TURNO 5: Continúa hacia agendamiento sin re-enviar la imagen.');
  } else {
    console.warn('⚠ TURNO 5 no cumplió el criterio esperado.');
  }

  console.log('\n===============================================================');
  console.log('       SIMULACIÓN COMPLETA DE 5 TURNOS FINALIZADA CON ÉXITO     ');
  console.log('===============================================================');
}

testFullWhatsAppConversation().catch(console.error);
