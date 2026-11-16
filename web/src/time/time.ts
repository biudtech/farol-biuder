// A lógica da tela Time, sem React: o que mora no endereço, como fatiar o que o motor manda
// (a lista de GET /api/team, os perfis de `config.people` e as contestações de `pushbacks`) e
// como escrever cada campo. A tela só fatia e formata: a ordem da lista, o que é uma entrada
// e o que vale como perfil são do motor.
import type { Contestacao } from '@/contratos/historico';
import type { Autor, Pessoa, Pessoas } from '@/contratos/time';
import { ROTULO_DA_ACAO } from '@/historico/rotulos';
import { nomeDoPr } from '@/radar/formato';
import type { Conexao } from '@/transporte/cliente';
import { DOMINIOS, rotuloDoDominio, rotuloDoNivel, rotuloDoPapel } from './taxonomia';

// Quantas entradas o motor guarda por dossiê: writeMemory (lib/engine/decision.js) corta nas
// dez mais recentes. O teste ao lado confere o número contra o motor.
export const TETO_DE_ENTRADAS = 10;

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
// (updateSettings, server.js): por isso vai a lista toda, com esta pessoa alterada. Pessoa
// sem papel nem competência sai do mapa, que é o que o motor faria com a entrada vazia.
export function comPerfil(pessoas: Pessoas, login: string, perfil: Pessoa): Pessoas {
  const chave = chaveDaPessoa(login);
  const limpo = perfilLimpo(perfil);
  const resto = Object.entries(pessoas).filter(([outro]) => outro !== chave);
  // fromEntries define propriedade própria, qualquer que seja o login
  return Object.fromEntries(limpo ? [...resto, [chave, limpo]] : resto);
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

const pessoas = (n: number): string => (n === 1 ? '1 pessoa' : `${n} pessoas`);

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
// lista inteira de perfis desta aba: com a lista ausente, incompleta ou possivelmente velha,
// salvar apagaria perfil que a tela não tem.
export function motivoQueImpedeSalvar(estado: { pessoas: Pessoas | undefined; ilegiveis: number; conexao: Conexao }): string | null {
  if (!estado.pessoas) return 'O motor não mandou a lista de perfis a esta tela: não dá para salvar daqui, porque o salvar manda a lista inteira.';
  if (estado.ilegiveis > 0) {
    return `${estado.ilegiveis} perfil(is) chegaram do motor em formato que esta tela não lê. Salvar mandaria a lista sem eles, e o motor os apagaria: o salvar fica fechado.`;
  }
  if (estado.conexao !== 'conectado') {
    return `Esta aba está sem o estado do motor em dia (conexão: ${NOME_DA_CONEXAO[estado.conexao]}). A lista de perfis daqui pode estar velha, e salvar a mandaria inteira por cima da do motor: o salvar volta quando a conexão voltar.`;
  }
  return null;
}
