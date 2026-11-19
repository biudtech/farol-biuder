// O resumo de cada assunto do menu da tela Sistema, sem React: o estado (a bolinha) e a frase
// curta abaixo do nome. Tudo sai do que a tela já recebe do motor e do estado que cada assunto
// já calcula (a saúde pelas verificações, a conta pela presença do token, e assim por diante):
// nada é medido aqui.
import type { ConfigDoSistema, ContaRevisora, Modelos, PerfisDoClaude, Saude, SessoesPareadas, SiteDoJira } from '@/contratos/sistema';
import { automacaoDe, resumoDaAutomacao } from './automacao';
import { resumoDosPadroes } from './padroes';
import { desfechosEmEspera, resumoDaPolitica } from './politica';
import { resumoDasRegras } from './regras';
import { resumoDoRitmo, ritmoDe } from './ritmo';
import { ehGrave, type Verificacao } from './saude';

// ok: verde. aviso: âmbar. ruim: vermelho. neutro: cinza (sem dado, desligado, carregando).
export type TomDaLinha = 'ok' | 'aviso' | 'ruim' | 'neutro';

export interface EstadoDaLinha {
  tom: TomDaLinha;
  resumo: string;
}

// O que a bolinha diz, para o leitor de tela (a bolinha é decorativa).
export const ROTULO_DO_TOM: Record<TomDaLinha, string> = { ok: 'OK', aviso: 'Atenção', ruim: 'Problema', neutro: 'Sem dado ou desligado' };

const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

// `saude`: `undefined` é a chave que não veio, `null` o diagnóstico que ainda não rodou.
export function linhaDaSaude(saude: Saude | null | undefined, verificacoes: readonly Verificacao[]): EstadoDaLinha {
  const graves = verificacoes.filter(ehGrave);
  const atencao = verificacoes.filter((v) => v.estado === 'atencao');
  const primeira = graves[0] ?? atencao[0];
  if (primeira) {
    const resumo = atencao.length > 1 ? `${primeira.nome} e mais ${atencao.length - 1}` : `${primeira.nome}: ${primeira.detalhe}`;
    return { tom: graves.length ? 'ruim' : 'aviso', resumo };
  }
  if (saude === undefined) return { tom: 'neutro', resumo: 'o motor não mandou o diagnóstico' };
  if (saude === null) return { tom: 'neutro', resumo: 'diagnóstico ainda não rodou' };
  return { tom: 'ok', resumo: plural(verificacoes.length, 'verificação OK', 'verificações OK') };
}

export function linhaDaConta(conta: ContaRevisora | undefined): EstadoDaLinha {
  if (!conta) return { tom: 'neutro', resumo: 'o motor não mandou a conta' };
  if (!conta.user) return { tom: 'ruim', resumo: 'sem conta revisora' };
  const quem = `@${conta.user}`;
  if (conta.tokenOk === false) return { tom: 'ruim', resumo: `${quem}, sem token do gh` };
  if (!conta.owners.length) return { tom: 'aviso', resumo: `${quem}, sem organização monitorada` };
  if (conta.limiteGhAte && conta.limiteGhAte > 0) return { tom: 'aviso', resumo: `${quem}, no limite do GitHub` };
  if (conta.limitePlanoAte && conta.limitePlanoAte > 0) return { tom: 'aviso', resumo: `${quem}, no limite do plano do Claude` };
  // Desfecho em espera não posta nada sozinho: o PR fica sem nada postado, e o revisor da
  // tela nunca espera. Pede atenção, e o resumo diz que veio do motor.
  if (conta.autoReview !== false && desfechosEmEspera(conta)) return { tom: 'aviso', resumo: `${quem}, ${resumoDaPolitica(conta)}` };
  return { tom: 'ok', resumo: `${quem}, ${resumoDaPolitica(conta)}` };
}

export function linhaDasRegras(conta: ContaRevisora | undefined): EstadoDaLinha {
  if (!conta) return { tom: 'neutro', resumo: 'o motor não mandou a conta' };
  if (conta.regrasIlegiveis) return { tom: 'aviso', resumo: `${resumoDasRegras(conta.regras)}, ${plural(conta.regrasIlegiveis, 'ilegível', 'ilegíveis')}` };
  return { tom: conta.regras.length ? 'ok' : 'neutro', resumo: resumoDasRegras(conta.regras) };
}

export function linhaDosPadroes(conta: ContaRevisora | undefined): EstadoDaLinha {
  if (!conta) return { tom: 'neutro', resumo: 'o motor não mandou a conta' };
  return { tom: conta.padroes?.trim() ? 'ok' : 'neutro', resumo: resumoDosPadroes(conta.padroes) };
}

