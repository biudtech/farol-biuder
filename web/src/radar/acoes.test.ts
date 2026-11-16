import { describe, expect, it, vi } from 'vitest';
import type { Cliente, Resultado } from '@/transporte/cliente';
import {
  CHECAR, confirmacaoDa, executar, idDa, lerRespostaDeAcao, mensagemDaRecusa, nomeDa, pedidoDa, rotuloDa,
  type Acao, type RespostaDeAcao,
} from './acoes';

const NOME = 'PR #12 de dono/repo';
const base = { alvo: 'dono/repo#12', nome: NOME };
const aprovar: Acao = { ...base, tipo: 'decidir', id: 'd1', decisao: 'approve' };

function clienteQueResponde(resultado: Resultado<RespostaDeAcao>) {
  const post = vi.fn(async () => resultado);
  return { cliente: { post } as unknown as Pick<Cliente, 'post'>, post };
}

describe('rota e corpo de cada ação, como lib/http-server.js espera', () => {
  it.each<[Acao, string, object]>([
    [CHECAR, '/api/check', {}],
    [{ ...base, tipo: 'revisar', url: 'https://github.com/dono/repo/pull/12' }, '/api/review', { urls: ['https://github.com/dono/repo/pull/12'] }],
    [{ ...base, tipo: 'cancelar', id: 'a7' }, '/api/cancel', { id: 'a7' }],
    [aprovar, '/api/decide', { id: 'd1', action: 'approve' }],
    [{ ...base, tipo: 'decidir', id: 'd1', decisao: 'request_changes' }, '/api/decide', { id: 'd1', action: 'request_changes' }],
    [{ ...base, tipo: 'decidir', id: 'd1', decisao: 'comment' }, '/api/decide', { id: 'd1', action: 'comment' }],
    [{ ...base, tipo: 'decidir', id: 'd1', decisao: 'skip' }, '/api/decide', { id: 'd1', action: 'skip' }],
    [{ ...base, tipo: 'ignorar', chave: 'dono/repo#12' }, '/api/ignore', { key: 'dono/repo#12' }],
    [{ ...base, tipo: 'restaurar', chave: 'dono/repo#12' }, '/api/restore', { key: 'dono/repo#12' }],
  ])('%o', (acao, rota, corpo) => {
    expect(pedidoDa(acao)).toEqual({ rota, corpo });
  });
});

