#!/usr/bin/env node
/*
 * Migra leads de una empresa a otra por inboxId, preservando subcolecciones
 * conocidas. No borra el origen salvo que pases --delete-source.
 *
 * Uso:
 *   node scripts/migrateInboxLeads.js empresa_demo grupo_meraki_real +573176820728
 *   node scripts/migrateInboxLeads.js empresa_demo grupo_meraki_real +573176820728 --delete-source
 */
const admin = require('firebase-admin');

const [, , sourceCompanyId = 'empresa_demo', targetCompanyId = 'grupo_meraki_real', inboxId = '+573176820728', ...flags] = process.argv;
const deleteSource = flags.includes('--delete-source');

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'crm-conversacional',
});

const db = admin.firestore();
const SUBCOLLECTIONS = ['messages', 'calls', 'notes'];

async function copyCollection(sourceCol, targetCol) {
  const snap = await sourceCol.get();
  let count = 0;
  for (const doc of snap.docs) {
    await targetCol.doc(doc.id).set(doc.data(), { merge: true });
    count++;
  }
  return count;
}

async function migrateLead(doc) {
  const sourceRef = doc.ref;
  const targetRef = db
    .collection('companies').doc(targetCompanyId)
    .collection('leads').doc(doc.id);

  const lead = {
    ...doc.data(),
    companyId: targetCompanyId,
    migratedFromCompanyId: sourceCompanyId,
    migratedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await targetRef.set(lead, { merge: true });

  const subCounts = {};
  for (const name of SUBCOLLECTIONS) {
    subCounts[name] = await copyCollection(sourceRef.collection(name), targetRef.collection(name));
  }

  if (deleteSource) {
    for (const name of SUBCOLLECTIONS) {
      const subSnap = await sourceRef.collection(name).get();
      for (const subDoc of subSnap.docs) await subDoc.ref.delete();
    }
    await sourceRef.delete();
  }

  return subCounts;
}

async function main() {
  if (!sourceCompanyId || !targetCompanyId || !inboxId || sourceCompanyId === targetCompanyId) {
    throw new Error('Uso: node scripts/migrateInboxLeads.js <sourceCompanyId> <targetCompanyId> <inboxId> [--delete-source]');
  }

  const snap = await db
    .collection('companies').doc(sourceCompanyId)
    .collection('leads')
    .where('inboxId', '==', inboxId)
    .get();

  console.log(`Leads encontrados en ${sourceCompanyId} con inboxId=${inboxId}: ${snap.size}`);
  if (snap.empty) return;

  let migrated = 0;
  const totals = { messages: 0, calls: 0, notes: 0 };
  for (const doc of snap.docs) {
    const counts = await migrateLead(doc);
    migrated++;
    for (const key of Object.keys(totals)) totals[key] += counts[key] || 0;
    console.log(`- ${doc.id}: ${doc.get('name') || doc.get('phone') || 'lead'} migrado`);
  }

  console.log(`Migrados: ${migrated}`);
  console.log(`Subdocs copiados: messages=${totals.messages}, calls=${totals.calls}, notes=${totals.notes}`);
  console.log(deleteSource ? 'Origen eliminado.' : 'Origen conservado. Revisa y luego repite con --delete-source si todo esta bien.');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
