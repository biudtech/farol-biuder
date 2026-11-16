// As ações da tela Sistema: a rota e o corpo de cada POST, a pergunta antes do envio e a frase
// depois, conferida contra o que o motor respondeu. Sem React. Elas entram na união `Acao` de
// src/radar/acoes.ts, e passam pelo mesmo `executar` e pelo mesmo gancho `useAcoes`.
//
// Cada ação mexe numa seção só: a da conta vai a POST /api/accounts/edit com os campos que a
// pessoa alterou; a da automação vai a POST /api/settings só com as chaves de automação que
// ela alterou; a de sessão vai a POST /api/auth/revoke. Nenhuma ação manda `claudeProfiles`:
// a tela não edita perfil nem teto de gasto.
import type { Objeto } from '@/contratos/formas';
import type { ConfigDoSistema } from '@/contratos/sistema';
import { diferencasDaAutomacao, textoDaAutomacao, type CorpoDaAutomacao } from './automacao';
import { corpoDaConta, nomeDoCampoDaConta, textoDosCampos, type CamposDaConta } from './politica';
import { perguntaDeRevogar } from './sessoes';

interface Base {
  // de quem é a ação na tela: uma ação por alvo de cada vez
  alvo: string;
  // como a tela chama o alvo
  nome: string;
}

export type AcaoDoSistema =
  // Os campos da conta revisora que a pessoa alterou (aplicarEdicao,
  // lib/engine/contas-config.js, na raiz). `ampliacoes` são as mudanças que ampliam o que o
  // motor publica sozinho, já por extenso e calculadas contra o valor atual do motor: havendo
  // alguma, a ação pergunta antes.
  | (Base & { tipo: 'conta'; user: string; campos: CamposDaConta; ampliacoes: readonly string[] })
  // As chaves de automação que a pessoa alterou, e só elas.
  | (Base & { tipo: 'automacao'; corpo: CorpoDaAutomacao; ampliacoes: readonly string[] })
  // Revoga uma sessão pareada pelo `id`. `atual`: é a deste navegador.
  | (Base & { tipo: 'revogarSessao'; id: string; rotulo: string; atual: boolean });

export const TIPOS_DO_SISTEMA = ['conta', 'automacao', 'revogarSessao'] as const;

export function pedidoDoSistema(acao: AcaoDoSistema): { rota: string; corpo: Objeto } {
  switch (acao.tipo) {
    case 'conta': return { rota: '/api/accounts/edit', corpo: corpoDaConta(acao.user, acao.campos) };
    case 'automacao': return { rota: '/api/settings', corpo: { ...acao.corpo } };
    case 'revogarSessao': return { rota: '/api/auth/revoke', corpo: { id: acao.id } };
  }
}

export function rotuloDoSistema(acao: AcaoDoSistema): string {
  switch (acao.tipo) {
    case 'conta': return 'Salvar conta e política';
    case 'automacao': return 'Salvar automação';
    case 'revogarSessao': return 'Revogar';
  }
}

export function nomeDoSistema(acao: AcaoDoSistema): string {
  switch (acao.tipo) {
    case 'conta': return `Salvar conta e política de ${acao.nome}`;
    case 'automacao': return 'Salvar automação';
    case 'revogarSessao': return `Revogar a sessão ${acao.nome}`;
  }
}

export interface PerguntaDoSistema {
  titulo: string;
  texto: string;
  confirmar: string;
}

const REGISTRO_DA_POLITICA = 'O motor registra a mudança de política com a data e a origem.';

// Quando a política nova passa a valer, como o motor a lê (os arquivos são da raiz). Ele
// consulta a política na hora de decidir cada resultado (shouldAutoApprove e shouldAutoReject,
// lib/engine/approval-policy.js; caminhoNovo, lib/engine/desfecho-da-revisao.js), na hora de
// começar cada revisão (politicaDeInicio, lib/engine/review-scope.js) e quando uma espera do
// CI já armada fecha (politicaAindaAprova, lib/engine/espera-ci.js). Ninguém ouve a mudança
// de configuração para reavaliar a mesa: a pendência que foi a "Precisa de você" porque a
// política mandava esperar continua lá.
export const QUANDO_A_POLITICA_VALE = 'Quando passa a valer: o motor lê a política ao começar cada revisão, ao decidir o resultado de cada uma e quando uma espera do CI fecha. Então vale para os PRs da fila a partir da próxima checagem, para as revisões que terminarem daqui em diante e para as aprovações que estão esperando o CI. O que já está em "Precisa de você" não é reavaliado: continua esperando o seu clique.';

// A pergunta antes do POST. A conta e a automação só perguntam quando a mudança AMPLIA o que
// o motor publica sozinho, dizendo o efeito de cada item; a que reduz vai direto. Revogar
// sessão pergunta sempre.
export function confirmacaoDoSistema(acao: AcaoDoSistema): PerguntaDoSistema | null {
  switch (acao.tipo) {
    case 'conta':
      if (!acao.ampliacoes.length) return null;
      return {
        titulo: `Ampliar o que o motor publica sozinho por ${acao.nome}?`,
        texto: `Esta mudança amplia o que o motor faz e publica no GitHub sem clique. ${acao.ampliacoes.join(' ')} ${QUANDO_A_POLITICA_VALE} Toda publicação continua passando pelos gates do motor. ${REGISTRO_DA_POLITICA}`,
        confirmar: 'Salvar e ampliar a publicação automática',
      };
    case 'automacao':
      if (!acao.ampliacoes.length) return null;
      return {
        titulo: 'Desligar o CI antes de aprovar?',
        texto: `Esta mudança amplia o que o motor publica no GitHub sem clique. ${acao.ampliacoes.join(' ')} ${REGISTRO_DA_POLITICA}`,
        confirmar: 'Salvar e desligar a espera do CI',
      };
    case 'revogarSessao': return perguntaDeRevogar({ rotulo: acao.rotulo, atual: acao.atual });
  }
}

