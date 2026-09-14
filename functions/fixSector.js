const fs = require('fs');
const file = 'C:/crm-conversacional/functions/src/modules/ai/aiOrchestrator.service.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  "const sector     = (args.sector ?? '').trim();",
  `let sector     = (args.sector ?? '').trim();
    if (sector.toUpperCase() === 'SAN FRANCISCO') sector = 'Sn.FRANCISCO';`
);

fs.writeFileSync(file, content);
