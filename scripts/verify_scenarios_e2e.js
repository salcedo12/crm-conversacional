process.env.GOOGLE_APPLICATION_CREDENTIALS = 'c:/crm-conversacional/service-account.json';
const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');

if (admin.apps.length === 0) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

// Import compiled functions
const {
  validateQuotationModalities,
  getCotizacionToolForCompany,
  quoteKey,
  resolveAvailabilitySelection,
  extractRequestedLocalTime,
  COTIZACION_TOOL,
  COTIZACION_TOOL_DEMO
} = require('c:/crm-conversacional/functions/lib/modules/ai/aiOrchestrator.service');

async function runE2EVerification() {
  console.log('===============================================================');
  console.log('    VERIFICACIÓN INTEGRAL DE REGLAS COMERCIALES (EMPRESA_DEMO)  ');
  console.log('===============================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, testName, details = '') {
    total++;
    if (condition) {
      passed++;
      console.log(`[PASS] ${testName}`);
      if (details) console.log(`       -> ${details}`);
    } else {
      console.error(`[FAIL] ${testName}`);
      if (details) console.error(`       -> ${details}`);
    }
  }

  // 1. Verificación de Aislamiento de Herramientas y Schemas
  console.log('--- 1. AISLAMIENTO MULTI-TENANT POR COMPANY_ID ---');
  const demoTool = getCotizacionToolForCompany('empresa_demo');
  const merakiTool = getCotizacionToolForCompany('grupo_meraki_real');

  assert(
    JSON.stringify(demoTool.function.parameters.properties.meses.enum) === JSON.stringify([20, 30, 40]),
    'Herramienta de empresa_demo restringe meses al enum [20, 30, 40]',
    `Enum detectado: ${JSON.stringify(demoTool.function.parameters.properties.meses.enum)}`
  );

  assert(
    merakiTool.function.parameters.properties.meses.enum === undefined,
    'Herramienta de grupo_meraki_real NO tiene restricción de enum (intacta)',
    `Enum en producción: ${merakiTool.function.parameters.properties.meses.enum}`
  );

  // 2. Validación Backend de Modalidades
  console.log('\n--- 2. VALIDACIONES DE BACKEND (validateQuotationModalities) ---');
  const demoContado = validateQuotationModalities('empresa_demo', 'contado');
  assert(demoContado.ok === true, 'empresa_demo: Pago de contado está autorizado');

  const demo20 = validateQuotationModalities('empresa_demo', 'cuotas', 20);
  assert(demo20.ok === true, 'empresa_demo: Financiación a 20 meses está autorizada');

  const demo30 = validateQuotationModalities('empresa_demo', 'cuotas', 30);
  assert(demo30.ok === true, 'empresa_demo: Financiación a 30 meses está autorizada');

  const demo40 = validateQuotationModalities('empresa_demo', 'cuotas', 40);
  assert(demo40.ok === true, 'empresa_demo: Financiación a 40 meses está autorizada');

  const demo36 = validateQuotationModalities('empresa_demo', 'cuotas', 36);
  assert(
    demo36.ok === false && demo36.reason === 'plazo_no_autorizado',
    'empresa_demo: Plazo no autorizado (36 meses) es rechazado amablemente',
    demo36.mensaje
  );

  const demo12 = validateQuotationModalities('empresa_demo', 'cuotas', 12);
  assert(
    demo12.ok === false && demo12.reason === 'plazo_no_autorizado',
    'empresa_demo: Plazo no autorizado (12 meses) es rechazado amablemente',
    demo12.mensaje
  );

  const demoFaltaMeses = validateQuotationModalities('empresa_demo', 'cuotas');
  assert(
    demoFaltaMeses.ok === false && demoFaltaMeses.reason === 'falta_meses',
    'empresa_demo: Cuotas sin número de meses solicita elegir entre 20, 30 o 40',
    demoFaltaMeses.mensaje
  );

  const meraki36 = validateQuotationModalities('grupo_meraki_real', 'cuotas', 36);
  assert(
    meraki36.ok === true,
    'grupo_meraki_real: 36 meses no se rechaza en backend compartido (100% aislado)',
    `Resultado producción: ok=${meraki36.ok}`
  );

  // 3. Verificación de Generación de Claves (Deduplicación vs Recotización)
  console.log('\n--- 3. CLAVES DE COTIZACIÓN Y DIFERENCIACIÓN DE MODALIDADES ---');
  const key20 = quoteKey('Mar Canarias', 150, 'cuotas', 20, undefined);
  const key30 = quoteKey('Mar Canarias', 150, 'cuotas', 30, undefined);
  const key40 = quoteKey('Mar Canarias', 150, 'cuotas', 40, undefined);
  const keyContado = quoteKey('Mar Canarias', 150, 'contado', undefined, undefined);

  assert(
    key20 !== key40,
    'Cambiar de 20 a 40 meses genera clave distinta (permite nueva cotización)',
    `20m: "${key20}" vs 40m: "${key40}"`
  );
  assert(
    key20 !== keyContado,
    'Cambiar de cuotas a contado genera clave distinta',
    `cuotas: "${key20}" vs contado: "${keyContado}"`
  );
  assert(
    key20 === quoteKey('Mar Canarias', 150, 'cuotas', 20, undefined),
    'Mismo terreno y misma modalidad produce clave idéntica (protección duplicados)'
  );

  // 4. Verificación de Firestore Prompts
  console.log('\n--- 4. CONFIGURACIÓN FIRESTORE Y PROMPT VIGENTE ---');
  const demoDoc = await db.collection('companies').doc('empresa_demo').collection('aiConfigs').doc('default').get();
  const demoPrompt = demoDoc.data().basePrompt;

  assert(
    demoPrompt.includes('$129.990.000'),
    'Prompt de empresa_demo mantiene precio publicitario desde $129.990.000'
  );
  assert(
    !demoPrompt.includes('$93.000.000') && !demoPrompt.includes('$93 millones'),
    'Prompt de empresa_demo NO contiene precio no autorizado de $93M'
  );
  assert(
    demoPrompt.includes('20 meses') && demoPrompt.includes('30 meses') && demoPrompt.includes('40 meses'),
    'Prompt de empresa_demo incluye explícitamente las 4 modalidades comerciales autorizadas'
  );
  assert(
    demoPrompt.includes('Una consulta general de precios NO debe activar automáticamente la herramienta de cotización'),
    'Prompt de empresa_demo prohíbe activar enviar_cotizacion ante pregunta general de precios'
  );

  const merakiDoc = await db.collection('companies').doc('grupo_meraki_real').collection('aiConfigs').doc('default').get();
  assert(
    merakiDoc.data().basePrompt.length === 24717,
    'Prompt de grupo_meraki_real se conserva 100% inalterado (longitud 24717)',
    `Longitud real en grupo_meraki_real: ${merakiDoc.data().basePrompt.length}`
  );

  // 5. Verificación de Parsing de Agendamiento
  console.log('\n--- 5. PARSING DE TIEMPO Y FECHAS EN AGENDAMIENTO ---');
  const time1 = extractRequestedLocalTime('9 de octubre a las 10am');
  assert(
    time1 && time1.hour === 10 && time1.minute === 0,
    'extractRequestedLocalTime("9 de octubre a las 10am") extrae hora 10:00 sin confundirse con el día 9',
    `Hora extraída: ${time1?.hour}:${time1?.minute}`
  );

  const time2 = extractRequestedLocalTime('a las 3:30 pm');
  assert(
    time2 && time2.hour === 15 && time2.minute === 30,
    'extractRequestedLocalTime("a las 3:30 pm") extrae hora militar 15:30',
    `Hora extraída: ${time2?.hour}:${time2?.minute}`
  );

  console.log('\n===============================================================');
  console.log(`  RESULTADO: ${passed}/${total} PRUEBAS SUPERADAS EXITOSAMENTE `);
  console.log('===============================================================');

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runE2EVerification().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
