// As ações do Radar e do Histórico: a rota e o corpo de cada POST, a leitura da resposta e a frase que a
// tela mostra depois. Sem React: quem liga isto aos botões é o gancho useAcoes.
//
// As sete rotas respondem 200 com `{ ok }` (lib/http-server.js, na raiz). A recusa do motor
// vem como `{ ok: false, blocked?, error? }`: `blocked` é o código do portão que recusou
// (lib/engine/decision.js e os colaboradores de postagem) e `error` a frase do motor.
import { campo, ehBooleano, ehObjeto, ehTexto, type Objeto } from '@/contratos/formas';
import type { Cliente, Leitor } from '@/transporte/cliente';

// O que POST /api/decide aceita em `action`.
export type Decisao = 'approve' | 'request_changes' | 'comment' | 'skip';

interface Base {
  // de quem é a ação na tela (a chave do PR, o id da sessão): enquanto uma ação do alvo
  // está no ar, os botões dele ficam desabilitados
  alvo: string;
  // como a tela chama o alvo: "PR #12 de dono/repo"
  nome: string;
}

export type Acao =
  | (Base & { tipo: 'checar' })
  // `deNovo`: o PR já tem revisão (o botão do Histórico); muda só o rótulo
  | (Base & { tipo: 'revisar'; url: string; deNovo?: true })
  | (Base & { tipo: 'cancelar'; id: string })
  | (Base & {
    tipo: 'decidir';
    id: string;
    decisao: Decisao;
    // o parecer da revisão (`verdict` da pendência): diz se o texto que a tela mostra é o
    // que esta decisão publica
    parecer?: string;
    // a pendência está em "Esperando o CI": pular descarta o que o motor faria sozinho
    espera?: 'ci' | 'prova';
  })
  | (Base & { tipo: 'ignorar'; chave: string })
  | (Base & { tipo: 'restaurar'; chave: string })
  // O desfecho da contestação de um PR (recordPushback, lib/engine/pushback.js). `desfecho`
  // vazio apaga o registro. Nada é publicado: é memória do motor, que entra no prompt de
  // revisões futuras.
  | (Base & { tipo: 'contestacao'; chave: string; autor: string; desfecho: DesfechoDaContestacao | ''; nota: string });

// PUSHBACK_OUTCOMES, lib/taxonomy.js
export type DesfechoDaContestacao = 'author_right' | 'we_right' | 'mixed';

export const CHECAR: Acao = Object.freeze({ tipo: 'checar', alvo: 'checar', nome: '' });

export function pedidoDa(acao: Acao): { rota: string; corpo: Objeto } {
  switch (acao.tipo) {
    case 'checar': return { rota: '/api/check', corpo: {} };
    // a lista vai sempre explícita, e só existe a revisão headless (mode "auto" é o padrão)
    case 'revisar': return { rota: '/api/review', corpo: { urls: [acao.url] } };
    case 'cancelar': return { rota: '/api/cancel', corpo: { id: acao.id } };
    case 'decidir': return { rota: '/api/decide', corpo: { id: acao.id, action: acao.decisao } };
    case 'ignorar': return { rota: '/api/ignore', corpo: { key: acao.chave } };
    case 'restaurar': return { rota: '/api/restore', corpo: { key: acao.chave } };
    // a nota só acompanha um desfecho: apagar o registro apaga a nota junto
    case 'contestacao': return { rota: '/api/pushback', corpo: { key: acao.chave, author: acao.autor, outcome: acao.desfecho, note: acao.desfecho ? acao.nota : '' } };
  }
}

const ROTULO_DA_DECISAO: Record<Decisao, string> = {
  approve: 'Aprovar',
  request_changes: 'Pedir mudanças',
  comment: 'Comentar',
  skip: 'Pular',
};

