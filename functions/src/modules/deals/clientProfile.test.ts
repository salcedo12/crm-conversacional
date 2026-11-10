import { test, expect } from 'vitest';
import { ClientInputSchema, clientDocId, normalizeIdentification } from './clientProfile';

const comprador = {
  personKind: 'natural',
  firstNames: 'CARLOS ANDRES',
  lastNames: 'PRUEBA UNO',
  birthDate: '1991-04-10',
  maritalStatus: 'casado',
  gender: 'masculino',
  residenceCity: 'Bogotá, D.C.',
  address: 'Calle 123 # 45 - 67',
  identificationKind: 'CC',
  identificationNumber: '1000000001',
  expeditionCity: 'Bogotá, D.C.',
  expeditionDate: '2009-11-03',
  mobile: '+573001112233',
  email: 'Carlos@Example.com',
};

test('ficha completa de persona natural es válida y normaliza el correo', () => {
  const parsed = ClientInputSchema.parse(comprador);
  expect(parsed.email).toBe('carlos@example.com');
});

test('persona natural exige nacimiento, estado civil, género y apellidos', () => {
  const { birthDate: _b, maritalStatus: _m, gender: _g, ...rest } = comprador;
  const result = ClientInputSchema.safeParse({ ...rest, lastNames: '' });
  expect(result.success).toBe(false);
  const paths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
  expect(paths).toEqual(expect.arrayContaining(['lastNames', 'birthDate', 'maritalStatus', 'gender']));
});

test('persona jurídica no exige datos personales', () => {
  const result = ClientInputSchema.safeParse({
    personKind: 'juridica',
    firstNames: 'INVERSIONES ABC S.A.S',
    residenceCity: 'Ibagué',
    address: 'Carrera 5 # 10 - 20',
    identificationKind: 'NIT',
    identificationNumber: '900123456-7',
    expeditionCity: 'Ibagué',
    expeditionDate: '2015-06-01',
    mobile: '+573001112233',
    email: 'gerencia@abc.com',
  });
  expect(result.success).toBe(true);
});

test('rechaza celular sin indicativo, fechas imposibles y expedición antes del nacimiento', () => {
  expect(ClientInputSchema.safeParse({ ...comprador, mobile: '3001112233' }).success).toBe(false);
  expect(ClientInputSchema.safeParse({ ...comprador, expeditionDate: '2009-02-30' }).success).toBe(false);
  expect(ClientInputSchema.safeParse({ ...comprador, expeditionDate: '1990-01-01' }).success).toBe(false);
});

test('el id de la ficha ignora puntos y espacios del documento', () => {
  expect(normalizeIdentification('1.000.000.001')).toBe('1000000001');
  expect(clientDocId('CC', '1.000.000.001')).toBe('CC-1000000001');
  expect(clientDocId('NIT', '900 123 456-7')).toBe('NIT-900123456-7');
});
