const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const OpenAI = require('c:/crm-conversacional/functions/node_modules/openai');
const apiKey = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey });

const { buildCompletionParamsForCompany } = require('c:/crm-conversacional/functions/lib/modules/ai/aiOrchestrator.service');

async function testRollbackFlow() {
  console.log('=== VERIFICACIÓN DEL FLUJO DE ROLLBACK EN FIRESTORE ===');
  const docRef = db.collection('companies').doc('empresa_demo').collection('aiConfigs').doc('default');

  // 1. Estado inicial con Luna
  await docRef.update({ model: 'gpt-5.6-luna' });
  const snapLuna = await docRef.get();
  const configLuna = snapLuna.data();
  const paramsLuna = buildCompletionParamsForCompany('empresa_demo', configLuna, false, [{ role: 'user', content: 'hola' }]);
  console.log(`1. Modo Luna activo en Firestore -> Modelo resuelto: ${paramsLuna.model}, max_completion_tokens: ${paramsLuna.max_completion_tokens}`);
  if (paramsLuna.model !== 'gpt-5.6-luna') throw new Error('Falló activación de Luna');

  // 2. Ejecutar Rollback cambiando Firestore a gpt-4o-mini
  console.log('\n2. Ejecutando Rollback en Firestore: actualizando a model: "gpt-4o-mini"...');
  await docRef.update({ model: 'gpt-4o-mini' });
  const snapRollback = await docRef.get();
  const configRollback = snapRollback.data();
  const paramsRollback = buildCompletionParamsForCompany('empresa_demo', configRollback, false, [{ role: 'user', content: 'hola' }]);
  console.log(`   Modelo resuelto tras rollback: ${paramsRollback.model}, max_tokens: ${paramsRollback.max_tokens}, temp: ${paramsRollback.temperature}`);
  
  if (paramsRollback.model !== 'gpt-4o-mini' || paramsRollback.max_tokens !== 350) {
    throw new Error('Falló el rollback a gpt-4o-mini');
  }

  // 3. Probar llamada real con parámetros de rollback
  console.log('\n3. Probando llamada real a OpenAI con parámetros de rollback...');
  const t0 = Date.now();
  const resRollback = await openai.chat.completions.create(paramsRollback);
  console.log(`✓ Llamada exitosa en ${Date.now() - t0}ms con modelo ${resRollback.model}: "${resRollback.choices[0]?.message?.content?.trim()}"`);

  // 4. Restaurar estado de prueba de Luna
  console.log('\n4. Restaurando Firestore para prueba activa de gpt-5.6-luna...');
  await docRef.update({ model: 'gpt-5.6-luna' });
  const snapRestored = await docRef.get();
  const configRestored = snapRestored.data();
  const paramsRestored = buildCompletionParamsForCompany('empresa_demo', configRestored, false, [{ role: 'user', content: 'hola' }]);
  console.log(`✓ Estado restaurado a Luna -> Modelo: ${paramsRestored.model}`);
  
  console.log('\n>>> ROLLBACK EN FIRESTORE 100% VERIFICADO Y OPERATIVO <<<');
}

testRollbackFlow().catch(err => {
  console.error('ERROR EN TEST DE ROLLBACK:', err);
  process.exit(1);
});
