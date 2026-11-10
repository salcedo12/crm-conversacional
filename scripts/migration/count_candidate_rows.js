const path = require('path');
const fs = require('fs');
const xlsx = require(path.join(__dirname, '../../functions/node_modules/xlsx'));

const downloadsDir = path.join(process.env.USERPROFILE, 'Downloads');
const candidateFiles = [
  'Meraki_Leads_meta_ads.xlsx',
  'CONSOLIDADO CONDOMINIO LLANO GRANDE.xlsx',
  'CONSOLIDADO_CANON_DE_ARIZONA.xlsx',
  'leeds de asinpro.xlsx',
  'leeds de asinpro (1).xlsx',
  'LEADS REGISTRADOS CORFERIAS 2026.xlsx',
  'total_leads.xlsx',
  'total_ventas.xlsx'
];

for (const name of candidateFiles) {
  const p = path.join(downloadsDir, name);
  if (fs.existsSync(p)) {
    try {
      const wb = xlsx.readFile(p);
      let totalRows = 0;
      wb.SheetNames.forEach(sheetName => {
        const sheet = wb.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
        totalRows += Math.max(0, data.length - 1);
      });
      console.log(`Archivo: ${name.padEnd(45)} | Total Filas: ${totalRows}`);
    } catch(e) {
      console.log(`Error leyendo ${name}:`, e.message);
    }
  }
}
