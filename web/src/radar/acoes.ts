// As ações do Radar, do Histórico, do Time e do Sistema: a rota e o corpo de cada POST, a
// leitura da resposta e a frase que a tela mostra depois. Sem React: quem liga isto aos botões
// é o gancho useAcoes. As do Sistema moram em src/sistema/acoes.ts e entram aqui pela união.
//
// O front não tem mesa: aprovar, pedir mudanças, comentar e pular uma pendência
// (POST /api/decide) saíram com o redesenho de 17/11/2026. O revisor publica sozinho.
//
// As rotas respondem 200 com `{ ok }` (lib/http-server.js, na raiz). A recusa do motor
// vem como `{ ok: false, blocked?, error? }`: `blocked` é o código do portão que recusou
// (lib/engine/decision.js e os colaboradores de postagem) e `error` a frase do motor. A de
// POST /api/settings vem como `{ ok: false, code, erro }` (lib/engine/chave-do-perfil.js), a de
// POST /api/accounts/edit como `{ ok: false, erro }` e a de POST /api/auth/revoke como
// `{ ok: false, code }`.
import { campo, ehBooleano, ehObjeto, ehTexto, type Objeto } from '@/contratos/formas';
import { mensagemSegura } from '@/contratos/segredos';
import { lerConfigDoSistema } from '@/contratos/sistema';
import { lerPessoas, type Pessoa, type PessoasCruas } from '@/contratos/time';
import {
  TIPOS_DO_SISTEMA, confirmacaoDoSistema, desfechoDoSistema, nomeDoSistema, pedidoDoSistema, rotuloDoSistema,
  type AceiteDoSistema, type AcaoDoSistema,
} from '@/sistema/acoes';
import { marcaDoPerfil, outrasQueDiferem, perfilDe, textoDoPerfil } from '@/time/time';
import type { Cliente, Leitor } from '@/transporte/cliente';

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
  | (Base & { tipo: 'ignorar'; chave: string })
  | (Base & { tipo: 'restaurar'; chave: string })
  // O desfecho da contestação de um PR (recordPushback, lib/engine/pushback.js). `desfecho`
  // vazio apaga o registro. Nada é publicado: é memória do motor, que entra no prompt de
  // revisões futuras.
  | (Base & { tipo: 'contestacao'; chave: string; autor: string; desfecho: DesfechoDaContestacao | ''; nota: string })
  // O papel e a competência de uma pessoa (POST /api/settings com `people`). O motor troca o
  // mapa inteiro pelo que chega (updateSettings, server.js), então `pessoas` é a lista toda,
  // montada do mapa cru do motor e só com a pessoa alterada (comPerfil, src/time/time.ts).
  // `nova`: a pessoa entra agora no Time ("Adicionar pessoa", comPessoaNova); muda o rótulo e a
  // conferência da resposta, que exige a pessoa no mapa gravado.
  | (Base & { tipo: 'perfil'; login: string; pessoas: PessoasCruas; nova?: true })
  // Tira uma pessoa do Time (removeTeamMember, lib/engine/decision.js): apaga o dossiê, o
  // perfil e as contestações dela, sem cópia, e só isso (as revisões dos PRs dela continuam
  // no histórico e no log). O que a tela via na hora do clique vai junto só para a pergunta
  // dizer o que será apagado.
  | (Base & { tipo: 'removerAutor'; login: string; entradas: number; temPerfil: boolean; contestacoes: number })
  // a conta e a política, a automação e a revogação de sessão
  | AcaoDoSistema;

function ehDoSistema(acao: Acao): acao is AcaoDoSistema {
  return (TIPOS_DO_SISTEMA as readonly string[]).includes(acao.tipo);
}

// PUSHBACK_OUTCOMES, lib/taxonomy.js
export type DesfechoDaContestacao = 'author_right' | 'we_right' | 'mixed';

export const CHECAR: Acao = Object.freeze({ tipo: 'checar', alvo: 'checar', nome: '' });

