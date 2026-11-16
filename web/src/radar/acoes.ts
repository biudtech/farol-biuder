// As ações do Radar: a rota e o corpo de cada POST, a leitura da resposta e a frase que a
// tela mostra depois. Sem React: quem liga isto aos botões é o gancho useAcoes.
//
// As seis rotas respondem 200 com `{ ok }` (lib/http-server.js, na raiz). A recusa do motor
// vem como `{ ok: false, blocked?, error? }`: `blocked` é o código do portão que recusou
// (lib/engine/decision.js e os colaboradores de postagem) e `error` a frase do motor.
import { ehBooleano, ehObjeto, ehTexto, opcional, type Objeto } from '@/contratos/formas';
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
  | (Base & { tipo: 'revisar'; url: string })
  | (Base & { tipo: 'cancelar'; id: string })
  | (Base & { tipo: 'decidir'; id: string; decisao: Decisao })
  | (Base & { tipo: 'ignorar'; chave: string })
  | (Base & { tipo: 'restaurar'; chave: string });

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
    case 'revisar': return 'Revisar agora';
    case 'cancelar': return 'Cancelar';
    case 'decidir': return ROTULO_DA_DECISAO[acao.decisao];
    case 'ignorar': return 'Ignorar';
    case 'restaurar': return 'Restaurar';
  }
}

// O nome acessível do botão: a ação e o alvo ("Aprovar PR #12 de dono/repo").
export function nomeDa(acao: Acao): string {
  return acao.nome ? `${rotuloDa(acao)} ${acao.nome}` : rotuloDa(acao);
}

// Identifica a ação dentro do alvo, para a tela saber qual botão está enviando.
export function idDa(acao: Acao): string {
  return acao.tipo === 'decidir' ? `decidir:${acao.decisao}` : acao.tipo;
}

export interface Confirmacao {
  titulo: string;
  texto: string;
  confirmar: string;
}

// Ação que pede confirmação antes do POST: as duas que publicam uma revisão decisiva, e o
// cancelamento, que joga fora a sessão em curso. A pergunta diz o que sai e em qual PR.
export function confirmacaoDa(acao: Acao): Confirmacao | null {
  if (acao.tipo === 'cancelar') {
    return {
      titulo: `Cancelar ${acao.nome}?`,
      texto: 'A análise em andamento é interrompida. O que já foi enviado ao GitHub não é desfeito, e se o envio do review já começou o motor recusa o cancelamento.',
      confirmar: 'Cancelar a sessão',
    };
  }
  if (acao.tipo !== 'decidir') return null;
  if (acao.decisao === 'approve') {
    return {
      titulo: `Aprovar ${acao.nome}?`,
      texto: `Isto publica uma aprovação (APPROVE) no GitHub, em ${acao.nome}, pela conta revisora do motor, com o texto do review desta pendência. Fica visível para todos no PR.`,
      confirmar: 'Publicar a aprovação',
    };
  }
  if (acao.decisao === 'request_changes') {
    return {
      titulo: `Pedir mudanças em ${acao.nome}?`,
      texto: `Isto publica um pedido de mudanças (REQUEST CHANGES) no GitHub, em ${acao.nome}, pela conta revisora do motor, com o texto do review desta pendência. Fica visível para todos, e o PR fica bloqueado até o autor tratar.`,
      confirmar: 'Publicar o pedido de mudanças',
    };
  }
  return null;
}

export type RespostaDeAcao =
  | { ok: true }
  | { ok: false; blocked?: string; error?: string };

export const lerRespostaDeAcao: Leitor<RespostaDeAcao> = (bruto) => {
  if (!ehObjeto(bruto) || !ehBooleano(bruto.ok)) return null;
  if (bruto.ok) return { ok: true };
  if (!opcional(bruto.blocked, ehTexto) || !opcional(bruto.error, ehTexto)) return null;
  return { ok: false, blocked: bruto.blocked, error: bruto.error };
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

function textoDoAceite(acao: Acao): string {
  if (acao.tipo === 'checar') return 'O motor aceitou: checar agora.';
  if (acao.tipo === 'decidir' && acao.decisao === 'skip') return `O motor aceitou: pular ${acao.nome}. Nada foi publicado.`;
  return `O motor aceitou: ${nomeDa(acao).replace(/^./, (letra) => letra.toLowerCase())}.`;
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
