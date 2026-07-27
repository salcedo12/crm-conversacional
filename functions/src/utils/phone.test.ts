import { test, expect } from 'vitest';
import { normalizePhone, toTwilioPhone, toNormalizedPhone } from './phone';

test('normalizePhone quita el prefijo whatsapp:', () => {
  expect(normalizePhone('whatsapp:+573213443603')).toBe('+573213443603');
});

test('normalizePhone es case-insensitive y recorta espacios', () => {
  expect(normalizePhone('WhatsApp:+573213443603 ')).toBe('+573213443603');
});

test('normalizePhone deja intacto un número ya limpio', () => {
  expect(normalizePhone('+573213443603')).toBe('+573213443603');
});

test('toTwilioPhone agrega el prefijo whatsapp:', () => {
  expect(toTwilioPhone('+573213443603')).toBe('whatsapp:+573213443603');
});

test('toTwilioPhone no duplica el prefijo si ya lo trae', () => {
  expect(toTwilioPhone('whatsapp:+573213443603')).toBe('whatsapp:+573213443603');
});

test('toNormalizedPhone quita whatsapp: y pasa a minúsculas', () => {
  expect(toNormalizedPhone('WhatsApp:+573213443603')).toBe('+573213443603');
});
