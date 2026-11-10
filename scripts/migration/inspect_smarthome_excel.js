const path = require('path');
const fs = require('fs');
const xlsx = require(path.join(__dirname, '../../functions/node_modules/xlsx'));

const filePath = path.join(__dirname, '../../Leads_Adriana_Montana_y_Oscar_Narvaez.xlsx');

if (!fs.existsSync(filePath)) {
  console.error('No se encontró el archivo:', filePath);
  process.exit(1);
}

console.log('Leyendo archivo Excel:', filePath);
const workbook = xlsx.readFile(filePath, { cellDates: true });

console.log('\nHojas encontradas en el libro:', workbook.SheetNames);

const firstSheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[firstSheetName];
const data = xlsx.utils.sheet_to_json(sheet, { defval: '' });

console.log('\nTotal de filas/registros en la primera hoja:', data.length);

if (data.length > 0) {
  console.log('\n--- COLUMNAS DETECTADAS ---');
  const columns = Object.keys(data[0]);
  columns.forEach((col, idx) => console.log(`[${idx + 1}] ${col}`));

  console.log('\n--- MUESTRA DE LAS PRIMERAS 2 FILAS ---');
  console.log(JSON.stringify(data.slice(0, 2), null, 2));

  // Análisis de valores únicos en columnas clave
  const findCol = (terms) => columns.find(c => terms.some(t => c.toLowerCase().includes(t.toLowerCase())));
  
  const colProyecto = findCol(['proyecto', 'project']);
  const colAsesor = findCol(['asesor', 'owner', 'vendedor', 'responsable', 'usuario']);
  const colFuente = findCol(['fuente', 'origen', 'source', 'medio', 'canal']);
  const colEstado = findCol(['estado', 'etapa', 'ciclo', 'status', 'stage']);
  const colBitacora = findCol(['bitacora', 'nota', 'seguimiento', 'observacion', 'comentario', 'ultimo']);

  console.log('\n--- MAPEO DE COLUMNAS DETECTADAS ---');
  console.log('Proyecto:', colProyecto || 'NO ENCONTRADA');
  console.log('Asesor:', colAsesor || 'NO ENCONTRADA');
  console.log('Fuente:', colFuente || 'NO ENCONTRADA');
  console.log('Estado:', colEstado || 'NO ENCONTRADA');
  console.log('Bitácora / Notas:', colBitacora || 'NO ENCONTRADA');

  const getUniques = (colName) => {
    if (!colName) return [];
    const set = new Set();
    data.forEach(row => {
      const val = String(row[colName] || '').trim();
      if (val) set.add(val);
    });
    return Array.from(set);
  };

  if (colProyecto) {
    console.log(`\nValores únicos de Proyecto (${getUniques(colProyecto).length}):`, getUniques(colProyecto).slice(0, 20));
  }
  if (colAsesor) {
    console.log(`\nValores únicos de Asesor (${getUniques(colAsesor).length}):`, getUniques(colAsesor).slice(0, 20));
  }
  if (colFuente) {
    console.log(`\nValores únicos de Fuente (${getUniques(colFuente).length}):`, getUniques(colFuente).slice(0, 25));
  }
  if (colEstado) {
    console.log(`\nValores únicos de Estado/Ciclo (${getUniques(colEstado).length}):`, getUniques(colEstado).slice(0, 20));
  }
}
