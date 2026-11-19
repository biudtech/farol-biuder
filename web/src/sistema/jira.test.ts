import { describe, expect, it } from 'vitest';
import { lerGravacaoDaCredencial } from '@/contratos/sistema';
import { corpoDaCredencial, erroDaCredencial, ultimosCardsLidos } from './jira';

const SITE = { id: 's', owners: ['orga'], projectKeys: ['PROJ'] };
const TOKEN = ['ATATT', 'xFfGF0abcdefghijklmnopqrstuvwx'].join('3');

describe('os últimos cards lidos de um site', () => {
  it('saem das decisões resolvidas, um por card, do mais novo para o mais antigo', () => {
    const resolvidas = [
      { key: 'orga/repo#1', card: 'PROJ-1', resolvedAt: 100 },
      { key: 'orga/repo#2', card: { key: 'PROJ-2' }, resolvedAt: 300 },
      { key: 'orga/repo#3', card: 'PROJ-1', resolvedAt: 200 },
      { key: 'outra/repo#4', card: 'PROJ-4', resolvedAt: 400 },
      { key: 'orga/repo#5', card: 'OUTRO-5', resolvedAt: 500 },
    ];
    expect(ultimosCardsLidos(resolvidas, SITE)).toEqual([{ card: 'PROJ-2', em: 300 }, { card: 'PROJ-1', em: 200 }]);
  });

  it('site sem organização nem projeto aceita qualquer card; o teto corta', () => {
    const resolvidas = Array.from({ length: 8 }, (_, i) => ({ key: `x/y#${i}`, card: `C-${i}`, resolvedAt: i }));
    expect(ultimosCardsLidos(resolvidas, { id: 's', owners: [], projectKeys: [] }).map((c) => c.card)).toEqual(['C-7', 'C-6', 'C-5', 'C-4', 'C-3']);
  });

  it('entrada torta não quebra', () => {
    expect(ultimosCardsLidos(undefined, SITE)).toEqual([]);
    expect(ultimosCardsLidos([null, 'x', 3, { card: 7 }, { key: 9, card: 'PROJ-9' }, { key: 'orga/r#1', card: 'PROJ-8', resolvedAt: 'ontem' }], SITE)).toEqual([{ card: 'PROJ-8' }]);
  });
});

describe('a troca da credencial', () => {
  it('pede e-mail e token', () => {
    expect(erroDaCredencial('', true)).toMatch(/e-mail/);
    expect(erroDaCredencial('sem-arroba', true)).toMatch(/e-mail/);
    expect(erroDaCredencial('a@b', false)).toMatch(/token/);
    expect(erroDaCredencial('a@b', true)).toBeNull();
  });

  it('o corpo é o da rota do motor', () => {
    expect(corpoDaCredencial('s', ' a@b ', ` ${TOKEN} `)).toEqual({ siteId: 's', email: 'a@b', token: TOKEN });
  });

  it('a resposta não traz nada além do ok e da frase da recusa, mesmo que o motor ecoe o token', () => {
    expect(lerGravacaoDaCredencial({ ok: true, token: TOKEN, email: 'a@b' })).toEqual({ ok: true });
    expect(lerGravacaoDaCredencial({ ok: false, error: `recusado ${TOKEN}` })).toEqual({ ok: false, erro: 'recusado [segredo omitido]' });
    expect(lerGravacaoDaCredencial({ ok: 'sim' })).toBeNull();
    expect(lerGravacaoDaCredencial(null)).toBeNull();
  });
});
