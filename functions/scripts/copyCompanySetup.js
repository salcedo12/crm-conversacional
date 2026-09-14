#!/usr/bin/env node
/*
 * Copia configuracion operativa de una empresa a otra:
 * - aiConfigs/default
 * - config/autoCall
 * - rutas de canal dapta/meta/messenger/instagram
 *
 * Uso:
 *   node scripts/copyCompanySetup.js empresa_demo grupo_meraki_real
 */
const admin = require('firebase-admin');

const [, , sourceCompanyId = 'empresa_demo', targetCompanyId = 'grupo_meraki_real'] = process.argv;

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'crm-conversacional',
});

const db = admin.firestore();
const ROUTE_PROVIDERS_TO_COPY = new Set(['dapta', 'meta', 'messenger', 'instagram']);

async function copyDoc(sourcePath, targetPath, transform = (data) => data) {
  const snap = await db.doc(sourcePath).get();
  if (!snap.exists) {
    console.log(`- omitido: ${sourcePath} no existe`);
    return false;
  }
  const data = transform(snap.data() || {});
  await db.doc(targetPath).set(data, { merge: true });
  console.log(`- copiado: ${sourcePath} -> ${targetPath}`);
  return true;
}

async function copyRoutes() {
  const routes = await db.collection('channelRoutes')
    .where('companyId', '==', sourceCompanyId)
    .get();

  let copied = 0;
  for (const doc of routes.docs) {
    const route = doc.data();
    if (!ROUTE_PROVIDERS_TO_COPY.has(route.provider)) continue;

    const id = `${route.provider}_${String(route.identifier).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    await db.collection('channelRoutes').doc(id).set({
      ...route,
      companyId: targetCompanyId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    copied++;
    console.log(`- ruta ${route.provider}:${route.identifier} -> ${targetCompanyId}`);
  }

  if (!copied) console.log('- no habia rutas Dapta/Meta para copiar');
}

async function main() {
  if (!sourceCompanyId || !targetCompanyId || sourceCompanyId === targetCompanyId) {
    throw new Error('Uso: node scripts/copyCompanySetup.js <sourceCompanyId> <targetCompanyId>');
  }

  console.log(`Copiando configuracion de ${sourceCompanyId} a ${targetCompanyId}...`);

  await copyDoc(
    `companies/${sourceCompanyId}/aiConfigs/default`,
    `companies/${targetCompanyId}/aiConfigs/default`,
    (data) => ({ ...data, companyId: targetCompanyId })
  );
  await copyDoc(
    `companies/${sourceCompanyId}/config/autoCall`,
    `companies/${targetCompanyId}/config/autoCall`
  );
  await copyRoutes();

  console.log('Listo.');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
