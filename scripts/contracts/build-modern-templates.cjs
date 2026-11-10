/**
 * Crea copias rediseñadas de las plantillas de contrato:
 *   functions/templates/preventa-2026.docx -> functions/templates/preventa-2026-moderno.docx
 *   functions/templates/promesa-2026.docx  -> functions/templates/promesa-2026-moderno.docx
 *
 * Línea gráfica: documento de imprenta. Una sola familia serif (Palatino Linotype, incrustada),
 * tinta negra sobre papel blanco, tablas con filetes horizontales como un estado financiero, firmas
 * sobre línea y el logo original como único color. Sin bandas, rellenos ni tarjetas.
 *
 * Solo cambia la presentación. Los originales no se tocan y el texto, los campos {…}, las
 * tablas (mismas filas y celdas, en el mismo orden, para que contractRenderer.ts siga funcionando)
 * y los recuadros de firma se conservan. El script falla si el texto cambia en un solo carácter.
 *
 * Uso: node scripts/contracts/build-modern-templates.cjs
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PizZip = require(path.join(__dirname, '..', '..', 'functions', 'node_modules', 'pizzip'));
const { bodyElements, elements, topTables, rowsOf, cellsOf, textOf } = require('./docxXml.cjs');

const TEMPLATES = path.join(__dirname, '..', '..', 'functions', 'templates');
const ASSETS = path.join(__dirname, 'moderno');

const FONT = 'Palatino Linotype';
const FONT_FILES = { embedRegular: 'pala.ttf', embedBold: 'palab.ttf', embedItalic: 'palai.ttf', embedBoldItalic: 'palabi.ttf' };
const INK = '111111';
const GRAY = '555555';
const HAIR = 'BDBDBD';

// Ancho de página carta (12240) menos márgenes de 1360 a cada lado.
const TEXT_WIDTH = 9520;
const SIGNATURE_WIDTH = TEXT_WIDTH * 635;
const SPACER_WIDTH = 110;
const fonts = `<w:rFonts w:ascii="${FONT}" w:eastAsia="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>`;

/** Encabezados de cláusula de la promesa: allí van pegados dentro de párrafos enormes. */
const PROMESA_CLAUSES = [
  'CLAUSULA PRIMERA-OBJETO:',
  'CLÁUSULA SEGUNDA: PRECIO, PLAZO Y FORMA DE PAGO:',
  'CLÁUSULA TERCERA: CONDICIONES ESPECIALES QUE MODULAN EL PRECIO Y/O LA FORMA DE PAGO:',
  'CLÁUSULA CUARTA: GASTOS ADMINISTRATIVOS, IMPUESTOS Y CONTRIBUCIONES:',
  'CLÁUSULA QUINTA: OTROS GASTOS. -',
  'CLÁUSULA SEXTA: ARRAS.',
  'CLAUSULA SÉPTIMA: ORIGEN DE FONDOS Y DESTINO DE LOS ACTIVOS.-',
  'CLÁUSULA OCTAVA: ACCIONES LEGALES, DEMANDAS Y PROCESOS:',
  'CLÁUSULA NOVENA: MORA. -',
  'CLÁUSULA DECIMA: ACELERATORIA:',
  'CLAUSULA DECIMA PRIMERA: INOPERANCIA DEL DERECHO DE RETRACTO:,',
  'CLAUSULA DECIMA SEGUNDA: PACTO COMISORIO.-',
  'CLAUSULA DECIMA TERCERA: GARANTÍAS:',
  'CLAUSULA DECIMA CUARTA; LEGISLACIÓN APLICABLE.',
  'CLAUSULA DECIMA QUINTA:. EXIGIBILIDAD Y MÉRITO EJECUTIVO:',
  'CLAUSULA DECIMA SEXTA: ENTREGA MATERIAL:',
  'CLAUSULA DECIMA SÉPTIMA: MERA TENENCIA:',
  'CLAUSULA DECIMA OCTAVA: ENTREGA DE BIENES COMUNES:',
  'CLAUSULA DECIMA NOVENA: RÉGIMEN DE PROPIEDAD HORIZONTAL:',
  'CLAUSULA VIGESIMA. CUOTA DE ADMINISTRACIÓN:',
  'CLAUSULA VIGÉSIMO PRIMERA: CONDICIONES DE LIBERTAD Y OTROS GRAVÁMENES:',
  'CLAUSULA DECIMO TERCERA. CONDICIÓN RESOLUTORIA:',
  'CLAUSULA VIGESIMA SEGUNDA: OTORGAMIENTO DE ESCRITURAS PÚBLICAS:',
  'CLAUSULA VIGESIMA TERCERA. GASTOS NOTARIALES Y DE REGISTRO:',
  'CLÁUSULA VIGÉSIMA CUARTA: CESIÓN.',
  'CLÁUSULA VIGÉSIMO QUINTA: IMPREVISTOS Y FUERZA MAYOR. -',
  'CLAUSULA VIGÉSIMO SEXTA; CLÁUSULA COMPROMISORIA, SOLUCIÓN DE CONFLICTOS   CONTRACTUALES; JURISDICCIÓN Y COMPETENCIA:',
  'CLÁUSULA VIGÉSIMO SÉPTIMA: INTERPRETACIÓN:',
  'CLÁUSULA VIGÉSIMA OCTAVA: NULIDAD PARCIAL:',
  'CLAUSULA VIGÉSIMO NOVENA: VALIDEZ DE LA RÚBRICA Y RUBRICA ELECTRÓNICA:',
  'CLÁUSULA TRIGÉSIMA. MODIFICACIONES, INTEGRIDAD Y PREVALENCIA CONTRACTUAL,',
  'CLÁUSULA TRIGÉSIMO-PRIMERA. DOMICILIO CONTRACTUAL:',
  'CLÁUSULA TRIGÉSIMO SEGUNDA. INFORMACIÓN PRECONTRACTUAL, NATURALEZA DEL PROYECTO Y CONSENTIMIENTO INFORMADO:',
  'CLÁUSULA TRIGÉSIMO SEGUNDA: GARANTÍA LEGAL Y PROCEDIMIENTO DE ATENCIÓN DE RECLAMACIONES:',
  'CLÁUSULA TRIGÉSIMO TERCERA:  NOTIFICACIONES CONTRACTUALES Y MEDIOS ELECTRÓNICOS DE COMUNICACIÓN:',
  'CLÁUSULA TRIGÉSIMO CUARTA: AUTORIZACIÓN PARA EL MANEJO DE DATOS PERSONALES:',
  'CLÁUSULA TRIGÉSIMO QUINTA DECLARACIÓN ADICIONAL:',
];