// O que o aceite do motor traz, para a conferência (lerRespostaDeAcao, src/radar/acoes.ts).
export interface AceiteDoSistema {
  // as chaves de `config` da resposta de POST /api/settings que a tela lê
  sistema?: ConfigDoSistema;
  // chaves que POST /api/settings não reconheceu
  ignoradas?: string[];
  // campos que POST /api/accounts/edit não aplicou (desconhecido, ou valor fora do domínio)
  ignorados?: string[];
  // POST /api/auth/revoke: a sessão revogada era a de quem pediu
  eraAtual?: boolean;
}

export type DesfechoDoSistema = { tipo: 'ok'; texto: string } | { tipo: 'erro'; texto: string };

const ESTADO_NA_TELA = 'O que ficou gravado aparece nesta tela quando o estado do motor chegar.';

// A rota da conta responde só `{ ok, ignorados }`, sem a conta gravada: a frase diz o que foi
// pedido e o que o motor disse ter ignorado, e manda conferir no estado que chega.
function desfechoDaConta(acao: Extract<AcaoDoSistema, { tipo: 'conta' }>, dados: AceiteDoSistema): DesfechoDoSistema {
  const ignorados = (dados.ignorados ?? []).filter((campo) => Object.hasOwn(acao.campos, campo));
  if (ignorados.length) {
    return { tipo: 'erro', texto: `O motor aceitou o pedido de ${acao.nome}, mas ignorou ${ignorados.map(nomeDoCampoDaConta).join(', ')}: esse valor não foi gravado. ${ESTADO_NA_TELA}` };
  }
  return { tipo: 'ok', texto: `O motor aceitou a mudança em ${acao.nome}: ${textoDosCampos(acao.campos)}. A resposta dele não traz a conta gravada. ${ESTADO_NA_TELA}` };
}

function desfechoDaAutomacao(acao: Extract<AcaoDoSistema, { tipo: 'automacao' }>, dados: AceiteDoSistema): DesfechoDoSistema {
  const ignoradas = (dados.ignoradas ?? []).filter((chave) => Object.hasOwn(acao.corpo, chave));
  if (ignoradas.length) return { tipo: 'erro', texto: `O motor ignorou ${ignoradas.join(', ')}: não foi gravado.` };
  if (!dados.sistema) return { tipo: 'ok', texto: `O motor aceitou o pedido (${textoDaAutomacao(acao.corpo)}), mas a resposta não trouxe a configuração gravada: confira na tela.` };
  const diferencas = diferencasDaAutomacao(acao.corpo, dados.sistema);
  if (diferencas.length) return { tipo: 'erro', texto: `O motor gravou diferente do pedido: ${diferencas.join('; ')}. O que ele não aceita, ele mantém como estava ou ajusta para a faixa.` };
  return { tipo: 'ok', texto: `O motor gravou: ${textoDaAutomacao(acao.corpo)}.` };
}

function desfechoDaRevogacao(acao: Extract<AcaoDoSistema, { tipo: 'revogarSessao' }>, dados: AceiteDoSistema): DesfechoDoSistema {
  if (dados.eraAtual || acao.atual) return { tipo: 'ok', texto: 'O motor revogou a sessão deste navegador. Voltando ao pareamento.' };
  return { tipo: 'ok', texto: `O motor revogou a sessão ${acao.nome}: o token dela não vale mais.` };
}

// O que a tela diz depois de `{ ok: true }`. O `ok` não é o desfecho: a frase sai do que a
// resposta diz que ficou gravado, conferido contra o enviado.
export function desfechoDoSistema(acao: AcaoDoSistema, dados: AceiteDoSistema): DesfechoDoSistema {
  switch (acao.tipo) {
    case 'conta': return desfechoDaConta(acao, dados);
    case 'automacao': return desfechoDaAutomacao(acao, dados);
    case 'revogarSessao': return desfechoDaRevogacao(acao, dados);
  }
}

// Por que a tela não oferece um salvar, ou null quando pode. Todo salvar parte do que esta
// aba tem do motor: sem o estado da conexão atual ele pode estar velho. `emDia`: o primeiro
// estado desta conexão já chegou (`estadoEmDia`, src/estado/app.ts).
export function impedimentoDeSalvar(estado: { conectado: boolean; emDia: boolean }): string | null {
  if (!estado.conectado) return 'Esta aba está sem conexão com o motor: o que ela mostra pode estar velho, e salvar mandaria por cima do que o motor tem. O salvar volta quando a conexão voltar e o estado chegar.';
  if (!estado.emDia) return 'A conexão com o motor acabou de abrir e o estado dele ainda não chegou: o que a tela mostra é de antes da queda. O salvar volta quando o estado chegar.';
  return null;
}
