// As ações da tela Sistema: a rota e o corpo de cada POST, a pergunta antes do envio e a frase
// depois, conferida contra o que o motor respondeu. Sem React. Elas entram na união `Acao` de
// src/radar/acoes.ts, e passam pelo mesmo `executar` e pelo mesmo gancho `useAcoes`.
//
// Cada ação mexe numa coisa só:
// - a conta vai a POST /api/accounts/edit com os campos da política que a pessoa alterou; os
//   padrões do time, pela mesma rota, só com `padroesRevisao`; uma regra por organização ou
//   autor, pela mesma rota, com a operação pontual `regra-review`;
// - a automação (modelo, esforço, paralelo, modo rápido) e o ritmo (intervalo, retomada,
//   contestação) vão a POST /api/settings, cada um só com as chaves que a pessoa alterou;
// - Subir na ordem vai a POST /api/settings com o padrão e a lista de perfis remontada sem
//   segredo (src/sistema/perfis.ts, o único lugar que monta `claudeProfiles`);
// - Sair e Revogar vão a POST /api/auth/revoke.
// Nada daqui leva segredo: a credencial do Jira e o código do login da assinatura vão por
// chamada própria dos componentes, que não guardam o valor (CredencialDoJira.tsx, LoginWeb.tsx).
import type { Objeto } from '@/contratos/formas';
import type { ConfigDoSistema, ModoDaRegra } from '@/contratos/sistema';
import { diferencasDaAutomacao, textoDaAutomacao, type CorpoDaAutomacao } from './automacao';
import { textoDosPadroes } from './padroes';
import { diferencaDaOrdem, type CorpoDaOrdem } from './perfis';
import { corpoDaConta, nomeDoCampoDaConta, textoDosCampos, type CamposDaConta } from './politica';
import { EFEITO_DO_MODO, ROTULO_DO_MODO, corpoDaRegra } from './regras';
import { diferencasDoRitmo, textoDoRitmo, type CorpoDoRitmo } from './ritmo';
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
  // Os padrões do time da conta: o texto inteiro, que troca o anterior; vazio tira o campo.
  | (Base & { tipo: 'padroes'; user: string; texto: string })
  // Uma regra de review por organização, ou por autor dentro dela (editarRegra,
  // lib/engine/review-scope.js). `inherit` tira a regra.
  | (Base & { tipo: 'regra'; user: string; organizacao: string; autor?: string; modo: ModoDaRegra | 'inherit' })
  // As chaves de automação que a pessoa alterou, e só elas. Nenhuma amplia o que o motor
  // publica: a espera do CI, cuja mudança ampliava, saiu da tela.
  | (Base & { tipo: 'automacao'; corpo: CorpoDaAutomacao })
  // As chaves do ritmo que a pessoa alterou. Nenhuma muda o que o motor publica.
  | (Base & { tipo: 'ritmo'; corpo: CorpoDoRitmo })
  // A ordem de uso dos perfis do Claude, com o perfil `perfil` (o id) um lugar acima.
  | (Base & { tipo: 'ordemDosPerfis'; perfil: string; corpo: CorpoDaOrdem })
  // Encerra (revoga) uma sessão pareada pelo `id`. `atual`: é a deste navegador (o Sair).
  | (Base & { tipo: 'revogarSessao'; id: string; rotulo: string; atual: boolean });

export const TIPOS_DO_SISTEMA = ['conta', 'padroes', 'regra', 'automacao', 'ritmo', 'ordemDosPerfis', 'revogarSessao'] as const;

