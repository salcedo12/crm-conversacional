/**
 * Conversión de "PROMESA DE COMPRAVENTA 2026" a plantilla con campos (ver build-templates.cjs).
 * Los bloques "(Texto para el proyecto X)" pasan a secciones condicionales:
 *   {#vendedor.esSM} / {^vendedor.esSM}  → Cañón (S+M) / resto (ZOMAC)
 *   {#proyecto.esCanon} {#proyecto.esRioClaro} {#proyecto.esLagunaMar} {#proyecto.esLlanoGrande}
 */
const { replaceText, setCellText, wrapCell, deleteRow, wrapBlock, clearParagraphs, centerTableCells, setTableGrid, centerTable, tidyTable, ensureAllTablesCantSplit } = require('./docxXml.cjs');
const { prepareSignatureBoxes } = require('./signatureBoxes.cjs');

const MARK_CANON = '(Texto para el proyecto CAÑON DE ARIZONA)';
const MARK_OTHERS = '(Texto para el proyecto RIO CLARO LUXURY LIVING CLUB – CIUDAD COUNTRY LAGUNA MAR – LLANO GRANDE LUXURY LIVING CLUB)';
const MARK_LLANO_REZAGO = '(Texto para el proyecto LLANO GRANDE que esta como lotes de rezago en el proyecto CAÑON DE ARIZONA)';
const MARK_RIO = '(Texto para el proyecto RIO CLARO LUXURY LIVING CLUB)';
const MARK_LAGUNA = '(Texto para el proyecto CIUDAD COUNTRY LAGUNA MAR)';

function lotTable(xml, t) {
  xml = setCellText(xml, t, 1, 1, '{lote.numero}');
  xml = setCellText(xml, t, 2, 1, '{lote.sector}');
  xml = setCellText(xml, t, 3, 1, '{lote.area}');
  return setCellText(xml, t, 5, 1, '{lote.condicion}');
}

/**
 * Convierte la fila de separación en un bucle: docxtemplater crea una fila por
 * pago y contractRenderer combina verticalmente la etiqueta y el total.
 * Se exporta también para poder actualizar la plantilla ya generada sin necesitar
 * nuevamente los Word originales de jurídica.
 */
function configureSeparationRows(xml) {
  xml = setCellText(xml, 2, 2, 0, '{#separacionPagos}{#esPrimera}VALOR DE LA SEPARACIÓN{/esPrimera}');
  xml = setCellText(xml, 2, 2, 1, '{valor}');
  xml = setCellText(xml, 2, 2, 2, '{fecha}');
  return setCellText(xml, 2, 2, 3, '{#esPrimera}{total}{/esPrimera}{/separacionPagos}');
}

