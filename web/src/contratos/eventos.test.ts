import { describe, expect, it } from 'vitest';
import { TETO_DO_RECADO, lerRecado } from './eventos';

describe('evento toast do motor', () => {
  it('lê os três tipos que o motor emite', () => {
    expect(lerRecado({ kind: 'info', text: 'a/b#1 pulado, nada foi postado.' })).toEqual({ tom: 'info', texto: 'a/b#1 pulado, nada foi postado.' });
    expect(lerRecado({ kind: 'ok', text: '✅ a/b#1 aprovado sem ressalvas.' })).toEqual({ tom: 'ok', texto: '✅ a/b#1 aprovado sem ressalvas.' });
    expect(lerRecado({ kind: 'error', text: 'Falha ao postar em a/b#1: x' })).toEqual({ tom: 'erro', texto: 'Falha ao postar em a/b#1: x' });
  });

  it('tipo ausente ou desconhecido vale como informação', () => {
    for (const kind of [undefined, null, 7, 'novo', 'constructor']) expect(lerRecado({ kind, text: 'x' })?.tom).toBe('info');
  });

  it('sem texto não há recado', () => {
    for (const torto of [null, 'x', [], {}, { kind: 'ok' }, { kind: 'ok', text: 7 }, { kind: 'ok', text: '  \n ' }]) expect(lerRecado(torto)).toBeNull();
  });

  it('o texto fica numa linha e tem teto', () => {
    expect(lerRecado({ kind: 'info', text: ' a\n  b ' })?.texto).toBe('a b');
    const longo = lerRecado({ kind: 'info', text: 'x'.repeat(5000) })?.texto ?? '';
    expect(longo).toHaveLength(TETO_DO_RECADO + 1);
    expect(longo.endsWith('…')).toBe(true);
  });
});
