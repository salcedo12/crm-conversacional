import { test, expect } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { buildOpenAiMessages, detectsTransferKeyword } from './aiContext.service';
import type { AiConfig } from './ai.types';
import type { Message } from '../messages/messages.types';

const baseConfig: AiConfig = {
  id: 'default',
  companyId: 'c1',
  enabled: true,
  assistantName: 'Victoria',
  businessName: 'Grupo Meraki',
  basePrompt: 'Eres un asistente de ventas.',
  tone: 'friendly',
  knowledgeBase: '',
  fallbackMessage: 'fallback',
  maxContextMessages: 20,
  transferKeywords: ['asesor', 'hablar con alguien'],
  blockedTopics: [],
  followUpSequence: [],
  updatedAt: Timestamp.now(),
};

const sys = (msgs: ReturnType<typeof buildOpenAiMessages>) => String(msgs[0].content);

// ── detectsTransferKeyword ──────────────────────────────────────────────────
test('detecta la keyword como palabra completa', () => {
  expect(detectsTransferKeyword('quiero un asesor por favor', baseConfig.transferKeywords)).toBe(true);
});

test('NO dispara dentro de otra palabra (asesoramiento)', () => {
  expect(detectsTransferKeyword('necesito asesoramiento', baseConfig.transferKeywords)).toBe(false);
});

test('detecta una frase completa', () => {
  expect(detectsTransferKeyword('me gustaría hablar con alguien', baseConfig.transferKeywords)).toBe(true);
});

test('es case-insensitive', () => {
  expect(detectsTransferKeyword('UN ASESOR YA', baseConfig.transferKeywords)).toBe(true);
});

test('sin coincidencia no dispara', () => {
  expect(detectsTransferKeyword('hola, qué tal', baseConfig.transferKeywords)).toBe(false);
});

// ── buildOpenAiMessages ─────────────────────────────────────────────────────
test('inyecta nombre, negocio y ajustes en el system prompt', () => {
  const content = sys(buildOpenAiMessages(baseConfig, [], 'hola'));
  expect(content).toContain('Victoria');
  expect(content).toContain('Grupo Meraki');
  expect(content).toContain('AJUSTES DEL ASISTENTE');
});

test('incluye los temas bloqueados cuando existen', () => {
  const content = sys(buildOpenAiMessages({ ...baseConfig, blockedTopics: ['política', 'religión'] }, [], 'hola'));
  expect(content).toContain('política');
  expect(content).toContain('No converses sobre estos temas');
});

test('no incluye la línea de bloqueados si la lista está vacía', () => {
  const content = sys(buildOpenAiMessages(baseConfig, [], 'hola'));
  expect(content).not.toContain('No converses sobre estos temas');
});

test('anexa la base de conocimiento cuando existe', () => {
  const content = sys(buildOpenAiMessages({ ...baseConfig, knowledgeBase: 'Precio desde 100M' }, [], 'hola'));
  expect(content).toContain('BASE DE CONOCIMIENTO');
  expect(content).toContain('Precio desde 100M');
});

test('agrega el mensaje del usuario al final', () => {
  const msgs = buildOpenAiMessages(baseConfig, [], 'quiero info');
  const last = msgs[msgs.length - 1];
  expect(last.role).toBe('user');
  expect(last.content).toBe('quiero info');
});

test('no duplica el mensaje si ya es el último del historial', () => {
  const history = [{ senderType: 'lead', content: 'quiero info' } as unknown as Message];
  const msgs = buildOpenAiMessages(baseConfig, history, 'quiero info');
  const userMsgs = msgs.filter((m) => m.role === 'user');
  expect(userMsgs.length).toBe(1);
});

test('un mensaje con imagen usa el formato vision (array de partes)', () => {
  const msgs = buildOpenAiMessages(baseConfig, [], 'mira esto', 'https://x/img.jpg', 'image/jpeg');
  const last = msgs[msgs.length - 1];
  expect(Array.isArray(last.content)).toBe(true);
});