const DOCS = {
  preventa: {
    source: 'preventa-2026.docx',
    target: 'preventa-2026-moderno.docx',
    headerTitle: null,
    bodySize: 20,
    defaultHeader: 'word/header1.xml',
    defaultFooters: ['word/footer1.xml'],
    titles: [
      'FORMATO DE DECLARACIÓN SOBRE ORIGEN LÍCITO DE LOS RECURSOS',
      'SUMINISTRO DE INFORMACIÓN MÍNIMA, DEBER DE INFORMACIÓN Y ASUNCIÓN INFORMADA DE RIESGOS Y RESPONSABILIDAD',
      'AUTORIZACIÓN DE TRATAMIENTO DE DATOS PERSONALES',
      'CONTRATO DE PREVENTA DE BIEN INMUEBLE SOBRE PLANOS',
    ],
    subtitles: ['(LEY 1480 DE 2011- CIRCULAR EXTERNA 004/2024 SUPERINTENDENCIA DE INDUSTRIA Y COMERCIO)'],
    subheads: [],
    clauses: [],
    // Tablas de cifras: centradas y con letra más pequeña porque llevan muchas columnas.
    // Los anchos de columnWidths son proporciones: se ajustan al ancho del texto.
    gridTables: [10, 11, 12],
    longTables: [10],
    columnWidths: {
      0: [950, 1230, 1340, 1480, 850, 1030, 1230, 1350],
      4: [1800, 2700, 1500, 1900, 566, 1283],
      5: [1650, 2300, 1500, 4190],
      6: [950, 1230, 1340, 1480, 850, 1030, 1230, 1350],
      10: [730, 1200, 1040, 110, 730, 1200, 1040, 110, 730, 1760, 1040],
      11: [2970, 110, 2970, 110, 3530],
      13: [1950, 8050],
    },
  },
  promesa: {
    source: 'promesa-2026.docx',
    target: 'promesa-2026-moderno.docx',
    headerTitle: 'CONTRATO DE PROMESA DE COMPRAVENTA',
    bodySize: 19,
    defaultHeader: 'word/header2.xml',
    defaultFooters: ['word/footer1.xml', 'word/footer2.xml'],
    titles: ['CONTRATO DE PROMESA DE COMPRAVENTA'],
    subtitles: [],
    subheads: ['Forma de pago', 'DIRECCIONES DE NOTIFICACIÓN', 'CUOTAS ORDINARIAS', 'CUOTAS EXTRAORDINARIAS'],
    clauses: PROMESA_CLAUSES,
    gridTables: [],
    longTables: [3, 4],
    columnWidths: {
      0: [1040, 1280, 560, 1600, 880, 1130, 1130, 1970],
      3: [1500, 2350, 3790, 2000],
      4: [1950, 1800, 3890, 2000],
    },
  },
};

// ---------------------------------------------------------------- estilos

