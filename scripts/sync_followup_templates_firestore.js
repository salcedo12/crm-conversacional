const path = require('path');
const admin = require(path.join(__dirname, '../functions/node_modules/firebase-admin'));
const sa = require(path.join(__dirname, '../service-account.json'));

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const companyId = 'grupo_meraki_real';

const templatesToSave = [
  {
    name: 'seguimiento_inicial_prospecto',
    displayName: 'Día 1 - Primer seguimiento (+24h)',
    category: 'marketing',
    language: 'es',
    body: '¡Hola, {{1}}! 👋🌿\n\nGracias por tu interés en los proyectos campestres de Grupo Constructor Meraki.\n\nQueremos ayudarte a encontrar el terreno campestre ideal para ti y tu familia. 🏡\n\n¿Te gustaría recibir la información de nuestros proyectos por WhatsApp o prefieres hablar directamente con uno de nuestros asesores?',
    variables: [{ key: '1', example: 'Carlos' }],
    buttons: [
      { type: 'quick_reply', text: 'Recibir información' },
      { type: 'quick_reply', text: 'Hablar con un asesor' }
    ],
    headerType: 'none',
    wabaId: '1602852641481306',
    lineNumber: '+573176820728',
    officialTemplateId: '1003878728629876',
    status: 'approved', // or pending, will update
    followUpStep: 0,
    followUpDelayMinutes: 1440,
    followUpLabel: 'Día 1 (+24h)'
  },
  {
    name: 'opciones_proyectos_meraki',
    displayName: 'Día 3 - Conoce nuestros proyectos (+72h)',
    category: 'marketing',
    language: 'es',
    body: '¡Hola, {{1}}! 🌿🏡\n\nEn Grupo Constructor Meraki tenemos diferentes opciones para que hagas del campo tu segundo hogar.\n\n📍 Melgar / Ricaurte\n🌴 Ciudad Country Laguna Mar: ideal para disfrutar del clima cálido y espacios de descanso.\n\n📍 Mariquita\n🌳 Río Claro: naturaleza, tranquilidad y espacios para compartir en familia.\n\n📍 Alvarado\n☀️ Cañón de Arizona, Llano Grande y Sobre Montañas: tres propuestas para disfrutar del campo, el descanso y el bienestar.\n\nAdemás, contamos con facilidades de pago directamente con la constructora.\n\n🏡 ¿En cuál de estas ubicaciones te gustaría conocer nuestros terrenos campestres?',
    variables: [{ key: '1', example: 'Carlos' }],
    buttons: [
      { type: 'quick_reply', text: 'Melgar / Ricaurte' },
      { type: 'quick_reply', text: 'Mariquita' },
      { type: 'quick_reply', text: 'Alvarado' }
    ],
    headerType: 'none',
    wabaId: '1602852641481306',
    lineNumber: '+573176820728',
    officialTemplateId: '1780048653200426',
    status: 'approved',
    followUpStep: 1,
    followUpDelayMinutes: 4320,
    followUpLabel: 'Día 3 (+72h)'
  },
  {
    name: 'reactivacion_interes_meraki',
    displayName: 'Día 8 - Reactivación de interés (+8 días)',
    category: 'marketing',
    language: 'es',
    body: '¡Hola, {{1}}! 👋🌿\n\nHace unos días nos contactaste mostrando interés en nuestros proyectos campestres de Grupo Constructor Meraki. 🏡\n\nNos gustaría retomar la conversación y ayudarte a encontrar la mejor opción para ti.\n\nDe los proyectos que tenemos en Melgar, Mariquita y Alvarado, ¿cuál te gustaría conocer más a fondo?\n\nEstaremos encantados de compartirte información sobre terrenos disponibles, amenidades y facilidades de pago.',
    variables: [{ key: '1', example: 'Carlos' }],
    buttons: [
      { type: 'quick_reply', text: 'Melgar / Ricaurte' },
      { type: 'quick_reply', text: 'Mariquita' },
      { type: 'quick_reply', text: 'Alvarado' }
    ],
    headerType: 'none',
    wabaId: '1602852641481306',
    lineNumber: '+573176820728',
    officialTemplateId: '1427717538806864',
    status: 'approved',
    followUpStep: 2,
    followUpDelayMinutes: 11520,
    followUpLabel: 'Día 8 (+192h)'
  }
];

async function syncToFirestore() {
  const colRef = db.collection('companies').doc(companyId).collection('whatsappTemplates');
  for (const t of templatesToSave) {
    // Check if doc exists with this name
    const q = await colRef.where('name', '==', t.name).get();
    if (!q.empty) {
      const docRef = q.docs[0].ref;
      await docRef.set({
        ...t,
        companyId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      console.log(`Updated Firestore doc: ${docRef.id} (${t.name})`);
    } else {
      const docRef = await colRef.add({
        ...t,
        companyId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log(`Created Firestore doc: ${docRef.id} (${t.name})`);
    }
  }

  // Also update aiConfig default followUpSequence to:
  // Day 1 (1440 min), Day 3 (4320 min), Day 8 (11520 min)
  const aiConfigRef = db.collection('companies').doc(companyId).collection('aiConfigs').doc('default');
  await aiConfigRef.set({
    followUpSequence: [
      { delayMinutes: 1440,  enabled: true, templateName: 'seguimiento_inicial_prospecto' },
      { delayMinutes: 4320,  enabled: true, templateName: 'opciones_proyectos_meraki' },
      { delayMinutes: 11520, enabled: true, templateName: 'reactivacion_interes_meraki' },
    ]
  }, { merge: true });
  console.log('Updated aiConfig default followUpSequence for grupo_meraki_real!');
}

syncToFirestore().catch(console.error);
