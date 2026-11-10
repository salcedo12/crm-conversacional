const path = require('path');
const admin = require(path.join(__dirname, '../functions/node_modules/firebase-admin'));
const sa = require(path.join(__dirname, '../service-account.json'));

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const companyId = 'grupo_meraki_real';

const templateDoc = {
  companyId,
  name: 'plan_referidos_meraki',
  displayName: 'Plan de Referidos Meraki (Opción C)',
  category: 'marketing',
  language: 'es',
  body: '¡Hola, {{1}}! 👋 Qué gusto haber conversado contigo sobre {{2}}.\n\nQuiero dejarte una invitación especial: ¿sabías que puedes generar ingresos adicionales con Grupo Constructor Meraki sin comprar lote y sin experiencia en ventas? 🚀\n\nCon nuestro Plan de Referidos, ganas hasta $3.000.000 COP por cada amigo o familiar que recomiendes y adquiera su lote campestre con nosotros:\n✅ Sin límite de referidos.\n✅ Pago directo a tu cuenta tras cumplirse los requisitos de pago.\n✅ Registro 100% online.\n\n👉 Mira cómo funciona y registra tus referidos en nuestra web oficial:\nhttps://grupoconstructormeraki.com.co/referidos\n\n¡Quedo atento por si tienes a alguien en mente hoy mismo! 🤝',
  variables: [
    { key: '1', example: 'Carlos' },
    { key: '2', example: 'nuestros proyectos campestres' }
  ],
  buttons: [
    { type: 'quick_reply', text: 'Tengo un referido' },
    { type: 'quick_reply', text: 'Más información' }
  ],
  headerType: 'none',
  wabaId: '1602852641481306',
  lineNumber: '+573176820728',
  officialTemplateId: '1598374175397297',
  status: 'approved',
  updatedAt: admin.firestore.FieldValue.serverTimestamp()
};

async function sync() {
  const colRef = db.collection('companies').doc(companyId).collection('whatsappTemplates');
  const q = await colRef.where('name', '==', 'plan_referidos_meraki').get();
  if (!q.empty) {
    await q.docs[0].ref.set(templateDoc, { merge: true });
    console.log(`Updated Firestore template: ${q.docs[0].id}`);
  } else {
    const docRef = await colRef.add({
      ...templateDoc,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`Created Firestore template: ${docRef.id}`);
  }
}

sync().catch(console.error);
