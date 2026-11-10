const path = require('path');
const admin = require(path.join(__dirname, '../functions/node_modules/firebase-admin'));
const sa = require(path.join(__dirname, '../service-account.json'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

// Leads to preserve (e.g. Developer / Admin test conversation with bot)
const EXCLUDE_LEAD_IDS = new Set(['7clYvowWXULop42GiCwo']);

async function getTeamPhones(companyId) {
  const phones = new Set();
  const connsSnap = await db.collection('companies').doc(companyId).collection('advisorWhatsappConnections').get();
  for (const d of connsSnap.docs) {
    const p = d.data().phone;
    if (typeof p === 'string' && p.trim()) phones.add(p.trim());
  }
  const usersSnap = await db.collection('companies').doc(companyId).collection('users').get();
  for (const d of usersSnap.docs) {
    const p = d.data().phone;
    if (typeof p === 'string' && p.trim()) phones.add(p.trim());
  }
  return Array.from(phones);
}

async function main() {
  const companyId = 'grupo_meraki_real';
  const leadsCol = db.collection('companies').doc(companyId).collection('leads');

  const teamPhones = await getTeamPhones(companyId);
  console.log(`Searching for leads matching ${teamPhones.length} advisor phones...`);

  const dirtyLeads = [];
  const seenIds = new Set();

  for (const rawPhone of teamPhones) {
    const digits = rawPhone.replace(/\D/g, '');
    const cleanWithPlus = '+' + digits;
    const tail = digits.slice(-10);

    const queries = [
      leadsCol.where('phone', '==', rawPhone).get(),
      leadsCol.where('phone', '==', cleanWithPlus).get(),
      leadsCol.where('normalizedPhone', '==', digits).get(),
      leadsCol.where('phoneTail', '==', tail).get(),
    ];

    const results = await Promise.all(queries);
    for (const snap of results) {
      for (const doc of snap.docs) {
        if (!seenIds.has(doc.id) && !EXCLUDE_LEAD_IDS.has(doc.id)) {
          seenIds.add(doc.id);
          const data = doc.data();
          const msgs = await doc.ref.collection('messages').get();
          dirtyLeads.push({
            id: doc.id,
            name: data.name,
            phone: data.phone,
            normalizedPhone: data.normalizedPhone,
            assignedTo: data.assignedTo,
            messagesCount: msgs.size,
            ref: doc.ref,
            msgDocs: msgs.docs,
          });
        }
      }
    }
  }

  console.log(`\nFound ${dirtyLeads.length} advisor/coworker leads to clean up:`);
  for (const l of dirtyLeads) {
    console.log(`- Lead ID: ${l.id} | Name: ${l.name} | Phone: ${l.phone} | AssignedTo: ${l.assignedTo} | Messages: ${l.messagesCount}`);
  }

  const isDryRun = process.argv.includes('--dry-run') || !process.argv.includes('--apply');
  if (isDryRun) {
    console.log('\n[DRY RUN] No changes were made. Run with --apply to clean up these internal leads.');
    return;
  }

  console.log('\nApplying cleanup (deleting internal coworker leads and their messages)...');
  for (const l of dirtyLeads) {
    for (const m of l.msgDocs) {
      await m.ref.delete();
    }
    await l.ref.delete();
    console.log(`Deleted lead ${l.id} (${l.phone} - ${l.name})`);
  }

  console.log('\nCleanup finished successfully!');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
