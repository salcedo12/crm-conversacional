/**
 * Convierte las plantillas Word de jurídica (con datos de ejemplo y bloques
 * "(texto para el proyecto X)") en plantillas con campos {…} para docxtemplater.
 *
 *   node scripts/contracts/build-templates.cjs "<CONTRATO DE PREVENTA 2026 ….docx>" "<PROMESA DE COMPRAVENTA 2026 ….docx>"
 *
 * Salida: functions/templates/preventa-2026.docx y promesa-2026.docx.
 * Si jurídica cambia el Word original, se vuelve a correr este script. Si algún texto
 * de ejemplo cambió, el script falla diciendo cuál no encontró.
 * Los campos disponibles están en functions/src/modules/contracts/contractData.ts.
 */
const fs = require('fs');
const path = require('path');
const PizZip = require(path.join(__dirname, '..', '..', 'functions', 'node_modules', 'pizzip'));
const { replaceText, setCellText, wrapCell, deleteRow, textOf, innermostParagraphs } = require('./docxXml.cjs');
const { prepareSignatureBoxes } = require('./signatureBoxes.cjs');

const OUT_DIR = path.join(__dirname, '..', '..', 'functions', 'templates');

const SELLER_BOTH =
  '(texto para todos los proyectos excepto CAÑON DE ARIZONA) GRUPO CONSTRUCTOR MERAKI S.A.S ZOMAC, ' +
  '(texto para el proyecto CAÑON DE ARIZONA) COMPAÑIA CONSTRUCTORA MERAKI    S+M   S.A.S';
const DENOMINATION_SAMPLE = 'CLUB DE CAMPO CONDOMINIO ECO HOTEL Ciudad Country Laguna Mar Bungalow Coliving Club';

/** Declaración de comprador (NOMBRE / CÉDULA, EXPEDICIÓN, ESTADO CIVIL, TELÉFONO), repetida por comprador. */
function buyerDeclarationTable(xml, t) {
  xml = setCellText(xml, t, 0, 1, '{nombreCompleto}');
  xml = setCellText(xml, t, 1, 0, '{etiquetaId}:');
  xml = setCellText(xml, t, 1, 1, '{numeroId}');
  xml = setCellText(xml, t, 1, 3, '{expedicion}');
  xml = setCellText(xml, t, 1, 5, '{estadoCivil}');
  xml = setCellText(xml, t, 1, 7, '{celular}');
  xml = wrapCell(xml, t, 0, 0, { prefix: '{#compradores}' });
  return wrapCell(xml, t, 1, 7, { suffix: '{/compradores}' });
}