export function pedidoDoSistema(acao: AcaoDoSistema): { rota: string; corpo: Objeto } {
  switch (acao.tipo) {
    case 'conta': return { rota: '/api/accounts/edit', corpo: corpoDaConta(acao.user, acao.campos) };
    case 'padroes': return { rota: '/api/accounts/edit', corpo: { tipo: 'editar', user: acao.user, campos: { padroesRevisao: acao.texto } } };
    case 'regra': return { rota: '/api/accounts/edit', corpo: { ...corpoDaRegra(acao.user, acao.organizacao, acao.autor, acao.modo) } };
    case 'automacao': return { rota: '/api/settings', corpo: { ...acao.corpo } };
    case 'ritmo': return { rota: '/api/settings', corpo: { ...acao.corpo } };
    case 'ordemDosPerfis': return { rota: '/api/settings', corpo: { ...acao.corpo } };
    case 'revogarSessao': return { rota: '/api/auth/revoke', corpo: { id: acao.id } };
  }
}

function rotuloDaRegra(acao: Extract<AcaoDoSistema, { tipo: 'regra' }>): string {
  if (acao.modo === 'inherit') return 'Remover';
  return `Salvar: ${ROTULO_DO_MODO[acao.modo].toLowerCase()}`;
}

export function rotuloDoSistema(acao: AcaoDoSistema): string {
  switch (acao.tipo) {
    case 'conta': return 'Salvar conta e política';
    case 'padroes': return 'Salvar padrões';
    case 'regra': return rotuloDaRegra(acao);
    case 'automacao': return 'Salvar automação';
    case 'ritmo': return 'Salvar ritmo';
    case 'ordemDosPerfis': return 'Subir na ordem';
    case 'revogarSessao': return acao.atual ? 'Sair' : 'Revogar';
  }
}

