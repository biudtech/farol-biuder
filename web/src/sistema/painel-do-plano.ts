// O painel do assunto Claude: de cada perfil, na ordem de uso, a cota do plano, a validade do
// login e a posição, sem clique. Sem React. Pedido do dono de 21/11/2026: "sinto falta da tela
// onde mostra a cota da assinatura, quando vamos ter que renovar a credencial e ordem de
// consumo" (os três dados existiam, mas dentro de cada perfil fechado).
//
// A tela não calcula nada: a fração de cada janela, a hora da volta, a validade e a faixa do
// aviso são as que o motor leu (usoParaTela, lib/engine/uso-do-plano.js), e a ordem é a do motor
// (ordemDeUso, ./perfis.ts).
//
// A validade vem do campo `credential_expires_at` do `/usage` do Claude Code. Medido em
// 21/11/2026: a versão 2.1.310 responde as janelas sem esse campo, e a 2.1.325 o manda. Por isso
// "uso lido e sem validade" não é "ainda não leu": o Claude Code do motor respondeu sem ela, e
// a tela diz isso em vez de prometer uma leitura que não vem.
import type { Tom } from '@/componentes/ui';
import type { ConfigDoSistema, LimiteDoPerfil, PerfisDoClaude, UsoDoPlano } from '@/contratos/sistema';
import { dataHora } from '@/radar/formato';
import { idDoPadrao, nomeDoPerfil, ordemDeUso } from './perfis';

export interface JanelaDoPainel {
  nome: string;
  // de 0 a 100, ou null quando o motor não mandou a fração
  pct: number | null;
  volta?: string;
}

export interface ValidadeDoPainel {
  // o selo curto (o chip não quebra linha) e a frase inteira, que vai em texto comum
  selo: string;
  texto: string;
  tom: Tom;
}

export interface LinhaDoPainel {
  id: string;
  posicao: number;
  nome: string;
  padrao: boolean;
  deChave: boolean;
  janelas: JanelaDoPainel[];
  // por que não há janela, quando não há
  semJanela?: string;
  desatualizado: boolean;
  validade: ValidadeDoPainel;
  // quando o perfil volta, se ele está no limite do plano: a frase já diz se a hora é estimada
  noLimite?: string;
}

export const SEM_VALIDADE_NO_CLI = 'O Claude Code do motor respondeu o uso sem a validade deste login. Versões antigas não informam: confira a versão instalada no motor.';
export const VALIDADE_SEM_LEITURA = 'A validade não veio: a leitura do uso do plano falhou. Se o motivo for falta de login, refaça o login.';
export const VALIDADE_NAO_LIDA = 'O motor ainda não leu a validade deste login.';

// A frase da validade do login de um perfil de assinatura, com o tom do selo.
export function validadeDoLogin(uso: UsoDoPlano | undefined, fuso?: string): ValidadeDoPainel {
  if (uso?.venceEm) {
    const quando = dataHora(uso.venceEm, fuso) || 'data não informada';
    if (uso.faixaDoLogin === 'vencido') return { selo: 'Vencido', texto: `Vencido em ${quando}: o login precisa ser refeito.`, tom: 'ruim' };
    if (uso.faixaDoLogin) return { selo: 'Vence logo', texto: `Vence em ${quando}: refaça o login antes disso.`, tom: 'aviso' };
    return { selo: 'Vale', texto: `Vale até ${quando}.`, tom: 'ok' };
  }
  // a leitura falhou (sem login na pasta, CLI que não respondeu): esperar não traz a validade
  if (uso?.lido && uso.ok === false) return { selo: 'Leitura falhou', texto: VALIDADE_SEM_LEITURA, tom: 'aviso' };
  // o CLI respondeu as janelas e não mandou a validade: esperar também não resolve
  if (uso?.lido) return { selo: 'Sem validade', texto: SEM_VALIDADE_NO_CLI, tom: 'aviso' };
  return { selo: 'Não lida', texto: VALIDADE_NAO_LIDA, tom: 'neutro' };
}

function janelasDoUso(uso: UsoDoPlano | undefined): JanelaDoPainel[] {
  if (!uso?.lido || uso.ok === false) return [];
  return uso.janelas.map((j) => {
    const valido = j.usado !== undefined && Number.isFinite(j.usado) && j.usado >= 0;
    const janela: JanelaDoPainel = { nome: j.nome ?? 'Janela', pct: valido ? Math.min(100, Math.round((j.usado as number) * 100)) : null };
    if (j.resetTexto) janela.volta = j.resetTexto;
    return janela;
  });
}

function motivoSemJanela(deChave: boolean, uso: UsoDoPlano | undefined): string {
  if (deChave) return 'Chave de API: não tem janela de plano.';
  if (uso?.lido && uso.ok === false) return `O motor não conseguiu ler o uso do plano${uso.erro ? `: ${uso.erro}` : ''}.`;
  if (uso?.lido) return 'O Claude Code não devolveu nenhuma janela do plano.';
  return 'O motor ainda não leu o uso do plano deste perfil.';
}

const proprio = <T>(mapa: Record<string, T> | undefined, id: string): T | undefined => (mapa && Object.hasOwn(mapa, id) ? mapa[id] : undefined);

export function linhasDoPainel(config: ConfigDoSistema | undefined, perfis: PerfisDoClaude | undefined, fuso?: string): LinhaDoPainel[] {
  const padrao = idDoPadrao(config);
  return ordemDeUso(config).map((perfil, i) => {
    const deChave = perfil.kind === 'apikey';
    const uso = proprio<UsoDoPlano>(perfis?.uso, perfil.id);
    const limite = proprio<LimiteDoPerfil>(perfis?.limites, perfil.id);
    const janelas = janelasDoUso(uso);
    const linha: LinhaDoPainel = {
      id: perfil.id,
      posicao: i + 1,
      nome: nomeDoPerfil(perfil),
      padrao: padrao === perfil.id,
      deChave,
      janelas,
      desatualizado: uso?.desatualizado === true,
      validade: deChave ? { selo: 'Chave de API', texto: 'Não tem login para renovar.', tom: 'neutro' } : validadeDoLogin(uso, fuso),
    };
    if (!janelas.length) linha.semJanela = motivoSemJanela(deChave, uso);
    if (limite) linha.noLimite = `volta em ${dataHora(limite.ate, fuso) || 'hora não informada'}${limite.estimado ? ' (hora estimada)' : ''}`;
    return linha;
  });
}