export function pedidoDa(acao: Acao): { rota: string; corpo: Objeto } {
  if (ehDoSistema(acao)) return pedidoDoSistema(acao);
  switch (acao.tipo) {
    case 'checar': return { rota: '/api/check', corpo: {} };
    // a lista vai sempre explícita, e só existe a revisão headless (mode "auto" é o padrão)
    case 'revisar': return { rota: '/api/review', corpo: { urls: [acao.url] } };
    case 'cancelar': return { rota: '/api/cancel', corpo: { id: acao.id } };
    case 'ignorar': return { rota: '/api/ignore', corpo: { key: acao.chave } };
    case 'restaurar': return { rota: '/api/restore', corpo: { key: acao.chave } };
    // a nota só acompanha um desfecho: apagar o registro apaga a nota junto
    case 'contestacao': return { rota: '/api/pushback', corpo: { key: acao.chave, author: acao.autor, outcome: acao.desfecho, note: acao.desfecho ? acao.nota : '' } };
    case 'perfil': return { rota: '/api/settings', corpo: { people: acao.pessoas } };
    // o login vai como o motor o listou: é o nome do arquivo do dossiê
    case 'removerAutor': return { rota: '/api/team/remove', corpo: { login: acao.login } };
  }
}

// O texto do botão.
export function rotuloDa(acao: Acao): string {
  if (ehDoSistema(acao)) return rotuloDoSistema(acao);
  switch (acao.tipo) {
    case 'checar': return 'Checar agora';
    case 'revisar': return acao.deNovo ? 'Revisar de novo' : 'Revisar agora';
    case 'cancelar': return 'Cancelar';
    case 'ignorar': return 'Ignorar';
    case 'restaurar': return 'Restaurar';
    case 'contestacao': return acao.desfecho ? 'Gravar o desfecho' : 'Apagar a contestação';
    case 'perfil': return acao.nova ? 'Adicionar ao Time' : 'Salvar papel e competência';
    case 'removerAutor': return 'Remover do Time';
  }
}

// O nome acessível do botão: a ação e o alvo ("Revisar agora PR #12 de dono/repo").
export function nomeDa(acao: Acao): string {
  if (ehDoSistema(acao)) return nomeDoSistema(acao);
  if (acao.tipo === 'contestacao') return acao.desfecho ? `Gravar o desfecho da contestação de ${acao.nome}` : `Apagar a contestação de ${acao.nome}`;
  if (acao.tipo === 'perfil') return acao.nova ? `Adicionar ${acao.nome} ao Time` : `Salvar papel e competência de ${acao.nome}`;
  if (acao.tipo === 'removerAutor') return `Remover ${acao.nome} do Time`;
  return acao.nome ? `${rotuloDa(acao)} ${acao.nome}` : rotuloDa(acao);
}

// Identifica a ação dentro do alvo, para a tela saber qual botão está enviando.
export function idDa(acao: Acao): string {
  if (acao.tipo === 'contestacao') return acao.desfecho ? 'contestacao:gravar' : 'contestacao:apagar';
  return acao.tipo;
}

export interface Confirmacao {
  titulo: string;
  texto: string;
  confirmar: string;
}

