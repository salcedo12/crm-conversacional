/**
 * DocuBlock y conversor PDF de mentiras para probar la firma en localhost (emuladores).
 * Nunca envía nada real. Datos ficticios. Puerto 4599.
 *
 *   node scripts/docublock-mock.cjs
 *
 * Los emuladores lo usan por functions/.env.demo-crm-local (DOCUBLOCK_BASE_URL, DOCX_PDF_URL).
 * Cada consulta a un documento avanza un paso: en firma → firma el siguiente → firmado.
 */
const http = require('http');

const PORT = 4599;
const COLOMBIA = '661a1fb2a0e9e20423fe6cc8';
const ORG = '68276a30ec9007c33d6f9b97';

const templates = [
  { _id: 'tpl-promesa', name: 'PROMESA DE COMPRAVENTA V1', directory: 'dir-promesas', state: 1, typeSigners: [
    { name: 'PROMITENTE COMPRADOR', principal: true, type: 'mandatory' },
    { name: 'PROMITENTE VENDEDOR', principal: false, type: 'mandatory' },
    { name: 'PROMITENTE COMPRADOR 2', principal: false, type: 'optional' },
    { name: 'PROMITENTE COMPRADOR 3', principal: false, type: 'optional' },
  ] },
  { _id: 'tpl-otrosi', name: 'OTRO SI V2', directory: 'dir-otrosi', state: 1, typeSigners: [
    { name: 'Cliente', principal: true, type: 'mandatory' },
    { name: 'Representante ', principal: false, type: 'mandatory' },
    { name: 'cliente 2', principal: false, type: 'optional' },
    { name: 'cliente 3', principal: false, type: 'optional' },
  ] },
  { _id: 'tpl-general', name: 'General', directory: 'dir-general', state: 1, typeSigners: [
    { name: 'Principal', principal: true, type: 'mandatory' },
    { name: 'Obligatorio', principal: false, type: 'mandatory' },
  ] },
];

const directories = [
  { _id: 'dir-promesas', name: 'PROMESAS DE COMPRAVENTA' },
  { _id: 'dir-laguna', name: 'PROMESAS LAGUNA MAR - MELGAR' },
  { _id: 'dir-llano', name: 'PROMESAS LLANO GRANDE - ALVARADO' },
  { _id: 'dir-otrosi', name: 'OTRO SI' },
  { _id: 'dir-general', name: 'General' },
];

const member = (role) => [{ organization: { _id: ORG }, role: { name: role } }];
// Nombres de los firmantes de la empresa (COMPANY_SIGNERS); cédulas, correos y celulares ficticios.
const users = [
  { _id: 'u-jhon', names: 'JHON ESPER', surNames: 'TOLEDO CASTAÑEDA', email: 'representante@meraki.test', phone: '+573000000001', identificationType: 'CC', identification: '10000001', expeditionDate: '2000-01-01', expeditionCity: 'Ibagué', city: 'Ibagué', organizations: member('Administrador') },
  { _id: 'u-javier', names: 'Javier Eduardo', surNames: 'Buitrago', email: 'gerente@meraki.test', phone: '+573000000002', identificationType: 'CC', identification: '10000002', expeditionDate: '2001-02-02', expeditionCity: 'Bogotá', city: 'Bogotá', organizations: member('Operador') },
  { _id: 'u-leidy', names: 'LEIDY LIZETH', surNames: 'RAMIREZ LOZANO', email: 'gerente2@meraki.test', phone: '+573000000003', identificationType: 'CC', identification: '10000003', expeditionDate: '2001-03-03', expeditionCity: 'Ibagué', city: 'Ibagué', organizations: member('Operador') },
  { _id: 'u-luis', names: 'Luis Eduardo', surNames: 'Salcedo Aya', email: '', phone: '', identificationType: 'CC', identification: '', organizations: member('Administrador') },
  { _id: 'u-asesora', names: 'Asesora', surNames: 'De Prueba', email: 'asesora@meraki.test', phone: '+573000000004', identificationType: 'CC', identification: '10000004', organizations: member('Observador') },
  { _id: 'u-otra', names: 'Otra', surNames: 'Organización', email: 'otra@x.test', identification: '1', organizations: [{ organization: { _id: 'otra-org' } }] },
];

const cities = ['Ibagué', 'Bogotá', 'Melgar', 'Alvarado', 'Mariquita', 'Medellín', 'Chía', 'El Espinal', 'Sahagun', 'Sahagún', 'Cali']
  .map((name, i) => ({ _id: `c${i}`, name, country: { _id: COLOMBIA } }));
