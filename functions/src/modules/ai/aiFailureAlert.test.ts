import { describe, expect, it } from 'vitest';
import { aiFailureReason, buildAiFailureAlert, oneLine } from './aiFailureAlert';

describe('aviso de falla de la IA', () => {
  it('explica la causa en palabras simples', () => {
    expect(aiFailureReason('429 You exceeded your current quota, please check your plan and billing details.')).toMatch(/sin saldo/);
    expect(aiFailureReason('401 Incorrect API key provided')).toMatch(/llave/);
    expect(aiFailureReason('429 Rate limit reached for requests')).toMatch(/por minuto/);
    expect(aiFailureReason('Request timed out.')).toMatch(/tardó/);
    expect(aiFailureReason('503 The server is overloaded')).toMatch(/caído/);
    expect(aiFailureReason('algo raro')).toMatch(/error técnico/);
  });

  it('arma un mensaje en una sola línea (Meta rechaza saltos en variables)', () => {
    const text = buildAiFailureAlert({ leadName: 'Ana', phoneTail: '1234', reason: 'OpenAI está caído o con fallas', otherFailures: 3 });
    expect(text).not.toMatch(/\n/);
    expect(text).toContain('Ana (…1234)');
    expect(text).toContain('fallaron 3 chat(s) más');
    expect(buildAiFailureAlert({ leadName: 'Ana', phoneTail: '', reason: 'x', otherFailures: 0 })).not.toContain('fallaron');
    expect(oneLine('a\n\n   b\tc')).toBe('a b c');
  });
});
