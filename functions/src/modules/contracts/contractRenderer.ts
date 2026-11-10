import { readFileSync } from 'fs';
import { join } from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import type { ContractData } from './contractData';
import type { DealDocumentKind } from '../deals/deals.types';

/**
 * Llena la plantilla Word del documento (functions/templates/<tipo>-2026.docx,
 * generadas con scripts/contracts/build-templates.cjs) y devuelve el .docx.
 */

const TEMPLATE_FILES: Record<DealDocumentKind, string> = {
  preventa: 'preventa-2026.docx',
  promesa: 'promesa-2026.docx',
};

// lib/modules/contracts → functions/templates (y src/… en las pruebas).
const TEMPLATES_DIR = join(__dirname, '..', '..', '..', 'templates');

type XmlRange = { start: number; end: number; depth: number };

function xmlElements(xml: string, tag: string): XmlRange[] {
  const re = new RegExp(`<${tag}(?=[ >/])|</${tag}>`, 'g');
  const stack: number[] = [];
  const out: XmlRange[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    if (match[0].startsWith('</')) {
      const start = stack.pop();
      if (start !== undefined) out.push({ start, end: match.index + match[0].length, depth: stack.length });
      continue;
    }
    const close = xml.indexOf('>', match.index);
    if (xml[close - 1] === '/') out.push({ start: match.index, end: close + 1, depth: stack.length });
    else stack.push(match.index);
  }
  return out.sort((a, b) => a.start - b.start);
}

function directChildren(xml: string, parent: XmlRange, tag: string): XmlRange[] {
  return xmlElements(xml.slice(parent.start, parent.end), tag)
    .filter((item) => item.depth === 0)
    .map((item) => ({ ...item, start: parent.start + item.start, end: parent.start + item.end }));
}

function withVerticalMerge(cell: string, first: boolean): string {
  const marker = first ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>';
  const withoutOld = cell.replace(/<w:vMerge(?: [^>]*)?\/>/g, '');
  if (!withoutOld.includes('<w:tcPr>')) {
    return withoutOld.replace(/^<w:tc>/, `<w:tc><w:tcPr>${marker}</w:tcPr>`);
  }
  // vMerge debe ir antes de bordes, relleno y alineación dentro de tcPr.
  return withoutOld.replace(/<w:tcPr>([\s\S]*?)<\/w:tcPr>/, (_all, props: string) => {
    const beforeVisualProps = props.search(/<w:(?:tcBorders|shd|noWrap|tcMar|textDirection|tcFitText|vAlign|hideMark|headers|cellIns|cellDel|cellMerge|tcPrChange)[ >/]/);
    const at = beforeVisualProps >= 0 ? beforeVisualProps : props.length;
    return `<w:tcPr>${props.slice(0, at)}${marker}${props.slice(at)}</w:tcPr>`;
  });
}

/** Oculta completamente la cuadrícula de una celda vacía, incluso si la tabla define bordes generales. */
function withoutCellBorders(cell: string): string {
  const noBorders = '<w:tcBorders>' +
    '<w:top w:val="nil"/>' +
    '<w:left w:val="single" w:sz="4" w:space="0" w:color="FFFFFF"/>' +
    '<w:bottom w:val="nil"/>' +
    '<w:right w:val="single" w:sz="4" w:space="0" w:color="FFFFFF"/>' +
    '<w:insideH w:val="nil"/><w:insideV w:val="nil"/>' +
    '</w:tcBorders>';
  const withoutOld = cell.replace(/<w:tcBorders>[^]*?<\/w:tcBorders>/g, '');
  if (!withoutOld.includes('<w:tcPr>')) {
    return withoutOld.replace(/^<w:tc>/, `<w:tc><w:tcPr>${noBorders}</w:tcPr>`);
  }
  return withoutOld.replace(/<w:tcPr>([^]*?)<\/w:tcPr>/, (_all, props: string) => {
    // tcBorders debe respetar el orden del esquema OOXML; si queda después de tcMar/vAlign,
    // Word lo ignora y vuelve a mostrar los bordes generales de la tabla.
    const beforeVisualProps = props.search(/<w:(?:shd|noWrap|tcMar|textDirection|tcFitText|vAlign|hideMark|headers|cellIns|cellDel|cellMerge|tcPrChange)[ >/]/);
    const at = beforeVisualProps >= 0 ? beforeVisualProps : props.length;
    return `<w:tcPr>${props.slice(0, at)}${noBorders}${props.slice(at)}</w:tcPr>`;
  });
}

/**
 * La preventa pone separación, ordinarias y extraordinarias lado a lado en una sola tabla.
 * Docxtemplater necesita tantas filas como el grupo más largo; en los grupos cortos esas filas
 * quedaban dibujadas como casillas vacías. Se conservan las filas para alinear las tres tablas,
 * pero se ocultan los bordes desde la última cuota real de cada grupo.
 */
