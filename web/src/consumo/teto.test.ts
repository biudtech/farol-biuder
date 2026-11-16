import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TetoDoPerfil } from '@/contratos/consumo';
import { estadoDoTeto, linhasDaAuditoria } from './teto';

const RAIZ = path.resolve(import.meta.dirname, '../../..');
const fonte = (arquivo: string): string => fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');

const base: TetoDoPerfil = { id: 'p1', label: 'Assinatura do time', kind: 'assinatura', capHoje: 50, capOrigem: 'base', today: 12.5, sinceCutoff: 300, blocked: false, tipicoReview: 4.1 };

describe('o estado do teto em frases', () => {
  it('dentro do teto: o gasto de hoje, o teto, de onde ele vem e o que resta', () => {
    expect(estadoDoTeto(base)).toEqual({
      nome: 'Assinatura do time',
      tipo: 'Assinatura',
      pausado: false,
      situacao: 'Dentro do teto: a revisão automática segue.',
      linhas: ['Hoje, no dia do motor: US$ 12,50 estimados de US$ 50,00 (teto diário). Resta US$ 37,50.'],
      notas: [],
    });
  });

  it('o teto de hoje pode vir do dia da semana ou de uma data', () => {
    expect(estadoDoTeto({ ...base, capOrigem: 'semana' }).linhas[0]).toContain('(teto deste dia da semana)');
    expect(estadoDoTeto({ ...base, capOrigem: 'data' }).linhas[0]).toContain('(teto só desta data)');
    expect(estadoDoTeto({ ...base, capOrigem: 'nova' }).linhas[0]).toContain('(teto de hoje)');
  });

  it('teto total: desde a data de corte, ou em todo o registro', () => {
    const comCorte = estadoDoTeto({ ...base, budgetTotal: 1000, budgetSince: '2026-11-01' });
    expect(comCorte.linhas[1]).toBe('Desde 01/11/2026: US$ 300,00 estimados de US$ 1.000,00 (teto total). Resta US$ 700,00.');
    expect(estadoDoTeto({ id: 'p', blocked: false, budgetTotal: 100, sinceCutoff: 100 }).linhas).toEqual(['Em todo o registro: US$ 100,00 estimados de US$ 100,00 (teto total). Teto atingido.']);
  });

  it('pausado: diz qual teto, o que o motor deixa de fazer e o que continua', () => {
    const pausado = estadoDoTeto({ ...base, today: 51, blocked: true, reason: 'diario' });
    expect(pausado.pausado).toBe(true);
    expect(pausado.situacao).toBe('Pausado: o teto de hoje foi atingido.');
    expect(pausado.linhas[0]).toMatch(/Teto atingido\.$/);
    expect(pausado.notas).toEqual(['Enquanto durar, o motor não inicia revisão automática, retentativa nem busca de contestação por este perfil. A revisão pedida por você continua liberada.']);
    expect(estadoDoTeto({ ...base, blocked: true, reason: 'total' }).situacao).toBe('Pausado: o teto total foi atingido.');
  });

  it('pausa prevista: o gasto ainda não chegou ao teto, e a tela diz a projeção do motor', () => {
    const previsto = estadoDoTeto({ ...base, today: 47, blocked: true, reason: 'diario-previsto' });
    expect(previsto.situacao).toBe('Pausado: a próxima revisão não cabe no teto de hoje.');
    expect(previsto.linhas[0]).toMatch(/Resta US\$ 3,00\.$/);
    expect(previsto.notas[1]).toBe('O motor projeta US$ 4,10 para a próxima revisão (a mediana do custo das revisões dos últimos 30 dias) e pausa antes de gastar.');
    expect(estadoDoTeto({ ...base, blocked: true, reason: 'total-previsto', tipicoReview: 0 }).notas).toHaveLength(1);
  });

  it('motivo que a tela não conhece aparece cru, e pausa sem motivo não inventa um', () => {
    expect(estadoDoTeto({ ...base, blocked: true, reason: 'cota' }).situacao).toBe('Pausado pelo teto (motivo que esta tela não conhece: cota).');
    expect(estadoDoTeto({ ...base, blocked: true, reason: 'constructor' }).situacao).toContain('constructor');
    expect(estadoDoTeto({ ...base, blocked: true }).situacao).toBe('Pausado pelo teto.');
  });

  it('sem teto, e sem o campo de pausa', () => {
    const semTeto = estadoDoTeto({ id: 'p2', kind: 'apikey', today: 3, blocked: false });
    expect(semTeto).toMatchObject({ nome: 'p2', tipo: 'Chave de API', situacao: 'Sem teto definido: este perfil não pausa por gasto.', linhas: ['Hoje, no dia do motor: US$ 3,00 estimados, sem teto diário.'] });
    expect(estadoDoTeto({ id: 'p3' })).toEqual({ nome: 'p3', tipo: 'Tipo não informado', pausado: false, situacao: 'O motor não disse se este perfil está pausado.', linhas: [], notas: [] });
    expect(estadoDoTeto({ id: 'p4', kind: 'outro' }).tipo).toBe('outro');
  });

  it('gasto que não veio aparece como sem dado, sem inventar o que resta', () => {
    expect(estadoDoTeto({ id: 'p', capHoje: 10, blocked: false }).linhas).toEqual(['Hoje, no dia do motor: gasto não informado; o teto é de US$ 10,00 (teto de hoje).']);
  });

  it('reserva por custo desconhecido vira nota', () => {
    expect(estadoDoTeto({ ...base, parcialmenteEstimado: true }).notas[0]).toMatch(/^Há sessão com custo desconhecido neste perfil/);
  });

  it('os motivos, as origens e a janela da projeção são os do motor', () => {
    const consumo = fonte('lib/engine/usage.js');
    expect(consumo).toContain("return veredito('diario', spend.today, nd.hoje, dailyCapFor(profile, localDay()))");
    expect(consumo).toContain("|| veredito('total', spend.sinceCutoff, nd.desde, profile.budgetTotal)");
    expect(consumo).toContain('reason: `${reason}-previsto`');
    expect(consumo).toContain("return 'data';");
    expect(consumo).toContain("return 'semana';");
    expect(consumo).toContain("? 'base' : 'nenhum';");
    expect(consumo).toContain('const TIPICO_DIAS = 30;');
    expect(consumo).toContain("const kind = p.kind === 'apikey' ? 'apikey' : 'assinatura';");
    // quem deixa de rodar com o perfil pausado: a fila automática, a retentativa e a busca de
    // contestação; a revisão pedida à mão passa
    expect(fonte('server.js')).toContain('const blockedProfile = this.budgetBlockedFor(acct);');
    expect(fonte('lib/engine/review-retry.js')).toContain('!engine.budgetBlockedFor(engine.accountForPr(pr))');
    expect(fonte('lib/engine/pushback.js')).toContain('if (engine.budgetBlockedFor(engine.accountForPr(pr))) return false;');
    expect(fonte('lib/engine/review.js')).toContain('const perfilEstourado = pr.manual && !pr.lote ? null : engine.budgetBlockedFor(engine.accountForPr(pr));');
  });
});