// O texto do botão.
export function rotuloDa(acao: Acao): string {
  switch (acao.tipo) {
    case 'checar': return 'Checar agora';
    case 'revisar': return acao.deNovo ? 'Revisar de novo' : 'Revisar agora';
    case 'cancelar': return 'Cancelar';
    case 'decidir': return ROTULO_DA_DECISAO[acao.decisao];
    case 'ignorar': return 'Ignorar';
    case 'restaurar': return 'Restaurar';
    case 'contestacao': return acao.desfecho ? 'Gravar o desfecho' : 'Apagar a contestação';
  }
}

// O nome acessível do botão: a ação e o alvo ("Aprovar PR #12 de dono/repo").
export function nomeDa(acao: Acao): string {
  if (acao.tipo === 'contestacao') return acao.desfecho ? `Gravar o desfecho da contestação de ${acao.nome}` : `Apagar a contestação de ${acao.nome}`;
  return acao.nome ? `${rotuloDa(acao)} ${acao.nome}` : rotuloDa(acao);
}

// Identifica a ação dentro do alvo, para a tela saber qual botão está enviando.
export function idDa(acao: Acao): string {
  if (acao.tipo === 'contestacao') return acao.desfecho ? 'contestacao:gravar' : 'contestacao:apagar';
  return acao.tipo === 'decidir' ? `decidir:${acao.decisao}` : acao.tipo;
}

export interface Confirmacao {
  titulo: string;
  texto: string;
  confirmar: string;
}

// O que cada decisão publica no GitHub, para a pergunta de confirmação.
const PUBLICACAO: Record<Exclude<Decisao, 'skip'>, { titulo: (nome: string) => string; oQue: string; depois: string; confirmar: string }> = {
  approve: {
    titulo: (nome) => `Aprovar ${nome}?`,
    oQue: 'uma aprovação (APPROVE)',
    depois: 'Fica visível para todos no PR.',
    confirmar: 'Publicar a aprovação',
  },
  request_changes: {
    titulo: (nome) => `Pedir mudanças em ${nome}?`,
    oQue: 'um pedido de mudanças (REQUEST CHANGES)',
    depois: 'Fica visível para todos, e o PR fica bloqueado até o autor tratar.',
    confirmar: 'Publicar o pedido de mudanças',
  },
  comment: {
    titulo: (nome) => `Comentar em ${nome}?`,
    oQue: 'um review de comentário (COMMENT)',
    depois: 'Fica visível para todos no PR, sem aprovar nem bloquear.',
    confirmar: 'Publicar o comentário',
  },
};

// O motor guarda um texto por ação (corpo e comentários em linha) e publica o da ação
// clicada (`item.payloads[action]`, lib/engine/decision.js). A tela só recebe o texto do
// parecer. Então a pergunta só diz "o review mostrado acima" quando a ação é a do parecer.
function textoQueSai(acao: Extract<Acao, { tipo: 'decidir' }>): string {
  if (acao.parecer !== undefined && acao.parecer === acao.decisao) {
    return 'O texto é o do review mostrado acima, e o motor pode publicar junto comentários em linha, que esta tela não mostra.';
  }
  return 'O texto que sai NÃO é o mostrado acima: o motor publica o que ele preparou para esta ação, que esta tela não mostra e que pode trazer comentários em linha.';
}