describe('rótulo, nome e confirmação', () => {
  it('o nome do botão diz a ação e o alvo', () => {
    expect(rotuloDa(aprovar)).toBe('Aprovar');
    expect(nomeDa(aprovar)).toBe('Aprovar PR #12 de dono/repo');
    expect(nomeDa({ ...base, tipo: 'decidir', id: 'd1', decisao: 'request_changes' })).toBe('Pedir mudanças PR #12 de dono/repo');
    expect(nomeDa(CHECAR)).toBe('Checar agora');
    expect(idDa(aprovar)).toBe('decidir:approve');
    expect(idDa({ ...base, tipo: 'ignorar', chave: 'x' })).toBe('ignorar');
  });

  it('Aprovar e Pedir mudanças pedem confirmação dizendo o que sai e em qual PR', () => {
    const a = confirmacaoDa(aprovar);
    expect(a?.titulo).toBe('Aprovar PR #12 de dono/repo?');
    expect(a?.texto).toMatch(/publica uma aprovação \(APPROVE\) no GitHub, em PR #12 de dono\/repo/);
    const rc = confirmacaoDa({ ...base, tipo: 'decidir', id: 'd1', decisao: 'request_changes' });
    expect(rc?.texto).toMatch(/pedido de mudanças \(REQUEST CHANGES\) no GitHub, em PR #12 de dono\/repo/);
  });

  it('Cancelar a sessão também pergunta; o resto vai direto', () => {
    expect(confirmacaoDa({ ...base, tipo: 'cancelar', id: 'a1' })?.texto).toMatch(/interrompida/);
    expect(confirmacaoDa({ ...base, tipo: 'decidir', id: 'd1', decisao: 'comment' })).toBeNull();
    expect(confirmacaoDa({ ...base, tipo: 'decidir', id: 'd1', decisao: 'skip' })).toBeNull();
    expect(confirmacaoDa({ ...base, tipo: 'ignorar', chave: 'x' })).toBeNull();
    expect(confirmacaoDa(CHECAR)).toBeNull();
  });
});

describe('leitura da resposta', () => {
  it('aceita o aceite e a recusa, com os campos extras do motor ignorados', () => {
    expect(lerRespostaDeAcao({ ok: true, mode: 'auto', duplicados: [] })).toEqual({ ok: true });
    expect(lerRespostaDeAcao({ ok: false, blocked: 'pr_fechado', error: 'x', attempted: false })).toEqual({ ok: false, blocked: 'pr_fechado', error: 'x' });
    expect(lerRespostaDeAcao({ ok: false })).toEqual({ ok: false, blocked: undefined, error: undefined });
  });

  it('recusa o que não tem a forma', () => {
    for (const torto of [null, 'ok', [], {}, { ok: 'true' }, { ok: false, error: 7 }, { ok: false, blocked: {} }]) {
      expect(lerRespostaDeAcao(torto)).toBeNull();
    }
  });
});

describe('mensagem da recusa, pelo código do motor', () => {
  it.each([
    ['stale_head', /commit novo depois da revisão/],
    ['pr_proprio', /própria conta revisora/],
    ['pr_fechado', /mergeado ou fechado/],
    ['instancia_isolada', /instância isolada/],
    ['internal_language', /filtro de linguagem/],
    ['credencial_no_texto', /credencial/],
    ['criterios_inconsistentes', /inconsistentes/],
    ['round_memory', /memória de rodadas/],
    ['invalid_payload', /não pode ser publicado/],
    ['technical_review', /avaliação técnica/],
  ])('%s', (blocked, texto) => {
    expect(mensagemDaRecusa({ blocked, error: 'frase do motor' })).toMatch(texto);
  });

  it('só os códigos que pedem o caso concreto levam a frase do motor junto', () => {
    expect(mensagemDaRecusa({ blocked: 'technical_review', error: 'falta o lint' })).toBe('A avaliação técnica não permite publicar agora. O motor disse: falta o lint');
    expect(mensagemDaRecusa({ blocked: 'pr_fechado', error: 'PR mergeado, então o review não foi postado' })).toBe('O PR já foi mergeado ou fechado: o review não foi publicado.');
    expect(mensagemDaRecusa({ blocked: 'technical_review' })).toBe('A avaliação técnica não permite publicar agora.');
  });

  it('código desconhecido, ou recusa sem código, mostra a frase do motor', () => {
    expect(mensagemDaRecusa({ blocked: 'codigo_novo', error: 'decisão não encontrada (já resolvida?)' })).toBe('O motor recusou: decisão não encontrada (já resolvida?)');
    expect(mensagemDaRecusa({ error: '  sessão não\n encontrada  ' })).toBe('O motor recusou: sessão não encontrada');
    expect(mensagemDaRecusa({ blocked: 'constructor' })).toBe('O motor recusou a ação e não disse o motivo.');
    expect(mensagemDaRecusa({})).toBe('O motor recusou a ação e não disse o motivo.');
  });

  it('frase comprida do motor é cortada', () => {
    const texto = mensagemDaRecusa({ error: 'x'.repeat(2000) });
    expect(texto.length).toBeLessThan(430);
    expect(texto.endsWith('…')).toBe(true);
  });
});

describe('executar', () => {
  it('manda o POST da ação pelo cliente e diz o aceite', async () => {
    const { cliente, post } = clienteQueResponde({ ok: true, dados: { ok: true } });
    expect(await executar(cliente, aprovar)).toEqual({ tipo: 'ok', texto: 'O motor aceitou: aprovar PR #12 de dono/repo.' });
    expect(post).toHaveBeenCalledWith('/api/decide', { id: 'd1', action: 'approve' }, lerRespostaDeAcao);
  });

  it('pular diz que nada foi publicado, e checar não tem alvo', async () => {
    const { cliente } = clienteQueResponde({ ok: true, dados: { ok: true } });
    expect(await executar(cliente, { ...base, tipo: 'decidir', id: 'd1', decisao: 'skip' })).toEqual({ tipo: 'ok', texto: 'O motor aceitou: pular PR #12 de dono/repo. Nada foi publicado.' });
    expect(await executar(cliente, CHECAR)).toEqual({ tipo: 'ok', texto: 'O motor aceitou: checar agora.' });
  });

  it('recusa do motor vira a mensagem do código', async () => {
    const { cliente } = clienteQueResponde({ ok: true, dados: { ok: false, blocked: 'pr_proprio', error: 'x' } });
    expect(await executar(cliente, aprovar)).toEqual({ tipo: 'erro', texto: expect.stringMatching(/própria conta revisora/) });
  });

  it.each<[Resultado<RespostaDeAcao>, RegExp]>([
    [{ ok: false, falha: 'rede', status: 0 }, /falha de rede/],
    [{ ok: false, falha: 'recusado', status: 403 }, /HTTP 403/],
    [{ ok: false, falha: 'resposta_invalida', status: 200 }, /fora do formato/],
    [{ ok: false, falha: 'nao_autenticado', status: 401 }, /Pareie de novo/],
  ])('falha do transporte %o', async (resultado, texto) => {
    const { cliente } = clienteQueResponde(resultado);
    expect(await executar(cliente, aprovar)).toEqual({ tipo: 'erro', texto: expect.stringMatching(texto) });
  });

  it('chamada abortada não vira mensagem', async () => {
    const { cliente } = clienteQueResponde({ ok: false, falha: 'cancelado', status: 0 });
    expect(await executar(cliente, aprovar)).toEqual({ tipo: 'cancelado' });
  });
});
