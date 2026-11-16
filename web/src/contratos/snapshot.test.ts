import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHAVES_DO_SNAPSHOT, LEITORES } from './snapshot';

// A lista fechada do motor mora em test/snapshot-chaves.test.js, na raiz do repositório.
// Lida por texto, porque o arquivo sobe a Engine ao ser importado.
function chavesDoMotor(): string[] {
  const arquivo = path.resolve(import.meta.dirname, '../../../test/snapshot-chaves.test.js');
  const fonte = fs.readFileSync(arquivo, 'utf8');
  const bloco = /const CHAVES = \[([\s\S]*?)\];/.exec(fonte);
  if (!bloco) throw new Error('não achei a lista CHAVES no teste do motor');
  return [...(bloco[1] as string).matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
}

describe('chaves de topo do snapshot', () => {
  it('são exatamente as da lista fechada do motor', () => {
    const doMotor = chavesDoMotor();
    expect(doMotor.length).toBeGreaterThanOrEqual(30);
    expect([...CHAVES_DO_SNAPSHOT].sort()).toEqual(doMotor.slice().sort());
  });

  it('toda chave tem leitor, e nenhum leitor sobra', () => {
    expect(Object.keys(LEITORES).sort()).toEqual([...CHAVES_DO_SNAPSHOT].sort());
  });

  it('app confere a identidade que o motor emite', () => {
    const app = { name: 'Farol', version: '3.0.0-dev', platform: 'linux' };
    expect(LEITORES.app(app, () => {})).toBe(app);
    for (const torto of [null, 'Farol', [], {}, { name: 'Farol', version: 3, platform: 'linux' }, { name: 'Farol', version: '3' }]) {
      expect(LEITORES.app(torto, () => {})).toBeUndefined();
    }
  });
});