// Ação que pede confirmação antes do POST: as três que publicam no GitHub (Aprovar, Pedir
// mudanças e Comentar), o Pular de uma pendência que o motor resolveria sozinho, o
// cancelamento, que joga fora a sessão em curso, e a contestação: gravar o desfecho muda o
// prompt de revisões futuras (do autor e, conforme o desfecho, do repositório), e apagar joga
// o registro fora. A pergunta diz o que sai e em qual PR.
export function confirmacaoDa(acao: Acao): Confirmacao | null {
  if (acao.tipo === 'cancelar') {
    return {
      titulo: `Cancelar ${acao.nome}?`,
      texto: 'A análise em andamento é interrompida. O que já foi enviado ao GitHub não é desfeito, e se o envio do review já começou o motor recusa o cancelamento.',
      confirmar: 'Cancelar a sessão',
    };
  }
  if (acao.tipo === 'contestacao') {
    if (!acao.desfecho) {
      return {
        titulo: `Apagar a contestação de ${acao.nome}?`,
        texto: `O registro de contestação de ${acao.nome} sai da memória do motor, com a nota: deixa de entrar no prompt das próximas revisões, e o motor volta a poder detectar contestação neste PR sozinho. Nada é publicado no GitHub.`,
        confirmar: 'Apagar o registro',
      };
    }
    // O que recordPushback faz, e quem lê o registro depois (lib/engine/pushback.js, na raiz):
    // pushbacksFor (as revisões do autor), licoesDoRepo (as de outros autores do repositório,
    // só quando a revisão errou) e pushbackTargets (a detecção automática, que pula o manual).
    const outros = acao.desfecho === 'we_right'
      ? ''
      : ' e, por ser um desfecho em que a revisão errou, também no das revisões de PRs de outros autores neste repositório';
    return {
      titulo: `Gravar o desfecho da contestação de ${acao.nome}?`,
      texto: `O desfecho de ${acao.nome} fica na memória do motor como confirmado e registrado à mão. Com a nota, ele entra no prompt das próximas revisões dos PRs do autor${outros}. Com o registro à mão o motor deixa de procurar contestação neste PR sozinho. Nada é publicado no GitHub.`,
      confirmar: 'Gravar o desfecho',
    };
  }
  if (acao.tipo !== 'decidir') return null;
  if (acao.decisao === 'skip') {
    if (!acao.espera) return null;
    return {
      titulo: `Pular ${acao.nome}?`,
      texto: acao.espera === 'ci'
        ? `Pular tira ${acao.nome} da mesa e descarta a aprovação que sairia sozinha quando os checks fechassem. Nada é publicado.`
        : `Pular tira ${acao.nome} da mesa e descarta a análise que o motor está recuperando sozinho. Nada é publicado.`,
      confirmar: 'Pular e descartar a espera',
    };
  }
  const p = PUBLICACAO[acao.decisao];
  return {
    titulo: p.titulo(acao.nome),
    texto: `Isto publica ${p.oQue} no GitHub, em ${acao.nome}, pela conta revisora do motor. ${textoQueSai(acao)} ${p.depois}`,
    confirmar: p.confirmar,
  };
}

export type RespostaDeAcao =
  | { ok: true }
  | { ok: false; blocked?: string; error?: string };

export const lerRespostaDeAcao: Leitor<RespostaDeAcao> = (bruto) => {
  if (!ehObjeto(bruto) || !ehBooleano(bruto.ok)) return null;
  if (bruto.ok) return { ok: true };
  // código ou frase de forma errada contam como ausentes: a recusa continua sendo recusa
  return { ok: false, blocked: campo(bruto.blocked, ehTexto), error: campo(bruto.error, ehTexto) };
};

// A frase de cada código de recusa do motor (`blocked`). Os que vêm com `true` levam junto
// a frase do motor, que diz o caso concreto (qual lacuna, qual campo).
const RECUSAS: Record<string, { texto: string; comDetalhe?: true }> = {
  stale_head: { texto: 'O PR recebeu commit novo depois da revisão: o texto fala do código anterior e não foi publicado. Revise de novo.' },
  pr_proprio: { texto: 'O PR é da própria conta revisora: o GitHub não aceita aprovação nem pedido de mudanças do autor. Use Comentar.' },
  pr_fechado: { texto: 'O PR já foi mergeado ou fechado: o review não foi publicado.' },
  instancia_isolada: { texto: 'Este motor é uma instância isolada e não escreve no GitHub.' },
  internal_language: { texto: 'A redação do review foi barrada pelo filtro de linguagem. Redija e publique o review direto no GitHub.' },
  credencial_no_texto: { texto: 'O texto do review parece conter uma credencial e não foi publicado.' },
  criterios_inconsistentes: { texto: 'A revisão tem critérios ou evidências inconsistentes. Revise de novo antes de publicar.' },
  round_memory: { texto: 'A memória de rodadas deste PR tem pendência aberta, e a publicação foi recusada.' },
  invalid_payload: { texto: 'O texto guardado para esta ação não pode ser publicado.', comDetalhe: true },
  technical_review: { texto: 'A avaliação técnica não permite publicar agora.', comDetalhe: true },
};

