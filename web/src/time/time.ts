// A lógica da tela Time, sem React: o que mora no endereço, como fatiar o que o motor manda
// (a lista de GET /api/team, os perfis de `config.people` e as contestações de `pushbacks`) e
// como escrever cada campo. A tela só fatia e formata: a ordem da lista, o que é uma entrada
// e o que vale como perfil são do motor.
import type { Contestacao } from '@/contratos/historico';
import { ehObjeto, mesmoJson } from '@/contratos/formas';
import type { Autor, NumerosDoAutor, Pessoa, Pessoas, PessoasCruas } from '@/contratos/time';
import { ROTULO_DA_ACAO } from '@/historico/rotulos';
import { nomeDoPr } from '@/radar/formato';
import type { Conexao } from '@/transporte/cliente';
import { DOMINIOS, rotuloDoDominio, rotuloDoNivel, rotuloDoPapel } from './taxonomia';

// Quantas entradas o motor guarda por dossiê: writeMemory (lib/engine/decision.js) corta nas
// dez mais recentes. O teste ao lado confere o número contra o motor.
export const TETO_DE_ENTRADAS = 10;

// Quantas contestações de uma pessoa entram no prompt de uma revisão: as confirmadas mais
// recentes (personProfileBlock, lib/engine/review-prompt.js). O teste ao lado confere.
export const CONTESTACOES_NO_PROMPT = 5;

// O login de quem está com o dossiê aberto é a única coisa da tela que vai ao endereço: é o
// identificador que o motor já usa. A busca por nome não vai, de propósito.
const TETO_DO_LOGIN = 100;

export function lerEnderecoDoTime(params: Pick<URLSearchParams, 'get'>): string | null {
  const autor = (params.get('autor') ?? '').trim();
  return autor && autor.length <= TETO_DO_LOGIN ? autor : null;
}

export function enderecoDoTime(autor: string | null): string {
  return autor ? new URLSearchParams({ autor }).toString() : '';
}

// O motor guarda o perfil pelo login em minúsculas (parsePeople, lib/parse.js).
export function chaveDaPessoa(login: string): string {
  return login.trim().toLowerCase();
}

export function perfilDe(pessoas: Pessoas | undefined, login: string): Pessoa | undefined {
  const chave = chaveDaPessoa(login);
  return pessoas && Object.hasOwn(pessoas, chave) ? pessoas[chave] : undefined;
}

// sem caixa e sem acento: "joao" acha "João"
function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// A busca por nome ou login, feita aqui porque GET /api/team entrega a lista inteira e não
// tem parâmetro de busca. Todos os termos têm de aparecer; a ordem da lista não muda.
export function filtrarPorNome<T extends { login: string; name?: string }>(itens: readonly T[], busca: string): readonly T[] {
  const termos = semAcento(busca).split(/\s+/).filter(Boolean);
  if (!termos.length) return itens;
  return itens.filter((item) => {
    const onde = semAcento(`${item.login} ${item.name ?? ''}`);
    return termos.every((termo) => onde.includes(termo));
  });
}

// Quem tem papel ou competência gravados e não tem dossiê: a lista do motor não os traz, mas
// o perfil deles entra no prompt do mesmo jeito. Na ordem em que o motor mandou o mapa.
export function soComPerfil(pessoas: Pessoas | undefined, autores: readonly Autor[]): string[] {
  if (!pessoas) return [];
  const comDossie = new Set(autores.map((a) => chaveDaPessoa(a.login)));
  return Object.keys(pessoas).filter((login) => !comDossie.has(chaveDaPessoa(login)));
}

export interface ContestacaoDoAutor {
  // a chave do PR
  chave: string;
  registro: Contestacao;
}

// As contestações que o motor guarda dos PRs de uma pessoa (`pushbacks` do snapshot, pelo
// campo `author`), na ordem em que vieram.
export function contestacoesDoAutor(contestacoes: Readonly<Record<string, Contestacao>> | undefined, login: string): ContestacaoDoAutor[] {
  if (!contestacoes) return [];
  const alvo = chaveDaPessoa(login);
  return Object.entries(contestacoes)
    .filter(([, registro]) => chaveDaPessoa(registro.author ?? '') === alvo)
    .map(([chave, registro]) => ({ chave, registro }));
}

