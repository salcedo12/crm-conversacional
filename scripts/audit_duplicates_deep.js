const admin = require('../functions/node_modules/firebase-admin');
const sa = require('../service-account.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function fullDuplicateAnalysis() {
  const cId = 'grupo_meraki_real';
  const leadsSnap = await db.collection('companies').doc(cId).collection('leads').get();
  const usersSnap = await db.collection('companies').doc(cId).collection('users').get();
  
  const userMap = new Map();
  for (const u of usersSnap.docs) {
    const ud = u.data();
    userMap.set(u.id, ud.displayName || ud.name || ud.email || u.id);
  }

  const phoneMap = new Map();
  for (const doc of leadsSnap.docs) {
    const data = doc.data();
    if (data.status === 'discarded' && (data.tags || []).includes('duplicado-unificado')) continue;
    const raw = data.phone || data.normalizedPhone || '';
    const digits = raw.replace(/\D/g, '');
    const tail = digits.length >= 10 ? digits.slice(-10) : digits;
    if (!tail || tail.length < 7) continue;

    if (!phoneMap.has(tail)) phoneMap.set(tail, []);
    phoneMap.get(tail).push({ id: doc.id, ...data });
  }

  const dupGroups = [];
  for (const [tail, leads] of phoneMap.entries()) {
    if (leads.length > 1) {
      dupGroups.push({ tail, leads });
    }
  }

  console.log('Total duplicate phone groups:', dupGroups.length);

  const stats = {
    totalGroups: dupGroups.length,
    advisorScenarios: {
      diffActiveAdvisors: [],
      oneActiveOneUnassigned: [],
      sameActiveAdvisor: [],
      bothUnassigned: []
    },
    activityScenarios: {
      bothHaveMessages: 0,
      oneHasMessages: 0,
      neitherHasMessages: 0,
      bothHaveBitacorasNotes: 0,
      oneHasBitacorasNotes: 0,
      neitherHasBitacorasNotes: 0,
    }
  };

  for (const group of dupGroups) {
    const advisors = group.leads.map(l => {
      const advId = l.assignedTo || l.advisorId || l.assignedAdvisorId || null;
      const advName = advId ? userMap.get(advId) : null;
      const isActive = !!(advId && advName && !advName.toLowerCase().includes('sin asignar') && !advName.toLowerCase().includes('administrador'));
      const hasMsgs = !!(l.lastMessageText || l.lastMessageAt);
      const bitacorasArr = Array.isArray(l.bitacoras) ? l.bitacoras.length : 0;
      const smBitacoras = Array.isArray(l.metadata && l.metadata.smarthomeBitacoras) ? l.metadata.smarthomeBitacoras.length : 0;
      const hasFichaFlag = !!l.hasFicha || !!l.lastFichaAt;
      return {
        id: l.id,
        name: l.name,
        advId,
        advName,
        isActive,
        exAsesor: (l.tags || []).find(t => t.startsWith('ex_asesor_')),
        hasMsgs,
        hasBitacoras: bitacorasArr > 0 || smBitacoras > 0 || hasFichaFlag,
        bitacorasCount: bitacorasArr + smBitacoras,
        isSm: l.id.startsWith('sm_'),
        status: l.status,
      };
    });

    const activeAdvs = advisors.filter(a => a.isActive);
    const uniqueActiveAdvIds = new Set(activeAdvs.map(a => a.advId));

    if (uniqueActiveAdvIds.size > 1) {
      stats.advisorScenarios.diffActiveAdvisors.push({ tail: group.tail, leads: advisors });
    } else if (uniqueActiveAdvIds.size === 1 && activeAdvs.length < advisors.length) {
      stats.advisorScenarios.oneActiveOneUnassigned.push({ tail: group.tail, leads: advisors });
    } else if (uniqueActiveAdvIds.size === 1 && activeAdvs.length === advisors.length) {
      stats.advisorScenarios.sameActiveAdvisor.push({ tail: group.tail, leads: advisors });
    } else {
      stats.advisorScenarios.bothUnassigned.push({ tail: group.tail, leads: advisors });
    }

    const msgsCount = advisors.filter(a => a.hasMsgs).length;
    if (msgsCount > 1) stats.activityScenarios.bothHaveMessages++;
    else if (msgsCount === 1) stats.activityScenarios.oneHasMessages++;
    else stats.activityScenarios.neitherHasMessages++;

    const bitCount = advisors.filter(a => a.hasBitacoras).length;
    if (bitCount > 1) stats.activityScenarios.bothHaveBitacorasNotes++;
    else if (bitCount === 1) stats.activityScenarios.oneHasBitacorasNotes++;
    else stats.activityScenarios.neitherHasBitacorasNotes++;
  }

  console.log('--- ADVISOR SCENARIOS ---');
  console.log('1. Different ACTIVE advisors:', stats.advisorScenarios.diffActiveAdvisors.length);
  console.log('2. One active advisor, other unassigned / ex-asesor:', stats.advisorScenarios.oneActiveOneUnassigned.length);
  console.log('3. Same active advisor on both:', stats.advisorScenarios.sameActiveAdvisor.length);
  console.log('4. Both unassigned / ex-asesor / sin asesor:', stats.advisorScenarios.bothUnassigned.length);

  console.log('\n--- ACTIVITY & BITACORAS SCENARIOS ---');
  console.log('Messages:');
  console.log('  Both have messages:', stats.activityScenarios.bothHaveMessages);
  console.log('  Only one has messages:', stats.activityScenarios.oneHasMessages);
  console.log('  Neither has messages:', stats.activityScenarios.neitherHasMessages);
  console.log('Bitácoras / Fichas:');
  console.log('  Both have bitácoras/fichas:', stats.activityScenarios.bothHaveBitacorasNotes);
  console.log('  Only one has bitácoras/fichas:', stats.activityScenarios.oneHasBitacorasNotes);
  console.log('  Neither has bitácoras/fichas:', stats.activityScenarios.neitherHasBitacorasNotes);

  console.log('\n--- EXAMPLES OF DIFFERENT ACTIVE ADVISORS (Top 10) ---');
  for (const item of stats.advisorScenarios.diffActiveAdvisors.slice(0, 10)) {
    console.log('Phone tail:', item.tail);
    for (const l of item.leads) {
      console.log('  [' + l.id + '] ' + l.name + ' | Advisor: ' + l.advName + ' (' + l.advId + ') | Status: ' + l.status + ' | Msgs: ' + l.hasMsgs + ' | Bitacoras/Ficha: ' + l.hasBitacoras);
    }
  }

  console.log('\n--- EXAMPLES OF ONE ACTIVE, ONE UNASSIGNED (Top 5) ---');
  for (const item of stats.advisorScenarios.oneActiveOneUnassigned.slice(0, 5)) {
    console.log('Phone tail:', item.tail);
    for (const l of item.leads) {
      console.log('  [' + l.id + '] ' + l.name + ' | Advisor: ' + (l.advName || 'Sin asignar') + ' | ExAsesor: ' + l.exAsesor + ' | Msgs: ' + l.hasMsgs);
    }
  }
}

fullDuplicateAnalysis().catch(console.error);