const TETO_DO_DETALHE = 400;

function detalheDoMotor(erro: string | undefined): string {
  const limpo = (erro ?? '').replace(/\s+/g, ' ').trim();
  return limpo.length > TETO_DO_DETALHE ? `${limpo.slice(0, TETO_DO_DETALHE)}…` : limpo;
}

export function mensagemDaRecusa(resposta: { blocked?: string; error?: string }): string {
  const detalhe = detalheDoMotor(resposta.error);
  const conhecida = resposta.blocked !== undefined && Object.hasOwn(RECUSAS, resposta.blocked) ? RECUSAS[resposta.blocked] : undefined;
  if (conhecida) return conhecida.comDetalhe && detalhe ? `${conhecida.texto} O motor disse: ${detalhe}` : conhecida.texto;
  return detalhe ? `O motor recusou: ${detalhe}` : 'O motor recusou a ação e não disse o motivo.';
}

// cancelado: a sessão acabou com o pedido no ar; a tela não mostra nada por isso.
export type Desfecho =
  | { tipo: 'ok'; texto: string }
  | { tipo: 'erro'; texto: string }
  | { tipo: 'cancelado' };

// Depois de `{ ok: true }` a tela só diz que o motor aceitou o pedido. O `ok` de uma decisão
// não quer dizer que algo foi publicado (o motor responde ok também quando já havia um review
// igual e ele não publicou de novo): o desfecho vem no aviso do motor, pelo evento `toast`.
function textoDoAceite(acao: Acao): string {
  if (acao.tipo === 'checar') return 'O motor aceitou o pedido: checar agora.';
  const pedido = nomeDa(acao).replace(/^./, (letra) => letra.toLowerCase());
  return acao.tipo === 'decidir'
    ? `O motor aceitou o pedido: ${pedido}. O desfecho vem no aviso do motor.`
    : `O motor aceitou o pedido: ${pedido}.`;
}

// O que a região viva diz enquanto o pedido está no ar.
export function textoDoEnvio(acao: Acao): string {
  return `Enviando: ${nomeDa(acao)}.`;
}

// Faz o POST da ação pelo cliente único e devolve o que a tela diz. Nunca lança, e não mexe
// em estado nenhum: quem muda a tela é o snapshot que o motor empurra depois.
export async function executar(cliente: Pick<Cliente, 'post'>, acao: Acao): Promise<Desfecho> {
  const { rota, corpo } = pedidoDa(acao);
  const r = await cliente.post(rota, corpo, lerRespostaDeAcao);
  if (r.ok) return r.dados.ok ? { tipo: 'ok', texto: textoDoAceite(acao) } : { tipo: 'erro', texto: mensagemDaRecusa(r.dados) };
  switch (r.falha) {
    case 'cancelado': return { tipo: 'cancelado' };
    case 'rede': return { tipo: 'erro', texto: 'Não deu para falar com o motor (falha de rede). Não dá para saber se o pedido chegou: confira a conexão e o estado na tela antes de tentar de novo.' };
    case 'nao_autenticado': return { tipo: 'erro', texto: 'A sessão deste navegador não vale mais no motor. Pareie de novo.' };
    case 'recusado': return { tipo: 'erro', texto: `O motor recusou o pedido (HTTP ${r.status}).` };
    case 'resposta_invalida': return { tipo: 'erro', texto: 'O motor respondeu fora do formato esperado. Confira na tela se a ação entrou.' };
  }
}
