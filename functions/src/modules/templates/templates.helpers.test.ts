/* Test manual (sin framework): npx ts-node src/modules/templates/templates.helpers.test.ts */
import assert from 'assert';
import { Timestamp } from 'firebase-admin/firestore';
import {
  mapYcloudStatus, buildYcloudCreateComponents, buildPositionalComponents,
} from './templates.helpers';
import type { WhatsAppTemplate } from './templates.types';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${(e as Error).message}`); process.exitCode = 1; }
}

console.log('mapYcloudStatus');
test('APPROVED → approved', () => assert.equal(mapYcloudStatus('APPROVED'), 'approved'));
test('REJECTED → rejected', () => assert.equal(mapYcloudStatus('REJECTED'), 'rejected'));
test('PENDING → pending',   () => assert.equal(mapYcloudStatus('PENDING'), 'pending'));
test('PAUSED/desconocido → pending', () => assert.equal(mapYcloudStatus('PAUSED'), 'pending'));
test('undefined → pending', () => assert.equal(mapYcloudStatus(undefined), 'pending'));

console.log('buildYcloudCreateComponents');
test('convierte {{nombre}},{{proyecto}} → {{1}},{{2}} en orden', () => {
  const comps = buildYcloudCreateComponents({
    header: 'Meraki',
    body:   'Hola {{nombre}}, ¿sigues interesado en {{proyecto}}?',
    footer: 'Equipo Meraki',
    variables: [
      { key: 'nombre',   example: 'Juan' },
      { key: 'proyecto', example: 'Torre Norte' },
    ],
  });
  assert.deepEqual(comps[0], { type: 'HEADER', format: 'TEXT', text: 'Meraki' });
  const body = comps[1];
  assert.equal(body.type, 'BODY');
  assert.equal(body.text, 'Hola {{1}}, ¿sigues interesado en {{2}}?');
  assert.deepEqual(body.example, { body_text: [['Juan', 'Torre Norte']] });
  assert.deepEqual(comps[2], { type: 'FOOTER', text: 'Equipo Meraki' });
});

test('sin variables → BODY sin example, sin header/footer', () => {
  const comps = buildYcloudCreateComponents({ body: 'Mensaje fijo', variables: [] });
  assert.equal(comps.length, 1);
  assert.equal(comps[0].type, 'BODY');
  assert.equal(comps[0].example, undefined);
});

test('variable repetida en el body se reemplaza en todas sus apariciones', () => {
  const comps = buildYcloudCreateComponents({
    body: '{{nombre}}, {{nombre}} de nuevo',
    variables: [{ key: 'nombre', example: 'Ana' }],
  });
  assert.equal(comps[0].text, '{{1}}, {{1}} de nuevo');
});

test('example usa la key como fallback si no hay ejemplo', () => {
  const comps = buildYcloudCreateComponents({
    body: 'Hola {{nombre}}',
    variables: [{ key: 'nombre', example: '' }],
  });
  assert.deepEqual(comps[0].example, { body_text: [['nombre']] });
});

test('header IMAGE → component HEADER con example.header_url', () => {
  const comps = buildYcloudCreateComponents({
    headerType: 'image',
    headerMediaUrl: 'https://cdn.meraki.com/banner.jpg',
    body: 'Hola {{nombre}}',
    variables: [{ key: 'nombre', example: 'Ana' }],
  });
  assert.deepEqual(comps[0], {
    type: 'HEADER', format: 'IMAGE',
    example: { header_url: ['https://cdn.meraki.com/banner.jpg'] },
  });
});

test('botones URL / PHONE_NUMBER / QUICK_REPLY → component BUTTONS', () => {
  const comps = buildYcloudCreateComponents({
    body: 'Hola',
    variables: [],
    buttons: [
      { type: 'URL', text: 'Ver web', url: 'https://meraki.com' },
      { type: 'PHONE_NUMBER', text: 'Llamar', phoneNumber: '+573001112233' },
      { type: 'QUICK_REPLY', text: 'No, gracias' },
    ],
  });
  const btns = comps.find((c) => c.type === 'BUTTONS');
  assert.ok(btns, 'debe existir component BUTTONS');
  assert.deepEqual(btns!.buttons, [
    { type: 'URL', text: 'Ver web', url: 'https://meraki.com' },
    { type: 'PHONE_NUMBER', text: 'Llamar', phone_number: '+573001112233' },
    { type: 'QUICK_REPLY', text: 'No, gracias' },
  ]);
});

console.log('buildPositionalComponents');
const baseTemplate: WhatsAppTemplate = {
  id: 't1', companyId: 'c1', name: 'reactivacion', displayName: 'Reactivación',
  category: 'utility', language: 'es',
  body: 'Hola {{nombre}}, sobre {{proyecto}}',
  variables: [{ key: 'nombre', example: 'Juan' }, { key: 'proyecto', example: 'Torre' }],
  status: 'approved', createdAt: Timestamp.now(),
};

test('parámetros en orden de template.variables (no del objeto recibido)', () => {
  // Se pasan en orden invertido a propósito: debe respetar el orden de la plantilla
  const comps = buildPositionalComponents(baseTemplate, { proyecto: 'Torre Norte', nombre: 'Ana' });
  assert.equal(comps.length, 1);
  assert.equal(comps[0].type, 'body');
  assert.deepEqual(comps[0].parameters, [
    { type: 'text', text: 'Ana' },
    { type: 'text', text: 'Torre Norte' },
  ]);
});

test('usa el ejemplo cuando falta el valor en runtime', () => {
  const comps = buildPositionalComponents(baseTemplate, { nombre: 'Ana' });
  assert.deepEqual((comps[0].parameters as { text: string }[])[1], { type: 'text', text: 'Torre' });
});

test('header con URL → component de imagen + body', () => {
  const comps = buildPositionalComponents(
    { ...baseTemplate, header: 'https://cdn.meraki.com/banner.jpg' },
    { nombre: 'Ana', proyecto: 'Torre' }
  );
  assert.equal(comps.length, 2);
  assert.equal(comps[0].type, 'header');
  assert.deepEqual(comps[0].parameters, [{ type: 'image', image: { link: 'https://cdn.meraki.com/banner.jpg' } }]);
  assert.equal(comps[1].type, 'body');
});

test('header de texto (no URL) NO genera component de header en el envío', () => {
  const comps = buildPositionalComponents({ ...baseTemplate, header: 'Meraki' }, { nombre: 'Ana', proyecto: 'Torre' });
  assert.equal(comps.length, 1);
  assert.equal(comps[0].type, 'body');
});

test('plantilla sin variables → sin components', () => {
  const comps = buildPositionalComponents({ ...baseTemplate, variables: [] }, {});
  assert.equal(comps.length, 0);
});

test('envío con headerType video → component header con link de video', () => {
  const comps = buildPositionalComponents(
    { ...baseTemplate, headerType: 'video', headerMediaUrl: 'https://cdn.meraki.com/clip.mp4' },
    { nombre: 'Ana', proyecto: 'Torre' }
  );
  assert.equal(comps[0].type, 'header');
  assert.deepEqual(comps[0].parameters, [{ type: 'video', video: { link: 'https://cdn.meraki.com/clip.mp4' } }]);
});

console.log(`\n${passed} pruebas OK`);
