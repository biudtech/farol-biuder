import { describe, expect, it } from 'vitest';
import { LEITORES } from './snapshot';
import { MOTIVOS_DE_FORA } from './de-fora';

function coletor() {
  const avisos: string[] = [];
  return { avisos, registrar: (aviso: string) => { avisos.push(aviso); } };
}

// O que deForaParaTela (lib/engine/de-fora.js) emite num item.
const ITEM = {
  key: 'dono/repo#12', url: 'https://github.com/dono/repo/pull/12', title: 'Corrige o cálculo', author: 'ana',
  repo: 'dono/repo', number: 12, motivo: 'decisao_de_gente', desde: 1700000000000, head: 'abc1234def',
  detalhe: { decisivos: [{ quem: 'bia', estado: 'APPROVED', em: '2026-11-19T08:30:00Z' }] }, quem: ['bia'],
};

describe('deFora: o leitor tipado', () => {
  it('lê o item inteiro, campo a campo', () => {
    const { registrar, avisos } = coletor();
    expect(LEITORES.deFora([ITEM], registrar)).toEqual([{
      key: 'dono/repo#12', url: 'https://github.com/dono/repo/pull/12', title: 'Corrige o cálculo', author: 'ana',
      repo: 'dono/repo', number: 12, motivo: 'decisao_de_gente', desde: 1700000000000, head: 'abc1234def',
      detalhe: { decisivos: [{ quem: 'bia', estado: 'APPROVED', em: '2026-11-19T08:30:00Z' }] }, quem: ['bia'],
    }]);
    expect(avisos).toEqual([]);
  });

  it('os sete motivos do motor são a lista fechada, na ordem de precedência', () => {
    expect(MOTIVOS_DE_FORA).toEqual(['estacionado', 'outra_conta', 'decisao_de_gente', 'pedido_retirado', 'regra_manual', 'auto_desligado', 'ignorado']);
  });

  it('sem chave ou com motivo que este front não conhece, o item é descartado e registrado; o resto entra', () => {
    const { registrar, avisos } = coletor();
    const lido = LEITORES.deFora([ITEM, { ...ITEM, key: '' }, { ...ITEM, key: 'x/y#1', motivo: 'rascunho' }, 'torto', null], registrar);
    expect(lido?.map((i) => i.key)).toEqual(['dono/repo#12']);
    expect(avisos).toEqual(['snapshot: 4 item(ns) de "deFora" com forma inesperada, descartado(s)']);
  });

  it('campo torto conta como ausente, e o item aparece com o que deu para ler', () => {
    const { registrar } = coletor();
    const [item] = LEITORES.deFora([{
      key: 'dono/repo#12', motivo: 'estacionado', url: 7, title: null, author: ['x'], number: 'doze', desde: 'ontem', head: {},
      detalhe: 'quebrado', quem: [1, 'bia'],
    }], registrar) ?? [];
    expect(item).toEqual({ key: 'dono/repo#12', motivo: 'estacionado', detalhe: {}, quem: ['bia'] });
  });

  it('o detalhe é montado por motivo, sem o que vier a mais', () => {
    const { registrar } = coletor();
    const lidos = LEITORES.deFora([
      { key: 'a#1', motivo: 'estacionado', detalhe: { tipo: 'esgotado', motivo: 'timeout', token: 'ghp_x' } },
      { key: 'a#2', motivo: 'outra_conta', detalhe: { fonte: 'label', extra: 1 }, quem: ['carla'] },
      { key: 'a#3', motivo: 'regra_manual', detalhe: { source: 'organizacao', organization: 'acme', author: 7 } },
      { key: 'a#4', motivo: 'decisao_de_gente', detalhe: { decisivos: [{ quem: 'bia', estado: 'CHANGES_REQUESTED', em: '' }, { estado: 'APPROVED' }, 'x'] } },
      { key: 'a#5', motivo: 'ignorado', detalhe: { qualquer: true } },
    ], registrar) ?? [];
    expect(lidos.map((i) => i.detalhe)).toEqual([
      { tipo: 'esgotado', motivo: 'timeout' },
      { fonte: 'label' },
      { source: 'organizacao', organization: 'acme' },
      { decisivos: [{ quem: 'bia', estado: 'CHANGES_REQUESTED' }] },
      {},
    ]);
    expect(lidos[1]?.quem).toEqual(['carla']);
  });

  it('o que não é lista é forma errada da chave: o valor anterior fica', () => {
    const { registrar } = coletor();
    for (const torto of [null, {}, 'x', 3]) expect(LEITORES.deFora(torto, registrar)).toBeUndefined();
    expect(LEITORES.deFora([], registrar)).toEqual([]);
  });
});

describe('emRetentativa: o leitor tipado', () => {
  it('lê tentativas e a hora a partir da qual roda, ou null', () => {
    const { registrar, avisos } = coletor();
    expect(LEITORES.emRetentativa({ 'a#1': { tentativas: 2, aPartirDe: 1700000000000 }, 'a#2': { tentativas: 1, aPartirDe: null } }, registrar)).toEqual({
      'a#1': { tentativas: 2, aPartirDe: 1700000000000 },
      'a#2': { tentativas: 1, aPartirDe: null },
    });
    expect(avisos).toEqual([]);
  });

  it('entrada torta: o que falta vira zero ou null; o que não é objeto sai do mapa, com registro', () => {
    const { registrar, avisos } = coletor();
    expect(LEITORES.emRetentativa({ 'a#1': { tentativas: 'duas', aPartirDe: 'logo' }, 'a#2': 'x', 'a#3': null }, registrar)).toEqual({
      'a#1': { tentativas: 0, aPartirDe: null },
    });
    expect(avisos).toEqual(['snapshot: 2 entrada(s) de "emRetentativa" com forma inesperada, descartada(s)']);
    expect(LEITORES.emRetentativa([], registrar)).toBeUndefined();
  });
});
