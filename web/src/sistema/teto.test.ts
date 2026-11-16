import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  comTeto, conferirTeto, efeitosDoTeto, lerRascunhoDoTeto, marcaDoRascunho, mesmoTeto, rascunhoDoTeto, tetoDoPerfil, textoDoTeto,
  type Teto,
} from './teto';

const raiz = (arquivo: string): string => fs.readFileSync(path.resolve(import.meta.dirname, '../../..', arquivo), 'utf8');

// A lista como o motor a manda para fora: o perfil de chave sem `apiKey` e com `temChave`.
const PLANO = { id: 'plano', label: 'Assinatura', kind: 'dir', dir: '', budgetDaily: 20, cor: 'azul' };
const API = { id: 'api', label: 'Chave', kind: 'apikey', baseUrl: 'https://proxy.exemplo.com', temChave: true, budgetByWeekday: { 6: 5 } };
const CRU = [PLANO, API];

const SEM_TETO: Teto = { budgetDaily: null, budgetTotal: null, budgetSince: '' };

describe('o contrato que deixa o teto ser editado sem reenviar segredo', () => {
  it('o motor mantém a chave guardada quando o perfil chega sem ela, e a pasta é a do arquivo', () => {
    expect(raiz('lib/engine/chave-do-perfil.js')).toContain('return chave ? { ...p, apiKey: chave } : p;');
    expect(raiz('lib/engine/pasta-do-perfil.js')).toContain("p.kind === 'dir' ? { ...p, dir: pastaAtual(");
    // e a rota aplica as duas antes de gravar
    expect(raiz('lib/http-server.js')).toContain('engine.updateSettings(patchDaTela(body || {}, engine.config)');
  });

  it('os campos do teto são os que aplicaOrcamento aceita, e a lista de perfis é trocada inteira', () => {
    const fonte = raiz('lib/parse.js');
    for (const campo of ['budgetDaily', 'budgetTotal', 'budgetSince', 'budgetByWeekday', 'budgetDates']) expect(fonte).toContain(`out.${campo} = `);
    expect(raiz('lib/settings.js')).toContain("{ key: 'claudeProfiles', def: [], ui: true, san: (v, _c, f) => f.normalizeClaudeProfiles(v) }");
  });
});

describe('lerRascunhoDoTeto', () => {
  it('vazio é sem teto, zero é teto, e vírgula ou ponto servem', () => {
    expect(lerRascunhoDoTeto({ diario: '', total: '', desde: '' })).toEqual({ teto: SEM_TETO, erros: null });
    expect(lerRascunhoDoTeto({ diario: '0', total: ' 12,50 ', desde: '2026-11-01' })).toEqual({ teto: { budgetDaily: 0, budgetTotal: 12.5, budgetSince: '2026-11-01' }, erros: null });
    expect(lerRascunhoDoTeto({ diario: '7.5', total: '', desde: '' }).teto).toEqual({ budgetDaily: 7.5, budgetTotal: null, budgetSince: '' });
  });

  it('o que o motor descartaria calado é erro aqui, por campo', () => {
    for (const ruim of ['-1', 'abc', '1e3', '1,234', '12,', '1 2', 'NaN', '1234567']) {
      expect(lerRascunhoDoTeto({ diario: ruim, total: '', desde: '' }).erros?.diario, ruim).toBeTruthy();
    }
    expect(lerRascunhoDoTeto({ diario: '', total: 'x', desde: '' }).erros).toEqual({ total: expect.any(String) });
    for (const ruim of ['2026-02-30', '01/11/2026', '2026-1-1', '0000-01-01']) {
      expect(lerRascunhoDoTeto({ diario: '', total: '', desde: ruim }).erros?.desde, ruim).toBeTruthy();
    }
  });

  it('o rascunho parte do teto do motor, e a marca ignora a forma de escrever', () => {
    expect(rascunhoDoTeto({ budgetDaily: 12.5, budgetTotal: 0, budgetSince: '2026-11-01' })).toEqual({ diario: '12,5', total: '0', desde: '2026-11-01' });
    expect(rascunhoDoTeto(SEM_TETO)).toEqual({ diario: '', total: '', desde: '' });
    expect(marcaDoRascunho({ diario: '12,5', total: '', desde: '' })).toBe(marcaDoRascunho({ diario: ' 12.50', total: '', desde: '' }));
    expect(marcaDoRascunho({ diario: '12', total: '', desde: '' })).not.toBe(marcaDoRascunho({ diario: '13', total: '', desde: '' }));
    expect(marcaDoRascunho({ diario: 'x', total: '', desde: '' })).not.toBe(marcaDoRascunho({ diario: 'y', total: '', desde: '' }));
  });

  it('tetoDoPerfil lê os três campos, e mesmoTeto compara os três', () => {
    expect(tetoDoPerfil({ budgetDaily: 0 })).toEqual({ budgetDaily: 0, budgetTotal: null, budgetSince: '' });
    expect(mesmoTeto(SEM_TETO, { ...SEM_TETO })).toBe(true);
    expect(mesmoTeto(SEM_TETO, { ...SEM_TETO, budgetDaily: 0 })).toBe(false);
  });
});

