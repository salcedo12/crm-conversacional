const fs = require('fs');
const data = JSON.parse(fs.readFileSync('scripts/meraki_templates.json', 'utf8'));

console.log('Total templates:', data.templates.length);

// Group by name
const byName = {};
for (const t of data.templates) {
  if (!byName[t.name]) byName[t.name] = [];
  byName[t.name].push(t);
}

console.log('Unique names count:', Object.keys(byName).length);

for (const [name, list] of Object.entries(byName)) {
  console.log(`\n========================================`);
  console.log(`Name: ${name} (Instances: ${list.length})`);
  for (const t of list) {
    console.log(`  - ID: ${t.id} | line: ${t.lineNumber} | waba: ${t.wabaId} | status: ${t.status} | category: ${t.category} | created: ${t.createdAt ? new Date(t.createdAt._seconds * 1000).toISOString() : 'N/A'}`);
    console.log(`    displayName: "${t.displayName}"`);
    console.log(`    headerType: ${t.headerType || 'none'} | header: "${t.header || ''}"`);
    if (t.headerMediaUrl) console.log(`    headerMediaUrl: ${t.headerMediaUrl}`);
    console.log(`    body: ${JSON.stringify(t.body)}`);
    if (t.footer) console.log(`    footer: "${t.footer}"`);
    if (t.buttons && t.buttons.length) console.log(`    buttons:`, t.buttons);
    if (t.variables && t.variables.length) console.log(`    variables:`, t.variables);
  }
}
