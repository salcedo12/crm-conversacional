const path = require('path');
const fs = require('fs');
const xlsx = require(path.join(__dirname, '../../functions/node_modules/xlsx'));

const downloadsDir = path.join(process.env.USERPROFILE, 'Downloads');
const files = fs.readdirSync(downloadsDir).filter(f => f.endsWith('.xlsx') || f.endsWith('.csv'));

console.log(`Analizando ${files.length} archivos en Downloads para encontrar la base de 12,664 leads...`);

for (const file of files) {
  const fullPath = path.join(downloadsDir, file);
  try {
    const stats = fs.statSync(fullPath);
    // Solo archivos de más de 300KB tienen potencial de 12k filas
    if (stats.size > 300 * 1024) {
      const wb = xlsx.readFile(fullPath, { sheetRows: 5 });
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      const ref = firstSheet['!ref'];
      console.log(`\nArchivo: ${file} | Tamaño: ${(stats.size / 1024 / 1024).toFixed(2)} MB | Hojas: ${wb.SheetNames.join(', ')} | Rango: ${ref}`);
    }
  } catch (err) {
    // ignorar archivos bloqueados
  }
}
