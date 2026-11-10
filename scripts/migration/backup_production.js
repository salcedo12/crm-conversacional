const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const admin = require('../../functions/node_modules/firebase-admin');

let serviceAccount;
try {
  serviceAccount = require('../../service-account.json');
} catch (e) {
  serviceAccount = require('../../functions/service-account.json');
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
const COMPANY_ID = 'grupo_meraki_real';

function getTimestampString() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function processLead(doc, leadsCol) {
  const leadId = doc.id;
  const leadData = doc.data();

  const serializedData = JSON.parse(JSON.stringify(leadData, (key, value) => {
    if (value && typeof value === 'object' && value._seconds !== undefined) {
      return { _type: 'Timestamp', _seconds: value._seconds, _nanoseconds: value._nanoseconds };
    }
    return value;
  }));

  const subcollections = {};
  const subcolNames = ['messages', 'notes', 'photo_evidence', 'calls'];
  const counts = { messages: 0, notes: 0, photo_evidence: 0, calls: 0 };

  await Promise.all(subcolNames.map(async (subName) => {
    try {
      const subSnap = await leadsCol.doc(leadId).collection(subName).get();
      if (!subSnap.empty) {
        subcollections[subName] = subSnap.docs.map(sDoc => ({
          id: sDoc.id,
          ...JSON.parse(JSON.stringify(sDoc.data(), (k, v) => {
            if (v && typeof v === 'object' && v._seconds !== undefined) {
              return { _type: 'Timestamp', _seconds: v._seconds, _nanoseconds: v._nanoseconds };
            }
            return v;
          }))
        }));
        counts[subName] = subSnap.size;
      }
    } catch (err) {
      // Ignorar o registrar error leve
    }
  }));

  const fullRecord = {
    id: leadId,
    data: serializedData,
    subcollections: subcollections
  };

  const metaItem = {
    id: leadId,
    phone: leadData.phone || leadData.normalizedPhone || '',
    name: leadData.name || '',
    status: leadData.status || '',
    source: leadData.source || '',
    hasMessages: !!subcollections.messages,
    messagesCount: counts.messages
  };

  return { fullRecord, metaItem, counts };
}

async function runBackup() {
  console.log('========================================================');
  console.log(`[BACKUP PARALELO] Iniciando Respaldo para: ${COMPANY_ID}`);
  console.log('========================================================');

  const tsStr = getTimestampString();
  const backupDir = path.join(__dirname, `../../backups/backup_${tsStr}`);
  fs.mkdirSync(backupDir, { recursive: true });

  const leadsCol = db.collection('companies').doc(COMPANY_ID).collection('leads');
  console.log('[BACKUP] Obteniendo lista de documentos de leads...');
  const snapshot = await leadsCol.get();
  const totalLeads = snapshot.size;
  console.log(`[BACKUP] Se encontraron ${totalLeads} documentos de leads.`);

  const metadata = {
    companyId: COMPANY_ID,
    backupStartedAt: new Date().toISOString(),
    totalLeads: totalLeads,
    subcollectionsCount: {
      messages: 0,
      notes: 0,
      photo_evidence: 0,
      calls: 0
    },
    leads: []
  };

  const jsonlPath = path.join(backupDir, 'all_leads.jsonl');
  const leadsStream = fs.createWriteStream(jsonlPath, { encoding: 'utf8' });

  const CONCURRENCY = 20;
  const docs = snapshot.docs;
  let completed = 0;

  for (let i = 0; i < totalLeads; i += CONCURRENCY) {
    const chunk = docs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(d => processLead(d, leadsCol)));

    for (const res of results) {
      leadsStream.write(JSON.stringify(res.fullRecord) + '\n');
      metadata.leads.push(res.metaItem);
      metadata.subcollectionsCount.messages += res.counts.messages;
      metadata.subcollectionsCount.notes += res.counts.notes;
      metadata.subcollectionsCount.photo_evidence += res.counts.photo_evidence;
      metadata.subcollectionsCount.calls += res.counts.calls;
    }

    completed += chunk.length;
    console.log(`[BACKUP PROGRESO] ${completed} / ${totalLeads} leads respaldados (${Math.round((completed/totalLeads)*100)}%)`);
  }

  leadsStream.end();

  // Esperar a que el stream se cierre en disco
  await new Promise((resolve) => leadsStream.on('finish', resolve));

  metadata.backupCompletedAt = new Date().toISOString();

  // Calcular hash SHA256 del archivo JSONL
  const fileBuffer = fs.readFileSync(jsonlPath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  metadata.sha256 = hashSum.digest('hex');

  fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(metadata, null, 2), 'utf8');

  console.log('========================================================');
  console.log(`[BACKUP COMPLETADO CON ÉXITO]`);
  console.log(`Directorio: ${backupDir}`);
  console.log(`Total Leads: ${metadata.totalLeads}`);
  console.log(`Mensajes Subcolección: ${metadata.subcollectionsCount.messages}`);
  console.log(`Notas Subcolección: ${metadata.subcollectionsCount.notes}`);
  console.log(`Foto Evidencia: ${metadata.subcollectionsCount.photo_evidence}`);
  console.log(`Llamadas: ${metadata.subcollectionsCount.calls}`);
  console.log(`Archivo JSONL: ${jsonlPath} (${(fileBuffer.length / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(`Checksum SHA256: ${metadata.sha256}`);
  console.log('========================================================');
}

runBackup().catch(err => {
  console.error('[BACKUP ERROR FATAL]:', err);
  process.exit(1);
});