// O perfil sem campo vazio. Sem nada, não há perfil.
export function perfilLimpo(perfil: Pessoa): Pessoa | undefined {
  const dominios = Object.fromEntries(Object.entries(perfil.dominios ?? {}).filter(([, nivel]) => nivel !== ''));
  const limpo: Pessoa = {};
  if (perfil.papel) limpo.papel = perfil.papel;
  if (Object.keys(dominios).length) limpo.dominios = dominios;
  return limpo.papel || limpo.dominios ? limpo : undefined;
}

// O corpo de `people` em POST /api/settings. O motor troca o mapa inteiro pelo que chega
// (updateSettings, server.js): por isso vai a lista toda. Ela sai do mapa CRU do motor, e só
// a pessoa editada muda: as outras voltam exatamente como vieram, inclusive com campo que a
// tela não conhece ou valor que ela não lê (quem decide o que fazer com eles é o motor).
// Na pessoa editada trocam-se o papel e os domínios; outro campo dela fica. Sem nada, ela
// sai do mapa, que é o que o motor faria com a entrada vazia. A chave é o login em
// minúsculas, como o motor guarda; entrada da mesma pessoa em outra caixa é trocada por ela.
export function comPerfil(cru: PessoasCruas, login: string, perfil: Pessoa): PessoasCruas {
  const chave = chaveDaPessoa(login);
  const limpo = perfilLimpo(perfil);
  const antes = Object.entries(cru).filter(([outro]) => chaveDaPessoa(outro) === chave).map(([, valor]) => valor).find(ehObjeto);
  const resto = Object.entries(cru).filter(([outro]) => chaveDaPessoa(outro) !== chave);
  const pessoa: Record<string, unknown> = { ...antes };
  delete pessoa.papel;
  delete pessoa.dominios;
  if (limpo?.papel) pessoa.papel = limpo.papel;
  if (limpo?.dominios) pessoa.dominios = limpo.dominios;
  // fromEntries define propriedade própria, qualquer que seja o login
  return Object.fromEntries(Object.keys(pessoa).length ? [...resto, [chave, pessoa]] : resto);
}

// Antes de gravar `people` (que o motor troca inteiro), a tela relê o mapa atual do motor e monta
// o corpo a partir dele, com só a pessoa editada ou a nova mudando: assim um perfil gravado por
// outra aba depois do último estado que chegou aqui não é apagado. A releitura é a chave
// `config.people` de GET /api/state, como o motor a manda.
export const CAMINHO_DO_ESTADO = '/api/state';

export function lerPessoasDoEstado(bruto: unknown): PessoasCruas | null {
  if (!ehObjeto(bruto) || !ehObjeto(bruto.config)) return null;
  const people = bruto.config.people;
  if (people === undefined) return {};
  return ehObjeto(people) ? people : null;
}

export type Releitura = { ok: true; pessoas: PessoasCruas } | { ok: false; texto: string };
export type RelerPessoas = () => Promise<Releitura>;

// O login do GitHub: letras, dígitos e hífen, até 39, sem hífen na ponta nem dois seguidos. É a
// mesma regra com que o motor aceita uma pessoa sem papel (parsePeople, lib/parse.js na raiz).
const LOGIN_DO_GITHUB = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

export function loginValido(login: string): boolean {
  return LOGIN_DO_GITHUB.test(login);
}

// O login como a pessoa digitou, sem o @ da frente e sem espaço nas pontas.
export function loginDigitado(texto: string): string {
  return texto.trim().replace(/^@/, '');
}

// O corpo de `people` para pôr uma pessoa nova no Time: o mapa cru inteiro, como veio, mais ela,
// com o papel quando escolhido e vazia sem ele (o motor guarda a pessoa sem perfil). Quem já
// está no mapa não entra de novo: aí é editar o perfil.
export function comPessoaNova(cru: PessoasCruas, login: string, papel: string): PessoasCruas | null {
  const chave = chaveDaPessoa(login);
  if (!loginValido(login) || Object.keys(cru).some((outro) => chaveDaPessoa(outro) === chave)) return null;
  return Object.fromEntries([...Object.entries(cru), [chave, papel ? { papel } : {}]]);
}

// As outras pessoas (todas menos `login`) cujo perfil gravado difere do enviado: mudou, saiu
// da lista ou apareceu sem ter sido enviada. É a conferência da resposta de um salvar.
export function outrasQueDiferem(enviado: PessoasCruas, gravado: PessoasCruas, login: string): string[] {
  const chave = chaveDaPessoa(login);
  const todas = [...new Set([...Object.keys(enviado), ...Object.keys(gravado)])].filter((outro) => chaveDaPessoa(outro) !== chave);
  return todas.filter((outro) => !Object.hasOwn(enviado, outro) || !Object.hasOwn(gravado, outro) || !mesmoJson(enviado[outro], gravado[outro]));
}

