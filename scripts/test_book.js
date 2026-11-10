const admin = require('c:/crm-conversacional/functions/node_modules/firebase-admin');
const sa = require('c:/crm-conversacional/service-account.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const { bookAppointment } = require('c:/crm-conversacional/functions/lib/modules/appointments/appointments.service');

async function testBook() {
  const companyId = 'empresa_demo';
  const leadId = '0cpdGhOXL8rT4dfRhR4S';
  const startTime = new Date('2026-10-09T15:00:00.000Z');

  try {
    const res = await bookAppointment({
      companyId,
      leadId,
      startTime,
      durationMinutes: 30,
      source: 'ai',
    });
    console.log('Book appointment SUCCESS:', res);
  } catch (err) {
    console.error('Book appointment FAILED with error:');
    console.error(err);
  }
}

testBook().catch(console.error);
