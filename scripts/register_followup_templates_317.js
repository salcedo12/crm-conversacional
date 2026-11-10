const https = require('https');

const API_KEY = '7586167436e1cc2c8b3bfdb34a9bf50c';
const WABA_ID = '1602852641481306';

function ycloudPost(path, body) {
  const bodyStr = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.ycloud.com',
      path,
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY,
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

const templates = [
  {
    name: 'seguimiento_inicial_prospecto',
    category: 'MARKETING',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: '¡Hola, {{1}}! 👋🌿\n\nGracias por tu interés en los proyectos campestres de Grupo Constructor Meraki.\n\nQueremos ayudarte a encontrar el terreno campestre ideal para ti y tu familia. 🏡\n\n¿Te gustaría recibir la información de nuestros proyectos por WhatsApp o prefieres hablar directamente con uno de nuestros asesores?',
        example: {
          body_text: [['Carlos']]
        }
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'QUICK_REPLY',
            text: 'Recibir información'
          },
          {
            type: 'QUICK_REPLY',
            text: 'Hablar con un asesor'
          }
        ]
      }
    ]
  },
  {
    name: 'opciones_proyectos_meraki',
    category: 'MARKETING',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: '¡Hola, {{1}}! 🌿🏡\n\nEn Grupo Constructor Meraki tenemos diferentes opciones para que hagas del campo tu segundo hogar.\n\n📍 Melgar / Ricaurte\n🌴 Ciudad Country Laguna Mar: ideal para disfrutar del clima cálido y espacios de descanso.\n\n📍 Mariquita\n🌳 Río Claro: naturaleza, tranquilidad y espacios para compartir en familia.\n\n📍 Alvarado\n☀️ Cañón de Arizona, Llano Grande y Sobre Montañas: tres propuestas para disfrutar del campo, el descanso y el bienestar.\n\nAdemás, contamos con facilidades de pago directamente con la constructora.\n\n🏡 ¿En cuál de estas ubicaciones te gustaría conocer nuestros terrenos campestres?',
        example: {
          body_text: [['Carlos']]
        }
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'QUICK_REPLY',
            text: 'Melgar / Ricaurte'
          },
          {
            type: 'QUICK_REPLY',
            text: 'Mariquita'
          },
          {
            type: 'QUICK_REPLY',
            text: 'Alvarado'
          }
        ]
      }
    ]
  },
  {
    name: 'reactivacion_interes_meraki',
    category: 'MARKETING',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: '¡Hola, {{1}}! 👋🌿\n\nHace unos días nos contactaste mostrando interés en nuestros proyectos campestres de Grupo Constructor Meraki. 🏡\n\nNos gustaría retomar la conversación y ayudarte a encontrar la mejor opción para ti.\n\nDe los proyectos que tenemos en Melgar, Mariquita y Alvarado, ¿cuál te gustaría conocer más a fondo?\n\nEstaremos encantados de compartirte información sobre terrenos disponibles, amenidades y facilidades de pago.',
        example: {
          body_text: [['Carlos']]
        }
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'QUICK_REPLY',
            text: 'Melgar / Ricaurte'
          },
          {
            type: 'QUICK_REPLY',
            text: 'Mariquita'
          },
          {
            type: 'QUICK_REPLY',
            text: 'Alvarado'
          }
        ]
      }
    ]
  }
];

async function main() {
  console.log(`Submitting 3 templates to Line 317 WABA: ${WABA_ID}...`);
  for (const t of templates) {
    const payload = {
      wabaId: WABA_ID,
      name: t.name,
      language: t.language,
      category: t.category,
      components: t.components
    };
    console.log(`\nSubmitting ${t.name}...`);
    const res = await ycloudPost('/v2/whatsapp/templates', payload);
    console.log(`Result: ${res.status}`, JSON.stringify(res.body || res.raw, null, 2));
  }
}

main().catch(console.error);
