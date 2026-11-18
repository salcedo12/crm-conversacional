import { test, expect } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import {
  buyerEndorsement,
  documentProgress,
  localCellphone,
  missingSignerData,
  userEndorsement,
  userRoleName,
  DOCUBLOCK_ORGANIZATION_ID,
} from './docublock.logic';
import { signatureDealStatus } from '../../modules/deals/dealSignature.logic';
import { tramiteFields } from '../../modules/inventory/inventory.logic';
import type { ClientProfile, DealDocument } from '../../modules/deals/deals.types';

const client: ClientProfile = {
  id: 'c1', companyId: 'co', personKind: 'natural', firstNames: ' Ana  María ', lastNames: 'Pérez Gómez',
  residenceCity: 'Ibagué', address: 'Calle 1', identificationKind: 'CC', identificationNumber: '452245414',
  expeditionCity: 'Ibagué', expeditionDate: '2021-07-27', mobile: '+573022911626', email: 'Ana@Correo.com',
  leadIds: [], createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
};

test('comprador → firmante de DocuBlock (celular sin indicativo, correo en minúscula)', () => {
  const e = buyerEndorsement(client, { typeSign: 'PROMITENTE COMPRADOR', iteration: 1, principal: true, requirePhoto: true });
  expect(e).toMatchObject({
    firstName: 'Ana María', lastName: 'Pérez Gómez', identification: '452245414', cellphone: '3022911626',
    email: 'ana@correo.com', expeditionDate: '2021-07-27', identificationKind: 'CC', principalSigner: true,
    reqDocument: true, iteration: 1, kindPerson: 'Persona Natural', country: 'Colombia',
  });
  expect(missingSignerData(e)).toEqual([]);
  expect(localCellphone('3001234567')).toBe('3001234567');
  expect(localCellphone('+13139772852', 'US')).toBe('3139772852');
  expect(localCellphone('+34641357991', 'ES')).toBe('641357991');
  expect(localCellphone('+525512345678', 'MX')).toBe('5512345678');
});

test('usuario de Meraki en DocuBlock → firmante (secuencia 2, sin foto)', () => {
  const user = {
    _id: 'u1', names: 'JHON ESPER', surNames: 'TOLEDO CASTAÑEDA', email: 'jhon@meraki.co', phone: '+573001112233',
    identificationType: 'CC', identification: '12207629', expeditionDate: '1990-01-01T00:00:00.000Z',
    organizations: [{ organization: { _id: DOCUBLOCK_ORGANIZATION_ID }, role: { name: 'Administrador' } }],
  };
  const e = userEndorsement(user, { typeSign: 'PROMITENTE VENDEDOR', iteration: 2 });
  expect(e).toMatchObject({ firstName: 'JHON ESPER', identification: '12207629', expeditionDate: '1990-01-01', reqDocument: false, iteration: 2, cellphone: '3001112233' });
  const oidUser = {
    ...user,
    identificationType: '661a27059d979c2242a463a5',
    city: { _id: 'c1', name: 'Ibagué' },
    country: { _id: '661a1fb2a0e9e20423fe6cc8', name: 'Colombia' },
  };
  expect(userEndorsement(oidUser, { typeSign: 'PROMITENTE VENDEDOR', iteration: 2 })).toMatchObject({
    identificationKind: 'CC',
    city: 'Ibagué',
    country: 'Colombia',
  });
  expect(userRoleName(user)).toBe('Administrador');
  expect(missingSignerData({ ...e, email: '', identification: '' })).toEqual(['número de documento', 'correo']);
});

test('estado de DocuBlock: en firma, parcial, firmado y vencido', () => {
  const signer = (checked: number, order: number) => ({ checked, order, typeSign: 'X', identity: { signer: { _id: `s${order}`, firstName: 'A', lastName: 'B', email: `s${order}@x.co` } } });
  const future = '2099-01-01T00:00:00.000Z';
  expect(documentProgress({ _id: 'd', signatureProgress: 1, endorsement: [signer(0, 1), signer(0, 2)], versions: [{ expirationSign: future }] }).status).toBe('en_firma');
  expect(documentProgress({ _id: 'd', signatureProgress: 1, endorsement: [signer(1, 1), signer(0, 2)], versions: [{ expirationSign: future }] }).status).toBe('firmado_parcial');
  const done = documentProgress({ _id: 'd', signatureProgress: 3, endorsement: [signer(1, 1), signer(1, 2)], versions: [{ path: 'https://s3/firmado.pdf', expirationSign: future }] });
  expect(done).toMatchObject({ status: 'firmado', fileUrl: 'https://s3/firmado.pdf' });
  expect(done.signers.map((s) => s.endorsementId)).toEqual(['s1', 's2']);
  expect(documentProgress({ _id: 'd', signatureProgress: 1, endorsement: [signer(1, 1), signer(0, 2)], versions: [{ expirationSign: '2020-01-01T00:00:00.000Z' }] }).status).toBe('vencido');
  const wrapped = documentProgress({
    _id: 'd',
    signatureProgress: 1,
    endorsement: [signer(0, 1)],
    versions: [{ path: 'https://s3/signed.pdf', _doc: { expirationSign: future } }],
  });
  expect(wrapped).toMatchObject({ status: 'en_firma', fileUrl: 'https://s3/signed.pdf', expiresAt: future });
});