function modernStyles(doc) {
  const style = (id, name, pPr, rPr, extra = '') => (
    `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>${extra}<w:qFormat/>` +
    `<w:pPr>${pPr}</w:pPr><w:rPr>${fonts}${rPr}</w:rPr></w:style>`
  );
  const noInd = '<w:ind w:left="0" w:right="0" w:firstLine="0"/>';
  const cell = (keep = '') => `${keep}<w:spacing w:before="0" w:after="0" w:line="252" w:lineRule="auto"/>${noInd}<w:jc w:val="left"/>`;
  const center = (keep = '') => `${keep}<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>${noInd}<w:jc w:val="center"/>`;
  const size = (n) => `<w:sz w:val="${n}"/><w:szCs w:val="${n}"/>`;
  return [
    // Título de sección: versales espaciadas, centradas, sin negrita ni filetes.
    style('MkTitulo', 'Meraki Título',
      `<w:keepNext/><w:keepLines/><w:spacing w:before="200" w:after="340" w:line="288" w:lineRule="auto"/>${noInd}<w:jc w:val="center"/><w:outlineLvl w:val="0"/>`,
      `<w:color w:val="${INK}"/><w:spacing w:val="24"/>${size(28)}`, '<w:next w:val="MkCuerpo"/>'),
    style('MkSubtitulo', 'Meraki Subtítulo',
      `<w:keepNext/><w:spacing w:before="0" w:after="300" w:line="252" w:lineRule="auto"/>${noInd}<w:jc w:val="center"/>`,
      `<w:i/><w:iCs/><w:color w:val="${GRAY}"/>${size(18)}`, '<w:next w:val="MkCuerpo"/>'),
    style('MkClausula', 'Meraki Cláusula',
      `<w:keepNext/><w:keepLines/><w:spacing w:before="340" w:after="110" w:line="264" w:lineRule="auto"/>${noInd}<w:jc w:val="left"/><w:outlineLvl w:val="1"/>`,
      `<w:b/><w:bCs/><w:color w:val="${INK}"/><w:spacing w:val="6"/>${size(20)}`, '<w:next w:val="MkCuerpo"/>'),
    style('MkApartado', 'Meraki Apartado',
      `<w:keepNext/><w:spacing w:before="240" w:after="100" w:line="264" w:lineRule="auto"/>${noInd}<w:jc w:val="left"/>`,
      `<w:b/><w:bCs/><w:color w:val="${INK}"/>${size(20)}`, '<w:next w:val="MkCuerpo"/>'),
    style('MkCuerpo', 'Meraki Cuerpo',
      `<w:spacing w:before="0" w:after="120" w:line="270" w:lineRule="auto"/>${noInd}<w:jc w:val="both"/>`,
      `<w:color w:val="${INK}"/>${size(doc.bodySize)}`),
    style('MkLista', 'Meraki Lista',
      '<w:spacing w:before="0" w:after="100" w:line="270" w:lineRule="auto"/><w:jc w:val="both"/>',
      `<w:color w:val="${INK}"/>${size(doc.bodySize)}`),
    style('MkEspacio', 'Meraki Espacio',
      `<w:spacing w:before="0" w:after="60" w:line="120" w:lineRule="exact"/>${noInd}`, size(6)),
    style('MkCelda', 'Meraki Celda', cell(), `<w:color w:val="${INK}"/>${size(19)}`),
    style('MkCeldaEtiqueta', 'Meraki Celda Etiqueta',
      `<w:spacing w:before="24" w:after="0" w:line="252" w:lineRule="auto"/>${noInd}<w:jc w:val="left"/>`,
      `<w:color w:val="${GRAY}"/><w:spacing w:val="6"/>${size(16)}`),
    style('MkCeldaTitulo', 'Meraki Celda Título', cell('<w:keepNext/>'),
      `<w:b/><w:bCs/><w:color w:val="${INK}"/><w:spacing w:val="8"/>${size(16)}`),
    style('MkCifra', 'Meraki Cifra', center(), `<w:color w:val="${INK}"/>${size(17)}`),
    style('MkCifraEtiqueta', 'Meraki Cifra Etiqueta', center(), `<w:color w:val="${GRAY}"/>${size(14)}`),
    style('MkCifraTitulo', 'Meraki Cifra Título', center('<w:keepNext/>'),
      `<w:b/><w:bCs/><w:color w:val="${INK}"/>${size(14)}`),
  ].join('');
}

// ---------------------------------------------------------------- utilidades de párrafo

const RUN = /<w:r(?: [^>]*)?>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g;
const T_EL = /<w:t(?: [^>]*)?>([^<]*)<\/w:t>/;

function runsOf(p) {
  let at = 0;
  return [...p.matchAll(RUN)].map((m) => {
    const text = textOf(m[0]);
    const run = { start: m.index, end: m.index + m[0].length, xml: m[0], text, at };
    at += text.length;
    return run;
  });
}

/** Parte el run que atraviesa `offset` para que exista una frontera justo ahí. */
function ensureBoundary(p, offset) {
  for (const run of runsOf(p)) {
    if (offset <= run.at || offset >= run.at + run.text.length) continue;
    if ((run.xml.match(/<w:t[ >]/g) || []).length !== 1) throw new Error(`Run con varios textos: ${run.text.slice(0, 50)}`);
    const k = offset - run.at;
    const piece = (text) => run.xml.replace(T_EL, () => `<w:t xml:space="preserve">${text}</w:t>`);
    return p.slice(0, run.start) + piece(run.text.slice(0, k)) + piece(run.text.slice(k)) + p.slice(run.end);
  }
  return p;
}

/** Inserta un fin/inicio de párrafo en los desplazamientos de texto indicados. */
function splitParagraph(p, offsets) {
  const open = p.match(/^<w:p(?: [^>]*)?>/)[0];
  const cleanOpen = open.replace(/ w14:(?:paraId|textId)="[^"]*"/g, '');
  const pPr = (p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [''])[0];
  for (const offset of offsets) p = ensureBoundary(p, offset);
  const cuts = offsets.map((offset) => {
    const run = runsOf(p).find((r) => r.at === offset && r.text.length);
    if (!run) throw new Error(`Sin run en el desplazamiento ${offset}`);
    if (elements(p.slice(0, run.start), 'w:hyperlink').length !== (p.slice(0, run.start).match(/<\/w:hyperlink>/g) || []).length) {
      throw new Error('Corte dentro de un hipervínculo');
    }
    return run.start;
  }).sort((a, b) => b - a);
  for (const cut of cuts) p = `${p.slice(0, cut)}</w:p>${cleanOpen}${pPr}${p.slice(cut)}`;
  return p.split('</w:p>').filter(Boolean).map((part) => `${part}</w:p>`);
}