describe('a auditoria do registro inteiro', () => {
  const parte = (sessions: number, costUsd: number) => ({ sessions, costUsd });

  it('sem perda nem estimativa, só o total', () => {
    expect(linhasDaAuditoria({ total: parte(1, 2), perdido: parte(0, 0), estimado: parte(0, 0), desconhecido: parte(0, 0) })).toEqual(['Registro inteiro de sessões: US$ 2,00 estimados em 1 sessão.']);
  });

  it('diz o que não virou resultado, o que o motor calculou e o que ficou desconhecido', () => {
    expect(linhasDaAuditoria({ total: parte(42, 900), util: parte(39, 810), perdido: parte(3, 90), medido: parte(40, 880), estimado: parte(1, 20), desconhecido: parte(1, 0) })).toEqual([
      'Registro inteiro de sessões: US$ 900,00 estimados em 42 sessões.',
      'Não viraram resultado (erro, cancelada, parcial, descartada ou interrompida): US$ 90,00 em 3 sessões, 10% do custo registrado.',
      'Custo calculado pelo motor, para sessão que morreu antes de informar: US$ 20,00 em 1 sessão.',
      'Custo desconhecido: 1 sessão, fora de todo valor em dólar.',
    ]);
  });

  it('total zero não vira participação', () => {
    expect(linhasDaAuditoria({ total: parte(1, 0), perdido: parte(1, 0) })[1]).toBe('Não viraram resultado (erro, cancelada, parcial, descartada ou interrompida): US$ 0,00 em 1 sessão.');
  });
});
