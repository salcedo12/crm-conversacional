const admin = require('../functions/node_modules/firebase-admin');
const sa = require('../service-account.json');
const fs = require('fs');
const https = require('https');

admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

function ycloudGet(apiKey, path) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'api.ycloud.com',
      path,
      headers: { 'X-API-Key': apiKey }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
    }).on('error', reject);
  });
}

async function run() {
  const companyId = 'grupo_meraki_real';
  const colRef = db.collection('companies').doc(companyId).collection('whatsappTemplates');

  // 1. Backup all current templates in Firestore
  const allSnap = await colRef.get();
  const backup = allSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  fs.writeFileSync('scripts/backup_templates_before_sync.json', JSON.stringify(backup, null, 2), 'utf8');
  console.log(`Backed up ${backup.length} templates from Firestore.`);

  // 2. Identify docs for line 317 (old WABA 1643056187826489 or lineNumber +573176820728)
  const toDelete = [];
  const keep = [];

  allSnap.docs.forEach(doc => {
    const data = doc.data();
    if (data.lineNumber === '+573232094057' || data.wabaId === '941339738153724') {
      keep.push({ id: doc.id, name: data.name, line: data.lineNumber });
    } else {
      toDelete.push({ id: doc.id, name: data.name, wabaId: data.wabaId });
    }
  });

  console.log(`Keeping ${keep.length} templates (line 323 / Angelica):`, keep.map(k => k.name));
  console.log(`Deleting ${toDelete.length} old/duplicated templates for line 317...`);

  const batch = db.batch();
  toDelete.forEach(item => {
    batch.delete(colRef.doc(item.id));
  });
  await batch.commit();
  console.log('Old templates deleted.');

  // 3. Now pull from YCloud for WABA 1602852641481306 and insert into Firestore
  const credDoc = await db.collection('channelCredentials').doc(companyId).get();
  const apiKey = credDoc.data().ycloud.apiKey;
  const wabaId = credDoc.data().ycloud.wabaId;

  const ycloudRes = await ycloudGet(apiKey, `/v2/whatsapp/templates?limit=100&filter.wabaId=${wabaId}`);
  const ycloudTemplates = ycloudRes.body.items || [];
  console.log(`Fetched ${ycloudTemplates.length} templates from YCloud WABA ${wabaId}.`);

  for (const t of ycloudTemplates) {
    const bodyComp = t.components.find(c => c.type === 'BODY');
    const headerComp = t.components.find(c => c.type === 'HEADER');
    const footerComp = t.components.find(c => c.type === 'FOOTER');
    const body = bodyComp?.text ?? '';

    const varKeys = [...new Set([...body.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))];
    const examples = bodyComp?.example?.body_text?.[0] ?? [];
    const variables = varKeys.map((k, i) => ({ key: k, example: examples[i] ?? `[${k}]` }));

    let headerType = 'none';
    if (headerComp?.format === 'TEXT') headerType = 'text';
    else if (headerComp?.format === 'IMAGE') headerType = 'image';
    else if (headerComp?.format === 'VIDEO') headerType = 'video';
    else if (headerComp?.format === 'DOCUMENT') headerType = 'document';

    const headerMediaUrl = headerComp?.example?.header_url?.[0];

    const buttonsComp = t.components.find(c => c.type === 'BUTTONS');
    const buttons = (buttonsComp?.buttons ?? []).map(b => ({
      type: b.type,
      text: b.text ?? '',
      ...(b.url ? { url: b.url } : {}),
      ...(b.phone_number ? { phoneNumber: b.phone_number } : {}),
    }));

    const statusMap = {
      APPROVED: 'approved',
      REJECTED: 'rejected',
      PENDING: 'pending',
      IN_APPEAL: 'pending',
    };
    const status = statusMap[t.status] || 'pending';

    const newDoc = {
      companyId,
      name: t.name,
      displayName: t.name.replace(/_/g, ' '),
      category: t.category.toLowerCase(),
      language: t.language,
      body,
      variables,
      status,
      headerType,
      wabaId,
      lineNumber: '+573176820728',
      officialTemplateId: t.officialTemplateId || t.id,
      ...(headerComp?.text ? { header: headerComp.text } : {}),
      ...(headerMediaUrl ? { headerMediaUrl } : {}),
      ...(footerComp?.text ? { footer: footerComp.text } : {}),
      ...(buttons.length > 0 ? { buttons } : {}),
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    };

    await colRef.add(newDoc);
    console.log(`Saved template to Firestore: ${t.name} (status: ${status})`);
  }

  // 4. Verify total in Firestore
  const finalSnap = await colRef.get();
  console.log(`\nFinal total templates in Firestore for ${companyId}: ${finalSnap.size}`);
  finalSnap.docs.forEach(d => {
    const data = d.data();
    console.log(` - [${data.lineNumber || 'no-line'}] ${data.name} (${data.status})`);
  });
}

run().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
