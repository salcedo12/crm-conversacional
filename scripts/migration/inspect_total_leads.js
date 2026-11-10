const path = require('path');
const xlsx = require(path.join(__dirname, '../../functions/node_modules/xlsx'));

const filePath = path.join(process.env.USERPROFILE, 'Downloads', 'total_leads.xlsx');
console.log('Inspeccionando:', filePath);

const wb = xlsx.readFile(filePath);
console.log('Hojas:', wb.SheetNames);

const sheet = wb.Sheets[wb.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet, { defval: '' });

console.log('TOTAL DE REGISTROS / FILAS:', data.length);

if (data.length > 0) {
  console.log('\nColumnas principales (primeras 35):');
  Object.keys(data[0]).slice(0, 35).forEach((col, i) => console.log(`[${i+1}] ${col}`));

  console.log('\nPrimera fila de muestra:');
  console.log(JSON.stringify(data[0], null, 2));
}