// Dois perfis são o mesmo quando têm a mesma marca: o papel e os domínios, em ordem fixa.
export function marcaDoPerfil(perfil: Pessoa | undefined): string {
  const limpo = perfil ? perfilLimpo(perfil) : undefined;
  if (!limpo) return '';
  const dominios = Object.entries(limpo.dominios ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([limpo.papel ?? '', dominios]);
}

// Os domínios de um perfil na ordem do motor, e depois os que a tela não conhece.
function dominiosEmOrdem(perfil: Pessoa | undefined): Array<[string, string]> {
  const dominios = perfil?.dominios ?? {};
  const conhecidos = DOMINIOS.map(([d]) => d).filter((d) => Object.hasOwn(dominios, d));
  const outros = Object.keys(dominios).filter((d) => !conhecidos.includes(d));
  return [...conhecidos, ...outros].map((d) => [d, dominios[d] as string]);
}

export function textoDoPapel(perfil: Pessoa | undefined): string {
  return perfil?.papel ? rotuloDoPapel(perfil.papel) : 'Não informado';
}

export function textoDaCompetencia(perfil: Pessoa | undefined): string {
  const dominios = dominiosEmOrdem(perfil);
  return dominios.length ? dominios.map(([d, nivel]) => `${rotuloDoDominio(d)}: ${rotuloDoNivel(nivel)}`).join(', ') : 'Não informada';
}

// O perfil numa frase, para o resultado de um salvar.
export function textoDoPerfil(perfil: Pessoa | undefined): string {
  const limpo = perfil ? perfilLimpo(perfil) : undefined;
  if (!limpo) return 'sem papel nem competência';
  const partes = [limpo.papel ? `papel ${rotuloDoPapel(limpo.papel)}` : 'sem papel'];
  for (const [d, nivel] of dominiosEmOrdem(limpo)) partes.push(`${rotuloDoDominio(d)}: ${rotuloDoNivel(nivel)}`);
  return partes.join('; ');
}

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

// O dia da entrada (AAAA-MM-DD, que o motor grava em UTC) escrito como dia/mês/ano. É troca
// de ordem do texto, sem fuso: o dia mostrado é o que o motor gravou. Outra forma aparece crua.
export function dataDaEntrada(data: string | undefined): string {
  if (!data) return '';
  const partes = DIA.exec(data.trim());
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : data.trim();
}

// O que foi publicado na revisão da entrada. O motor grava o evento em maiúsculas (APPROVE,
// REQUEST CHANGES ou REQUEST_CHANGES, COMMENT); valor que a tabela não conhece aparece cru.
export function desfechoDaEntrada(veredito: string | undefined): string {
  if (!veredito) return '';
  const chave = veredito.trim().toLowerCase().replace(/\s+/g, '_');
  return Object.hasOwn(ROTULO_DA_ACAO, chave) ? (ROTULO_DA_ACAO[chave] as string) : veredito.trim();
}

const CHAVE_DE_PR = /^[^#\s]+\/[^#\s]+#\d+$/;

// O PR da entrada. Entrada antiga traz só o nome curto do repositório, e aparece como veio.
export function prDaEntrada(ref: string | undefined): string {
  if (!ref) return '';
  return CHAVE_DE_PR.test(ref.trim()) ? nomeDoPr(ref.trim()) : ref.trim();
}

// Os pontos de uma entrada voltam a ser a lista de markdown que o motor gravou no dossiê.
export function markdownDosPontos(pontos: readonly string[]): string {
  return pontos.map((ponto) => `- ${ponto.replace(/\s*\n\s*/g, ' ')}`).join('\n');
}

// O nome que a linha e o dossiê mostram: o do dossiê, quando o motor traz um; senão o login.
export function nomeDaPessoa(login: string, autor: Pick<Autor, 'name'> | undefined): string {
  return autor?.name?.trim() || login;
}

// As iniciais do avatar: a primeira letra da primeira e da última parte do nome (separado por
// espaço, hífen, ponto, sublinhado ou troca de caixa, como em "arturReiman"); com uma parte
// só, as duas primeiras letras. É enfeite: o nome vai escrito ao lado.
export function iniciais(nome: string): string {
  const partes = nome
    .replace(/([a-zà-ÿ])([A-ZÀ-Þ])/g, '$1 $2')
    .split(/[\s._\-[\]()@]+/)
    .map((parte) => parte.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  const [primeira, ...resto] = partes;
  if (!primeira) return '?';
  const ultima = resto.at(-1);
  const letras = ultima ? `${[...primeira][0]}${[...ultima][0]}` : [...primeira].slice(0, 2).join('');
  return letras.toUpperCase();
}

// O papel numa palavra, para a linha da lista: sem papel gravado, "Sem papel".
export function papelCurto(perfil: Pessoa | undefined): string {
  return perfil?.papel ? rotuloDoPapel(perfil.papel) : 'Sem papel';
}

// O resumo da calibração na linha fechada de "Como revisar": o papel e as competências.
export function resumoDaCalibracao(perfil: Pessoa | undefined): string {
  const limpo = perfil ? perfilLimpo(perfil) : undefined;
  if (!limpo) return 'sem papel nem competência';
  const partes = [limpo.papel ? rotuloDoPapel(limpo.papel) : 'sem papel'];
  for (const [d, nivel] of dominiosEmOrdem(limpo)) partes.push(`${rotuloDoDominio(d)}: ${rotuloDoNivel(nivel)}`);
  return partes.join(' · ');
}

export type DesfechoDaEntrada = 'aprovacao' | 'mudancas' | 'comentario' | 'outro';

// O desfecho de uma entrada, pela mesma leitura de desfechoDaEntrada.
export function tipoDoDesfecho(veredito: string | undefined): DesfechoDaEntrada {
  const chave = (veredito ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  if (chave === 'approve') return 'aprovacao';
  if (chave === 'request_changes') return 'mudancas';
  if (chave === 'comment') return 'comentario';
  return 'outro';
}

// O `action` do Histórico que a entrada corresponde (`approve`, `request_changes`, `comment`),
// para a cor sair da mesma fonte das duas telas (tomDoDesfecho, src/historico/rotulos.ts).
const ACAO_DO_TIPO: Record<DesfechoDaEntrada, string | undefined> = { aprovacao: 'approve', mudancas: 'request_changes', comentario: 'comment', outro: undefined };

export function acaoDaEntrada(veredito: string | undefined): string | undefined {
  return ACAO_DO_TIPO[tipoDoDesfecho(veredito)];
}

export type ContagemDosDesfechos = Record<DesfechoDaEntrada, number>;

// Os desfechos das entradas listadas, somados. Não é número da pessoa: o motor guarda só as
// dez entradas mais recentes e não manda total nenhum.
export function contagemDosDesfechos(entradas: readonly { verdict?: string }[]): ContagemDosDesfechos {
  const contagem: ContagemDosDesfechos = { aprovacao: 0, mudancas: 0, comentario: 0, outro: 0 };
  for (const entrada of entradas) contagem[tipoDoDesfecho(entrada.verdict)] += 1;
  return contagem;
}

export const quantasPessoas = (n: number): string => (n === 1 ? '1 pessoa' : `${n} pessoas`);
const pessoas = quantasPessoas;

// O que a região viva anuncia depois de uma carga ou de uma busca.
export function textoDoResultado(total: number, mostradas: number, busca: string): string {
  if (total === 0) return 'Ninguém no Time';
  if (!busca.trim()) return pessoas(total);
  return mostradas === 0 ? `Ninguém passa pela busca, de ${pessoas(total)}` : `${mostradas} de ${pessoas(total)} ${mostradas === 1 ? 'passa' : 'passam'} pela busca`;
}

const NOME_DA_CONEXAO: Record<Conexao, string> = {
  conectando: 'ainda conectando',
  conectado: 'conectada',
  reconectando: 'reconectando',
  'sem-motor': 'sem resposta do motor',
};

// Por que a tela não oferece o salvar de um perfil, ou null quando pode. O salvar manda a
// lista inteira de perfis desta aba: com a lista ausente ou possivelmente velha, salvar
// passaria por cima do que o motor tem. `emDia`: o primeiro estado da conexão atual já
// chegou (`estadoEmDia`, src/estado/app.ts); "conectado" sozinho não basta, porque vem antes
// dele, ainda com o snapshot da conexão anterior.
export function motivoQueImpedeSalvar(estado: { cru: PessoasCruas | undefined; conexao: Conexao; emDia: boolean }): string | null {
  if (!estado.cru) return 'O motor não mandou a lista de perfis a esta tela: não dá para salvar daqui, porque o salvar manda a lista inteira.';
  if (estado.conexao !== 'conectado') {
    return `Esta aba está sem o estado do motor em dia (conexão: ${NOME_DA_CONEXAO[estado.conexao]}). A lista de perfis daqui pode estar velha, e salvar a mandaria inteira por cima da do motor: o salvar volta quando a conexão voltar e o estado chegar.`;
  }
  if (!estado.emDia) {
    return 'A conexão com o motor acabou de abrir e o estado dele ainda não chegou: a lista de perfis daqui é a de antes da queda. O salvar volta quando o estado chegar.';
  }
  return null;
}

// O aviso de que a tela não leu algum perfil inteiro. Não fecha o salvar: o corpo sai do
// mapa cru do motor, e essas pessoas voltam para ele como vieram.
export function avisoDeIlegiveis(ilegiveis: number): string | null {
  if (ilegiveis <= 0) return null;
  return `${ilegiveis} perfil(is) chegaram do motor com campo ou formato que esta tela não lê: ela mostra o que conseguiu ler. Salvar o perfil de outra pessoa reenvia esses como vieram, e o que o motor faz com eles vem no resultado do salvar.`;
}

// Os números de 30 dias como a tela os escreve: a taxa de aprovação de primeira e a média de
// rodadas por PR saem das contagens que o motor manda, sem outra fonte.
const UMA_CASA = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function taxaDePrimeira(n: { prs: number; aprovadosDePrimeira: number }): string {
  return `${Math.round((n.aprovadosDePrimeira / n.prs) * 100)}%`;
}

export function rodadasPorPr(n: { prs: number; rodadas: number }): string {
  return UMA_CASA.format(n.rodadas / n.prs);
}

export function textoDosNumeros(n: { janelaDias: number; prs: number; aprovadosDePrimeira: number }): string {
  return `${n.prs === 1 ? '1 PR' : `${n.prs} PRs`} em ${n.janelaDias} dias · ${taxaDePrimeira(n)} aprovados de primeira`;
}

// ---------- o cartão da pessoa (redesenho, lote 4) ----------

// "O que o Farol já aprendeu": os pontos que o motor anotou nas entradas do dossiê, na ordem dele
// (a entrada mais recente primeiro), sem repetir, até o teto. O motor não resume o dossiê: o
// cartão mostra os pontos mais recentes, e o dossiê inteiro fica em "Ver dossiê".
export function aprendizados(autor: Autor | undefined, teto = 2): string[] {
  const vistos = new Set<string>();
  const lista: string[] = [];
  for (const entrada of autor?.entries ?? []) {
    for (const bruto of entrada.bullets) {
      const ponto = bruto.trim();
      if (!ponto || vistos.has(ponto)) continue;
      vistos.add(ponto);
      lista.push(ponto);
      if (lista.length >= teto) return lista;
    }
  }
  return lista;
}

// Os domínios do perfil com o nível ("Frontend: Autoridade"), na ordem da taxonomia do motor.
export function dominiosDoCartao(perfil: Pessoa | undefined): string[] {
  return dominiosEmOrdem(perfil).map(([d, nivel]) => `${rotuloDoDominio(d)}: ${rotuloDoNivel(nivel)}`);
}

export interface NumeroDoCartao {
  rotulo: string;
  valor: string;
  tom?: 'ok' | 'falha';
}

// As caixas dos 30 dias, só com o que o motor mandou (numeros-do-time.js, na raiz): os PRs, os
// aprovados de primeira e, quando o motor os conta, os pedidos de mudança (as revisões publicadas
// desses PRs que pediram mudanças). Sem os números, nenhuma caixa: a tela não inventa zero.
export function numerosDoCartao(n: NumerosDoAutor | undefined): NumeroDoCartao[] {
  if (!n) return [];
  const caixas: NumeroDoCartao[] = [
    { rotulo: 'PRs revisados', valor: String(n.prs) },
    { rotulo: 'aprovados de primeira', valor: String(n.aprovadosDePrimeira), tom: 'ok' },
  ];
  if (n.bloqueios !== undefined) caixas.push({ rotulo: 'pedidos de mudança', valor: String(n.bloqueios), tom: 'falha' });
  return caixas;
}
