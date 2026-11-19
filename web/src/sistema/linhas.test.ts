import { describe, expect, it } from 'vitest';
import type { ContaRevisora, Saude } from '@/contratos/sistema';
import {
  fraseDoTopo, linhaDaAutomacao, linhaDaConta, linhaDaRede, linhaDaSaude, linhaDasSessoes, linhaDoJira, linhaDoPerfil, type EstadoDaLinha,
} from './linhas';
import type { Verificacao } from './saude';

const CONTA: ContaRevisora = { user: 'farol-bot', owners: ['biudtech'], tokenOk: true, autoReview: true, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes', regrasDeReview: 0, regras: [], regrasIlegiveis: 0 };
const ok = (nome: string): Verificacao => ({ nome, estado: 'ok', detalhe: 'certo' });
const SAUDE = { claudeAuth: [], claudePerfilPronto: true } as unknown as Saude;

describe('a linha da saúde', () => {
  it('verde com tudo certo, âmbar com atenção, vermelho com o que para a revisão', () => {
    expect(linhaDaSaude(SAUDE, [ok('Node'), ok('Claude Code')])).toEqual({ tom: 'ok', resumo: '2 verificações OK' });
    expect(linhaDaSaude(SAUDE, [ok('Node'), { nome: 'Versão do Claude Code', estado: 'atencao', detalhe: 'atrasada' }])).toEqual({ tom: 'aviso', resumo: 'Versão do Claude Code: atrasada' });
    const comGrave = linhaDaSaude(SAUDE, [{ nome: 'Versão do Claude Code', estado: 'atencao', detalhe: 'x' }, { nome: 'Autenticação do GitHub', estado: 'atencao', detalhe: 'sem autenticação' }]);
    expect(comGrave).toEqual({ tom: 'ruim', resumo: 'Autenticação do GitHub e mais 1' });
  });

  it('cinza sem diagnóstico', () => {
    expect(linhaDaSaude(undefined, []).tom).toBe('neutro');
    expect(linhaDaSaude(null, [ok('Monitoramento da conta')])).toEqual({ tom: 'neutro', resumo: 'diagnóstico ainda não rodou' });
  });
});

describe('a linha da conta', () => {
  it('diz a conta e a política, e o que falta', () => {
    expect(linhaDaConta(CONTA)).toEqual({ tom: 'ok', resumo: '@farol-bot, publica sozinho' });
    // desfecho em espera não posta sozinho: pede atenção, e o resumo diz que veio do motor
    expect(linhaDaConta({ ...CONTA, onReject: 'wait' })).toEqual({ tom: 'aviso', resumo: '@farol-bot, 1 desfecho espera, definido no motor' });
    expect(fraseDoTopo([linhaDaConta({ ...CONTA, onClean: 'wait', onCaveats: 'wait' })])).toBe('1 ponto pede atenção');
    expect(linhaDaConta({ ...CONTA, onClean: 'wait', onCaveats: 'wait' }).resumo).toBe('@farol-bot, 2 desfechos esperam, definido no motor');
    expect(linhaDaConta(undefined).tom).toBe('neutro');
    expect(linhaDaConta({ ...CONTA, user: '' })).toEqual({ tom: 'ruim', resumo: 'sem conta revisora' });
    expect(linhaDaConta({ ...CONTA, tokenOk: false }).tom).toBe('ruim');
    expect(linhaDaConta({ ...CONTA, owners: [] }).tom).toBe('aviso');
    expect(linhaDaConta({ ...CONTA, limiteGhAte: 5 }).tom).toBe('aviso');
  });
});

describe('as outras linhas', () => {
  it('automação: as três chaves, ou cinza sem elas', () => {
    expect(linhaDaAutomacao({ parallelReviews: 2, reviewModel: 'opus', reviewEffort: '' }, { claude: [{ valor: 'opus', rotulo: 'Opus' }] } as never)).toEqual({ tom: 'ok', resumo: '2 ao mesmo tempo, Opus' });
    expect(linhaDaAutomacao({ parallelReviews: 2 }, undefined)).toEqual({ tom: 'neutro', resumo: 'o motor não mandou as chaves' });
  });

  it('perfil do Claude: nenhum é problema; perfil em uso pronto é verde', () => {
    expect(linhaDoPerfil({ claudeProfiles: [] }, undefined, undefined)).toEqual({ tom: 'ruim', resumo: 'nenhum perfil' });
    expect(linhaDoPerfil({ claudeProfiles: [{ id: 'p', label: 'Plano' }], claudeProfileId: 'p' }, { problemas: [], uso: {} }, SAUDE)).toEqual({ tom: 'ok', resumo: 'Plano, pronto' });
    expect(linhaDoPerfil({ claudeProfiles: [{ id: 'p' }] }, undefined, { ...SAUDE, claudePerfilPronto: false }).tom).toBe('ruim');
    expect(linhaDoPerfil(undefined, undefined, undefined).tom).toBe('neutro');
  });

  it('Jira: o endereço do site, desligado sem site, âmbar sem credencial', () => {
    expect(linhaDoJira([{ id: 'b', baseUrl: 'https://biud.atlassian.net', owners: [], projectKeys: [], hasCredential: true }])).toEqual({ tom: 'ok', resumo: 'biud.atlassian.net' });
    expect(linhaDoJira([])).toEqual({ tom: 'neutro', resumo: 'desligado' });
    expect(linhaDoJira([{ id: 'b', owners: [], projectKeys: [], hasCredential: false }]).tom).toBe('aviso');
  });

  it('sessões: carregando, vazia, ativas e lista que não carregou', () => {
    expect(linhaDasSessoes({ carregando: true, dados: null, erro: null })).toEqual({ tom: 'neutro', resumo: 'carregando' });
    expect(linhaDasSessoes({ carregando: false, dados: { sessoes: [], descartadas: 0 }, erro: null })).toEqual({ tom: 'neutro', resumo: 'nenhuma' });
    expect(linhaDasSessoes({ carregando: false, dados: { sessoes: [{ id: 'a', rotulo: '', criadoEm: 0, ultimoUsoEm: 0, atual: true }], descartadas: 0 }, erro: null })).toEqual({ tom: 'ok', resumo: '1 ativa' });
    expect(linhaDasSessoes({ carregando: false, dados: null, erro: 'falha' }).tom).toBe('aviso');
  });

  it('rede: o nome público, ou o endereço e a porta', () => {
    expect(linhaDaRede({ hostPublico: 'farol.exemplo.com', bind: '127.0.0.1', port: 1 }).resumo).toBe('farol.exemplo.com');
    expect(linhaDaRede({ bind: '127.0.0.1', port: 47170 }).resumo).toBe('127.0.0.1:47170');
    expect(linhaDaRede(undefined).tom).toBe('neutro');
  });
});

describe('a frase do topo', () => {
  const de = (...tons: EstadoDaLinha['tom'][]): EstadoDaLinha[] => tons.map((tom) => ({ tom, resumo: '' }));
  it('conta só âmbar e vermelho', () => {
    expect(fraseDoTopo(de('ok', 'neutro'))).toBe('Nenhum ponto pede atenção');
    expect(fraseDoTopo(de('ok', 'aviso', 'neutro'))).toBe('1 ponto pede atenção');
    expect(fraseDoTopo(de('ruim', 'aviso', 'ok'))).toBe('2 pontos pedem atenção');
  });
});
