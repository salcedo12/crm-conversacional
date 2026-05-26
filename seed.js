/**
 * Seed script: crea colecciones iniciales en Firestore (crm-conversacional)
 * Usa firebase-admin con Application Default Credentials del Firebase CLI.
 * Ejecutar: node seed.js
 */

const path = require('path');
const https = require('https');
const fs = require('fs');

const PROJECT_ID = 'crm-conversacional';
const FB_TOOLS_PATH = path.join(
  process.env.APPDATA,
  'npm',
  'node_modules',
  'firebase-tools'
);

const admin = require(path.join(
  __dirname,
  'functions',
  'node_modules',
  'firebase-admin'
));

// Usar credenciales de la cuenta de servicio del Firebase CLI
// Esto requiere que "firebase login" se haya ejecutado antes.
// La forma más simple: obtener token via firebase-tools
async function getToken() {
  const tools = require(FB_TOOLS_PATH);
  const tokens = await tools.login.list();
  if (!tokens || tokens.length === 0) throw new Error('No hay sesión activa. Ejecuta: firebase login');
  // Usar el primer usuario autenticado
  const user = tokens[0];
  // tools.login.getToken no es público, usamos el api interno
  return user.tokens?.access_token || null;
}

function firestoreRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents${path}`,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => (responseData += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(responseData || '{}'));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function toFirestoreValue(value) {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number' && Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (value === null) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value).map(([k, v]) => [k, toFirestoreValue(v)])
        ),
      },
    };
  }
  return { stringValue: String(value) };
}

function buildDocument(data) {
  return {
    fields: Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, toFirestoreValue(v)])
    ),
  };
}

async function createDocument(collectionPath, docId, data, token) {
  const body = buildDocument(data);
  const result = await firestoreRequest(
    'PATCH',
    `/${collectionPath}/${docId}`,
    body,
    token
  );
  console.log(`  ✓ ${collectionPath}/${docId}`);
  return result;
}

async function seed() {
  console.log('\n🌱 Iniciando seed en Firestore...\n');

  let token;
  try {
    token = await getToken();
    if (!token) throw new Error('Token vacío');
  } catch (e) {
    console.error('❌ No se pudo obtener token de Firebase CLI:', e.message);
    console.log('\nAlternativa: ejecuta `firebase login` y vuelve a intentarlo.');
    process.exit(1);
  }

  const now = new Date().toISOString();

  try {
    // ── companies ──────────────────────────────────────────────────────────
    console.log('📁 companies/');
    await createDocument('companies', 'crm-conversacional', {
      name: 'Meraki CRM Demo',
      whatsappPhoneId: '',
      whatsappToken: '',
      createdAt: now,
      updatedAt: now,
    }, token);

    // ── users ──────────────────────────────────────────────────────────────
    console.log('\n📁 users/');
    await createDocument('users', 'admin-001', {
      companyId: 'crm-conversacional',
      name: 'Admin Principal',
      email: 'sistemas1.meraki@gmail.com',
      role: 'ADMIN',
      status: 'ACTIVE',
      assignedLeadsCount: 0,
      createdAt: now,
      updatedAt: now,
    }, token);

    await createDocument('users', 'asesor-001', {
      companyId: 'crm-conversacional',
      name: 'Asesor Demo',
      email: 'asesor@meraki.com',
      role: 'ADVISER',
      status: 'ACTIVE',
      assignedLeadsCount: 0,
      createdAt: now,
      updatedAt: now,
    }, token);

    // ── leads + conversación de demo ───────────────────────────────────────
    console.log('\n📁 leads/');
    await createDocument('leads', 'lead-demo-001', {
      companyId: 'crm-conversacional',
      phoneNumber: '+52 1 55 1234 5678',
      name: '+52 1 55 1234 5678',
      status: 'QUALIFYING',
      assignedToId: 'asesor-001',
      activeConversationId: 'conv-demo-001',
      lastMessageText: 'Sí, ¿qué horarios tienen disponibles mañana?',
      createdAt: now,
      updatedAt: now,
    }, token);

    await createDocument('leads', 'lead-demo-002', {
      companyId: 'crm-conversacional',
      phoneNumber: '+34 600 123 456',
      name: '+34 600 123 456',
      status: 'APPOINTMENT_SET',
      assignedToId: 'asesor-001',
      activeConversationId: 'conv-demo-002',
      lastMessageText: '✅ Cita Agendada (10 AM)',
      createdAt: now,
      updatedAt: now,
    }, token);

    await createDocument('leads', 'lead-demo-003', {
      companyId: 'crm-conversacional',
      phoneNumber: 'Juan Pérez (Web)',
      name: 'Juan Pérez',
      status: 'NEW',
      assignedToId: 'asesor-001',
      activeConversationId: 'conv-demo-003',
      lastMessageText: 'Quisiera precios...',
      createdAt: now,
      updatedAt: now,
    }, token);

    // ── conversaciones ─────────────────────────────────────────────────────
    console.log('\n📁 conversations/');
    await createDocument('conversations', 'conv-demo-001', {
      leadId: 'lead-demo-001',
      companyId: 'crm-conversacional',
      status: 'ACTIVE',
      aiActive: true,
      lastMessageText: 'Sí, ¿qué horarios tienen disponibles mañana?',
      createdAt: now,
      updatedAt: now,
    }, token);

    await createDocument('conversations', 'conv-demo-002', {
      leadId: 'lead-demo-002',
      companyId: 'crm-conversacional',
      status: 'ACTIVE',
      aiActive: false,
      lastMessageText: '✅ Cita Agendada (10 AM)',
      createdAt: now,
      updatedAt: now,
    }, token);

    await createDocument('conversations', 'conv-demo-003', {
      leadId: 'lead-demo-003',
      companyId: 'crm-conversacional',
      status: 'ACTIVE',
      aiActive: true,
      lastMessageText: 'Quisiera precios...',
      createdAt: now,
      updatedAt: now,
    }, token);

    // ── messages (subcolección de conv-demo-001) ───────────────────────────
    console.log('\n📁 conversations/conv-demo-001/messages/');
    await createDocument('conversations/conv-demo-001/messages', 'msg-001', {
      conversationId: 'conv-demo-001',
      senderType: 'LEAD',
      content: 'Hola, me interesa conocer más sobre su CRM.',
      timestamp: now,
    }, token);

    await createDocument('conversations/conv-demo-001/messages', 'msg-002', {
      conversationId: 'conv-demo-001',
      senderType: 'AI',
      content: '¡Hola! Claro que sí. Nuestro CRM conversacional te permite gestionar leads desde WhatsApp con IA. ¿Te gustaría agendar una demo por Google Meet?',
      timestamp: now,
    }, token);

    await createDocument('conversations/conv-demo-001/messages', 'msg-003', {
      conversationId: 'conv-demo-001',
      senderType: 'LEAD',
      content: 'Sí, ¿qué horarios tienen disponibles mañana?',
      timestamp: now,
    }, token);

    await createDocument('conversations/conv-demo-001/messages', 'msg-004', {
      conversationId: 'conv-demo-001',
      senderType: 'AI',
      content: 'Tengo espacio a las 10:00 AM y a las 3:00 PM (hora local). ¿Cuál prefieres?',
      timestamp: now,
    }, token);

    // ── promptConfig ───────────────────────────────────────────────────────
    console.log('\n📁 promptConfigs/');
    await createDocument('promptConfigs', 'prompt-demo-001', {
      companyId: 'crm-conversacional',
      behaviorInstructions: 'Eres un asistente de ventas amable y profesional. Tu objetivo es calificar leads y agendar demos por Google Meet. Responde en español.',
      knowledgeBase: 'Ofrecemos un CRM conversacional con IA que integra WhatsApp Business, gestión de leads y agendamiento automático.',
      createdAt: now,
      updatedAt: now,
    }, token);

    console.log('\n✅ Seed completado exitosamente.\n');
    console.log('Colecciones creadas:');
    console.log('  • companies (1 doc)');
    console.log('  • users (2 docs: admin + asesor)');
    console.log('  • leads (3 docs de demo)');
    console.log('  • conversations (3 docs)');
    console.log('  • conversations/conv-demo-001/messages (4 mensajes)');
    console.log('  • promptConfigs (1 doc)');
    console.log('\nAhora puedes levantar el frontend: cd frontend && npm run dev\n');

  } catch (err) {
    console.error('\n❌ Error en seed:', err.message);
    process.exit(1);
  }
}

seed();
