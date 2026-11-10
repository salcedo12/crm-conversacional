/**
 * Actualiza la promesa ya generada para que la separación use filas dinámicas.
 * El mismo cambio vive en promesa.cjs para futuras reconstrucciones desde el Word
 * original de jurídica.
 */
const fs = require('fs');
const path = require('path');
const PizZip = require(path.join(__dirname, '..', '..', 'functions', 'node_modules', 'pizzip'));
const { configureSeparationRows } = require('./promesa.cjs');

const template = path.join(__dirname, '..', '..', 'functions', 'templates', 'promesa-2026.docx');
const zip = new PizZip(fs.readFileSync(template));
const xml = configureSeparationRows(zip.file('word/document.xml').asText());
zip.file('word/document.xml', xml);
fs.writeFileSync(template, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`✔ ${template}`);
