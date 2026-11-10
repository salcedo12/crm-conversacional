const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');

if (admin.apps.length === 0) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

async function run() {
  console.log('--- ACTUALIZANDO PROMPT EXCLUSIVAMENTE PARA EMPRESA_DEMO ---');
  const demoRef = db.collection('companies').doc('empresa_demo').collection('aiConfigs').doc('default');
  const docSnap = await demoRef.get();
  
  if (!docSnap.exists) {
    throw new Error('No existe aiConfigs/default en empresa_demo');
  }

  let prompt = docSnap.data().basePrompt;
  const originalLength = prompt.length;

  // 1. Reemplazar regla en sección introductoria (línea 27)
  prompt = prompt.replace(
    '- No des cotizaciones exactas.\n- No inventes disponibilidad de terrenos, precios, descuentos, fechas, horas ni citas.',
    '- No des cotizaciones exactas inventadas. Toda cotización específica debe generarse exclusivamente mediante la herramienta oficial enviar_cotizacion.\n- No inventes disponibilidad de terrenos, precios, descuentos, fechas, horas ni citas.'
  );

  // 2. Reemplazar Sección 6 (Precios)
  const oldSec6 = `### Precios\n\nRespuesta autorizada:\n\nActualmente contamos con precios desde $129.990.000, dependiendo del tamaño del terreno, la ubicacion del club de campo y las condiciones comerciales vigentes. Las cotizaciones exactas y opciones de pago se revisan de forma personalizada con el equipo comercial.\n\nLuego puedes preguntar:\n\n¿Te gustaria que revisemos una llamada para darte una cotizacion personalizada?\n\nReglas:\n- Siempre usa "precios desde $129.990.000".\n- No digas que todos los terrenos cuestan eso.\n- No inventes cuotas, descuentos, tasas ni valores exactos.\n- Di "plazos de pago", no "financiacion", salvo que haya informacion oficial.`;

  const newSec6 = `### Precios\n\nRespuesta autorizada:\n\nActualmente contamos con terrenos campestres desde $129.990.000, dependiendo del tamaño del terreno, la ubicación del club de campo y las condiciones comerciales vigentes.\n\nEn esa misma conversación puedes explicar naturalmente que manejamos cuatro modalidades comerciales:\n- Pago de contado.\n- Financiación a 20 meses.\n- Financiación a 30 meses.\n- Financiación a 40 meses.\n\nReglas:\n- Siempre usa "precios desde $129.990.000". NUNCA uses otros precios base.\n- Una consulta general de precios NO debe activar automáticamente la herramienta de cotización.\n- No inventes cuotas, descuentos, tasas ni valores exactos sin la herramienta oficial cotizadora.`;

  if (prompt.includes(oldSec6)) {
    prompt = prompt.replace(oldSec6, newSec6);
    console.log('✓ Sección 6 actualizada con éxito');
  } else {
    console.warn('⚠ Advertencia: Sección 6 no coincidió exactamente');
  }

  // 3. Reemplazar Sección 9 (Precios y Cotizaciones)
  const oldSec9 = `## 9. PRECIOS Y COTIZACIONES\n\nPrecio autorizado: desde $129.990.000.\n\nNo des cotizaciones exactas por chat. Para cotizacion exacta, forma de pago, bonos o disponibilidad puntual, guia hacia una llamada con el equipo comercial.`;

  const newSec9 = `## 9. PRECIOS Y COTIZACIONES\n\nPrecio publicitario oficial: desde $129.990.000.\n\nModalidades comerciales autorizadas (EXCLUSIVAS):\n1. Contado.\n2. Financiación a 20 meses.\n3. Financiación a 30 meses.\n4. Financiación a 40 meses.\n\nReglas obligatorias de cotización:\n- Consulta general de precios ("¿cuánto valen?", "precio", "¿desde cuánto?"): Responde naturalmente informando el precio desde $129.990.000 y explica las 4 modalidades comerciales autorizadas (contado, 20, 30 y 40 meses). PROHIBIDO activar automáticamente la herramienta enviar_cotizacion ante una pregunta general de precios.\n- Cotización bajo demanda: Se genera EXCLUSIVAMENTE cuando el cliente solicita conocer el valor específico de un terreno concreto, sus cuotas o una propuesta de pago, y están identificados el proyecto, sector, terreno y modalidad. Si faltan datos, obténlos conversacionalmente sin interrogar.\n- Valores oficiales: Toda cotización específica debe provenir de la herramienta enviar_cotizacion. NUNCA realices cálculos financieros manuales ni inventes cuotas.\n- Plazos no autorizados: Si el cliente pide plazos de 12, 24, 36 meses u otros no autorizados, explícale amablemente que las modalidades autorizadas son contado, 20, 30 y 40 meses, y ofrécele la opción autorizada más cercana sin modificar su elección sin su consentimiento.\n- Protección contra duplicados: Si el cliente ya recibió una cotización y responde "sí", "ese", "me gusta", "listo" o similar, continúa la conversación hacia el agendamiento o asesoría sin volver a enviar la cotización.\n- Cambio de modalidad: Si el cliente solicita cambiar de contado a 20, 30 o 40 meses (o entre cuotas), genera la nueva cotización correspondiente.`;

  if (prompt.includes(oldSec9)) {
    prompt = prompt.replace(oldSec9, newSec9);
    console.log('✓ Sección 9 actualizada con éxito');
  } else {
    console.warn('⚠ Advertencia: Sección 9 no coincidió exactamente');
  }

  // Guardar en Firestore para empresa_demo
  await demoRef.update({
    basePrompt: prompt,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`✓ Prompt de empresa_demo actualizado. Longitud previa: ${originalLength}, nueva: ${prompt.length}`);

  // Verificación de aislamiento estricto
  const merakiDoc = await db.collection('companies').doc('grupo_meraki_real').collection('aiConfigs').doc('default').get();
  console.log(`✓ Verificación de aislamiento: grupo_meraki_real permanece intacto con longitud ${merakiDoc.data().basePrompt.length}`);
}

run().catch(console.error);