describe('comTeto: a lista crua com um teto trocado', () => {
  it('só os três campos do perfil editado mudam; o resto volta como veio', () => {
    const corpo = comTeto(CRU, 'plano', { budgetDaily: 5, budgetTotal: 100, budgetSince: '2026-11-01' });
    expect(corpo).toEqual([
      { id: 'plano', label: 'Assinatura', kind: 'dir', dir: '', cor: 'azul', budgetDaily: 5, budgetTotal: 100, budgetSince: '2026-11-01' },
      API,
    ]);
    // o outro perfil é o mesmo objeto, e o cru não foi mexido
    expect(corpo?.[1]).toBe(API);
    expect(PLANO).toEqual({ id: 'plano', label: 'Assinatura', kind: 'dir', dir: '', budgetDaily: 20, cor: 'azul' });
  });

  it('tirar o teto tira o campo (ausente é sem teto), e zero fica', () => {
    expect(comTeto(CRU, 'plano', SEM_TETO)?.[0]).toEqual({ id: 'plano', label: 'Assinatura', kind: 'dir', dir: '', cor: 'azul' });
    expect(comTeto(CRU, 'api', { budgetDaily: 0, budgetTotal: null, budgetSince: '' })?.[1]).toEqual({ ...API, budgetDaily: 0 });
  });

  it('o corpo não ganha chave de API: o perfil de chave vai com o que veio', () => {
    const corpo = comTeto(CRU, 'api', { budgetDaily: 1, budgetTotal: null, budgetSince: '' });
    expect(JSON.stringify(corpo)).not.toContain('apiKey');
    expect(corpo?.[1]).toEqual({ ...API, budgetDaily: 1 });
  });

  it('perfil que não está na lista, ou que aparece duas vezes, não tem corpo', () => {
    expect(comTeto(CRU, 'outro', SEM_TETO)).toBeNull();
    expect(comTeto([PLANO, { ...PLANO }], 'plano', SEM_TETO)).toBeNull();
    expect(comTeto([], 'plano', SEM_TETO)).toBeNull();
    // item torto da lista volta como veio
    expect(comTeto([7, PLANO], 'plano', SEM_TETO)?.[0]).toBe(7);
  });
});

describe('conferirTeto: o que voltou contra o enviado', () => {
  const pedido: Teto = { budgetDaily: 5, budgetTotal: null, budgetSince: '' };
  const enviado = comTeto(CRU, 'plano', pedido) ?? [];

  it('gravado igual ao enviado', () => {
    expect(conferirTeto(enviado, JSON.parse(JSON.stringify(enviado)), 'plano', pedido)).toEqual({ igual: true, gravado: pedido, outros: [] });
  });

  it('o motor descartou o valor: o que ficou é dito', () => {
    const gravado = [{ ...PLANO, budgetDaily: undefined }, API].map((p) => JSON.parse(JSON.stringify(p)));
    expect(conferirTeto(enviado, gravado, 'plano', pedido)).toEqual({ igual: false, gravado: SEM_TETO, outros: [] });
  });

  it('outro perfil que mudou, saiu ou apareceu é apontado pelo id', () => {
    expect(conferirTeto(enviado, [enviado[0], { ...API, baseUrl: 'https://outro.exemplo.com' }], 'plano', pedido).outros).toEqual(['api']);
    expect(conferirTeto(enviado, [enviado[0]], 'plano', pedido).outros).toEqual(['api']);
    expect(conferirTeto(enviado, [...enviado, { id: 'novo', kind: 'dir' }], 'plano', pedido).outros).toEqual(['novo']);
  });

  it('o perfil editado saiu da lista', () => {
    expect(conferirTeto(enviado, [API], 'plano', pedido)).toEqual({ igual: false, gravado: null, outros: [] });
  });
});

describe('textos do teto', () => {
  it('o teto numa frase', () => {
    expect(textoDoTeto(SEM_TETO)).toBe('sem teto');
    expect(textoDoTeto({ budgetDaily: 20, budgetTotal: null, budgetSince: '' })).toBe('US$ 20,00 por dia');
    expect(textoDoTeto({ budgetDaily: 0, budgetTotal: 300, budgetSince: '2026-11-01' })).toBe('US$ 0,00 por dia; US$ 300,00 no total, contado desde 01/11/2026');
    expect(textoDoTeto({ budgetDaily: null, budgetTotal: 300, budgetSince: '' })).toBe('US$ 300,00 no total, contado desde o começo do registro do motor');
    expect(textoDoTeto({ budgetDaily: null, budgetTotal: null, budgetSince: '2026-11-01' })).toBe('sem teto (data de corte 01/11/2026)');
  });

  it('baixar, criar ou zerar diz que pode pausar; subir ou tirar diz que pode soltar', () => {
    const de: Teto = { budgetDaily: 20, budgetTotal: null, budgetSince: '' };
    expect(efeitosDoTeto(de, { ...de, budgetDaily: 0 })[0]).toContain('param já');
    expect(efeitosDoTeto(de, { ...de, budgetDaily: 5 })[0]).toMatch(/baixa .*pausam/);
    expect(efeitosDoTeto(de, { ...de, budgetTotal: 100 })[0]).toMatch(/total passa a existir .*pausam/);
    expect(efeitosDoTeto(de, { ...de, budgetDaily: 50 })[0]).toContain('podem voltar a rodar');
    expect(efeitosDoTeto(de, { ...de, budgetDaily: null })[0]).toContain('volta a rodar');
    expect(efeitosDoTeto(de, { ...de, budgetSince: '2026-11-01' })).toEqual(['A data de corte passa a ser 01/11/2026: o teto total conta só o gasto desse dia em diante.']);
    expect(efeitosDoTeto({ ...de, budgetSince: '2026-11-01' }, de)[0]).toContain('todo o gasto');
    expect(efeitosDoTeto(de, { ...de })).toEqual([]);
  });
});
