/**
 * Utilidades para editar el XML de un .docx (word/document.xml) sin perder formato:
 * localizar tablas/celdas/párrafos (respetando anidamiento) y reemplazar texto que
 * Word reparte entre varios "runs". Las usa build-templates.cjs para convertir las
 * plantillas Word de jurídica en plantillas con campos {…} para docxtemplater.
 */

/** Pares inicio/fin de cada elemento <tag> (anidamiento resuelto con pila). */
function elements(xml, tag) {
  const re = new RegExp(`<${tag}(?=[ >/])|</${tag}>`, 'g');
  const stack = [];
  const out = [];
  let m;
  while ((m = re.exec(xml))) {
    if (m[0].startsWith('</')) {
      const start = stack.pop();
      if (start !== undefined) out.push({ start, end: m.index + m[0].length, depth: stack.length });
    } else {
      // <w:p/> vacío autocerrado
      const close = xml.indexOf('>', m.index);
      if (xml[close - 1] === '/') { out.push({ start: m.index, end: close + 1, depth: stack.length }); continue; }
      stack.push(m.index);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function runTexts(fragment) {
  return [...fragment.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => ({
    start: m.index, end: m.index + m[0].length, text: m[1],
  }));
}

function textOf(fragment) {
  return runTexts(fragment).map((r) => r.text).join('');
}

/** Párrafos sin otros párrafos dentro (los de los cuadros de texto quedan como propios). */
function innermostParagraphs(xml) {
  const ps = elements(xml, 'w:p');
  return ps.filter((p) => !ps.some((q) => q !== p && q.start > p.start && q.end < p.end));
}

/** Tablas de primer nivel en orden. */
function topTables(xml) {
  return elements(xml, 'w:tbl').filter((t) => t.depth === 0);
}

function rowsOf(xml, table) {
  return elements(xml.slice(table.start, table.end), 'w:tr')
    .filter((r) => r.depth === 0)
    .map((r) => ({ start: table.start + r.start, end: table.start + r.end }));
}

function cellsOf(xml, row) {
  return elements(xml.slice(row.start, row.end), 'w:tc')
    .filter((c) => c.depth === 0)
    .map((c) => ({ start: row.start + c.start, end: row.start + c.end }));
}

const T = (text) => `<w:t xml:space="preserve">${text}</w:t>`;

/**
 * Reemplaza `search` por `replacement` dentro de un párrafo aunque el texto esté partido
 * en varios runs: el reemplazo queda en el run donde empieza (con su formato).
 */
function replaceInFragment(fragment, search, replacement) {
  const runs = runTexts(fragment);
  const full = runs.map((r) => r.text).join('');
  const at = full.indexOf(search);
  if (at < 0) return null;
  const endAt = at + search.length;
  let pos = 0;
  const newTexts = runs.map((r) => {
    const rs = pos;
    const re = pos + r.text.length;
    pos = re;
    if (re <= at || rs >= endAt) return r.text;                 // fuera del rango
    const before = at > rs ? r.text.slice(0, at - rs) : '';
    const after = endAt < re ? r.text.slice(endAt - rs) : '';
    return (at >= rs && at < re ? before + replacement : before) + after;
  });
  let out = '';
  let last = 0;
  runs.forEach((r, i) => {
    out += fragment.slice(last, r.start) + T(newTexts[i]);
    last = r.end;
  });
  return out + fragment.slice(last);
}

/** Reemplazo de texto en todos los párrafos donde aparezca (o en el n-ésimo). Lanza si no lo encuentra. */
function replaceText(xml, search, replacement, { nth = null, min = 1 } = {}) {
  let count = 0;
  let out = xml;
  // De atrás hacia adelante para no mover offsets.
  const ps = innermostParagraphs(xml).reverse();
  const hits = ps.filter((p) => textOf(xml.slice(p.start, p.end)).includes(search)).reverse();
  hits.forEach((p, i) => {
    if (nth !== null && i !== nth) return;
    count++;
  });
  if (count < min) throw new Error(`No se encontró: "${search.slice(0, 80)}"`);
  const targets = hits.filter((_, i) => nth === null || i === nth).reverse();
  for (const p of targets) {
    let frag = out.slice(p.start, p.end);
    let replaced;
    while ((replaced = replaceInFragment(frag, search, replacement)) !== null && replaced !== frag) {
      frag = replaced;
      if (!textOf(frag).includes(search) || replacement.includes(search)) break;
    }
    out = out.slice(0, p.start) + frag + out.slice(p.end);
  }
  return out;
}

/**
 * Deja una celda con un solo texto: conserva el primer párrafo y su primer run (formato),
 * borra el resto de runs y párrafos.
 */
function setCellText(xml, tableIndex, rowIndex, cellIndex, text, options = {}) {
  const table = topTables(xml)[tableIndex];
  if (!table) throw new Error(`No existe la tabla ${tableIndex}`);
  const row = rowsOf(xml, table)[rowIndex];
  if (!row) throw new Error(`No existe la fila ${tableIndex}.${rowIndex}`);
  const cell = cellsOf(xml, row)[cellIndex];
  if (!cell) throw new Error(`No existe la celda ${tableIndex}.${rowIndex}.${cellIndex}`);
  const cellXml = xml.slice(cell.start, cell.end);
  const paras = elements(cellXml, 'w:p').filter((p) => p.depth === 0);
  const tcPrEnd = cellXml.indexOf('</w:tcPr>');
  const head = cellXml.slice(0, paras.length ? paras[0].start : (tcPrEnd >= 0 ? tcPrEnd + 9 : cellXml.indexOf('>') + 1));
  let para = paras.length ? cellXml.slice(paras[0].start, paras[0].end) : '<w:p></w:p>';
  let pPr = (para.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [''])[0];
  const firstRun = para.match(/<w:r(?=[ >])[\s\S]*?<\/w:r>/);
  let rPr = firstRun ? (firstRun[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0] : '';

  if (options.bold === false) {
    pPr = pPr.replace(/<w:b(?:\b[^>]*)?\/>/g, '').replace(/<w:bCs(?:\b[^>]*)?\/>/g, '');
    rPr = rPr.replace(/<w:b(?:\b[^>]*)?\/>/g, '').replace(/<w:bCs(?:\b[^>]*)?\/>/g, '');
  } else if (options.bold === true) {
    if (!rPr.includes('<w:b/>')) {
      rPr = rPr ? rPr.replace('</w:rPr>', '<w:b/><w:bCs/></w:rPr>') : '<w:rPr><w:b/><w:bCs/></w:rPr>';
    }
  }

  if (options.sz) {
    pPr = pPr.replace(/<w:sz(?:\b[^>]*)?\/>/g, '').replace(/<w:szCs(?:\b[^>]*)?\/>/g, '');
    rPr = rPr.replace(/<w:sz(?:\b[^>]*)?\/>/g, '').replace(/<w:szCs(?:\b[^>]*)?\/>/g, '');
    const szTag = `<w:sz w:val="${options.sz}"/><w:szCs w:val="${options.sz}"/>`;
    rPr = rPr ? rPr.replace('</w:rPr>', `${szTag}</w:rPr>`) : `<w:rPr>${szTag}</w:rPr>`;
  }

  if (options.lineSpacing) {
    pPr = pPr.replace(/<w:spacing(?:\b[^>]*)?\/>/g, '');
    const spTag = `<w:spacing w:line="${options.lineSpacing}" w:lineRule="auto"/>`;
    pPr = pPr ? pPr.replace('</w:pPr>', `${spTag}</w:pPr>`) : `<w:pPr>${spTag}</w:pPr>`;
  }

  const pOpen = para.match(/^<w:p(?: [^>]*)?>/)[0].replace('/>', '>');
  para = `${pOpen}${pPr}<w:r>${rPr}${T(text)}</w:r></w:p>`;
  return xml.slice(0, cell.start) + head + para + '</w:tc>' + xml.slice(cell.end);
}

/** Antepone / pospone texto al contenido de una celda (para marcas de bucle {#…} {/…}). */
function wrapCell(xml, tableIndex, rowIndex, cellIndex, { prefix = '', suffix = '' }) {
  const table = topTables(xml)[tableIndex];
  const row = rowsOf(xml, table)[rowIndex];
  const cell = cellsOf(xml, row)[cellIndex];
  const cellXml = xml.slice(cell.start, cell.end);
  const runs = runTexts(cellXml);
  if (!runs.length) throw new Error(`Celda vacía ${tableIndex}.${rowIndex}.${cellIndex}`);
  const texts = runs.map((r) => r.text);
  texts[0] = prefix + texts[0];
  texts[texts.length - 1] += suffix;
  let out = '';
  let last = 0;
  runs.forEach((r, i) => {
    out += cellXml.slice(last, r.start) + T(texts[i]);
    last = r.end;
  });
  out += cellXml.slice(last);
  return xml.slice(0, cell.start) + out + xml.slice(cell.end);
}

/** Borra una fila completa de una tabla. */
function deleteRow(xml, tableIndex, rowIndex) {
  const table = topTables(xml)[tableIndex];
  const row = rowsOf(xml, table)[rowIndex];
  return xml.slice(0, row.start) + xml.slice(row.end);
}

/** Párrafos cuyo texto completo (sin espacios a los lados) es exactamente `text`. */
function paragraphsWithText(xml, text) {
  return innermostParagraphs(xml).filter((p) => textOf(xml.slice(p.start, p.end)).trim() === text.trim());
}

/** Cambia todo el texto de un párrafo (conserva el formato del primer run). */
function setParagraphAt(xml, p, text) {
  const frag = xml.slice(p.start, p.end);
  const runs = runTexts(frag);
  let out = '';
  let last = 0;
  runs.forEach((r, i) => {
    out += frag.slice(last, r.start) + T(i === 0 ? text : '');
    last = r.end;
  });
  return xml.slice(0, p.start) + out + frag.slice(last) + xml.slice(p.end);
}

/**
 * Bloque "(Texto para el proyecto X)": el párrafo marca pasa a ser la etiqueta de apertura
 * ({#cond} o {^cond}) y se inserta un párrafo con el cierre después del último párrafo del
 * bloque (el primero, tras la marca, cuyo texto empieza con `lastStartsWith`).
 */
function wrapBlock(xml, { marker, nth = 0, lastStartsWith, open, close }) {
  const markers = paragraphsWithText(xml, marker);
  const m = markers[nth];
  if (!m) throw new Error(`No se encontró la marca #${nth}: "${marker}"`);
  xml = setParagraphAt(xml, m, open);
  const lastP = innermostParagraphs(xml).find((p) => p.start > m.start && textOf(xml.slice(p.start, p.end)).startsWith(lastStartsWith));
  if (!lastP) throw new Error(`No se encontró el final del bloque "${marker}": "${lastStartsWith}"`);
  return xml.slice(0, lastP.end) + `<w:p><w:r>${T(close)}</w:r></w:p>` + xml.slice(lastP.end);
}

/** Vacía párrafos de instrucciones de jurídica (texto exacto). */
function clearParagraphs(xml, text) {
  const ps = paragraphsWithText(xml, text);
  if (!ps.length) throw new Error(`No se encontró el párrafo: "${text}"`);
  for (const p of ps.reverse()) xml = setParagraphAt(xml, p, '');
  return xml;
}

/** Elementos de primer nivel del cuerpo (párrafos y tablas que no están dentro de otro). */
function bodyElements(xml) {
  const body = xml.indexOf('<w:body>');
  const all = elements(xml, 'w:p').filter((p) => p.start > body).concat(topTables(xml));
  return all.filter((e) => !all.some((o) => o !== e && o.start < e.start && o.end > e.end)).sort((a, b) => a.start - b.start);
}

/**
 * Reemplaza los elementos de primer nivel desde el primero que cumple `isFirst(texto)`
 * hasta el último (después de ese) que cumple `isLast(texto)`, inclusive.
 */
function replaceRegion(xml, isFirst, isLast, replacement) {
  const els = bodyElements(xml);
  const texts = els.map((e) => textOf(xml.slice(e.start, e.end)));
  const from = texts.findIndex(isFirst);
  if (from < 0) throw new Error("No se encontró el inicio de la región");
  let to = -1;
  texts.forEach((t, i) => { if (i >= from && isLast(t)) to = i; });
  if (to < 0) throw new Error("No se encontró el final de la región");
  return xml.slice(0, els[from].start) + replacement + xml.slice(els[to].end);
}

/** Celdas de datos centradas (horizontal y vertical) y sin sangrías, desde la fila `fromRow`. */
function centerTableCells(xml, tableIndex, fromRow = 1) {
  const table = topTables(xml)[tableIndex];
  const rows = rowsOf(xml, table).slice(fromRow);
  const cells = rows.flatMap((r) => cellsOf(xml, r)).reverse();
  for (const c of cells) {
    let cell = xml.slice(c.start, c.end);
    cell = cell.replace(/<w:vAlign [^>]*\/>/g, '');
    cell = cell.includes('<w:tcPr>')
      ? cell.replace('</w:tcPr>', '<w:vAlign w:val="center"/></w:tcPr>')
      : cell.replace(/^<w:tc>/, '<w:tc><w:tcPr><w:vAlign w:val="center"/></w:tcPr>');
    cell = cell.replace(/<w:ind [^>]*\/>/g, '');
    // Cada párrafo centrado; <w:jc> va antes de <w:rPr> dentro de <w:pPr> (orden del esquema de Word).
    cell = cell.replace(/<w:p(?=[ >])([^>]*)>(<w:pPr>[\s\S]*?<\/w:pPr>)?/g, (_m, attrs, pPr) => {
      if (!pPr) return `<w:p${attrs}><w:pPr><w:jc w:val="center"/></w:pPr>`;
      const out = pPr.replace(/<w:jc w:val="\w+"\/>/g, '');
      // Primer elemento que en el esquema va DESPUÉS de <w:jc>; si no hay, al final.
      const after = out.search(/<w:(?:textDirection|textAlignment|textboxTightWrap|outlineLvl|divId|cnfStyle|rPr|sectPr|pPrChange)[ >/]/);
      const at = after >= 0 ? after : out.lastIndexOf('</w:pPr>');
      return `<w:p${attrs}>${out.slice(0, at)}<w:jc w:val="center"/>${out.slice(at)}`;
    });
    xml = xml.slice(0, c.start) + cell + xml.slice(c.end);
  }
  return xml;
}

/** Cambia el ancho de las columnas de una tabla (y el total). */
function setTableGrid(xml, tableIndex, widths) {
  const t = topTables(xml)[tableIndex];
  let tbl = xml.slice(t.start, t.end);
  // La copia vieja de la cuadrícula (control de cambios) trae su propio <w:tblGrid> anidado.
  tbl = tbl.replace(/<w:tblGridChange[\s\S]*?<\/w:tblGridChange>/g, '');
  tbl = tbl.replace(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/, `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`);
  tbl = tbl.replace(/<w:tblW [^>]*\/>/, `<w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/>`);
  return xml.slice(0, t.start) + tbl + xml.slice(t.end);
}

/** Centra la tabla en la página (como las de SmartHome): <w:jc> va justo después de <w:tblW>. */
function centerTable(xml, tableIndex) {
  const t = topTables(xml)[tableIndex];
  let tbl = xml.slice(t.start, t.end);
  tbl = tbl.replace(/<w:tblPr>[\s\S]*?<\/w:tblPr>/, (pr) => {
    const out = pr.replace(/<w:jc w:val="\w+"\/>/g, '').replace(/<w:tblInd [^>]*\/>/g, '');
    return /<w:tblW [^>]*\/>/.test(out)
      ? out.replace(/(<w:tblW [^>]*\/>)/, '$1<w:jc w:val="center"/>')
      : out.replace('<w:tblPr>', '<w:tblPr><w:jc w:val="center"/>');
  });
  return xml.slice(0, t.start) + tbl + xml.slice(t.end);
}

/**
 * Quita sangrías de los párrafos de una tabla y le da margen interno a las celdas.
 * La promesa original trae sangría de primera línea de 1 cm en las celdas: en columnas
 * angostas parte las palabras ("NOM BRE", "CÉD ULA").
 */
function tidyTable(xml, tableIndex, sideMargin = 70) {
  const t = topTables(xml)[tableIndex];
  // Sangría cero EXPLÍCITA: sin <w:ind> el párrafo hereda la del documento (izquierda 610 en la promesa).
  const ZERO = '<w:ind w:left="0" w:right="0" w:firstLine="0"/>';
  let tbl = xml.slice(t.start, t.end).replace(/<w:ind [^>]*\/>/g, '');
  tbl = tbl.replace(/<w:p(?=[ >])([^>]*)>(<w:pPr>[\s\S]*?<\/w:pPr>)?/g, (_m, attrs, pPr) => {
    if (!pPr) return `<w:p${attrs}><w:pPr>${ZERO}</w:pPr>`;
    // <w:ind> va después de <w:spacing> y antes de <w:jc>, <w:rPr>… (orden del esquema de Word).
    const after = pPr.search(/<w:(?:contextualSpacing|mirrorIndents|suppressOverlap|jc|textDirection|textAlignment|textboxTightWrap|outlineLvl|divId|cnfStyle|rPr|sectPr|pPrChange)[ >/]/);
    const at = after >= 0 ? after : pPr.lastIndexOf('</w:pPr>');
    return `<w:p${attrs}>${pPr.slice(0, at)}${ZERO}${pPr.slice(at)}`;
  });
  tbl = tbl.replace(/<w:tblPr>[\s\S]*?<\/w:tblPr>/, (pr) => {
    const mar = `<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="${sideMargin}" w:type="dxa"/>` +
      `<w:bottom w:w="28" w:type="dxa"/><w:right w:w="${sideMargin}" w:type="dxa"/></w:tblCellMar>`;
    const out = pr.replace(/<w:tblCellMar>[\s\S]*?<\/w:tblCellMar>/, '');
    return out.includes('<w:tblLook') ? out.replace('<w:tblLook', `${mar}<w:tblLook`) : out.replace('</w:tblPr>', `${mar}</w:tblPr>`);
  });
  return xml.slice(0, t.start) + tbl + xml.slice(t.end);
}

/** Asegura que todas las filas de todas las tablas tengan cantSplit (no se parten entre páginas). */
function ensureAllTablesCantSplit(xml) {
  return xml.replace(/<w:tr(?=[ >])([\s\S]*?)<\/w:tr>/g, (tr) => {
    if (tr.includes('<w:cantSplit/>')) return tr;
    if (tr.includes('<w:trPr>')) {
      return tr.replace('<w:trPr>', '<w:trPr><w:cantSplit/>');
    }
    return tr.replace(/^(<w:tr(?: [^>]*)?>)/, '$1<w:trPr><w:cantSplit/></w:trPr>');
  });
}

/** Configura una fila de tabla como encabezado repetible con keepNext para que no se separe de las filas siguientes. */
function makeTableHeader(xml, tableIndex, rowIndex = 0) {
  const table = topTables(xml)[tableIndex];
  if (!table) return xml;
  const row = rowsOf(xml, table)[rowIndex];
  if (!row) return xml;
  let rowXml = xml.slice(row.start, row.end);
  if (!rowXml.includes('<w:tblHeader/>')) {
    if (rowXml.includes('<w:trPr>')) {
      rowXml = rowXml.replace('<w:trPr>', '<w:trPr><w:tblHeader/><w:cantSplit/>');
    } else {
      rowXml = rowXml.replace(/^(<w:tr(?: [^>]*)?>)/, '$1<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>');
    }
  }
  // Añadir keepNext a todos los párrafos de la fila
  rowXml = rowXml.replace(/<w:p(?=[ >])([^>]*)>(<w:pPr>[\s\S]*?<\/w:pPr>)?/g, (_m, attrs, pPr) => {
    if (!pPr) return `<w:p${attrs}><w:pPr><w:keepNext/></w:pPr>`;
    if (pPr.includes('<w:keepNext/>')) return `<w:p${attrs}>${pPr}`;
    return `<w:p${attrs}>${pPr.replace('<w:pPr>', '<w:pPr><w:keepNext/>')}`;
  });
  return xml.slice(0, row.start) + rowXml + xml.slice(row.end);
}

/** Añade w:keepNext a los párrafos que contengan determinado texto para evitar títulos huérfanos al fondo de página. */
function addKeepNextToParagraphs(xml, search) {
  const ps = innermostParagraphs(xml).reverse();
  const hits = ps.filter((p) => textOf(xml.slice(p.start, p.end)).includes(search));
  let out = xml;
  for (const p of hits) {
    let pXml = out.slice(p.start, p.end);
    if (!pXml.includes('<w:keepNext/>')) {
      if (pXml.includes('<w:pPr>')) {
        pXml = pXml.replace('<w:pPr>', '<w:pPr><w:keepNext/>');
      } else {
        pXml = pXml.replace(/^(<w:p(?: [^>]*)?>)/, '$1<w:pPr><w:keepNext/></w:pPr>');
      }
      out = out.slice(0, p.start) + pXml + out.slice(p.end);
    }
  }
  return out;
}

/** Texto de cada tabla/fila/celda (para depurar). */
function describeTables(xml) {
  return topTables(xml).map((t, ti) => rowsOf(xml, t).map((r, ri) =>
    `T${ti}.r${ri}: ` + cellsOf(xml, r).map((c, ci) => `[${ci}]${textOf(xml.slice(c.start, c.end)).slice(0, 40)}`).join(' | ')).join('\n')).join('\n');
}

module.exports = {
  elements, innermostParagraphs, textOf, replaceText, setCellText, wrapCell, deleteRow, describeTables,
  topTables, rowsOf, cellsOf, paragraphsWithText, wrapBlock, clearParagraphs,
  bodyElements, replaceRegion, centerTableCells, setTableGrid, centerTable, tidyTable,
  ensureAllTablesCantSplit, makeTableHeader, addKeepNextToParagraphs,
};