function convertPreventa(xml) {
  // ── Tablas (índice = orden en el documento) ──
  xml = buyerDeclarationTable(xml, 0);                              // origen lícito de recursos
  xml = setCellText(xml, 1, 0, 1, '{lote.numero}');
  xml = setCellText(xml, 1, 1, 1, '{lote.sector}');
  xml = setCellText(xml, 1, 2, 1, '{lote.area}');
  xml = setCellText(xml, 1, 3, 1, '{proyecto.nombre}');

  xml = setCellText(xml, 2, 1, 1, '{proyecto.municipio}');          // diligenciamiento S.I.M.
  xml = setCellText(xml, 2, 2, 1, '{fecha.diligenciamiento}');
  xml = setCellText(xml, 2, 3, 1, '{asesor.nombre}');

  xml = setCellText(xml, 3, 2, 1, '{proyecto.nombre}');             // datos generales del negocio
  xml = setCellText(xml, 3, 3, 1, '{proyecto.localizacion}');
  xml = setCellText(xml, 3, 4, 1, '{lote.numero}');
  xml = setCellText(xml, 3, 4, 5, '{lote.sector}');
  xml = setCellText(xml, 3, 5, 1, '{plan.plazo}');
  xml = setCellText(xml, 3, 5, 3, '{plan.valorTerreno}');
  xml = setCellText(xml, 3, 5, 5, '{plan.beneficio}');

  xml = setCellText(xml, 4, 1, 1, '{vendedor.razonSocial}');         // promotor
  xml = setCellText(xml, 4, 1, 5, '{vendedor.nit}');

  xml = setCellText(xml, 5, 1, 1, '{tipoPersona}');                 // consumidores (4 filas por comprador)
  xml = setCellText(xml, 5, 1, 3, '{nombreCompleto}');
  xml = setCellText(xml, 5, 2, 1, '{tipoIdLargo}');
  xml = setCellText(xml, 5, 2, 3, '{numeroId}');
  xml = setCellText(xml, 5, 3, 1, '{celular}');
  xml = setCellText(xml, 5, 3, 3, '{correo}');
  xml = setCellText(xml, 5, 4, 1, '{direccion}, {ciudadResidencia}');
  xml = wrapCell(xml, 5, 1, 0, { prefix: '{#compradores}' });
  xml = wrapCell(xml, 5, 4, 1, { suffix: '{/compradores}' });

  xml = buyerDeclarationTable(xml, 6);                              // tratamiento de datos

  xml = setCellText(xml, 7, 0, 1, '{fecha.corta}');                 // encabezado del contrato
  xml = setCellText(xml, 7, 1, 0,
    'En la ciudad de Ibagué, departamento del Tolima {fecha.texto}, entre los suscritos a saber ' +
    '{vendedor.representacion}, quien obra en condición de representante legal, quienes en el presente ' +
    'contrato se denominará EL PROMITENTE VENDEDOR, y por la otra parte:');
  xml = setCellText(xml, 7, 2, 1,
    '{vendedor.razonSocial} www.grupoconstructormeraki.com.co/pagos Convenio Banco Davivienda {vendedor.convenio}');

  xml = setCellText(xml, 8, 0, 1, '{nombreCompleto}');              // promitente(s) comprador(es)
  xml = setCellText(xml, 8, 0, 2, 'No. {etiquetaId}');
  xml = setCellText(xml, 8, 0, 3, '{numeroId}');
  xml = setCellText(xml, 8, 1, 1, '{celular}');
  xml = setCellText(xml, 8, 1, 3, '{ciudadResidencia}');
  xml = setCellText(xml, 8, 2, 1, '{correo}');
  xml = setCellText(xml, 8, 2, 3, '{direccion}');
  xml = wrapCell(xml, 8, 0, 0, { prefix: '{#compradores}' });
  xml = wrapCell(xml, 8, 2, 3, { suffix: '{/compradores}' });

  xml = setCellText(xml, 9, 1, 1, '{proyecto.nombre}');             // detalles del negocio
  xml = setCellText(xml, 9, 2, 1, '{lote.sector}');
  xml = setCellText(xml, 9, 3, 1, '{lote.numero}');
  xml = setCellText(xml, 9, 4, 1, '{lote.area}');
  xml = setCellText(xml, 9, 5, 1, '{lote.codigo}');
  xml = setCellText(xml, 9, 6, 1,
    '{proyecto.ubicacionDetalle}, cuya área, linderos, ubicación exacta y demás características definitivas se ' +
    'encuentran sujetas a verificación y ajuste técnico posterior.');

  xml = setCellText(xml, 10, 1, 1, '{plan.valorTerreno}');          // cierre del negocio
  xml = setCellText(xml, 10, 2, 1, '{lote.esquinero}');
  xml = setCellText(xml, 10, 3, 1, '{plan.beneficio}');
  xml = setCellText(xml, 10, 4, 1, '{plan.cesantias}');
  xml = setCellText(xml, 10, 5, 1, '{plan.separacion}');
  xml = setCellText(xml, 10, 6, 1, '{plan.totalTerreno}');
  xml = setCellText(xml, 10, 7, 1, '{plan.numeroCuotas} CUOTAS');

  xml = deleteRow(xml, 11, 2);                                      // tabla de cuotas: 1 fila por grupo
  ['{sepN}', '{sepValor}', '{sepFecha}', null, '{ordN}', '{ordValor}', '{ordFecha}', null, '{extN}', '{extValor}', '{extFecha}']
    .forEach((tag, c) => { if (tag) xml = setCellText(xml, 11, 1, c, tag); });
  xml = wrapCell(xml, 11, 1, 0, { prefix: '{#filasCuotas}' });
  xml = wrapCell(xml, 11, 1, 10, { suffix: '{/filasCuotas}' });

  xml = setCellText(xml, 12, 0, 0, '{plan.totalSeparacion}');
  xml = setCellText(xml, 12, 0, 2, '{plan.totalOrdinarias}');
  xml = setCellText(xml, 12, 0, 4, '{plan.totalExtraordinarias}');
  xml = setCellText(xml, 12, 1, 2, 'TOTAL ORDINARIAS');             // la plantilla decía "TOTAL SEPARACIÓN"
  xml = setCellText(xml, 13, 0, 1, '{plan.valorTotal}');
  xml = setCellText(xml, 14, 0, 1, '{plan.referido}');
  xml = setCellText(xml, 14, 1, 1, '{plan.observaciones}');

  // ── Textos dentro de párrafos ──
  xml = replaceText(xml,
    '(texto para todos los proyectos excepto CAÑON DE ARIZONA) GRUPO CONSTRUCTOR MERAKI S.A.S ZOMAC, identificada con NIT 901110049-0, ' +
    '(texto para el proyecto CAÑON DE ARIZONA) COMPAÑIA CONSTRUCTORA MERAKI    S+M   S.A.S, identificada con NIT 901590498-2',
    '{vendedor.razonSocial}, identificada con NIT {vendedor.nit}');
  xml = replaceText(xml, SELLER_BOTH, '{vendedor.razonSocial}', { min: 4 });
  xml = replaceText(xml, DENOMINATION_SAMPLE, '{proyecto.denominacion}', { min: 3 });
  xml = replaceText(xml,
    'TERRENO No. 44– ETAPA/SECTOR MAR CANARIAS CIUDAD COUNTRY LAGUNA MAR BUNGALOW COLIVING CLUB ubicado en el municipio de MELGAR, Tolima',
    'TERRENO No. {lote.numero} – ETAPA/SECTOR {lote.sector} {proyecto.nombre} ubicado en el municipio de {proyecto.municipio}, Tolima');
  xml = replaceText(xml, 'SEIS MILLONES DE PESOS ($6.000.000)', '{plan.separacionLetras} ({plan.separacion})');
  xml = replaceText(xml,
    'Cuarenta y un millones novecientos cincuenta y ocho mil seiscientos($41,958,600)',
    '{plan.arrasLetras} ({plan.arras})');

  // ── Asesor que firma como broker ──
  xml = replaceText(xml, 'JUANA MARÍA ÁVILA ROJAS', '{asesor.nombre}', { min: 1 });

  // ── Recuadros de firma originales (cuadros de texto: Word guarda cada uno dos veces) ──
  // Dentro del recuadro del comprador van los datos de CADA comprador (se repite por comprador).
  xml = replaceText(xml, 'BATMAN ROBERTO GONZALEZ ', '{nombreCompleto}');
  xml = replaceText(xml, 'CEDÚLA DE CIUDADANIA: ', '{tipoIdLargo}:');
  xml = replaceText(xml, '80.145.743 ', '{numeroId}');
  xml = replaceText(xml, 'BOGOTA D, C.', '{ciudadExpedicion}');
  // Bloque de S+M en la firma del vendedor: solo para Cañón de Arizona.
  xml = replaceText(xml, '(texto para todos los proyectos excepto CAÑON DE ARIZONA)', '{#vendedor.esSM}');
  xml = replaceText(xml, 'NIT: 901590498-2', 'NIT: 901590498-2{/vendedor.esSM}');
  // Recuadro por comprador y firmas que no se parten entre hojas. El recuadro del vendedor empuja
  // el texto hacia abajo (ajuste cuadrado): bastan unos renglones encadenados para que no se separe.
  xml = prepareSignatureBoxes(xml, { heading: 'PROMITENTE COMPRADORPROMITENTE COMPRADOR', sellerLines: 3 });
  return xml;
}

