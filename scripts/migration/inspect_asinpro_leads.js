const path = require('path');
const xlsx = require(path.join(__dirname, '../../functions/node_modules/xlsx'));

const filePath = path.join(process.env.USERPROFILE, 'Downloads', 'leeds de asinpro.xlsx');
console.log('Inspeccionando:', filePath);

const wb = xlsx.readFile(filePath);
console.log('Hojas encontradas:', wb.SheetNames);

let total = 0;
wb.SheetNames.forEach(sheetName => {
  const sheet = wb.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(sheet, { defval: '' });
  console.log(`- Hoja '${sheetName}': ${data.length} filas`);
  total += data.length;
  if (data.length > 0 && total === data.length) {
    console.log(`  Columnas en '${sheetName}':`, Object.keys(data[0]).slice(0, 15));
  }
});

console.log('\nTotal acumulado de leads en este archivo:', total);
