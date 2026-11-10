/**
 * Recuadros de firma ORIGINALES de jurídica (cuadros flotantes de Word), como en SmartHome:
 *  - el recuadro del comprador se repite por cada comprador ({#compradores}…{/compradores}),
 *  - título + recuadro + renglones que le reservan espacio quedan encadenados con
 *    "mantener con el siguiente": si no caben al final de la hoja, pasan completos a la siguiente,
 *  - el recuadro del vendedor reserva su alto completo para no quedar cortado.
 * Los cuadros flotan sobre párrafos vacíos; esos párrafos son los que se encadenan.
 */
const { bodyElements, textOf } = require('./docxXml.cjs');

/** Agrega <w:keepNext/> al párrafo (va después de <w:pStyle> si existe). */
function withKeepNext(p) {
  if (p.includes('<w:keepNext/>')) return p;
  if (/<w:pPr>/.test(p)) {
    return /<w:pStyle [^>]*\/>/.test(p)
      ? p.replace(/(<w:pPr><w:pStyle [^>]*\/>)/, '$1<w:keepNext/>')
      : p.replace('<w:pPr>', '<w:pPr><w:keepNext/>');
  }
  return p.replace(/^<w:p([^>]*)>/, '<w:p$1><w:pPr><w:keepNext/></w:pPr>');
}

/** Párrafo vacío copiado de uno existente (mismo tamaño de letra = mismo alto de renglón). */
function blankLike(p, text = '') {
  const open = p.match(/^<w:p[^>]*>/)[0].replace(/ w14:(?:paraId|textId)="[^"]*"/g, '');
  const pPr = (p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [''])[0];
  const rPr = (pPr.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
  const run = text ? `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>` : '';
  return `${open}${pPr}${run}</w:p>`;
}

/**
 * @param heading     texto exacto del párrafo que ancla el título "PROMITENTE COMPRADOR"
 * @param sellerLines renglones encadenados con el recuadro del vendedor (su ajuste empuja el texto debajo)
 */
function prepareSignatureBoxes(xml, { heading, sellerLines }) {
  const els = bodyElements(xml);
  const texts = els.map((e) => textOf(xml.slice(e.start, e.end)));
  const h = texts.findIndex((t) => t.trim() === heading);
  if (h < 0) throw new Error(`No se encontró el título de firmas: "${heading}"`);
  const box = h + 1;                                                     // recuadro del comprador
  let seller = -1;
  texts.forEach((t, i) => { if (i > box && t.includes('PROMITENTE VENDEDOR')) seller = i; });
  if (seller < 0) throw new Error('No se encontró el recuadro del vendedor');
  const isBlank = (i) => !texts[i].trim() && !xml.slice(els[i].start, els[i].end).includes('<w:drawing>');
  for (let i = box + 1; i < seller; i++) if (!isBlank(i)) throw new Error(`Se esperaban renglones vacíos entre las firmas (elemento ${i})`);

  const part = (i) => xml.slice(els[i].start, els[i].end);
  const blank = part(box + 1);

  // Vendedor: su ancla + renglones vacíos que le siguen hasta completar su alto, todo encadenado.
  let trailing = 0;
  for (let i = seller + 1; i < els.length && isBlank(i); i++) trailing++;
  const sellerBlock = [withKeepNext(part(seller))];
  for (let i = 1; i <= trailing; i++) sellerBlock.push(withKeepNext(part(seller + i)));
  for (let i = trailing; i < sellerLines; i++) sellerBlock.push(withKeepNext(blankLike(blank)));
  sellerBlock[sellerBlock.length - 1] = sellerBlock[sellerBlock.length - 1].replace('<w:keepNext/>', '');

  // Comprador: título (+1 renglón para que el título no quede tapado por el recuadro) y,
  // por comprador, recuadro + sus renglones; el último renglón de cada bloque no se encadena.
  const buyerParts = [];
  for (let i = box; i < seller; i++) buyerParts.push(i < seller - 1 ? withKeepNext(part(i)) : part(i));
  const out =
    withKeepNext(part(h)) +
    withKeepNext(blankLike(blank)) +
    blankLike(blank, '{#compradores}') +
    buyerParts.join('') +
    blankLike(blank, '{/compradores}') +
    sellerBlock.join('');

  const end = els[seller + trailing].end;
  return xml.slice(0, els[h].start) + out + xml.slice(end);
}

module.exports = { prepareSignatureBoxes };