const SAMPLE_LEFTOVERS = ['(texto para', '(Texto para', 'PEPITO', 'FAGUNDEZ', '13.900.000', '43.500.000', 'BATMAN', 'PANRANGUTIRIMICARO', 'batman@', 'JUANA MAR', '41,958,600', '1027293230'];

function checkLeftovers(name, xml) {
  const texts = innermostParagraphs(xml).map((p) => textOf(xml.slice(p.start, p.end))).join('\n');
  const found = SAMPLE_LEFTOVERS.filter((s) => texts.includes(s));
  if (found.length) throw new Error(`${name}: quedaron datos de ejemplo: ${found.join(', ')}`);
}

/**
 * Jurídica marcó en rojo (resaltado) los datos variables. Lo que siga en rojo y no sea
 * un campo {…} es un dato que se escapó de la conversión: se lista para revisarlo.
 */
function redLeftovers(xml) {
  const runs = [...xml.matchAll(/<w:r(?=[ >])(?:(?!<\/w:r>)[\s\S])*?<w:highlight w:val="red"\/>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g)];
  const texts = runs.map((m) => textOf(m[0])).filter((t) => t.trim() && !/^[\s{}#/.\w]*\}?$/.test(t) && !/\{[^}]+\}/.test(t));
  return [...new Set(texts.map((t) => t.trim()))];
}

/** Cada etiqueta abierta se cierra en orden: si no, Word dice que el archivo está dañado. */
function checkWellFormed(name, xml) {
  const stack = [];
  for (const m of xml.matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
    if (m[3] === '/') continue;
    if (!m[1]) { stack.push(m[2]); continue; }
    const open = stack.pop();
    if (open !== m[2]) throw new Error(`${name}: XML roto, </${m[2]}> cierra <${open}> (posición ${m.index})`);
  }
  if (stack.length) throw new Error(`${name}: XML roto, quedaron etiquetas sin cerrar`);
}

function build(src, outName, convert) {
  const zip = new PizZip(fs.readFileSync(src));
  let xml = convert(zip.file('word/document.xml').asText());
  checkLeftovers(outName, xml);
  const red = redLeftovers(xml);
  if (red.length) console.log(`⚠ ${outName}: textos aún resaltados en rojo (revisar si son datos variables):\n  - ${red.join('\n  - ')}`);
  // El contrato final no lleva los resaltados de trabajo de jurídica.
  xml = xml.replace(/<w:highlight w:val="(?:red|yellow)"\/>/g, '');
  // Jurídica pintó en azul/morado los textos que cambian por proyecto: el contrato final va en negro.
  xml = xml.replace(/<w:color w:val="(?:00C4FF|00B0F0|7030A0|9900FF|FF0000)"[^>]*\/>/gi, '');
  xml = xml.replace(/<w:tblGridChange[\s\S]*?<\/w:tblGridChange>/g, '');
  // Identificadores internos de párrafo: al repetir párrafos por comprador quedarían duplicados.
  xml = xml.replace(/ w14:(?:paraId|textId)="[^"]*"/g, '');
  checkWellFormed(outName, xml);
  zip.file('word/document.xml', xml);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, outName);
  fs.writeFileSync(out, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
  console.log(`✔ ${out}`);
}

const [preventaSrc, promesaSrc] = process.argv.slice(2);
if (!preventaSrc) {
  console.error('Uso: node scripts/contracts/build-templates.cjs <preventa.docx> [promesa.docx]');
  process.exit(1);
}
build(preventaSrc, 'preventa-2026.docx', convertPreventa);
if (promesaSrc) {
  const { convertPromesa } = require('./promesa.cjs');
  build(promesaSrc, 'promesa-2026.docx', convertPromesa);
}

module.exports = { checkLeftovers };