// Ação que pede confirmação antes do POST: o cancelamento, que joga fora a sessão em curso, a
// contestação (gravar o desfecho muda o prompt de revisões futuras, do autor e, conforme o
// desfecho, do repositório, e apagar joga o registro fora), a remoção de uma pessoa do Time e
// as do Sistema. A pergunta diz o que acontece e com quem.
export function confirmacaoDa(acao: Acao): Confirmacao | null {
  if (ehDoSistema(acao)) return confirmacaoDoSistema(acao);
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
  if (acao.tipo === 'removerAutor') {
    // O que removeTeamMember apaga (lib/engine/decision.js, na raiz), e só isto: o arquivo
    // do dossiê, a entrada em config.people e as contestações em que a pessoa é a autora. As
    // revisões dos PRs dela ficam em decisions.json (GET /api/decisions busca por autor) e no
    // farol.log. Quem lia cada coisa apagada: o dossiê é lido pela sessão de revisão, o perfil
    // entra no bloco "Perfil do autor" do prompt (personProfileBlock) e as contestações, além
    // desse bloco, viram lição para outros autores do repositório (licoesDoRepo). Não há
    // cópia nem rota que desfaça.
    const dossie = acao.entradas > 0
      ? `o dossiê (${acao.entradas} ${acao.entradas === 1 ? 'entrada' : 'entradas'} de memória nesta tela)`
      : 'o dossiê, se houver';
    const perfil = acao.temPerfil ? 'o papel e a competência configurados' : 'o papel e a competência, se houver';
    const contestacoes = acao.contestacoes > 0
      ? `todos os registros de contestação dos PRs dela (${acao.contestacoes} nesta tela)`
      : 'os registros de contestação dos PRs dela, se houver';
    return {
      titulo: `Remover ${acao.nome} do Time?`,
      texto: `O motor apaga três coisas de ${acao.nome}: ${dossie}, ${perfil} e ${contestacoes}. São as três de uma vez: o motor não apaga uma entrada só. Não dá para desfazer, porque o motor não guarda cópia. Não é tudo o que o motor tem sobre ela: as revisões dos PRs dela continuam no Histórico, com ela como autora, e no log do motor. Nada muda no GitHub. Nas próximas revisões dos PRs dela a sessão não encontra o dossiê, o prompt sai sem perfil e sem contestações (tom neutro), e as contestações apagadas deixam de entrar como lição nas revisões de outros autores do mesmo repositório. Se um PR dela for revisado de novo, um dossiê novo começa do zero.`,
      confirmar: 'Apagar o dossiê, o perfil e as contestações',
    };
  }
  return null;
}

// No aceite, os campos que só algumas rotas mandam: `removed` (POST /api/team/remove: havia
// algo para apagar), os perfis que ficaram gravados (`config.people` da resposta de
// POST /api/settings, como veio, com as chaves que o motor ignorou em `ignoradas`) e os do
// Sistema (AceiteDoSistema): o resto de `config` que a tela lê, sem o que tiver cara de
// segredo, os campos que POST /api/accounts/edit ignorou e o `eraAtual` da revogação.
export type RespostaDeAcao =
  | ({ ok: true; removed?: boolean; pessoas?: PessoasCruas } & AceiteDoSistema)
  | { ok: false; blocked?: string; error?: string };

// a resposta de uma ação não vai ao registro da borda: o que for descartado é só descartado
const semRegistro = (): void => {};