/** El formato lo dan los estilos: fuera tipografía, tamaño y color directos de cada run. */
function cleanRuns(p) {
  return p.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/g, (_m, props) => {
    const kept = props
      .replace(/<w:rFonts [^>]*\/>/g, '')
      .replace(/<w:sz(?:Cs)? [^>]*\/>/g, '')
      .replace(/<w:color w:val="(?!0563C1)[^"]*"[^>]*\/>/g, '')
      .replace(/<w:shd [^>]*\/>/g, '');
    return kept ? `<w:rPr>${kept}</w:rPr>` : '';
  });
}

/** Títulos y etiquetas toman su peso del estilo, no de la negrita o el subrayado del original. */
function plainRuns(p) {
  return p.replace(/<w:bCs\/>|<w:b\/>|<w:u [^>]*\/>/g, '').replace(/<w:rPr><\/w:rPr>/g, '');
}

function setParagraph(p, styleId, { keepNext = false, pageBreak = false, keepNumbering = true, jc = null, before = null, hanging = false } = {}) {
  const pPr = (p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [''])[0];
  const numPr = keepNumbering ? (pPr.match(/<w:numPr>[\s\S]*?<\/w:numPr>/) || [''])[0] : '';
  const ind = numPr ? (pPr.replace(/<w:rPr>[\s\S]*<\/w:rPr>/, '').match(/<w:ind [^>]*\/>/) || [''])[0] : '';
  const style = numPr && styleId === 'MkCuerpo' ? 'MkLista' : styleId;
  const next = `<w:pPr><w:pStyle w:val="${style}"/>${keepNext ? '<w:keepNext/>' : ''}${pageBreak ? '<w:pageBreakBefore/>' : ''}${numPr}${before ? `<w:spacing w:before="${before}"/>` : ''}${hanging ? '<w:ind w:left="380" w:hanging="380"/>' : ind}${jc ? `<w:jc w:val="${jc}"/>` : ''}</w:pPr>`;
  const body = cleanRuns(pPr ? p.replace(pPr, '') : p);
  return body.replace(/^(<w:p(?: [^>]*)?>)/, `$1${next}`);
}

/** Algunos títulos separan sus palabras con tabulaciones, que abrirían huecos enormes. */
function tabsToSpaces(p) {
  return p.replace(/<w:tab\/><w:t(?: [^>]*)?>([^<]*)<\/w:t>/g, '<w:t xml:space="preserve"> $1</w:t>');
}

/** Punto donde termina el encabezado de la cláusula, incluidos los espacios que lo siguen. */
function endWithSpaces(text, end) {
  while (text[end] === ' ') end += 1;
  return end;
}

function styleBodyParagraph(p, doc, state, { keepWithTable = false, afterTable = false } = {}) {
  const text = textOf(p);
  const trimmed = text.trim();
  if (!trimmed) return setParagraph(p, 'MkEspacio', { keepNumbering: false, keepNext: keepWithTable });

  state.seen.add(trimmed);
  const titleIndex = doc.titles.indexOf(trimmed);
  if (titleIndex >= 0) return plainRuns(setParagraph(p, 'MkTitulo', { pageBreak: titleIndex > 0, keepNumbering: false }));
  if (doc.subtitles.includes(trimmed)) return plainRuns(setParagraph(p, 'MkSubtitulo', { keepNumbering: false }));
  if (doc.subheads.includes(trimmed)) return setParagraph(p, 'MkApartado', { jc: 'left', before: afterTable ? 240 : null });

  // Corte de cláusulas y parágrafos que en el Word original van seguidos en un mismo párrafo.
  const offsets = new Set();
  const clauseEnds = new Map();
  for (const heading of doc.clauses) {
    const at = text.indexOf(heading);
    if (at < 0) continue;
    if (state.seen.has(heading)) throw new Error(`Cláusula repetida: ${heading}`);
    state.seen.add(heading);
    if (at > 0) offsets.add(at);
    const end = endWithSpaces(text, at + heading.length);
    if (end < text.length) offsets.add(end);
    clauseEnds.set(at, end);
  }
  for (const m of text.matchAll(/PARÁGRAFO|Parágrafo/g)) if (m.index > 0) offsets.add(m.index);

  const ordered = [...offsets].sort((a, b) => a - b);
  const pieces = ordered.length ? splitParagraph(p, ordered) : [p];
  const starts = [0, ...ordered];
  return pieces.map((piece, i) => {
    const pieceText = textOf(piece);
    const isClause = clauseEnds.has(starts[i]) || /^CL[ÁA]USULA\s/.test(pieceText) && pieceText.length < 130 && !doc.clauses.length;
    if (isClause) {
      return tabsToSpaces(setParagraph(piece, 'MkClausula', { keepNumbering: false }).replace(/<w:u [^>]*\/>/g, ''));
    }
    return setParagraph(piece, 'MkCuerpo', {
      keepNumbering: i === 0,
      keepNext: keepWithTable && i === pieces.length - 1,
      before: afterTable && i === 0 ? 220 : null,
      // Listas numeradas a mano ("1.Que…"): el número queda colgado y el texto alineado.
      hanging: /^\d{1,2}\./.test(pieceText),
    });
  }).join('');
}

// ---------------------------------------------------------------- tablas