test('estado del negocio con preventa y promesa enviadas a la vez', () => {
  const doc = (kind: 'preventa' | 'promesa', signatureStatus: DealDocument['signatureStatus']) => ({ kind, version: 1, signatureStatus } as DealDocument);
  expect(signatureDealStatus({ status: 'plan_listo', documents: [doc('preventa', 'en_firma'), doc('promesa', 'en_firma')] })).toBe('preventa_en_firma');
  expect(signatureDealStatus({ status: 'preventa_en_firma', documents: [doc('preventa', 'firmado'), doc('promesa', 'firmado_parcial')] })).toBe('promesa_en_firma');
  expect(signatureDealStatus({ status: 'promesa_en_firma', documents: [doc('preventa', 'firmado'), doc('promesa', 'firmado')] })).toBe('promesa_firmada');
  // La promesa puede terminar antes que la preventa: sigue "preventa en firma".
  expect(signatureDealStatus({ status: 'preventa_en_firma', documents: [doc('preventa', 'firmado_parcial'), doc('promesa', 'firmado')] })).toBe('preventa_en_firma');
  expect(signatureDealStatus({ status: 'preventa_en_firma', documents: [doc('preventa', 'anulado'), doc('promesa', 'anulado')] })).toBe('plan_listo');
  expect(signatureDealStatus({ status: 'anulado', documents: [doc('preventa', 'en_firma')] })).toBe('anulado');
});

test('lote en firma: TRAMITE sin vencimiento y marcado para que liberarLotes no lo suelte', () => {
  expect(tramiteFields(new Date('2026-10-29T12:00:00Z'), { dealId: 'd1', companyId: 'co', advisorName: 'Ana' })).toMatchObject({
    status: 'TRAMITE', fechaVencimiento: '', crmDealId: 'd1', crmSignature: true,
  });
});

test('ciudades: se envía el nombre exacto de DocuBlock (con tildes) y se sugieren parecidas', async () => {
  const { matchCity, suggestCities, COLOMBIA_ID } = await import('./docublock.logic');
  const cities = [
    { _id: '1', name: 'Ibagué', country: COLOMBIA_ID },
    { _id: '2', name: 'Bogotá', country: { _id: COLOMBIA_ID } },
    { _id: '3', name: 'Sahagun', country: COLOMBIA_ID },
    { _id: '4', name: 'Sahagún', country: COLOMBIA_ID },
    { _id: '5', name: 'El Espinal', country: COLOMBIA_ID },
    { _id: '6', name: 'Madrid', country: 'es' },
  ];
  const countries = [{ _id: COLOMBIA_ID, name: 'Colombia' }, { _id: 'es', name: 'España' }];
  expect(matchCity('IBAGUE', cities, countries)).toEqual({ city: 'Ibagué', country: 'Colombia' });
  expect(matchCity(' bogota ', cities, countries)?.city).toBe('Bogotá');
  expect(matchCity('Sahagun', cities, countries)?.city).toBe('Sahagún');
  expect(matchCity('Madrid', cities, countries)).toEqual({ city: 'Madrid', country: 'España' });
  expect(matchCity('Espinal', cities, countries)).toBeNull();
  expect(suggestCities('Espinal', cities)).toEqual(['El Espinal']);
});

test('país: DocuBlock lo pide como abreviatura ("CO")', async () => {
  const { countryCode, COLOMBIA_ID } = await import('./docublock.logic');
  const countries = [{ _id: COLOMBIA_ID, name: 'Colombia', abbreviation: 'CO' }, { _id: 'es', name: 'España', abbreviation: 'ES' }];
  expect(countryCode('Colombia', countries)).toBe('CO');
  expect(countryCode('españa', countries)).toBe('ES');
  expect(countryCode(undefined, countries)).toBe('CO');
  expect(countryCode('Narnia', countries)).toBe('CO');
});
