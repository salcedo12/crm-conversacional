const https = require('https');

const lines = [
  {
    name: 'Line 317 (Official Primary)',
    apiKey: '7586167436e1cc2c8b3bfdb34a9bf50c',
    wabaId: '1602852641481306'
  },
  {
    name: 'Line 314 (Secondary)',
    apiKey: '38b3a3b3d54e3f5a0e7810a5f203186f',
    wabaId: '1988571281873236'
  }
];

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

const templatePayload = {
  name: 'plan_referidos_meraki',
  category: 'MARKETING',
  language: 'es',
  components: [
    {
      type: 'BODY',
      text: '¡Hola, {{1}}! 👋 Qué gusto haber conversado contigo sobre {{2}}.\n\nQuiero dejarte una invitación especial: ¿sabías que puedes generar ingresos adicionales con Grupo Constructor Meraki sin comprar lote y sin experiencia en ventas? 🚀\n\nCon nuestro Plan de Referidos, ganas hasta $3.000.000 COP por cada amigo o familiar que recomiendes y adquiera su lote campestre con nosotros:\n✅ Sin límite de referidos.\n✅ Pago directo a tu cuenta tras cumplirse los requisitos de pago.\n✅ Registro 100% online.\n\n👉 Mira cómo funciona y registra tus referidos en nuestra web oficial:\nhttps://grupoconstructormeraki.com.co/referidos\n\n¡Quedo atento por si tienes a alguien en mente hoy mismo! 🤝',
      example: {
        body_text: [['Carlos', 'nuestros proyectos campestres']]
      }
    },
    {
      type: 'BUTTONS',
      buttons: [
        {
          type: 'QUICK_REPLY',
          text: 'Tengo un referido'
        },
        {
          type: 'QUICK_REPLY',
          text: 'Más información'
        }
      ]
    }
  ]
};

async function main() {
  for (const line of lines) {
    console.log(`\nSubmitting plan_referidos_meraki to ${line.name} (WABA: ${line.wabaId})...`);
    const payload = {
      wabaId: line.wabaId,
      ...templatePayload
    };
    const res = await ycloudPost(line.apiKey, '/v2/whatsapp/templates', payload);
    console.log(`Result: ${res.status}`, JSON.stringify(res.body || res.raw, null, 2));
  }
}

main().catch(console.error);
