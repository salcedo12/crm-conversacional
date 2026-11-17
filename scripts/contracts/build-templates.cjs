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
const {
  replaceText, setCellText, wrapCell, deleteRow, textOf, innermostParagraphs,
  ensureAllTablesCantSplit, makeTableHeader, addKeepNextToParagraphs, addPageBreakBefore,
  setTableColumnWidths, setTableRowFontSize, keepTableTogether,
} = require('./docxXml.cjs');
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
    'contrato se denominará EL PROMITENTE VENDEDOR, y por la otra parte:',
    { bold: false, sz: '20', lineSpacing: '240' });
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

  // Encabezado de la tabla de cuotas repetible y con keepNext (no se parte sola al fondo de página)
  xml = makeTableHeader(xml, 11, 0);

  // ── Calibración de anchos y tamaños en Tabla de Cuotas (Table 11) ──
  // Garantiza que las fechas (09/01/2027, etc.) no se corten en dos renglones en ninguna columna
  // y que los títulos (CUOTAS, EXTRAORDINARIAS, etc.) no se partan.
  const t11Widths = [
    768, 1301, 1240, // Grupo 1: CUOTAS (768), SEPARACIÓN (1301), FECHA (1240) -> Total 3309
    112,             // Espacio separador 1
    750, 1435, 1240, // Grupo 2: CUOTAS (750), ORDINARIAS (1435), FECHA (1240) -> Total 3425
    141,             // Espacio separador 2
    750, 1507, 1240  // Grupo 3: CUOTAS (750), EXTRAORDINARIAS (1507), FECHA (1240) -> Total 3497
  ];
  xml = setTableColumnWidths(xml, 11, t11Widths, 50);
  xml = setTableRowFontSize(xml, 11, 0, '15'); // 7.5pt para títulos de encabezado

  // ── Mantener CIERRE DEL NEGOCIO y plan de pagos completamente unidos ──
  // Evita que Table 10 se parta a la mitad o quede huérfana de la tabla de cuotas
  xml = keepTableTogether(xml, 10, true);
  xml = keepTableTogether(xml, 11, true);
  xml = keepTableTogether(xml, 12, true);
  xml = keepTableTogether(xml, 13, true);

  // Iniciar el bloque económico en página limpia para que todas las tablas quepan unidas
  xml = addPageBreakBefore(xml, 'Realizadas las precisiones anteriores');

  // Compactar párrafo entre Table 10 y Table 11
  xml = xml.replace(/(<\/w:tbl>)(<w:p\b[^>]*><w:pPr>[\s\S]*?<\/w:pPr><\/w:p>)(<w:tbl[\s\S]*?CUOTAS)/, (_m, tbl1, _p, tbl2) => {
    const compactP = '<w:p><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="40" w:line="80" w:lineRule="exact"/><w:rPr><w:sz w:val="8"/></w:rPr></w:pPr></w:p>';
    return `${tbl1}${compactP}${tbl2}`;
  });

  // Evitar títulos huérfanos y cortes indebidos
  xml = addKeepNextToParagraphs(xml, '1.4 CONTRATO DE PREVENTA DE BIEN INMUEBLE SOBRE PLANOS');
  xml = addKeepNextToParagraphs(xml, 'CIERRE DEL NEGOCIO');
  xml = addKeepNextToParagraphs(xml, 'Realizadas las precisiones anteriores');

  // Asegurar cantSplit en TODAS las filas de TODAS las tablas
  xml = ensureAllTablesCantSplit(xml);

  // Unificar colores de todas las tablas y figuras con el oro oficial Meraki (#D5B545)
  xml = xml.replace(/B7871C/gi, 'D5B545');

  // Quitar marcas de salto de página heredadas del Word de edición de jurídica
  xml = xml.replace(/<w:lastRenderedPageBreak\/>/g, '');

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

const BANNER_PREVENTA = path.join(__dirname, 'moderno', 'banner-preventa.png');

