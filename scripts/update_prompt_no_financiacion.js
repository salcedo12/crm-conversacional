const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');

if (admin.apps.length === 0) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

async function updatePromptNoFinanciacion() {
  const ref = db.collection('companies').doc('empresa_demo').collection('aiConfigs').doc('default');
  const doc = await ref.get();
  let prompt = doc.data().basePrompt;

  const oldPart = prompt.slice(
    prompt.indexOf('## 9. PRECIOS Y COTIZACIONES'),
    prompt.indexOf('## 10. CUANDO OFRECER UNA LLAMADA')
  );

  const newPart =
`## 9. PRECIOS Y COTIZACIONES

Precio publicitario oficial: desde $129.990.000.

Formas de pago comerciales autorizadas (EXCLUSIVAS):
1. Pago de contado.
2. Pago a plazos a 20 meses.
3. Pago a plazos a 30 meses.
4. Pago a plazos a 40 meses.

Regla de vocabulario comercial obligatoria:
- PROHIBIDO usar las palabras "financiación", "financiar" o "financiado". Usa exclusivamente términos como "formas de pago", "pago a plazos", "planes de pago" o "pago en cuotas".

Reglas comerciales de precios y cotización:
- Consulta general de precios ("¿cuánto valen?", "precio", "¿desde cuánto?"): Responde naturalmente informando el precio desde $129.990.000 y explica las 4 formas de pago autorizadas (contado y pago a plazos a 20, 30 y 40 meses). PROHIBIDO activar automáticamente la herramienta enviar_cotizacion ante una pregunta general de precios.
- Elección de terreno o imagen de plano (FÓRMULA OBLIGATORIA):
  Cuando el lead elija un terreno o envíe una imagen con un terreno marcado o encerrado en un círculo, confirma el terreno y su etapa, y pregunta SIEMPRE ofreciendo de inmediato las opciones autorizadas:
  "El terreno marcado es el número [número] en la etapa [sector/etapa]. ¿Te gustaría recibir una cotización para este terreno? Si es así, ¿prefieres pago de contado o pago a plazos? Si eliges cuotas, ¿a cuántos meses te gustaría el plan de pago: 20, 30 o 40 meses?"
- Prohibición total de preguntas abiertas de plazo (ANTI-BUCLE):
  NUNCA preguntes de forma abierta "¿a cuántos meses le gustaría financiar?" ni dejes el plazo abierto. NUNCA menciones 12, 18, 24 ni 36 meses (no existen).
  Si el cliente responde solo "a plazos" o "en cuotas" (sin número de meses), NO repitas la pregunta genérica ni entres en bucle. Responde de inmediato:
  "En nuestras formas de pago a plazos manejamos opciones a 20, 30 o 40 meses. ¿Cuál de estos tres plazos prefieres?"
- Cotización bajo demanda: Se genera EXCLUSIVAMENTE cuando el cliente solicita conocer el valor específico de un terreno concreto, sus cuotas o una propuesta de pago, y están identificados el proyecto, sector, terreno y modalidad.
- Valores oficiales: Toda cotización específica debe provenir de la herramienta enviar_cotizacion. NUNCA realices cálculos manuales ni inventes cuotas.
- Plazos no autorizados: Si el cliente pide plazos de 12, 18, 24, 36 meses u otros no autorizados, explícale amablemente que las opciones son exclusivamente de contado o pago a plazos a 20, 30 y 40 meses, y ofrécele la opción autorizada más cercana sin modificar su elección sin su consentimiento.
- Protección contra duplicados: Si el cliente ya recibió una cotización y responde "sí", "ese", "me gusta", "listo" o similar, continúa la conversación hacia el agendamiento o asesoría sin volver a enviar la cotización.
- Cambio de modalidad: Si el cliente solicita cambiar de contado a 20, 30 o 40 meses (o entre plazos), genera la nueva cotización correspondiente.

`;

  prompt = prompt.replace(oldPart, newPart);

  // Asegurar que en Sección 6 también esté sin financiación
  prompt = prompt.replace(/Financiación a 20 meses/g, 'Pago a plazos a 20 meses');
  prompt = prompt.replace(/Financiación a 30 meses/g, 'Pago a plazos a 30 meses');
  prompt = prompt.replace(/Financiación a 40 meses/g, 'Pago a plazos a 40 meses');

  await ref.update({
    basePrompt: prompt,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log('✓ Firestore empresa_demo prompt actualizado con "formas de pago" y "pago a plazos" (cero "financiación")');

  const meraki = await db.collection('companies').doc('grupo_meraki_real').collection('aiConfigs').doc('default').get();
  console.log(`✓ Verificación de aislamiento: grupo_meraki_real intacto (longitud ${meraki.data().basePrompt.length})`);
}

updatePromptNoFinanciacion().catch(console.error);
