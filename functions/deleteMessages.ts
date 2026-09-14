import * as admin from 'firebase-admin';
import * as fs from 'fs';

const serviceAccount = JSON.parse(fs.readFileSync('./service-account.json', 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
  console.log('Searching for lead with phone 3022911626 or +573022911626...');
  const companiesSnap = await db.collection('companies').get();
  for (const companyDoc of companiesSnap.docs) {
    const leadsRef = companyDoc.ref.collection('leads');
    const q1 = await leadsRef.where('phone', '==', '3022911626').get();
    const q2 = await leadsRef.where('phone', '==', '+573022911626').get();
    const docs = [...q1.docs, ...q2.docs];
    
    for (const leadDoc of docs) {
      console.log(`Found lead: ${leadDoc.id} in company ${companyDoc.id}`);
      
      // Delete messages
      const messagesSnap = await leadDoc.ref.collection('messages').get();
      const batch = db.batch();
      let count = 0;
      for (const msgDoc of messagesSnap.docs) {
        batch.delete(msgDoc.ref);
        count++;
        if (count % 400 === 0) {
            await batch.commit();
        }
      }
      if (count % 400 !== 0) {
          await batch.commit();
      }
      console.log(`Deleted ${count} messages.`);
      
      // Reset lead stats
      await leadDoc.ref.update({
        aiQuotationCount: 0,
        aiQuotedTerrenos: [],
        legalWelcomeSent: false
      });
      console.log('Reset lead stats.');
    }
  }
  console.log('Done.');
}

run().catch(console.error);