function scaleGrid(grid) {
  const spacers = grid.map((w) => w < 200);
  const free = TEXT_WIDTH - spacers.filter(Boolean).length * SPACER_WIDTH;
  const sum = grid.reduce((acc, w, i) => acc + (spacers[i] ? 0 : w), 0);
  const scaled = grid.map((w, i) => (spacers[i] ? SPACER_WIDTH : Math.round((w * free) / sum)));
  const last = scaled.length - 1 - [...spacers].reverse().findIndex((s) => !s);
  scaled[last] += TEXT_WIDTH - scaled.reduce((a, b) => a + b, 0);
  return { scaled, spacers };
}

function styleTable(table, index, doc) {
  const isGrid = doc.gridTables.includes(index);
  const grid = [...table.slice(0, table.indexOf('<w:tr')).matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]));
  const { scaled, spacers } = scaleGrid(doc.columnWidths[index] || grid);
  if (scaled.length !== grid.length) throw new Error(`Tabla ${index}: anchos inválidos`);
  const tblStyle = (table.match(/<w:tblStyle [^>]*\/>/) || [''])[0];
  const tblLook = (table.match(/<w:tblLook [^>]*\/>/) || [''])[0];
  // Como en un estado financiero: filete superior fuerte, filetes finos entre filas y nada de verticales.
  // Sin margen izquierdo la primera columna queda alineada con el texto del contrato.
  const left = isGrid ? 40 : 0;
  const right = isGrid ? 40 : 130;
  const tblPr = `<w:tblPr>${tblStyle}<w:tblW w:w="${TEXT_WIDTH}" w:type="dxa"/><w:tblInd w:w="0" w:type="dxa"/>` +
    '<w:tblBorders>' +
    `<w:top w:val="single" w:sz="8" w:space="0" w:color="${INK}"/><w:left w:val="nil"/>` +
    `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="${INK}"/><w:right w:val="nil"/>` +
    `<w:insideH w:val="single" w:sz="2" w:space="0" w:color="${HAIR}"/><w:insideV w:val="nil"/>` +
    '</w:tblBorders><w:tblLayout w:type="fixed"/>' +
    `<w:tblCellMar><w:top w:w="55" w:type="dxa"/><w:left w:w="${left}" w:type="dxa"/><w:bottom w:w="55" w:type="dxa"/><w:right w:w="${right}" w:type="dxa"/></w:tblCellMar>` +
    `${tblLook}</w:tblPr>`;
  const tblGrid = `<w:tblGrid>${scaled.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;

  const wrap = { start: 0, end: table.length };
  const rows = rowsOf(table, wrap);
  const styledRows = rows.map((row, rowIndex) => {
    const rowXml = table.slice(row.start, row.end);
    const cells = cellsOf(table, row);
    let col = 0;
    const info = cells.map((cell) => {
      const xml = table.slice(cell.start, cell.end);
      const span = Number((xml.match(/<w:gridSpan w:val="(\d+)"/) || [])[1] || 1);
      const first = col;
      col += span;
      const fill = (xml.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/) || [''])[0].match(/w:fill="(\w+)"/);
      return { xml, span, first, filled: !!fill && fill[1] !== 'FFFFFF' && fill[1] !== 'auto', spacer: span === 1 && spacers[first] };
    });
    if (col !== grid.length) throw new Error(`Tabla ${index}, fila ${rowIndex}: ${col} columnas de ${grid.length}`);
    const real = info.filter((c) => !c.spacer);
    const isHeader = rowIndex === 0 && real.length > 0 && real.every((c) => c.filled);
    const trOld = (rowXml.match(/<w:trPr>[\s\S]*?<\/w:trPr>/) || [''])[0];
    const height = Number((trOld.match(/<w:trHeight w:val="(\d+)"/) || [])[1] || 0);
    const trPr = `<w:trPr><w:cantSplit/><w:trHeight w:val="${height > 600 ? height : 280}"/>${isHeader && real.length > 1 ? '<w:tblHeader/>' : ''}</w:trPr>`;

    const styledCells = info.map((cell) => {
      const width = scaled.slice(cell.first, cell.first + cell.span).reduce((a, b) => a + b, 0);
      const vMerge = (cell.xml.match(/<w:vMerge(?: [^>]*)?\/>/) || [''])[0];
      const kind = cell.spacer ? 'spacer' : isHeader ? 'header' : cell.filled ? 'label' : 'value';
      const borders = cell.spacer
        ? '<w:tcBorders><w:top w:val="nil"/><w:bottom w:val="nil"/><w:insideH w:val="nil"/></w:tcBorders>'
        : kind === 'header' ? `<w:tcBorders><w:bottom w:val="single" w:sz="4" w:space="0" w:color="${INK}"/></w:tcBorders>` : '';
      const tcPr = `<w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${cell.span > 1 ? `<w:gridSpan w:val="${cell.span}"/>` : ''}${vMerge}${borders}<w:vAlign w:val="${isGrid ? 'center' : 'top'}"/></w:tcPr>`;
      const inner = cell.xml.replace(/^<w:tc(?: [^>]*)?>/, '').replace(/<\/w:tc>$/, '').replace(/<w:tcPr>[\s\S]*?<\/w:tcPr>/, '');
      const styleId = isGrid
        ? (kind === 'header' ? 'MkCifraTitulo' : kind === 'label' ? 'MkCifraEtiqueta' : 'MkCifra')
        : (kind === 'header' ? 'MkCeldaTitulo' : kind === 'label' ? 'MkCeldaEtiqueta' : 'MkCelda');
      const paragraphs = inner.replace(/<w:p(?: [^>]*)?(?:\/>|>[\s\S]*?<\/w:p>)/g, (p) => {
        const full = p.endsWith('/>') ? `${p.slice(0, -2)}></w:p>` : p;
        const styled = setParagraph(full, styleId, { keepNumbering: false, keepNext: !doc.longTables.includes(index) && rowIndex < rows.length - 1 });
        return kind === 'label' ? plainRuns(styled) : styled;
      });
      return `<w:tc>${tcPr}${paragraphs}</w:tc>`;
    });
    const open = rowXml.match(/^<w:tr(?: [^>]*)?>/)[0].replace(/ w14:(?:paraId|textId)="[^"]*"/g, '');
    return `${open}${trPr}${styledCells.join('')}</w:tr>`;
  });
  const open = table.match(/^<w:tbl(?: [^>]*)?>/)[0];
  return `${open}${tblPr}${tblGrid}${styledRows.join('')}</w:tbl>`;
}

// ---------------------------------------------------------------- recuadros de firma

/**
 * Los recuadros flotantes siguen en su sitio (reservan el espacio de cada firma), pero sin relleno
 * ni borde: un título discreto y la firma sobre una línea, como en un contrato impreso.
 */
function restyleSignature(p) {
  return p.replace(/<mc:Choice Requires="wps">[\s\S]*?<\/mc:Choice>/g, (choice) => {
    const isTitle = /<a:prstGeom prst="roundRect">[\s\S]*?<\/a:prstGeom><a:solidFill><a:srgbClr val="B7871C"\/>/.test(choice);
    const isSignature = choice.includes('FIRMA');
    let out = choice
      .replace(/<a:prstGeom prst="roundRect">[\s\S]*?<\/a:prstGeom>/, '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>')
      .replace(/(<\/a:prstGeom>)<a:solidFill>[\s\S]*?<\/a:solidFill>/, '$1<a:noFill/>')
      .replace(/<a:ln [\s\S]*?<\/a:ln>/, '<a:ln><a:noFill/></a:ln>');
    if (isTitle) {
      return out
        .replace(/(<wp:positionH relativeFrom="column"><wp:posOffset>)-?\d+/, '$10')
        .replace(/<wp:extent cx="\d+"/, `<wp:extent cx="${SIGNATURE_WIDTH}"`)
        .replace(/(<a:ext cx=")\d+(" cy="\d+"\/><\/a:xfrm><a:prstGeom)/, `$1${SIGNATURE_WIDTH}$2`)
        .replace(/<wp:wrapSquare [^>]*\/>/, '<wp:wrapNone/>')
        .replace(/lIns="\d+"/, 'lIns="0"').replace(/rIns="\d+"/, 'rIns="0"')
        .replace(/<w:pPr>[\s\S]*?<\/w:pPr>/g, `<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="0" w:firstLine="0"/><w:jc w:val="left"/></w:pPr>`)
        .replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g, `<w:rPr>${fonts}<w:b/><w:color w:val="${INK}"/><w:spacing w:val="10"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>`);
    }
    if (isSignature) {
      const offset = Number(out.match(/<wp:positionH relativeFrom="column"><wp:posOffset>(-?\d+)/)[1]);
      const width = SIGNATURE_WIDTH - offset;
      out = out
        .replace(/<wp:extent cx="\d+"/, `<wp:extent cx="${width}"`)
        .replace(/(<a:ext cx=")\d+(" cy="\d+"\/><\/a:xfrm><a:prstGeom)/, `$1${width}$2`)
        .replace(/rIns="\d+"/, 'rIns="0"')
        // Línea y rótulo al margen derecho: así nunca pisan los datos del firmante, sea cual sea su largo.
        .replace(/<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g, (line) => {
          if (!/_{5}|FIRMA/.test(textOf(line))) return line;
          const spacing = (line.match(/<w:spacing [^>]*\/>/) || [''])[0];
          return line.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, `<w:pPr>${spacing}<w:ind w:left="0" w:firstLine="0"/><w:jc w:val="right"/></w:pPr>`);
        });
    } else {
      // Datos del firmante alineados con el margen del texto.
      out = out.replace(/lIns="\d+"/, 'lIns="0"').replace(/<w:ind [^>]*\/>/g, '<w:ind w:left="0" w:firstLine="0"/>');
    }
    return out.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/g, (_m, props) => {
      const isRule = /<w:sz w:val="28"/.test(props);
      const isFirmaLabel = /<w:color w:val="B7871C"/.test(props) && !isRule;
      const flags = isFirmaLabel ? '' : (props.match(/<w:(?:b|bCs|i|iCs)(?: [^>]*)?\/>/g) || []).join('');
      const color = isFirmaLabel ? GRAY : INK;
      const size = isRule ? 22 : isFirmaLabel ? 15 : 18;
      return `<w:rPr>${fonts}${flags}<w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`;
    });
  });
}

// ---------------------------------------------------------------- cuerpo

function styleDocument(xml, doc) {
  const els = bodyElements(xml);
  const state = { seen: new Set() };
  const texts = els.map((e) => textOf(xml.slice(e.start, e.end)));
  const parts = els.map((e) => xml.slice(e.start, e.end));
  const firstSignature = parts.findIndex((x) => x.includes('<w:drawing>') && /PROMITENTE COMPRADOR/.test(textOf(x)));
  let seller = -1;
  parts.forEach((x, i) => { if (x.includes('<w:drawing>') && /PROMITENTE VENDEDOR/.test(textOf(x))) seller = i; });
  if (firstSignature < 0 || seller < 0) throw new Error('No se encontraron los recuadros de firma');
  let signatureEnd = seller;
  while (signatureEnd + 1 < els.length && !texts[signatureEnd + 1].trim() && parts[signatureEnd + 1].startsWith('<w:p')) signatureEnd += 1;

  let lastContent = els.length - 1;
  while (lastContent > signatureEnd && !texts[lastContent].trim() && !parts[lastContent].startsWith('<w:tbl')) lastContent -= 1;
  const drop = (i) => i > Math.max(lastContent + 1, signatureEnd);

  const tableIndex = new Map(topTables(xml).map((t, i) => [t.start, i]));
  let out = xml.slice(0, els[0].start);
  els.forEach((e, i) => {
    const part = parts[i];
    if (i) out += xml.slice(els[i - 1].end, e.start);
    if (drop(i)) return;
    if (i === lastContent + 1 && i > signatureEnd) {
      // Word exige un párrafo después de la última tabla: casi sin alto, para no abrir otra hoja.
      out += '<w:p><w:pPr><w:pStyle w:val="MkEspacio"/><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>';
      return;
    }
    if (part.startsWith('<w:tbl')) {
      out += styleTable(part, tableIndex.get(e.start), doc);
    } else if (i >= firstSignature && i <= signatureEnd) {
      // Los renglones vacíos reservan el alto de los recuadros flotantes: conservan su tamaño original.
      out += part.includes('<w:drawing>') ? restyleSignature(part) : part;
    } else if (part.includes('<w:drawing>') || part.includes('<w:pict')) {
      // Solo adornos sin texto: el filete negro y la banda de cierre de la promesa.
      if (texts[i].trim()) throw new Error(`Dibujo con texto inesperado: ${texts[i].slice(0, 60)}`);
      out += '<w:p><w:pPr><w:pStyle w:val="MkEspacio"/></w:pPr></w:p>';
    } else {
      const next = texts.findIndex((t, j) => j > i && (t.trim() || parts[j].startsWith('<w:tbl')));
      const keepWithTable = next > 0 && parts[next].startsWith('<w:tbl');
      out += styleBodyParagraph(part, doc, state, { keepWithTable, afterTable: i > 0 && parts[i - 1].startsWith('<w:tbl') });
    }
  });
  out += xml.slice(els[els.length - 1].end);
  for (const heading of [...doc.clauses, ...doc.titles, ...doc.subtitles, ...doc.subheads]) {
    if (!state.seen.has(heading)) throw new Error(`No se encontró: ${heading}`);
  }
  return out.replace(/<w:pgMar [^>]*\/>/, '<w:pgMar w:top="1700" w:right="1360" w:bottom="1340" w:left="1360" w:header="560" w:footer="580" w:gutter="0"/>')
    // La promesa empezaba a numerar en la página 6 ("Página 25 de 20").
    .replace(/<w:pgNumType w:start="\d+"\/>/, '<w:pgNumType w:start="1"/>');
}

// ---------------------------------------------------------------- encabezado y pie

function inlinePicture(relId, id, name, cx, cy) {
  return '<w:r><w:rPr><w:noProof/></w:rPr><w:drawing>' +
    `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="${name}" descr="${name}"/><wp:cNvGraphicFramePr/>` +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${name}"/><pic:cNvPicPr preferRelativeResize="0"/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
}

/** Membrete: logo a la izquierda sobre un filete fino; en la promesa, además su título y el sello Effata. */
function letterhead(xml, doc, logoRel, effataRel) {
  const open = xml.slice(0, xml.indexOf('<w:p '));
  const para = (jc, content) => `<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="0" w:right="0" w:firstLine="0"/><w:jc w:val="${jc}"/></w:pPr>${content}</w:p>`;
  const cell = (w, content) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${content}</w:tc>`;
  const title = doc.headerTitle
    ? `<w:r><w:rPr>${fonts}<w:color w:val="${GRAY}"/><w:spacing w:val="20"/><w:sz w:val="14"/><w:szCs w:val="14"/></w:rPr><w:t>${doc.headerTitle}</w:t></w:r>`
    : '';
  const widths = [2300, TEXT_WIDTH - 4600, 2300];
  const table = '<w:tbl><w:tblPr>' + `<w:tblW w:w="${TEXT_WIDTH}" w:type="dxa"/><w:tblBorders><w:bottom w:val="single" w:sz="4" w:space="0" w:color="${INK}"/></w:tblBorders><w:tblLayout w:type="fixed"/>` +
    '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid><w:tr>` +
    cell(widths[0], para('left', inlinePicture(logoRel, 9001, 'Meraki Grupo Constructor', 1097280, 392235))) +
    cell(widths[1], para('center', title)) +
    cell(widths[2], para('right', effataRel ? inlinePicture(effataRel, 9002, 'Effata', 462000, 390000) : '')) +
    '</w:tr></w:tbl>';
  return `${open}${table}<w:p><w:pPr><w:spacing w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p></w:hdr>`;
}