function configurePreventaHeaders(zip) {
  if (fs.existsSync(BANNER_PREVENTA)) {
    zip.file('word/media/banner-preventa.png', fs.readFileSync(BANNER_PREVENTA));
  }
  let contentTypes = zip.file('[Content_Types].xml').asText();
  if (!contentTypes.includes('Extension="png"')) {
    contentTypes = contentTypes.replace('<Types', '<Types><Default Extension="png" ContentType="image/png"/>');
  }
  if (!contentTypes.includes('/word/header2.xml')) {
    contentTypes = contentTypes.replace('</Types>', '<Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>');
  }
  zip.file('[Content_Types].xml', contentTypes);

  // Vaciar header1.xml para que las páginas 2 en adelante no lleven encabezado ni ocupen espacio vertical
  const emptyHdr = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr></w:p>' +
    '</w:hdr>';
  zip.file('word/header1.xml', emptyHdr);

  // header2.xml con el banner de preventa solo para la primera hoja
  const header2Xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:hdr xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 w15 wp14">' +
    '<w:p w14:paraId="75B33CB6" w14:textId="77777777" w:rsidR="000D1F05" w:rsidRDefault="00000000">' +
    '<w:pPr>' +
    '<w:pBdr><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:between w:val="nil"/></w:pBdr>' +
    '<w:tabs><w:tab w:val="center" w:pos="4419"/><w:tab w:val="right" w:pos="8838"/></w:tabs>' +
    '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>' +
    '<w:jc w:val="center"/>' +
    '<w:rPr><w:color w:val="000000"/></w:rPr>' +
    '</w:pPr>' +
    '<w:r>' +
    '<w:rPr><w:noProof/></w:rPr>' +
    '<w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" hidden="0" allowOverlap="1" wp14:anchorId="19E8B95D" wp14:editId="101BC217">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>-28225</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="5850890" cy="691240"/>' +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="114300" distR="114300"/>' +
    '<wp:docPr id="101" name="banner-preventa.png"/>' +
    '<wp:cNvGraphicFramePr/>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:nvPicPr><pic:cNvPr id="0" name="banner-preventa.png"/><pic:cNvPicPr preferRelativeResize="0"/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="5850890" cy="691240"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln/></pic:spPr>' +
    '</pic:pic>' +
    '</a:graphicData>' +
    '</a:graphic>' +
    '</wp:anchor>' +
    '</w:drawing>' +
    '</w:r>' +
    '</w:p>' +
    '</w:hdr>';
  zip.file('word/header2.xml', header2Xml);

  const header2Rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/banner-preventa.png"/>' +
    '</Relationships>';
  zip.file('word/_rels/header2.xml.rels', header2Rels);

  let docRels = zip.file('word/_rels/document.xml.rels').asText();
  if (!docRels.includes('Target="header2.xml"')) {
    docRels = docRels.replace('</Relationships>', '<Relationship Id="rId14" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/></Relationships>');
    zip.file('word/_rels/document.xml.rels', docRels);
  }

  let docXml = zip.file('word/document.xml').asText();
  docXml = docXml.replace(/<w:pgMar[^>]*\/>/, '<w:pgMar w:top="992" w:right="1417" w:bottom="992" w:left="1417" w:header="360" w:footer="360" w:gutter="0"/>');
  docXml = docXml.replace(/<w:sectPr(\b[^>]*)>([\s\S]*?)<\/w:sectPr>/, (match, attrs, body) => {
    let clean = body.replace(/<w:headerReference[^>]*\/>/g, '')
                    .replace(/<w:footerReference[^>]*\/>/g, '')
                    .replace(/<w:titlePg[^>]*\/>/g, '');
    const headers = '<w:headerReference w:type="default" r:id="rId10"/>' +
                    '<w:headerReference w:type="first" r:id="rId14"/>' +
                    '<w:footerReference w:type="default" r:id="rId11"/>' +
                    '<w:footerReference w:type="first" r:id="rId11"/>';
    return `<w:sectPr${attrs}>${headers}${clean}<w:titlePg/></w:sectPr>`;
  });
  zip.file('word/document.xml', docXml);
}

function configurePromesaHeaders(zip) {
  const emptyHdr = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr></w:p>' +
    '</w:hdr>';
  zip.file('word/header1.xml', emptyHdr);
  zip.file('word/header3.xml', emptyHdr);

  for (const name of ['word/footer1.xml', 'word/footer2.xml', 'word/footer3.xml']) {
    if (zip.file(name)) {
      let fxml = zip.file(name).asText();
      fxml = fxml.replace(/https:\/\/smart-home\.com\.co[^\s<]*/g, '');
      zip.file(name, fxml);
    }
  }

  let docXml = zip.file('word/document.xml').asText();
  docXml = docXml.replace(/<w:pgMar[^>]*\/>/, '<w:pgMar w:top="992" w:right="1417" w:bottom="992" w:left="1417" w:header="360" w:footer="360" w:gutter="0"/>');
  docXml = docXml.replace(/<w:sectPr(\b[^>]*)>([\s\S]*?)<\/w:sectPr>/, (match, attrs, body) => {
    let clean = body.replace(/<w:headerReference[^>]*\/>/g, '')
                    .replace(/<w:footerReference[^>]*\/>/g, '')
                    .replace(/<w:titlePg[^>]*\/>/g, '');
    const headers = '<w:headerReference w:type="default" r:id="rId12"/>' +
                    '<w:headerReference w:type="first" r:id="rId11"/>' +
                    '<w:footerReference w:type="default" r:id="rId15"/>' +
                    '<w:footerReference w:type="first" r:id="rId15"/>';
    return `<w:sectPr${attrs}>${headers}${clean}<w:titlePg/></w:sectPr>`;
  });
  zip.file('word/document.xml', docXml);
}

function cleanNumbering(zip) {
  if (!zip.file('word/numbering.xml')) return;
  let xml = zip.file('word/numbering.xml').asText();
  // Normaliza viñetas: reemplaza el círculo negro grande ● (U+25CF) de Google Docs
  // por la viñeta estándar tipográfica • (U+2022) en Arial con tamaño refinado (9pt = 18).
  xml = xml.replace(/<w:lvlText w:val="●"\/>/g, '<w:lvlText w:val="•"/>');
  xml = xml.replace(/<w:rFonts[^>]*Noto Sans Symbols[^>]*\/>/g, '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/>');
  xml = xml.replace(/(<w:lvl\b[\s\S]*?<\/w:lvl>)/g, (lvlXml) => {
    if (lvlXml.includes('w:numFmt w:val="bullet"')) {
      lvlXml = lvlXml.replace(/<w:sz w:val="20"\/>/g, '<w:sz w:val="18"/>');
      lvlXml = lvlXml.replace(/<w:szCs w:val="20"\/>/g, '<w:szCs w:val="18"/>');
      if (lvlXml.includes('<w:rPr>') && !lvlXml.includes('<w:sz ')) {
        lvlXml = lvlXml.replace('<w:rPr>', '<w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/>');
      } else if (lvlXml.includes('<w:rPr/>')) {
        lvlXml = lvlXml.replace('<w:rPr/>', '<w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/></w:rPr>');
      }
    }
    return lvlXml;
  });
  zip.file('word/numbering.xml', xml);
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
  if (outName === 'preventa-2026.docx') {
    configurePreventaHeaders(zip);
  } else if (outName === 'promesa-2026.docx') {
    configurePromesaHeaders(zip);
  }
  cleanNumbering(zip);
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
