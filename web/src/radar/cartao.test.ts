import { describe, expect, it } from 'vitest';
import type { ProgressoDaRevisao } from '@/contratos/radar';
import {
  SEM_SINAL_MS, andamentoDaFalha, desvioDoRelogio, andamentoDaPostada, andamentoDaSessao, andamentoIniciando, contextoDaPostada, contextoDaSessao,
  etapaDoProgresso, etapasDaFaixa, iniciais, pilulaDosChecks, pilulaDosCriterios, pilulasDaPostada, pilulasDaSessao, tempoDecorrido,
  textoDaFila, tomDaFila, ultimoEvento, urlDoAvatar,
} from './cartao';

const AGORA = Date.UTC(2026, 10, 16, 14, 32);

function progresso(etapa: number, extra: Partial<ProgressoDaRevisao> = {}): ProgressoDaRevisao {
  return { percentual: 50, etapa, totalEtapas: 5, rotuloDaEtapa: 'x', ...extra };
}

describe('o cartão do Radar, sem React', () => {
  it('tempo decorrido como o desenho', () => {
    expect([0, 999, 18000, 220000, 422000, -5, Number.NaN].map(tempoDecorrido)).toEqual(['0 s', '0 s', '18 s', '3 min 40 s', '7 min 02 s', '0 s', '0 s']);
  });

  it('avatar: só login com forma de login vira URL do GitHub; o resto, iniciais', () => {
    expect(urlDoAvatar('thiago-prado')).toBe('https://avatars.githubusercontent.com/thiago-prado?s=72');
    expect(urlDoAvatar('dependabot[bot]')).toBeNull();
    expect(urlDoAvatar('a/../b')).toBeNull();
    expect(urlDoAvatar('')).toBeNull();
    expect(urlDoAvatar(undefined)).toBeNull();
    expect([iniciais('thiago-prado'), iniciais('ana'), iniciais('dependabot[bot]'), iniciais(undefined)]).toEqual(['TP', 'AN', 'DE', '?']);
  });

  it('etapas da faixa: feitas antes, a atual com agora (ou erro na falha), traços verdes até a atual', () => {
    expect(etapasDaFaixa({ tipo: 'rodando', etapa: 2 }).map((e) => [e.estado, e.ligaFeita])).toEqual([
      ['feita', false], ['feita', true], ['agora', true], ['falta', false], ['falta', false],
    ]);
    expect(etapasDaFaixa({ tipo: 'falha', etapa: 1 }).map((e) => e.estado)).toEqual(['feita', 'erro', 'falta', 'falta', 'falta']);
    expect(etapasDaFaixa({ tipo: 'postada', etapa: 5 }).every((e) => e.estado === 'feita')).toBe(true);
  });

  it('a etapa do progresso, de 0 a 4', () => {
    expect([undefined, progresso(1), progresso(3), progresso(5)].map(etapaDoProgresso)).toEqual([0, 0, 2, 4]);
  });

  it('o último evento: a linha mais nova do feed ou o começo', () => {
    expect(ultimoEvento([], 10)).toBe(10);
    expect(ultimoEvento([{ t: 5, k: 'tool', text: '' }, { t: 30, k: 'tool', text: '' }], 10)).toBe(30);
    expect(ultimoEvento([], undefined)).toBeUndefined();
  });

  it('cada etapa diz o que faz; a barra é a porcentagem da revisão inteira, e o típico vai ao lado do tempo', () => {
    const base = { agora: AGORA, outras: 0 };
    expect(andamentoDaSessao({ ...base, etapa: 0, costumaMs: 420000 })).toMatchObject({ texto: 'Buscando o código do PR.', apoio: 'típico 7 min', barra: { tipo: 'indefinida' } });
    expect(andamentoDaSessao({ ...base, etapa: 0, outras: 2 }).texto).toBe('Buscando o código do PR, com 2 outras revisões em andamento.');
    expect(andamentoDaSessao({ ...base, etapa: 1 }).texto).toBe('Lendo o card no Jira.');
    expect(andamentoDaSessao({ ...base, etapa: 2, progresso: progresso(3, { percentual: 57.6, arquivosLidos: 1, arquivosTotais: 3, arquivoAtual: 'src/a.ts', restanteEstimadoMs: 180000 }) })).toMatchObject({
      texto: 'Lendo o código: 1 de 3 arquivos', arquivo: 'src/a.ts', apoio: '',
      barra: { tipo: 'definida', pct: 58, texto: 'da revisão inteira · termina em cerca de 3 min' },
    });
    expect(andamentoDaSessao({ ...base, etapa: 2, progresso: progresso(3) })).toMatchObject({ texto: 'Lendo o código do PR.', barra: { tipo: 'definida', pct: 50, texto: 'da revisão inteira' } });
    expect(andamentoDaSessao({ ...base, etapa: 3, progresso: progresso(4, { restanteEstimadoMs: 20000 }) }).barra).toMatchObject({ texto: 'da revisão inteira · termina em menos de 1 min' });
    expect(andamentoDaSessao({ ...base, etapa: 4 })).toMatchObject({ texto: 'Postando a revisão no GitHub.', apoio: '' });
    expect(andamentoDaSessao({ ...base, etapa: 4, conta: 'rev' }).apoio).toBe('pela conta @rev');
    expect(andamentoIniciando()).toMatchObject({ tipo: 'iniciando', etapa: 0, texto: 'Iniciando a revisão.', barra: { tipo: 'indefinida' } });
  });

  it('sem sinal: mais de 45 s sem evento no código ou na conferência, nunca nas outras etapas', () => {
    const calado = { agora: AGORA, outras: 0, ultimoEvento: AGORA - SEM_SINAL_MS - 1 };
    expect(andamentoDaSessao({ ...calado, etapa: 2 })).toMatchObject({ tipo: 'mudo', tom: 'aviso', texto: 'Sem sinal do modelo há 45 s. A sessão segue aberta.' });
    expect(andamentoDaSessao({ ...calado, etapa: 3 }).tipo).toBe('mudo');
    for (const etapa of [0, 1, 4]) expect(andamentoDaSessao({ ...calado, etapa }).tipo).toBe('rodando');
    expect(andamentoDaSessao({ ...calado, etapa: 2, ultimoEvento: AGORA - SEM_SINAL_MS }).tipo).toBe('rodando');
    expect(andamentoDaSessao({ agora: AGORA, outras: 0, etapa: 2 }).tipo).toBe('rodando');
  });

  it('a falha e a postada', () => {
    expect(andamentoDaFalha(7, 'limite.')).toMatchObject({ etapa: 4, texto: 'A sessão terminou sem resultado: limite.', apoio: 'nada foi publicado', barra: null });
    expect(andamentoDaPostada('approve', undefined)).toMatchObject({ etapa: 5, tom: 'ok', texto: 'Revisão postada: aprovada.', apoio: '', barra: null });
    expect(andamentoDaPostada('comment', undefined).tom).toBe('aviso');
    expect(andamentoDaPostada('request_changes', undefined).tom).toBe('falha');
  });

  it('a pílula do card na sessão: pela etapa, e o card lido pela chave que o motor grava', () => {
    expect(pilulasDaSessao(0)[1]?.texto).toBe('Ainda não lido');
    expect(pilulasDaSessao(1, 'BT-1')[1]?.texto).toBe('Lendo os critérios');
    expect(pilulasDaSessao(2, 'BT-1')[1]).toMatchObject({ tom: 'ok', icone: '✓', texto: 'BT-1 lido' });
    expect(pilulasDaSessao(2)[1]).toMatchObject({ tom: 'neutro', texto: 'Nenhum card lido' });
  });

  it('pílulas sem dado: o traço neutro, com o texto do que falta', () => {
    for (const p of pilulasDaSessao(0)) expect([p.icone, p.tom]).toEqual(['\u2013', 'neutro']);
    expect(pilulasDaPostada(undefined, undefined, undefined, false).map((p) => [p.icone, p.texto])).toEqual([
      ['\u2013', 'Sem leitura gravada'], ['\u2013', 'Sem card'], ['\u2013', 'Nada foi publicado'],
    ]);
    expect(pilulasDaPostada('approve', undefined, undefined, true).map((p) => p.texto)).toEqual(['Carregando', 'Carregando', 'Aprovado']);
  });

  it('pílula dos checks pelo que o motor leu', () => {
    const checks = { conferidoNoHead: true, semExigencia: false, naoVerdes: [], herdados: [] };
    expect(pilulaDosChecks(checks, '')).toMatchObject({ tom: 'ok', icone: '✓', texto: 'Verdes' });
    expect(pilulaDosChecks({ ...checks, naoVerdes: [{ nome: 'ci', estado: 'vermelho' }] }, '')).toMatchObject({ tom: 'falha', icone: '✕', texto: '1 fora do verde' });
    expect(pilulaDosChecks({ ...checks, conferidoNoHead: false }, '').tom).toBe('neutro');
    expect(pilulaDosChecks({ ...checks, semExigencia: true }, '').texto).toBe('A base não exige check');
    const tres = [{ nome: 'a', estado: '' }, { nome: 'b', estado: '' }, { nome: 'c', estado: '' }];
    expect(pilulaDosChecks({ ...checks, herdados: tres }, '').texto).toBe('Verdes · a, b e mais 1 herdados da base');
  });

  it('pílula do card pelos critérios', () => {
    expect(pilulaDosCriterios([{ texto: 'a', atende: true }], undefined, '')).toMatchObject({ tom: 'ok', texto: '1 de 1 critério atendido' });
    expect(pilulaDosCriterios([{ texto: 'a', atende: true }, { texto: 'b', atende: null }], undefined, '')).toMatchObject({ tom: 'aviso', icone: '!' });
  });

  it('linhas de contexto: só o que existe', () => {
    expect(contextoDaSessao({}, 'UTC')).toBe('');
    expect(contextoDaSessao({ startedAt: AGORA }, 'UTC')).toBe('começou às 14:32');
    expect(contextoDaSessao({ arquivosPr: 1, pedido: { por: 'ana', em: '2026-11-16T14:03:00Z' }, startedAt: AGORA }, 'UTC')).toBe('1 arquivo · pedido por @ana às 14:03');
    expect(contextoDaSessao({ startedAt: AGORA }, 'UTC', 'biud-2')).toBe('começou às 14:32 · Claude: biud-2');
    expect(contextoDaPostada({}, undefined, 'UTC')).toBe('');
    expect(contextoDaPostada({ card: 'BT-1', resolvedAt: AGORA }, undefined, 'UTC')).toBe('card BT-1 · postado às 14:32');
  });

  it('o desvio do relógio: navegador menos motor, arredondado ao segundo', () => {
    expect(desvioDoRelogio(AGORA - 60000, AGORA)).toBe(60000);
    expect(desvioDoRelogio(AGORA + 60000, AGORA)).toBe(-60000);
    expect(desvioDoRelogio(AGORA - 400, AGORA)).toBe(0);
    expect(desvioDoRelogio(AGORA - 17600, AGORA)).toBe(18000);
    expect(andamentoDaSessao({ etapa: 2, agora: AGORA - desvioDoRelogio(AGORA - 60000, AGORA), outras: 0, ultimoEvento: AGORA - 70000 }).tipo).toBe('rodando');
  });

  it('o rodapé da fila', () => {
    expect(textoDaFila(1, {})).toBe('1º na fila: começa quando abrir uma vaga.');
    expect(textoDaFila(2, { parada: 'Parada.' })).toBe('Parada.');
    expect(textoDaFila(3, { conflito: true })).toBe('3º na fila, em conflito com a base: volta sozinho quando o conflito for resolvido. Revisar agora não espera.');
    expect(textoDaFila(1, { retentativa: { tentativas: 2, aPartirDe: AGORA } }, 'UTC')).toBe('1º na fila, esperando o limite do plano: tenta de novo a partir de 16/11, 14:32.');
    expect(textoDaFila(1, { retentativa: { tentativas: 2, aPartirDe: null } })).toBe('1º na fila: nova tentativa automática (2ª) quando abrir uma vaga.');
  });

  it('a cor do ponto da fila diz o mesmo que o texto', () => {
    expect(tomDaFila({})).toBe('ok');
    expect(tomDaFila({ conflito: true })).toBe('aviso');
    expect(tomDaFila({ retentativa: { tentativas: 1, aPartirDe: null } })).toBe('aviso');
    expect(tomDaFila({ manual: true })).toBe('aviso');
    expect(tomDaFila({ parada: 'x' })).toBe('falha');
  });
});