function trimEmptyPreventaQuotaCells(xml: string, data: ContractData): string {
  const quotaRows = Array.isArray(data.filasCuotas)
    ? data.filasCuotas as Array<Record<string, unknown>>
    : [];
  if (!quotaRows.length) return xml;
  const counts = {
    separation: quotaRows.filter((row) => row.sepN || row.sepValor || row.sepFecha).length,
    ordinary: quotaRows.filter((row) => row.ordN || row.ordValor || row.ordFecha).length,
    extraordinary: quotaRows.filter((row) => row.extN || row.extValor || row.extFecha).length,
  };
  const table = xmlElements(xml, 'w:tbl').filter((item) => item.depth === 0).find((item) => {
    const fragment = xml.slice(item.start, item.end);
    return fragment.includes('CUOTAS') && fragment.includes('SEPARACI') && fragment.includes('EXTRAORDINARIAS');
  });
  if (!table) throw new Error('La preventa no contiene la tabla de cuotas esperada.');
  const rows = directChildren(xml, table, 'w:tr').slice(1);
  const groups = [
    // Las columnas 3 y 7 son separadores angostos; también hay que ocultarlas
    // para que no quede una línea vertical colgando debajo de la tabla corta.
    { count: counts.separation, cells: [0, 1, 2, 3] },
    { count: counts.ordinary, cells: [4, 5, 6, 7] },
    { count: counts.extraordinary, cells: [8, 9, 10] },
  ];
  const targets: XmlRange[] = [];
  rows.forEach((row, rowIndex) => {
    const cells = directChildren(xml, row, 'w:tc');
    for (const group of groups) {
      if (rowIndex < group.count) continue;
      for (const cellIndex of group.cells) {
        if (cells[cellIndex]) targets.push(cells[cellIndex]);
      }
    }
  });
  for (const target of targets.sort((a, b) => b.start - a.start)) {
    const cell = withoutCellBorders(xml.slice(target.start, target.end));
    xml = xml.slice(0, target.start) + cell + xml.slice(target.end);
  }
  return xml;
}

/** Combina etiqueta y total de la separación sobre las filas dinámicas. */
function mergeSeparationCells(xml: string, paymentCount: number): string {
  if (paymentCount < 2) return xml;
  const table = xmlElements(xml, 'w:tbl').filter((item) => item.depth === 0)[2];
  if (!table) throw new Error('La promesa no contiene la tabla de precio esperada.');
  const rows = directChildren(xml, table, 'w:tr').slice(2, 2 + paymentCount);
  if (rows.length !== paymentCount) {
    throw new Error(`La tabla de separación generó ${rows.length} filas; se esperaban ${paymentCount}.`);
  }
  const targets = rows.flatMap((row, rowIndex) => {
    const cells = directChildren(xml, row, 'w:tc');
    return [0, 3].map((cellIndex) => ({ ...cells[cellIndex], first: rowIndex === 0 }));
  }).sort((a, b) => b.start - a.start);
  for (const target of targets) {
    if (target.start === undefined || target.end === undefined) {
      throw new Error('La tabla de separación no tiene las cuatro columnas esperadas.');
    }
    const cell = withVerticalMerge(xml.slice(target.start, target.end), target.first);
    xml = xml.slice(0, target.start) + cell + xml.slice(target.end);
  }
  return xml;
}

export function renderContract(kind: DealDocumentKind, data: ContractData): Buffer {
  const zip = new PizZip(readFileSync(join(TEMPLATES_DIR, TEMPLATE_FILES[kind])));
  const missing = new Set<string>();
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    // Un campo sin dato es un error de la plantilla o del armado: mejor fallar que firmar un contrato con huecos.
    nullGetter: (part) => {
      if (!part.module) missing.add(part.value);
      return '';
    },
  });
  doc.render(data);
  if (missing.size) {
    throw new Error(`La plantilla ${TEMPLATE_FILES[kind]} pide campos sin dato: ${[...missing].join(', ')}`);
  }
  // Al repetir el recuadro de firma por comprador se duplican los id de las figuras:
  // Word exige que sean únicos, así que se renumeran.
  const out = doc.getZip();
  let nextId = 1000;
  const separationPaymentCount = kind === 'promesa' && Array.isArray(data.separacionPagos)
    ? data.separacionPagos.length
    : 0;
  let xml = out.file('word/document.xml')!.asText();
  xml = mergeSeparationCells(xml, separationPaymentCount);
  if (kind === 'preventa') xml = trimEmptyPreventaQuotaCells(xml, data);
  xml = xml.replace(/<wp:docPr id="\d+"/g, () => `<wp:docPr id="${nextId++}"`);
  out.file('word/document.xml', xml);
  return out.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
}

/** Texto plano del .docx generado (para pruebas y revisiones). */
export function docxText(buffer: Buffer): string {
  const xml = new PizZip(buffer).file('word/document.xml')!.asText();
  return [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
}