function plainFooter(xml) {
  const open = xml.slice(0, xml.indexOf('<w:p '));
  const rPr = `<w:rPr>${fonts}<w:color w:val="${GRAY}"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>`;
  const text = (t) => `<w:r>${rPr}<w:t xml:space="preserve">${t}</w:t></w:r>`;
  const field = (name) => `<w:r>${rPr}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rPr}<w:instrText>${name}</w:instrText></w:r><w:r>${rPr}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rPr}<w:t>1</w:t></w:r><w:r>${rPr}<w:fldChar w:fldCharType="end"/></w:r>`;
  return `${open}<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="0" w:right="0" w:firstLine="0"/><w:jc w:val="center"/></w:pPr>${text('Página ')}${field('PAGE')}${text(' de ')}${field('NUMPAGES')}</w:p></w:ftr>`;
}

function addRelationship(zip, relsPath, type, target) {
  const rels = zip.file(relsPath) ? zip.file(relsPath).asText() : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  const used = [...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  const id = `rId${Math.max(0, ...used) + 1}`;
  zip.file(relsPath, rels.replace('</Relationships>', `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/></Relationships>`));
  return id;
}

/** Incrusta la tipografía (sus permisos admiten incrustación) para que el PDF no dependa del servidor. */
function embedFont(zip) {
  let faces = '';
  for (const [element, file] of Object.entries(FONT_FILES)) {
    const data = Buffer.from(fs.readFileSync(path.join('C:/Windows/Fonts', file)));
    const hex = crypto.createHash('md5').update(file).digest('hex').toUpperCase();
    const guid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    // Ofuscación ODTTF: los primeros 32 bytes van en XOR con la clave GUID invertida.
    const key = Buffer.from(hex, 'hex');
    for (let i = 0; i < 32; i += 1) data[i] ^= key[15 - (i % 16)];
    const target = `fonts/${file.replace('.ttf', '')}.odttf`;
    zip.file(`word/${target}`, data);
    const id = addRelationship(zip, 'word/_rels/fontTable.xml.rels', 'font', target);
    faces += `<w:${element} r:id="${id}" w:fontKey="{${guid}}"/>`;
  }
  const block = `<w:font w:name="${FONT}"><w:panose1 w:val="02040502050505030304"/><w:charset w:val="00"/><w:family w:val="roman"/><w:pitch w:val="variable"/>${faces}</w:font>`;
  zip.file('word/fontTable.xml', zip.file('word/fontTable.xml').asText().replace('</w:fonts>', `${block}</w:fonts>`));
  const settings = zip.file('word/settings.xml').asText();
  if (!settings.includes('<w:embedTrueTypeFonts')) throw new Error('settings.xml sin embedTrueTypeFonts');
}

// ---------------------------------------------------------------- verificación

/** Texto del documento; la tabulación cuenta como espacio (ver tabsToSpaces) y no cuentan los espacios finales. */
function allText(xml) {
  return [...xml.replace(/<w:tab\/>/g, '<w:t> </w:t>').matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('').trimEnd();
}

function tableShape(xml) {
  return topTables(xml).map((t) => rowsOf(xml, t).map((r) => cellsOf(xml, r).length).join(','));
}

function build(kind, logo) {
  const doc = DOCS[kind];
  const buffer = fs.readFileSync(path.join(TEMPLATES, doc.source));
  const zip = new PizZip(buffer);
  const original = zip.file('word/document.xml').asText();
  const styled = styleDocument(original, doc);

  if (allText(styled) !== allText(original)) throw new Error(`${kind}: el texto cambió`);
  if (JSON.stringify(tableShape(styled)) !== JSON.stringify(tableShape(original))) throw new Error(`${kind}: cambió la forma de las tablas`);

  zip.file('word/document.xml', styled);
  zip.file('word/styles.xml', zip.file('word/styles.xml').asText().replace('</w:styles>', `${modernStyles(doc)}</w:styles>`));
  // Las listas siguen la tipografía nueva; los símbolos conservan su fuente.
  zip.file('word/numbering.xml', zip.file('word/numbering.xml').asText()
    .replace(/<w:rFonts w:ascii="Arial"[^>]*\/>/g, fonts));

  zip.file('word/media/meraki-logo.png', logo);
  const relsPath = `word/_rels/${path.basename(doc.defaultHeader)}.rels`;
  const logoRel = addRelationship(zip, relsPath, 'image', 'media/meraki-logo.png');
  let effataRel = null;
  if (doc.headerTitle) {
    zip.file('word/media/effata.png', fs.readFileSync(path.join(ASSETS, 'effata.png')));
    effataRel = addRelationship(zip, relsPath, 'image', 'media/effata.png');
  }
  zip.file(doc.defaultHeader, letterhead(zip.file(doc.defaultHeader).asText(), doc, logoRel, effataRel));
  for (const footer of doc.defaultFooters) zip.file(footer, plainFooter(zip.file(footer).asText()));

  const types = zip.file('[Content_Types].xml').asText();
  if (!/Extension="png"/.test(types)) {
    zip.file('[Content_Types].xml', types.replace(/<Types[^>]*>/, (m) => `${m}<Default Extension="png" ContentType="image/png"/>`));
  }
  embedFont(zip);

  const out = path.join(TEMPLATES, doc.target);
  fs.writeFileSync(out, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
  const paragraphs = (x) => (x.match(/<w:p[ >]/g) || []).length;
  console.log(`✔ ${path.relative(process.cwd(), out)}  texto idéntico (${allText(original).length} caracteres), párrafos ${paragraphs(original)} → ${paragraphs(styled)}`);
}

// El logo con fondo transparente es el que ya venía dentro de la preventa.
const logo = Buffer.from(new PizZip(fs.readFileSync(path.join(TEMPLATES, DOCS.preventa.source))).file('word/media/image1.png').asUint8Array());
build('preventa', logo);
build('promesa', logo);