export const lerRespostaDeAcao: Leitor<RespostaDeAcao> = (bruto) => {
  if (!ehObjeto(bruto) || !ehBooleano(bruto.ok)) return null;
  if (bruto.ok) {
    const aceite: Extract<RespostaDeAcao, { ok: true }> = { ok: true };
    if (ehBooleano(bruto.removed)) aceite.removed = bruto.removed;
    // o mapa gravado vai cru, como o enviado: a conferência dos dois é valor a valor
    if (ehObjeto(bruto.config) && ehObjeto(bruto.config.people)) aceite.pessoas = bruto.config.people;
    if (Array.isArray(bruto.ignoradas) && bruto.ignoradas.length) aceite.ignoradas = bruto.ignoradas.filter(ehTexto);
    if (Array.isArray(bruto.ignorados) && bruto.ignorados.length) aceite.ignorados = bruto.ignorados.filter(ehTexto);
    if (ehBooleano(bruto.eraAtual)) aceite.eraAtual = bruto.eraAtual;
    const sistema = lerConfigDoSistema(bruto.config, semRegistro);
    if (Object.keys(sistema).length) aceite.sistema = sistema;
    return aceite;
  }
  // Código ou frase de forma errada contam como ausentes: a recusa continua sendo recusa. A
  // recusa de POST /api/settings usa `code` e `erro` no lugar de `blocked` e `error`.
  // a frase da recusa é texto do motor para ler: o trecho em formato de credencial é trocado
  return { ok: false, blocked: campo(bruto.blocked, ehTexto) ?? campo(bruto.code, ehTexto), error: mensagemSegura(bruto.error) ?? mensagemSegura(bruto.erro) };
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
  // POST /api/auth/revoke (lib/local-auth/acesso.js)
  sessao_inexistente: { texto: 'O motor não tem mais essa sessão: ela já foi revogada ou expirou. Atualize a lista.' },
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

type Aceite = Extract<RespostaDeAcao, { ok: true }>;

const TETO_DE_NOMES = 5;

function nomesDe(logins: readonly string[]): string {
  const ditos = logins.slice(0, TETO_DE_NOMES).map((login) => `@${login}`).join(', ');
  return logins.length > TETO_DE_NOMES ? `${ditos} e mais ${logins.length - TETO_DE_NOMES}` : ditos;
}

// O que a tela diz depois de um salvar de perfil que o motor aceitou. O `ok` não basta: o
// motor descarta o que não reconhece sem recusar (parsePeople, lib/parse.js), e o salvar
// troca a lista inteira. Então a frase sai do mapa que a resposta diz que ficou gravado,
// conferido inteiro contra o enviado: a pessoa editada pelo perfil lido, e cada uma das
// outras valor a valor.
function desfechoDoPerfil(acao: Extract<Acao, { tipo: 'perfil' }>, dados: Aceite): Desfecho {
  if (dados.ignoradas?.includes('people')) return { tipo: 'erro', texto: `O motor ignorou o campo de perfis: o perfil de ${acao.nome} não foi gravado.` };
  if (!dados.pessoas) return { tipo: 'ok', texto: `O motor aceitou o pedido de salvar o perfil de ${acao.nome}, mas a resposta não trouxe os perfis gravados: confira o perfil na tela.` };
  const pedido = perfilDe(lerPessoas(acao.pessoas)?.pessoas, acao.login);
  const gravado = perfilDe(lerPessoas(dados.pessoas)?.pessoas, acao.login);
  if (acao.nova) return desfechoDaPessoaNova(acao, dados.pessoas, gravado, marcaDoPerfil(pedido) === marcaDoPerfil(gravado));
  const igual = marcaDoPerfil(pedido) === marcaDoPerfil(gravado);
  const outras = outrasQueDiferem(acao.pessoas, dados.pessoas, acao.login);
  const daPessoa = igual
    ? `O motor gravou o perfil de ${acao.nome}: ${textoDoPerfil(gravado)}.`
    : `O motor gravou o perfil de ${acao.nome} diferente do pedido: ficou ${textoDoPerfil(gravado)}. O que ele não reconhece, ele descarta.`;
  if (!outras.length) return { tipo: igual ? 'ok' : 'erro', texto: daPessoa };
  return {
    tipo: 'erro',
    texto: `${daPessoa} Atenção: o perfil de ${outras.length === 1 ? 'outra pessoa' : `outras ${outras.length} pessoas`} ficou diferente do que esta tela enviou, mudou ou saiu da lista (${nomesDe(outras)}). Confira na tela.`,
  };
}

// A pessoa nova só entrou se está no mapa gravado: perfil vazio e pessoa ausente têm a mesma marca.
function desfechoDaPessoaNova(acao: Extract<Acao, { tipo: 'perfil' }>, gravados: PessoasCruas, gravado: Pessoa | undefined, igual: boolean): Desfecho {
  const chave = acao.login.toLowerCase();
  const entrou = Object.keys(gravados).some((login) => login.toLowerCase() === chave);
  if (!entrou) return { tipo: 'erro', texto: `O motor não guardou ${acao.nome}: a pessoa não entrou no Time.` };
  const outras = outrasQueDiferem(acao.pessoas, gravados, acao.login);
  const texto = `O motor adicionou ${acao.nome} ao Time: ${textoDoPerfil(gravado)}.${igual ? '' : ' O papel pedido não ficou: o que ele não reconhece, ele descarta.'}`;
  if (!outras.length) return { tipo: igual ? 'ok' : 'erro', texto };
  return { tipo: 'erro', texto: `${texto} Atenção: o perfil de ${outras.length === 1 ? 'outra pessoa' : `outras ${outras.length} pessoas`} ficou diferente do que esta tela enviou (${nomesDe(outras)}). Confira na tela.` };
}

const O_QUE_FICA = 'As revisões dos PRs dela continuam no Histórico e no log do motor.';

// A frase diz o que o motor respondeu. `removed: true` quer dizer que havia ao menos uma das
// três coisas (dossiê, perfil, contestações), não que as três existiam.
function desfechoDaRemocao(acao: Extract<Acao, { tipo: 'removerAutor' }>, dados: Aceite): Desfecho {
  if (dados.removed === false) return { tipo: 'ok', texto: `O motor respondeu que não tinha dossiê, perfil nem contestação de ${acao.nome}: nada foi apagado. ${O_QUE_FICA}` };
  if (dados.removed === true) {
    return { tipo: 'ok', texto: `O motor respondeu que apagou o que tinha de ${acao.nome} entre o dossiê, o perfil e as contestações (ele não diz quais existiam). Não há como desfazer. ${O_QUE_FICA}` };
  }
  return { tipo: 'ok', texto: `O motor aceitou o pedido de remover ${acao.nome} do Time e não disse se havia algo para apagar. ${O_QUE_FICA}` };
}

// cancelado: a sessão acabou com o pedido no ar; a tela não mostra nada por isso.
export type Desfecho =
  | { tipo: 'ok'; texto: string }
  | { tipo: 'erro'; texto: string }
  | { tipo: 'cancelado' };

// Depois de `{ ok: true }` a tela só diz que o motor aceitou o pedido: o que aconteceu de fato
// (a revisão que começou, o review que saiu) vem no estado e no aviso do motor (`toast`).
function textoDoAceite(acao: Acao): string {
  if (acao.tipo === 'checar') return 'O motor aceitou o pedido: checar agora.';
  const pedido = nomeDa(acao).replace(/^./, (letra) => letra.toLowerCase());
  return `O motor aceitou o pedido: ${pedido}.`;
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
  if (r.ok) {
    if (!r.dados.ok) return { tipo: 'erro', texto: mensagemDaRecusa(r.dados) };
    if (acao.tipo === 'perfil') return desfechoDoPerfil(acao, r.dados);
    if (acao.tipo === 'removerAutor') return desfechoDaRemocao(acao, r.dados);
    if (ehDoSistema(acao)) return desfechoDoSistema(acao, r.dados);
    return { tipo: 'ok', texto: textoDoAceite(acao) };
  }
  switch (r.falha) {
    case 'cancelado': return { tipo: 'cancelado' };
    case 'rede': return { tipo: 'erro', texto: 'Não deu para falar com o motor (falha de rede). Não dá para saber se o pedido chegou: confira a conexão e o estado na tela antes de tentar de novo.' };
    case 'nao_autenticado': return { tipo: 'erro', texto: 'A sessão deste navegador não vale mais no motor. Pareie de novo.' };
    // o código, quando o corpo da recusa traz um (`code`)
    case 'recusado': return { tipo: 'erro', texto: `O motor recusou o pedido (HTTP ${r.status}${r.detalhe ? `, ${r.detalhe.codigo}` : ''}).` };
    case 'resposta_invalida': return { tipo: 'erro', texto: 'O motor respondeu fora do formato esperado. Confira na tela se a ação entrou.' };
  }
}
