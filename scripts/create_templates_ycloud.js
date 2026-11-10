const https = require('https');
const admin = require('../functions/node_modules/firebase-admin');
const sa = require('../service-account.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

function ycloudPost(apiKey, path, body) {
  const bodyStr = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.ycloud.com',
      path,
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(d) });
        } catch {
          resolve({ status: res.statusCode, raw: d });
        }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

const templatesToCreate = [
  {
    name: 'lead_espana_marketing',
    category: 'MARKETING',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: 'Hola 👋 Soy Victoria Sarmiento, asistente virtual de Grupo Constructor Meraki.\n\nRecibimos tu solicitud desde España 🇪🇸 para conocer nuestras opciones de inversión en lotes campestres en Colombia.\n\nUn asesor puede ayudarte con:\n• Proyectos disponibles\n• Precios y beneficios comerciales\n• Opciones de pago\n• Proceso de compra desde el exterior\n\n¿Quieres que te conecte ahora con un asesor comercial?'
      }
    ]
  },
  {
    name: 'pauta_formulario_corferias_2026',
    category: 'MARKETING',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: 'Hola 👋\n\n¡Recibimos tu registro!\n\nSoy tu asesor de Grupo Constructor Meraki, y estaré acompañándote para que conozcas nuestros proyectos y beneficios disponibles durante el Gran Salón Inmobiliario en Corferias 2026.\n\nAntes de enviarte la información, cuéntame:\n\n¿Qué te gustaría conocer primero?'
      },
      {
        type: 'FOOTER',
        text: 'Con Meraki, vas a la fija!'
      }
    ]
  },
  {
    name: 'reactivacion_de_clientes',
    category: 'MARKETING',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: 'Hola, {{1}} 👋 Vimos que dejaste pendiente la información sobre nuestros terrenos campestres.\n\nHoy puedes retomar tu proceso y conocer las opciones disponibles, precios y planes de pago.\n\n¿Te envío la información actualizada?',
        example: {
          body_text: [['Pedro']]
        }
      }
    ]
  },
  {
    name: 'confirmacion_de_cita',
    category: 'MARKETING',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: 'Hola {{1}} \nSoy Victoria Sarmiento, agente inmobiliaria de Grupo Constructor Meraki. 🌿\n\nTe confirmo tu cita para conocer más sobre nuestros clubes de campo y proyectos campestres.\n\n🗓 Fecha y hora: {{2}}\n\nEstaré esperándote para resolver todas tus dudas y acompañarte a dar el siguiente paso hacia una inversión inteligente. 🍃',
        example: {
          body_text: [['Eduardo Salcedo', 'lunes 24 de agosto a las 3:00 p. m.']]
        }
      }
    ]
  },
  {
    name: 'saludo_pagina_web',
    category: 'MARKETING',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: 'Hola {{1}}\n🌳🌴 ¡Bienvenido(a) a Grupo Constructor MERAKI! 🌴🌳\nGracias por registrarte en nuestro sitio web. Este es nuestro canal oficial de ventas y atención al cliente.\n\nAl comunicarte por este medio, y conforme a la Ley 1581 de 2012, autorizas el tratamiento de tus datos personales con fines informativos, institucionales y comerciales.\n\n✨ ¡Gracias por tu interés! En breve uno de nuestros asesores te contactará.\n¿Podrías confirmarme con quién tengo el gusto de hablar?',
        example: {
          body_text: [['Eduardo']]
        }
      }
    ]
  },
  {
    name: 'cita_asesor',
    category: 'UTILITY',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: '📅 ¡Nueva cita agendada!\n\nCliente: {{1}}\nTeléfono: {{2}}\nFecha: {{3}}\nHora: {{4}}\n\nContáctalo y revisa los detalles en el CRM.',
        example: {
          body_text: [['María Pérez', '+57 300 123 4567', 'sábado 16 de agosto de 2026', '10:00 a. m.']]
        }
      }
    ]
  },
  {
    name: 'reactivacion_con_pregunta_de_interes',
    category: 'MARKETING',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: 'Hola, ¿cómo estás?\n\nQueríamos saludarte y saber si aún sigues interesado(a) en tener tu espacio en el campo 🌿. \n\nActualmente contamos con proyectos en Melgar, Mariquita y Alvarado (Tolima), sobre vía nacional, con toda la documentación legal y con la tranquilidad de que ya hemos entregado 4 proyectos. \n\nAdemás, ofrecemos facilidades de pago para que invertir sea mucho más sencillo 🤝\n\nNos ayudaría mucho saber si deseas continuar con la información. Puedes responder a este mensaje con un sí o un no, sin compromiso 🙌\n\nQuedamos muy atentos a tu respuesta.'
      }
    ]
  },
  {
    name: 'beneficios_corferias_presencial_virtual_2026',
    category: 'MARKETING',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: '🔥 ¡Los beneficios de Corferias también llegan hasta ti!\n\nDel 20 al 23 de agosto, Grupo Constructor Meraki estará en el Gran Salón Inmobiliario 2026 con beneficios exclusivos para invertir en proyectos campestres en el Tolima. 🌳\n\n📍 Corferias, pabellón 6, stand 125.\n\n¿No puedes viajar a Bogotá? ¡No importa! Puedes acceder a los beneficios y precios especiales de feria desde cualquier ciudad de Colombia o desde el exterior.\n\n🎁 Si asistirás, responde con el día: 20, 21, 22 o 23.\n📲 Si quieres recibir atención a distancia, responde: QUIERO BENEFICIOS.\n\n¡Esta oportunidad estará disponible únicamente durante los días de feria!\n\nMeraki — Líderes en hacer del campo tu segundo hogar.'
      },
      {
        type: 'FOOTER',
        text: 'Con Meraki, vas a la fija!'
      }
    ]
  },
  {
    name: 'ultima_oportunidad_corferias',
    category: 'MARKETING',
    language: 'es',
    components: [
      {
        type: 'HEADER',
        format: 'VIDEO',
        example: {
          header_url: ['https://firebasestorage.googleapis.com/v0/b/crm-conversacional.firebasestorage.app/o/companies%2Fgrupo_meraki_real%2Fmedia%2Ftemplates%2F1787500951686_VIDEO_7_-_1920_2_.mp4?alt=media&token=5f157c60-7d28-4921-bcb0-ed67f3f1f89a']
        }
      },
      {
        type: 'BODY',
        text: '🔥 ¡ÚLTIMO DÍA DE FERIA!\n\nLotes campestres desde 490 m² por $109.990.000. 🌴🏡\n\n📍 Corferias – Pabellón 6, Stand 125\n📲 O escríbenos desde cualquier lugar.\n\n¡Aprovecha HOY!'
      }
    ]
  }
];

async function run() {
  const credDoc = await db.collection('channelCredentials').doc('grupo_meraki_real').get();
  const apiKey = credDoc.data().ycloud.apiKey;
  const wabaId = credDoc.data().ycloud.wabaId;

  console.log(`Starting creation for WABA: ${wabaId}...`);

  for (const tpl of templatesToCreate) {
    const payload = {
      wabaId,
      name: tpl.name,
      language: tpl.language,
      category: tpl.category,
      components: tpl.components
    };

    console.log(`\nSubmitting ${tpl.name}...`);
    const res = await ycloudPost(apiKey, '/v2/whatsapp/templates', payload);
    if (res.status >= 200 && res.status < 300) {
      console.log(`✅ ${tpl.name}: status=${res.body?.status}, id=${res.body?.officialTemplateId || res.body?.id}`);
    } else {
      console.error(`❌ ${tpl.name}: HTTP ${res.status}`, JSON.stringify(res.body || res.raw));
    }
  }
}

run().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