export function linhaDoRitmo(config: ConfigDoSistema | undefined): EstadoDaLinha {
  const ritmo = ritmoDe(config);
  if (!ritmo) return { tom: 'neutro', resumo: 'o motor não mandou as chaves' };
  return { tom: 'ok', resumo: resumoDoRitmo(ritmo) };
}

export function linhaDaAutomacao(config: ConfigDoSistema | undefined, modelos: Modelos | undefined): EstadoDaLinha {
  const chaves = automacaoDe(config);
  if (!chaves) return { tom: 'neutro', resumo: 'o motor não mandou as chaves' };
  return { tom: 'ok', resumo: resumoDaAutomacao(chaves, modelos?.claude ?? []) };
}

export function linhaDoPerfil(config: ConfigDoSistema | undefined, perfis: PerfisDoClaude | undefined, saude: Saude | null | undefined): EstadoDaLinha {
  const lista = config?.claudeProfiles;
  if (!lista) return { tom: 'neutro', resumo: 'o motor não mandou os perfis' };
  if (!lista.length) return { tom: 'ruim', resumo: 'nenhum perfil' };
  const padrao = lista.find((p) => p.id === config.claudeProfileId) ?? lista[0];
  const nome = padrao ? padrao.label || padrao.id : '';
  if (saude?.claudePerfilPronto === false) return { tom: 'ruim', resumo: 'o perfil em uso não está pronto' };
  if (perfis?.problemas.length) return { tom: 'aviso', resumo: `${nome}, perfil padrão apontado com problema` };
  if (padrao && perfis?.uso[padrao.id]?.faixaDoLogin === 'vencido') return { tom: 'ruim', resumo: `${nome}, login vencido` };
  if (padrao && perfis?.uso[padrao.id]?.faixaDoLogin) return { tom: 'aviso', resumo: `${nome}, login perto de vencer` };
  if (saude?.claudePerfilPronto === true) return { tom: 'ok', resumo: `${nome}, pronto` };
  return { tom: 'neutro', resumo: plural(lista.length, 'perfil', 'perfis') };
}

function hostDe(endereco: string | undefined): string {
  if (!endereco) return '';
  try {
    return new URL(endereco).host;
  } catch {
    return endereco;
  }
}

export function linhaDoJira(sites: readonly SiteDoJira[] | undefined): EstadoDaLinha {
  if (!sites) return { tom: 'neutro', resumo: 'o motor não mandou os sites' };
  if (!sites.length) return { tom: 'neutro', resumo: 'desligado' };
  const primeiro = sites[0] as SiteDoJira;
  const nome = hostDe(primeiro.baseUrl) || primeiro.label || primeiro.id;
  const resumo = sites.length > 1 ? `${nome} e mais ${sites.length - 1}` : nome;
  const semCredencial = sites.filter((s) => s.hasCredential === false).length;
  if (semCredencial) return { tom: 'aviso', resumo: `${resumo}, ${plural(semCredencial, 'site sem credencial', 'sites sem credencial')}` };
  return { tom: 'ok', resumo };
}

export function linhaDasSessoes(estado: { carregando: boolean; dados: SessoesPareadas | null; erro: string | null }): EstadoDaLinha {
  if (estado.erro && !estado.dados) return { tom: 'aviso', resumo: 'a lista não carregou' };
  if (!estado.dados) return { tom: 'neutro', resumo: 'carregando' };
  const total = estado.dados.sessoes.length;
  if (!total) return { tom: 'neutro', resumo: 'nenhuma' };
  return { tom: 'ok', resumo: plural(total, 'ativa', 'ativas') };
}

export function linhaDaRede(config: ConfigDoSistema | undefined): EstadoDaLinha {
  if (!config) return { tom: 'neutro', resumo: 'o motor não informou' };
  if (config.hostPublico) return { tom: 'ok', resumo: config.hostPublico };
  if (config.bind !== undefined || config.port !== undefined) return { tom: 'ok', resumo: `${config.bind ?? '?'}:${config.port ?? '?'}` };
  return { tom: 'neutro', resumo: 'o motor não informou' };
}

// A frase do topo: quantas linhas pedem atenção (âmbar ou vermelho).
export function fraseDoTopo(estados: readonly EstadoDaLinha[]): string {
  const pontos = estados.filter((e) => e.tom === 'aviso' || e.tom === 'ruim').length;
  if (!pontos) return 'Nenhum ponto pede atenção';
  return pontos === 1 ? '1 ponto pede atenção' : `${pontos} pontos pedem atenção`;
}