export function nomeDoSistema(acao: AcaoDoSistema): string {
  switch (acao.tipo) {
    case 'conta': return `Salvar conta e política de ${acao.nome}`;
    case 'padroes': return `Salvar os padrões do time de ${acao.nome}`;
    case 'regra': return acao.modo === 'inherit' ? `Remover a regra de ${acao.nome}` : `Salvar a regra de ${acao.nome}: ${ROTULO_DO_MODO[acao.modo].toLowerCase()}`;
    case 'automacao': return 'Salvar automação';
    case 'ritmo': return 'Salvar o ritmo da revisão';
    case 'ordemDosPerfis': return `Subir ${acao.nome} na ordem de uso`;
    case 'revogarSessao': return acao.atual ? 'Sair deste navegador' : `Revogar a sessão ${acao.nome}`;
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
// de configuração para reavaliar o que já foi decidido: o PR que a política anterior deixou
// esperando continua esperando no motor, e esta tela não tem decisão sobre ele.
export const QUANDO_A_POLITICA_VALE = 'Quando passa a valer: o motor lê a política ao começar cada revisão, ao decidir o resultado de cada uma e quando uma espera do CI fecha. Então vale para os PRs da fila a partir da próxima checagem e para as revisões que terminarem daqui em diante. O PR que a política anterior deixou esperando não é reavaliado: continua esperando no motor, e esta tela não tem decisão sobre ele.';

// A regra que revisa sozinho amplia o que o motor publica; tirar uma regra devolve o alvo à
// política da conta, que pode ser mais ampla ou mais estreita: as duas perguntam. A que põe
// no clique só reduz e vai direto.
function perguntaDaRegra(acao: Extract<AcaoDoSistema, { tipo: 'regra' }>): PerguntaDoSistema | null {
  if (acao.modo === 'manual') return null;
  if (acao.modo === 'auto') {
    return {
      titulo: `Revisar sozinho ${acao.nome}?`,
      texto: `${EFEITO_DO_MODO.auto} Toda publicação continua passando pelos gates do motor. A regra vale a partir da próxima checagem. ${REGISTRO_DA_POLITICA}`,
      confirmar: 'Salvar e revisar sozinho',
    };
  }
  return {
    titulo: `Remover a regra de ${acao.nome}?`,
    texto: `Sem a regra, ${acao.nome} volta a seguir ${acao.autor ? 'a regra da organização, se houver, ou ' : ''}a revisão automática da conta: se ela estiver ligada, o motor passa a revisar e publicar sozinho. A mudança vale a partir da próxima checagem. ${REGISTRO_DA_POLITICA}`,
    confirmar: 'Remover a regra',
  };
}

// Os padrões vazios apagam todos: pergunta antes.
function perguntaDosPadroes(acao: Extract<AcaoDoSistema, { tipo: 'padroes' }>): PerguntaDoSistema | null {
  if (acao.texto.trim()) return null;
  return {
    titulo: `Apagar todos os padrões do time de ${acao.nome}?`,
    texto: 'O campo está vazio: salvar apaga todos os padrões do time no motor, e a revisão segue sem eles a partir da próxima que começar. Não dá para desfazer: para voltar, é preciso escrever os padrões de novo.',
    confirmar: 'Apagar os padrões',
  };
}

// O perfil que vai para o topo passa a ser o primeiro que o motor usa. Sendo de chave de API,
// as revisões saem da assinatura e vão para a API paga, cobrada por uso.
function perguntaDaOrdem(acao: Extract<AcaoDoSistema, { tipo: 'ordemDosPerfis' }>): PerguntaDoSistema | null {
  const topo = acao.corpo.claudeProfiles[0];
  if (!topo || topo.id !== acao.perfil || topo.kind !== 'apikey') return null;
  return {
    titulo: `Pôr ${acao.nome} no topo da ordem de uso?`,
    texto: `${acao.nome} é um perfil de chave de API. No topo, ele é o primeiro que o motor usa: as revisões passam a gastar na API paga, cobrada por uso, e não mais na assinatura. Vale a partir da próxima sessão de revisão. Para voltar, suba um perfil de assinatura.`,
    confirmar: 'Subir e usar a API paga',
  };
}

// A pergunta antes do POST. A conta só pergunta quando a mudança AMPLIA o que o motor publica
// sozinho, dizendo o efeito de cada item; a que reduz vai direto. Os padrões vazios (apagam
// todos) e o perfil de chave de API que vai para o topo (as revisões passam a gastar na API
// paga) perguntam; o resto das preferências não. Sair e Revogar perguntam sempre.
export function confirmacaoDoSistema(acao: AcaoDoSistema): PerguntaDoSistema | null {
  switch (acao.tipo) {
    case 'conta':
      if (!acao.ampliacoes.length) return null;
      return {
        titulo: `Ampliar o que o motor publica sozinho por ${acao.nome}?`,
        texto: `Esta mudança amplia o que o motor faz e publica no GitHub sem clique. ${acao.ampliacoes.join(' ')} ${QUANDO_A_POLITICA_VALE} Toda publicação continua passando pelos gates do motor. ${REGISTRO_DA_POLITICA}`,
        confirmar: 'Salvar e ampliar a publicação automática',
      };
    case 'regra': return perguntaDaRegra(acao);
    case 'padroes': return perguntaDosPadroes(acao);
    case 'ordemDosPerfis': return perguntaDaOrdem(acao);
    case 'automacao':
    case 'ritmo':
      return null;
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

// `encerrouEstaSessao`: a revogação derrubou a sessão deste navegador, e a tela vai ao pareamento.
export type DesfechoDoSistema = { tipo: 'ok'; texto: string; encerrouEstaSessao?: true } | { tipo: 'erro'; texto: string };

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

function desfechoDosPadroes(acao: Extract<AcaoDoSistema, { tipo: 'padroes' }>, dados: AceiteDoSistema): DesfechoDoSistema {
  if (dados.ignorados?.includes('padroesRevisao')) return { tipo: 'erro', texto: `O motor ignorou os padrões do time: o texto não foi gravado. ${ESTADO_NA_TELA}` };
  return { tipo: 'ok', texto: `O motor aceitou: ${textoDosPadroes(acao.texto)}. Vale para as revisões que começarem daqui em diante. ${ESTADO_NA_TELA}` };
}

function desfechoDaRegra(acao: Extract<AcaoDoSistema, { tipo: 'regra' }>): DesfechoDoSistema {
  const feito = acao.modo === 'inherit' ? `tirou a regra de ${acao.nome}` : `gravou a regra de ${acao.nome}: ${ROTULO_DO_MODO[acao.modo].toLowerCase()}`;
  return { tipo: 'ok', texto: `O motor ${feito}. Vale a partir da próxima checagem. ${ESTADO_NA_TELA}` };
}

function desfechoDeSettings(corpo: Objeto, dados: AceiteDoSistema, texto: string, diferencas: (gravado: ConfigDoSistema) => string[]): DesfechoDoSistema {
  const ignoradas = (dados.ignoradas ?? []).filter((chave) => Object.hasOwn(corpo, chave));
  if (ignoradas.length) return { tipo: 'erro', texto: `O motor ignorou ${ignoradas.join(', ')}: não foi gravado.` };
  if (!dados.sistema) return { tipo: 'ok', texto: `O motor aceitou o pedido (${texto}), mas a resposta não trouxe a configuração gravada: confira na tela.` };
  const lista = diferencas(dados.sistema);
  if (lista.length) return { tipo: 'erro', texto: `O motor gravou diferente do pedido: ${lista.join('; ')}. O que ele não aceita, ele mantém como estava ou ajusta para a faixa.` };
  return { tipo: 'ok', texto: `O motor gravou: ${texto}.` };
}

function desfechoDaOrdem(acao: Extract<AcaoDoSistema, { tipo: 'ordemDosPerfis' }>, dados: AceiteDoSistema): DesfechoDoSistema {
  const ignoradas = (dados.ignoradas ?? []).filter((chave) => Object.hasOwn(acao.corpo, chave));
  if (ignoradas.length) return { tipo: 'erro', texto: `O motor ignorou ${ignoradas.join(', ')}: a ordem não mudou.` };
  const pedida = acao.corpo.claudeProfiles.map((p) => p.label || p.id).join(', ');
  if (!dados.sistema) return { tipo: 'ok', texto: `O motor aceitou a ordem ${pedida}, mas a resposta não trouxe os perfis gravados: confira na tela.` };
  const diferenca = diferencaDaOrdem(acao.corpo, dados.sistema);
  if (diferenca) return { tipo: 'erro', texto: `O motor gravou diferente do pedido: ${diferenca}.` };
  return { tipo: 'ok', texto: `O motor gravou a ordem de uso: ${pedida}. A próxima sessão começa pelo primeiro que não estiver no limite do plano.` };
}

function desfechoDaRevogacao(acao: Extract<AcaoDoSistema, { tipo: 'revogarSessao' }>, dados: AceiteDoSistema): DesfechoDoSistema {
  if (dados.eraAtual || acao.atual) return { tipo: 'ok', texto: 'O motor encerrou a sessão deste navegador. Voltando ao pareamento.', encerrouEstaSessao: true };
  return { tipo: 'ok', texto: `O motor revogou a sessão ${acao.nome}: o token dela não vale mais.` };
}

// O que a tela diz depois de `{ ok: true }`. O `ok` não é o desfecho: a frase sai do que a
// resposta diz que ficou gravado, conferido contra o enviado.
export function desfechoDoSistema(acao: AcaoDoSistema, dados: AceiteDoSistema): DesfechoDoSistema {
  switch (acao.tipo) {
    case 'conta': return desfechoDaConta(acao, dados);
    case 'padroes': return desfechoDosPadroes(acao, dados);
    case 'regra': return desfechoDaRegra(acao);
    case 'automacao': return desfechoDeSettings(acao.corpo, dados, textoDaAutomacao(acao.corpo), (gravado) => diferencasDaAutomacao(acao.corpo, gravado));
    case 'ritmo': return desfechoDeSettings(acao.corpo, dados, textoDoRitmo(acao.corpo), (gravado) => diferencasDoRitmo(acao.corpo, gravado));
    case 'ordemDosPerfis': return desfechoDaOrdem(acao, dados);
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