function convertPromesa(xml) {
  // ── Pre-título: elimina Grupo 3 e image1.jpg del cuerpo para que el banner esté solo en el encabezado de la primera hoja ──
  const titleText = 'CONTRATO DE PROMESA DE COMPRAVENTA';
  const titleIdx = xml.indexOf(titleText);
  if (titleIdx >= 0) {
    const bodyStart = xml.indexOf('<w:body>') + 8;
    const titleParaStart = xml.lastIndexOf('<w:p ', titleIdx);
    if (titleParaStart > bodyStart) {
      xml = xml.slice(0, bodyStart) + xml.slice(titleParaStart);
    }
  }

  // ── Tablas ──
  xml = setCellText(xml, 0, 0, 1, '{nombreCompleto}');               // compradores
  xml = setCellText(xml, 0, 1, 0, '{etiquetaId}:');
  xml = setCellText(xml, 0, 1, 1, '{numeroId}');
  xml = setCellText(xml, 0, 1, 3, '{expedicion}');
  xml = setCellText(xml, 0, 1, 5, '{estadoCivil}');
  xml = setCellText(xml, 0, 1, 7, '{celularInternacional}');
  xml = wrapCell(xml, 0, 0, 0, { prefix: '{#compradores}' });
  xml = wrapCell(xml, 0, 1, 7, { suffix: '{/compradores}' });

  xml = lotTable(xml, 1);                                           // objeto
  xml = lotTable(xml, 8);                                           // anexo final

  xml = setCellText(xml, 2, 1, 1, '{plan.valorTerrenoLetras}');      // precio
  xml = setCellText(xml, 2, 1, 2, '{plan.valorTerreno}');
  // Separación: una fila real por pago, con etiqueta y total combinados.
  xml = configureSeparationRows(xml);
  xml = setCellText(xml, 2, 3, 1, '{plan.saldoLetras}');
  xml = setCellText(xml, 2, 3, 2, '{plan.saldo}');

  for (let r = 5; r >= 2; r--) xml = deleteRow(xml, 3, r);         // ordinarias: 1 fila por grupo
  xml = setCellText(xml, 3, 1, 0, '{n}');
  xml = setCellText(xml, 3, 1, 1, '{fechas}');
  xml = setCellText(xml, 3, 1, 2, '{valorLetras}');
  xml = setCellText(xml, 3, 1, 3, '{valor}');
  xml = wrapCell(xml, 3, 1, 0, { prefix: '{#gruposOrdinarias}' });
  xml = wrapCell(xml, 3, 1, 3, { suffix: '{/gruposOrdinarias}' });
  xml = setCellText(xml, 3, 2, 2, '{plan.bonoLetras}');              // cuota bono (solo si hay beneficio)
  xml = setCellText(xml, 3, 2, 3, '{plan.bono}');
  xml = wrapCell(xml, 3, 2, 0, { prefix: '{#plan.tieneBono}' });
  xml = wrapCell(xml, 3, 2, 3, { suffix: '{/plan.tieneBono}' });

  for (let r = 4; r >= 2; r--) xml = deleteRow(xml, 4, r);         // extraordinarias
  xml = setCellText(xml, 4, 1, 0, '{n}');
  xml = setCellText(xml, 4, 1, 1, '{fechas}');
  xml = setCellText(xml, 4, 1, 2, '{valorLetras}');
  xml = setCellText(xml, 4, 1, 3, '{valor}');
  xml = wrapCell(xml, 4, 1, 0, { prefix: '{#gruposExtraordinarias}' });
  xml = wrapCell(xml, 4, 1, 3, { suffix: '{/gruposExtraordinarias}' });
  xml = setCellText(xml, 4, 2, 1, '{plan.saldoLetras}');
  xml = setCellText(xml, 4, 2, 2, '{plan.saldo}');

  xml = setCellText(xml, 5, 0, 1, '{plan.cesantiasAplica}');         // cesantías
  xml = setCellText(xml, 5, 1, 1, '{plan.fondoCesantias}');
  xml = setCellText(xml, 5, 1, 3, '{plan.cesantias}');

  xml = setCellText(xml, 6, 1, 0, '{plan.arrasLetras}');             // arras
  xml = setCellText(xml, 6, 1, 1, '{plan.arras}');

  xml = setCellText(xml, 7, 0, 1, '{nombreCompleto}');               // notificaciones de compradores
  xml = setCellText(xml, 7, 1, 1, '{direccion}, {ciudadResidencia}');
  xml = setCellText(xml, 7, 2, 1, '{correo}');
  xml = setCellText(xml, 7, 3, 1, '{celular}');
  xml = wrapCell(xml, 7, 0, 0, { prefix: '{#compradores}' });
  xml = wrapCell(xml, 7, 3, 1, { suffix: '{/compradores}' });

  // ── Bloques por proyecto (en orden del documento) ──
  xml = wrapBlock(xml, { marker: MARK_CANON, lastStartsWith: 'Entre los suscritos a saber COMPAÑÍA CONSTRUCTORA MERAKI S+M', open: '{#vendedor.esSM}', close: '{/vendedor.esSM}' });
  xml = wrapBlock(xml, { marker: MARK_OTHERS, lastStartsWith: 'Entre los suscritos a saber GRUPO CONSTRUCTOR MERAKI S.A.S ZOMAC', open: '{^vendedor.esSM}', close: '{/vendedor.esSM}' });
  xml = wrapBlock(xml, { marker: '(Texto para agregar  el proyecto LLANO GRANDE LUXURY LIVING CLUB)', lastStartsWith: 'Que EL(LOS) PROMITENTE(S) COMPRADOR(ES) ha(n) sido informado(s)', open: '{#proyecto.esLlanoGrande}', close: '{/proyecto.esLlanoGrande}' });
  // Identificación del predio (linderos y licencia de cada proyecto).
  xml = wrapBlock(xml, { marker: MARK_LLANO_REZAGO, lastStartsWith: 'Las partes reconocen que, por tratarse', open: '{#proyecto.esLlanoGrande}', close: '{/proyecto.esLlanoGrande}' });
  xml = wrapBlock(xml, { marker: MARK_CANON, lastStartsWith: 'El bien inmueble identificado hace parte del proyecto', open: '{#proyecto.esCanon}', close: '{/proyecto.esCanon}' });
  xml = wrapBlock(xml, { marker: MARK_RIO, lastStartsWith: 'El bien inmueble identificado hace parte del proyecto', open: '{#proyecto.esRioClaro}', close: '{/proyecto.esRioClaro}' });
  xml = wrapBlock(xml, { marker: MARK_LAGUNA, lastStartsWith: 'Las partes reconocen que, por tratarse', open: '{#proyecto.esLagunaMar}', close: '{/proyecto.esLagunaMar}' });
  // Amenidades.
  xml = wrapBlock(xml, { marker: MARK_RIO, lastStartsWith: 'Portería, oficina', open: '{#proyecto.esRioClaro}', close: '{/proyecto.esRioClaro}' });
  xml = wrapBlock(xml, { marker: MARK_LLANO_REZAGO, lastStartsWith: 'Portería, oficina', open: '{#proyecto.esLlanoGrande}', close: '{/proyecto.esLlanoGrande}' });
  xml = wrapBlock(xml, { marker: MARK_CANON, lastStartsWith: 'portería, oficina', open: '{#proyecto.esCanon}', close: '{/proyecto.esCanon}' });
  xml = wrapBlock(xml, { marker: MARK_LAGUNA, lastStartsWith: 'Portería, cancha sintética', open: '{#proyecto.esLagunaMar}', close: '{/proyecto.esLagunaMar}' });

  // Unificar amenidades de forma continua en el mismo párrafo ("de recorrido") y sin saltos vacíos
  const startMarker = 'estarán compuestas por: </w:t></w:r>';
  const startIdx = xml.indexOf(startMarker);
  const endMarker = 'CLÁUSULA SEGUNDA';
  const endIdx = xml.indexOf(endMarker, startIdx);
  if (startIdx !== -1 && endIdx !== -1) {
    const clausulaPStart = xml.lastIndexOf('<w:p', endIdx);
    const regionToReplace = xml.slice(startIdx + startMarker.length, clausulaPStart);

    const extractRuns = (tag) => {
      const o = regionToReplace.indexOf('{#' + tag + '}');
      const c = regionToReplace.indexOf('{/' + tag + '}');
      if (o === -1 || c === -1) return '';
      const inside = regionToReplace.slice(o, c);
      const runs = inside.match(/<w:r(?=[ >])[\s\S]*?<\/w:r>/g) || [];
      return runs.filter(r => !r.includes('{#' + tag + '}')).join('');
    };

    const rioRuns = extractRuns('proyecto.esRioClaro');
    const llanoRuns = extractRuns('proyecto.esLlanoGrande');
    const canonRuns = extractRuns('proyecto.esCanon');
    const lagunaRuns = extractRuns('proyecto.esLagunaMar');

    const inlineReplacement =
      '<w:r><w:t xml:space="preserve">{#proyecto.esRioClaro}</w:t></w:r>' +
      rioRuns +
      '<w:r><w:t xml:space="preserve">{/proyecto.esRioClaro}</w:t></w:r>' +
      '<w:r><w:t xml:space="preserve">{#proyecto.esLlanoGrande}</w:t></w:r>' +
      llanoRuns +
      '<w:r><w:t xml:space="preserve">{/proyecto.esLlanoGrande}</w:t></w:r>' +
      '<w:r><w:t xml:space="preserve">{#proyecto.esCanon}</w:t></w:r>' +
      canonRuns +
      '<w:r><w:t xml:space="preserve">{/proyecto.esCanon}</w:t></w:r>' +
      '<w:r><w:t xml:space="preserve">{#proyecto.esLagunaMar}</w:t></w:r>' +
      lagunaRuns +
      '<w:r><w:t xml:space="preserve">{/proyecto.esLagunaMar}</w:t></w:r>' +
      '</w:p>';

    xml = xml.slice(0, startIdx + startMarker.length) + inlineReplacement + xml.slice(clausulaPStart);
  }
  // Cuentas bancarias.
  xml = wrapBlock(xml, { marker: '(Texto para el proyecto CAÑÓN DE ARIZONA)', lastStartsWith: 'y realizarse únicamente', open: '{#vendedor.esSM}', close: '{/vendedor.esSM}' });
  xml = wrapBlock(xml, { marker: MARK_OTHERS, lastStartsWith: 'y realizarse únicamente', open: '{^vendedor.esSM}', close: '{/vendedor.esSM}' });
  // El final del bloque ZOMAC quedó pegado al texto común siguiente.
  xml = replaceText(xml, 'GRUPO CONSTRUCTOR MERAKI SAS. Como consecuencia', '{^vendedor.esSM}GRUPO CONSTRUCTOR MERAKI SAS. {/vendedor.esSM}Como consecuencia');
  // "…expedido por el área administrativa del [empresa] 2. Que el lote…": solo cambia el nombre de la empresa.
  xml = replaceText(xml,
    `${MARK_CANON}   COMPAÑÍA CONSTRUCTORA MERAKI S+M S.A.S, ${MARK_OTHERS}`, '{vendedor.razonSocial},');
  xml = clearParagraphs(xml, 'GRUPO CONSTRUCTOR MERAKI S.A.S ZOMAC,');
  xml = clearParagraphs(xml, '(EL TEXTO VA CONTINUO SOLO CAMBIA EL NOMBRE DE LA EMPRESA DE ACUERDO AL PROYECTO)');

  // ── Datos dentro de párrafos ──
  xml = replaceText(xml, '<<CÓDIGO DE REFERENCIA DEL LOTE>>', '{lote.codigo}');
  xml = replaceText(xml, 'ETAPA MAR SANTORINI, ubicado', 'ETAPA {lote.sector}, ubicado');
  xml = replaceText(xml,
    'CIENTO CUARENTA Y CINCO MILLONES DE PESOS M/CTE ($145.000.000)',
    '{plan.valorTerrenoLetras} M/CTE ({plan.valorTerreno})');
  xml = replaceText(xml, 'PLAZO TOTAL DE (36) MESES', 'PLAZO TOTAL DE ({plan.plazoMeses}) MESES');
  xml = replaceText(xml, 'a los 29 días del mes de enero del año 2026', 'a los {fecha.dia} días del mes de {fecha.mesNombre} del año {fecha.anio}');

  // ── Tablas de precio y cuotas: contenido centrado y columnas parejas ──
  // Ordinarias y extraordinarias con la misma cuadrícula; columna de valores ancha para que
  // "$ 5.635.500" no se parta. Total = 9662 (ancho original de la tabla).
  xml = setTableGrid(xml, 3, [1600, 2200, 3962, 1900]);
  xml = setTableGrid(xml, 4, [1600, 2200, 3962, 1900]);
  xml = setTableGrid(xml, 5, [3500, 2000, 2100, 2062]);              // cesantías
  for (const t of [2, 3, 4, 6]) xml = centerTableCells(xml, t, 1);
  xml = centerTableCells(xml, 5, 0);
  for (const t of [2, 3, 4, 5, 6]) xml = centerTable(xml, t);             // tablas centradas en la hoja
  // Celdas sin la sangría de 1 cm del original y con margen interno (compradores, lote, cuotas, notificaciones).
  for (let t = 0; t <= 8; t++) xml = tidyTable(xml, t);
  // Compradores: columnas de etiqueta más anchas para "PASAPORTE:" y "TELEFONO:" (mismo ancho total, 10227).
  xml = setTableGrid(xml, 0, [1500, 1400, 500, 1550, 1100, 1250, 1300, 1627]);

  // ── Recuadros de firma originales (cuadros de texto, dos copias): datos de cada comprador ──
  xml = replaceText(xml, 'BATMAN ROBERTO FAGUNDEZ GONZALEZ', '{nombreCompleto}');
  xml = replaceText(xml, 'CEDÚLA DE CIUDADANIA: ', '{tipoIdLargo}:');
  xml = replaceText(xml, '80.145.743 ', '{numeroId}');
  xml = replaceText(xml, 'BOGOTA D, C.', '{ciudadExpedicion}');
  // Recuadro por comprador y firmas que no se parten entre hojas (ver build-templates.cjs).
  // El cuadro de "FIRMA" tiene 10 renglones y mide 4,4 cm: Word centra y recorta lo que sobra,
  // y lo que quedaba fuera era "FIRMA". Se quitan el primer y el último renglón vacíos.
  xml = xml.replace(/<w:txbxContent>([\s\S]*?)<\/w:txbxContent>/g, (box, inner) => {
    if (!/>\s*FIRMA</.test(inner)) return box;
    const paras = inner.match(/<w:p(?=[ >])[\s\S]*?<\/w:p>/g) || [];
    const isEmpty = (p) => !(p.match(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g) || []).some((t) => t.replace(/<[^>]+>/g, '').trim());
    if (paras.length < 9 || !isEmpty(paras[0]) || !isEmpty(paras[paras.length - 1])) return box;
    return box.replace(paras[0], '').replace(new RegExp(`${paras[paras.length - 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\s\\S]*<w:p[ >])`), '');
  });
  // "FIRMA" del recuadro del comprador traía una sangría que lo empujaba fuera del cuadro (se veía cortado).
  xml = xml.replace(
    /(<w:pPr><w:spacing [^>]*\/>)<w:ind w:left="610" w:right="0" w:firstLine="600"\/>(<w:jc w:val="center"\/><w:textDirection w:val="btLr"\/><\/w:pPr>(?:(?!<\/w:p>)[\s\S])*?>FIRMA<)/g,
    '$1$2');
  xml = prepareSignatureBoxes(xml, { heading: 'PROMITENTE COMPRADOR', sellerLines: 3 });
  xml = ensureAllTablesCantSplit(xml);
  // Unificar colores con el oro oficial Meraki (#D5B545)
  xml = xml.replace(/B7871C/gi, 'D5B545');
  xml = xml.replace(/<w:lastRenderedPageBreak\/>/g, '');
  return xml;
}

module.exports = { convertPromesa, configureSeparationRows };
