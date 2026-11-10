const fs = require('fs');
const path = require('path');

// 1. Update metaLeads.service.ts
const metaLeadsPath = path.resolve(__dirname, '../src/modules/metaLeads/metaLeads.service.ts');
let ml = fs.readFileSync(metaLeadsPath, 'utf8');

if (!ml.includes('leadExclusivity.service')) {
  ml = ml.replace(
    "import { assignLead } from '../leads/leadAssignment.service';",
    "import { assignLead } from '../leads/leadAssignment.service';\r\nimport { evaluateExclusivityOnReentry } from '../leads/leadExclusivity.service';"
  );
  
  const searchPattern = "  } else {\r\n    await leadsRepository.update(companyId, lead.id, {";
  const replacement = "  } else {\r\n    const exclusivityResult = await evaluateExclusivityOnReentry(companyId, lead, 'meta_ads_leadgen');\r\n    if (exclusivityResult.reallocated) {\r\n      lead.assignedTo = exclusivityResult.currentAdvisorId || undefined;\r\n    }\r\n    await leadsRepository.update(companyId, lead.id, {";
  
  if (ml.includes(searchPattern)) {
    ml = ml.replace(searchPattern, replacement);
    fs.writeFileSync(metaLeadsPath, ml, 'utf8');
    console.log('✓ Updated metaLeads.service.ts');
  } else {
    // Try LF pattern
    const searchPatternLF = "  } else {\n    await leadsRepository.update(companyId, lead.id, {";
    const replacementLF = "  } else {\n    const exclusivityResult = await evaluateExclusivityOnReentry(companyId, lead, 'meta_ads_leadgen');\n    if (exclusivityResult.reallocated) {\n      lead.assignedTo = exclusivityResult.currentAdvisorId || undefined;\n    }\n    await leadsRepository.update(companyId, lead.id, {";
    if (ml.includes(searchPatternLF)) {
      ml = ml.replace(searchPatternLF, replacementLF);
      fs.writeFileSync(metaLeadsPath, ml, 'utf8');
      console.log('✓ Updated metaLeads.service.ts (LF)');
    } else {
      console.error('✗ Could not find insertion point in metaLeads.service.ts');
    }
  }
} else {
  console.log('metaLeads.service.ts already has exclusivity import');
}

// 2. Update ycloudWebhook.function.ts
const ycloudPath = path.resolve(__dirname, '../src/http/ycloudWebhook.function.ts');
let yc = fs.readFileSync(ycloudPath, 'utf8');

if (!yc.includes('leadExclusivity.service')) {
  yc = yc.replace(
    "import { assignLead }         from '../modules/leads/leadAssignment.service';",
    "import { assignLead }         from '../modules/leads/leadAssignment.service';\r\nimport { evaluateExclusivityOnReentry } from '../modules/leads/leadExclusivity.service';"
  );

  const searchTargetCRLF = "  // Caso raro: usuario oculto y SIN número ni en remitente ni en texto.";
  const exclusivityCall = "  // Protocolo Meraki: verificar caducidad de exclusividad (>30 días de abandono) si el lead escribe al 317\r\n  if (lead && !advisorLine) {\r\n    await evaluateExclusivityOnReentry(companyId, lead, 'whatsapp_inbound_317');\r\n  }\r\n\r\n  // Caso raro: usuario oculto y SIN número ni en remitente ni en texto.";
  
  if (yc.includes(searchTargetCRLF)) {
    yc = yc.replace(searchTargetCRLF, exclusivityCall);
    fs.writeFileSync(ycloudPath, yc, 'utf8');
    console.log('✓ Updated ycloudWebhook.function.ts');
  } else {
    const searchTargetLF = searchTargetCRLF.replace(/\r\n/g, '\n');
    const exclusivityCallLF = exclusivityCall.replace(/\r\n/g, '\n');
    if (yc.includes(searchTargetLF)) {
      yc = yc.replace(searchTargetLF, exclusivityCallLF);
      fs.writeFileSync(ycloudPath, yc, 'utf8');
      console.log('✓ Updated ycloudWebhook.function.ts (LF)');
    } else {
      console.error('✗ Could not find insertion point in ycloudWebhook.function.ts');
    }
  }
} else {
  console.log('ycloudWebhook.function.ts already has exclusivity check');
}