const countries = [{ _id: COLOMBIA, name: 'Colombia', abbreviation: 'CO' }, { _id: 'es', name: 'España', abbreviation: 'ES' }];

// PDF mínimo válido (una hoja en blanco con un texto).
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj 4 0 obj<</Length 58>>stream\nBT /F1 24 Tf 72 700 Td (Documento de prueba - mock) Tj ET\nendstream endobj 5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

const documents = new Map();
let seq = 0;

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks))); });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const body = await readBody(req);
  const path = url.pathname.replace(/\/+$/, '');
  const auth = req.headers.authorization || req.headers['x-pdf-key'];
  // Los archivos firmados se descargan sin llave (en DocuBlock son links de S3).
  if (!auth && !path.startsWith('/files/')) return send(res, 401, { message: 'Unauthorized' });
  console.log(req.method, path);

  if (path === '/docx-pdf') return send(res, 200, PDF, 'application/pdf');
  if (path === '/api/templates/get-all') return send(res, 201, { total: templates.length, totalPages: 1, templates });
  if (path === '/api/directories/get-all') return send(res, 201, { total: directories.length, totalPages: 1, directories });
  if (path === '/api/users/get-all') {
    // Como el real: la página va en el cuerpo; ?page= se ignora.
    const page = Number((body.length && JSON.parse(body.toString('utf8')).page) || 1);
    return send(res, 201, { total: users.length, totalPages: 1, user: page === 1 ? users : [] });
  }
  if (path === '/api/cities/get-all') return send(res, 201, { total: cities.length, totalPages: null, cities });
  if (path === '/api/countries/get-all') return send(res, 201, { total: countries.length, totalPages: null, countrydto: countries });

  if (path === '/api/documents/create-pdf-base64' && req.method === 'POST') {
    const input = JSON.parse(body.toString('utf8'));
    const missing = ['name', 'baseFile', 'template', 'directory', 'endorsementInput'].filter((k) => !input[k]);
    if (missing.length) return send(res, 400, { message: `Faltan: ${missing.join(', ')}` });
    const badCity = input.endorsementInput.find((e) => !cities.some((c) => c.name === e.city) || !cities.some((c) => c.name === e.expeditionCity));
    if (badCity) return send(res, 400, { message: `Ciudad inválida para ${badCity.firstName}` });
    // Como el real: el país va como abreviatura ("CO").
    const badCountry = input.endorsementInput.find((e) => !countries.some((c) => c.abbreviation === e.country));
    if (badCountry) return send(res, 400, { message: `Pais de ${badCountry.firstName} no encontrado` });
    const id = `mockdoc${++seq}`;
    documents.set(id, { input, step: 0 });
    console.log('  → creado', id, input.name, input.endorsementInput.map((e) => `${e.firstName} (${e.typeSign}, ${e.iteration})`).join(' · '));
    // Como el real: responde una lista con el documento creado.
    return send(res, 201, [{ _id: id, name: input.name, user: input.user ?? null }]);
  }

  const getMatch = path.match(/^\/api\/documents\/([^/]+)$/);
  if (getMatch && req.method === 'GET') {
    const doc = documents.get(getMatch[1]);
    if (!doc) return send(res, 404, { message: 'Documento no encontrado' });
    const signers = doc.input.endorsementInput;
    const signedCount = Math.min(doc.step, signers.length);
    doc.step += 1;
    const complete = signedCount >= signers.length;
    return send(res, 200, {
      _id: getMatch[1], name: doc.input.name, state: 0, signatureProgress: complete ? 3 : 1,
      path: `http://127.0.0.1:${PORT}/files/${getMatch[1]}.pdf`,
      versions: [{ path: `http://127.0.0.1:${PORT}/files/${getMatch[1]}.pdf`, expirationSign: new Date(Date.now() + 5 * 864e5).toISOString() }],
      endorsement: signers.map((e, i) => ({ checked: i < signedCount ? 1 : 0, order: e.iteration, typeSign: e.typeSign, identity: { signer: { _id: `signer-${i}`, firstName: e.firstName, lastName: e.lastName, email: e.email } } })),
    });
  }
  if (path.startsWith('/files/')) return send(res, 200, PDF, 'application/pdf');
  if (path === '/api/documents/resend-endorsement-document') return send(res, 201, { message: 'Reenviado' });
  return send(res, 404, { message: `Cannot ${req.method} ${path}` });
}).listen(PORT, '127.0.0.1', () => console.log(`DocuBlock mock en http://127.0.0.1:${PORT}`));
