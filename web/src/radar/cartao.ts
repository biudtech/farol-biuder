// O cartão de um PR no Radar, no molde do cartão da autoanálise do Farol (canvas aprovado em
// 18/11/2026): a borda pela cor do estado, o cabeçalho, as três pílulas e a faixa com as cinco
// etapas, o tempo, o trilho e o rodapé. Sem React: aqui mora só o que o cartão diz, a partir do
// que o motor manda (snapshot, SSE e GET /api/decision). Nada é inventado: sem o dado, a linha
// some ou a pílula diz o traço com texto neutro.
//
// A etapa é a do `progresso` do motor (lib/engine/progresso-revisao.js), que nunca recua; quem
// guarda o piso na tela, para um estado atrasado não fazer a faixa voltar, é o componente.
import type { Retentativa } from '@/contratos/de-fora';
import type { LinhaDoFeed, ProgressoDaRevisao } from '@/contratos/radar';
import type { ChecksDoHead, CriterioDoCard, Revisao } from '@/contratos/historico';
import { resumoDaExecucao } from '@/historico/detalhe';
import { dataHora, horaCurta } from './formato';

// As etapas da faixa, na ordem do motor (fontes, card, código, conferência, postagem).
export const ETAPAS_DO_CARTAO = ['Fontes', 'Card', 'Código', 'Conferência', 'Postagem'] as const;
// a faixa com todas as etapas feitas
export const TODAS_FEITAS = ETAPAS_DO_CARTAO.length;
const CARD = 1;
const CODIGO = 2;
const CONFERENCIA = 3;
const POSTAGEM = 4;

// Sem evento da sessão por mais que isto, o modelo está calado: "Sem sinal".
export const SEM_SINAL_MS = 45000;
const MINUTO_MS = 60000;

// A cor da borda: rodando é a primária; postada aprovada, ok; pediu mudanças ou falha, perigo;
// sem sinal ou comentada, aviso; fila, neutra.
export type TomDoCartao = 'rodando' | 'ok' | 'falha' | 'aviso' | 'fila';

// "0 s", "18 s", "3 min 40 s", "7 min 02 s"
export function tempoDecorrido(ms: number): string {
  const s = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

function minutos(ms: number): number {
  return Math.max(1, Math.round(ms / MINUTO_MS));
}

function termina(ms: number | undefined): string {
  if (ms === undefined) return '';
  return ms < MINUTO_MS ? 'termina em menos de 1 min' : `termina em cerca de ${Math.round(ms / MINUTO_MS)} min`;
}

// ---------- o avatar ----------

// O login do GitHub: letra ou dígito, depois letras, dígitos e hífens, até 39. Conta de bot
// ("dependabot[bot]") e o que não tiver essa forma ficam só com as iniciais.
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export function urlDoAvatar(login: string | undefined): string | null {
  return login && LOGIN.test(login) ? `https://avatars.githubusercontent.com/${login}?s=72` : null;
}

// "thiago-prado" vira "TP"; "ana" vira "AN"; sem login, "?".
export function iniciais(login: string | undefined): string {
  const partes = (login ?? '').replace(/\[bot\]$/, '').split(/[-_.\s]+/).filter(Boolean);
  if (!partes.length) return '?';
  const letras = partes.length > 1 ? `${partes[0]?.[0] ?? ''}${partes[1]?.[0] ?? ''}` : (partes[0] ?? '').slice(0, 2);
  return letras.toUpperCase();
}

// ---------- a faixa ----------

export type EstadoDaEtapa = 'feita' | 'agora' | 'erro' | 'falta';

export interface EtapaDaFaixa {
  nome: string;
  estado: EstadoDaEtapa;
  // o traço antes desta etapa fica verde (até a atual)
  ligaFeita: boolean;
}

// A barra única: definida pela porcentagem da revisão inteira (`progresso.percentual`), com a
// frase de baixo; indefinida quando o motor ainda não mandou o progresso; ausente quando terminou.
export type Barra = { tipo: 'definida'; pct: number; texto: string } | { tipo: 'indefinida' } | null;

export interface Andamento {
  tipo: 'iniciando' | 'rodando' | 'mudo' | 'postada' | 'falha';
  // de 0 a 5: a etapa atual, ou 5 com todas feitas
  etapa: number;
  tom: TomDoCartao;
  texto: string;
  // o arquivo da vez, no código: o último que a sessão leu
  arquivo?: string;
  // o que vai ao lado do tempo: o típico, a conta que posta
  apoio: string;
  barra: Barra;
}

export function etapasDaFaixa(a: Pick<Andamento, 'tipo' | 'etapa'>): EtapaDaFaixa[] {
  const correndo = a.tipo === 'iniciando' || a.tipo === 'rodando' || a.tipo === 'mudo';
  return ETAPAS_DO_CARTAO.map((nome, i) => {
    let estado: EstadoDaEtapa = 'falta';
    if (i < a.etapa) estado = 'feita';
    else if (i === a.etapa && correndo) estado = 'agora';
    else if (i === a.etapa && a.tipo === 'falha') estado = 'erro';
    return { nome, estado, ligaFeita: i > 0 && i <= a.etapa };
  });
}

// A etapa do progresso do motor, de 0 a 4 (com 100% a postagem acabou e a sessão está saindo).
export function etapaDoProgresso(p: ProgressoDaRevisao | undefined): number {
  if (!p) return 0;
  return Math.min(POSTAGEM, Math.max(0, p.etapa - 1));
}

// O último sinal de vida da sessão, na hora do motor: a linha mais nova do feed, o sinal que o
// motor publica com o modelo pensando ou escrevendo (ultimoSinalEm, que não vira linha), ou o
// começo dela.
export function ultimoEvento(feed: readonly LinhaDoFeed[], inicio: number | undefined, sinal?: number): number | undefined {
  const ultima = feed.length ? feed[feed.length - 1]?.t : undefined;
  const candidatos = [ultima, inicio, sinal].filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0);
  return candidatos.length ? Math.max(...candidatos) : undefined;
}

export interface SinaisDaSessao {
  etapa: number;
  progresso?: ProgressoDaRevisao;
  // o último evento da sessão (ultimoEvento); sem ele não há como dizer "sem sinal"
  ultimoEvento?: number;
  agora: number;
  // quantas outras revisões estão em curso
  outras: number;
  // quanto uma revisão deste tamanho costuma levar, até o fim, quando o motor mediu
  costumaMs?: number;
  // a conta que vai postar
  conta?: string;
}

function costuma(ms: number | undefined): string {
  return ms ? `típico ${minutos(ms)} min` : '';
}

// A diferença entre o relógio do navegador e o do motor, arredondada ao segundo: a hora do motor
// é a do navegador menos ela. Medida na chegada do retrato, contra o `agora` que o motor manda.
export function desvioDoRelogio(horaDoMotor: number, horaDoNavegador: number): number {
  return Math.round((horaDoNavegador - horaDoMotor) / 1000) * 1000;
}

const juntar = (...partes: string[]): string => partes.filter(Boolean).join(' · ');

// O andamento da sessão em curso. "Sem sinal" só vale com o modelo trabalhando (código e
// conferência): nas fontes, no card e na postagem quem trabalha é o motor, que não fala no feed.
export function andamentoDaSessao(s: SinaisDaSessao): Andamento {
  const { etapa, progresso: p } = s;
  const barra: Barra = p
    ? { tipo: 'definida', pct: Math.round(p.percentual), texto: juntar('da revisão inteira', termina(p.restanteEstimadoMs)) }
    : { tipo: 'indefinida' };
  const base = { tipo: 'rodando' as const, etapa, tom: 'rodando' as const, barra };
  if ((etapa === CODIGO || etapa === CONFERENCIA) && s.ultimoEvento !== undefined && s.agora - s.ultimoEvento > SEM_SINAL_MS) {
    return {
      ...base, tipo: 'mudo', tom: 'aviso',
      texto: `Sem sinal do modelo há ${tempoDecorrido(s.agora - s.ultimoEvento)}. A sessão segue aberta.`,
      apoio: 'pode cancelar e tentar de novo',
    };
  }
  if (etapa === CARD) return { ...base, texto: 'Lendo o card no Jira.', apoio: costuma(s.costumaMs) };
  if (etapa === CODIGO) {
    const texto = p?.arquivosTotais === undefined ? 'Lendo o código do PR.' : `Lendo o código: ${p.arquivosLidos ?? 0} de ${p.arquivosTotais} arquivos`;
    const andamento: Andamento = { ...base, texto, apoio: costuma(s.costumaMs) };
    if (p?.arquivoAtual) andamento.arquivo = p.arquivoAtual;
    return andamento;
  }
  if (etapa === CONFERENCIA) return { ...base, texto: 'Conferindo no código o que a revisão afirmou.', apoio: costuma(s.costumaMs) };
  if (etapa >= POSTAGEM) return { ...base, texto: 'Postando a revisão no GitHub.', apoio: s.conta ? `pela conta @${s.conta}` : '' };
  const outras = s.outras > 0 ? `, com ${s.outras} ${s.outras === 1 ? 'outra revisão' : 'outras revisões'} em andamento` : '';
  return { ...base, texto: `Buscando o código do PR${outras}.`, apoio: costuma(s.costumaMs) };
}

// O clique em Revisar, antes de o servidor responder.
export function andamentoIniciando(costumaMs?: number): Andamento {
  return { tipo: 'iniciando', etapa: 0, tom: 'rodando', texto: 'Iniciando a revisão.', apoio: costuma(costumaMs), barra: { tipo: 'indefinida' } };
}

const semPonto = (texto: string): string => texto.trim().replace(/[.\s]+$/, '');

// A sessão que sumiu sem resultado, parada na etapa em que estava.
export function andamentoDaFalha(etapa: number, motivo: string): Andamento {
  const razao = semPonto(motivo);
  return {
    tipo: 'falha', etapa: Math.min(POSTAGEM, Math.max(0, etapa)), tom: 'falha',
    texto: razao ? `A sessão terminou sem resultado: ${razao}.` : 'A sessão terminou sem resultado.',
    apoio: 'nada foi publicado', barra: null,
  };
}

const DESFECHO: Record<string, { tom: TomDoCartao; verbo: string }> = {
  approve: { tom: 'ok', verbo: 'aprovada' },
  request_changes: { tom: 'falha', verbo: 'pediu mudanças' },
  comment: { tom: 'aviso', verbo: 'comentada' },
};

function desfechoDe(acao: string | undefined) {
  return acao && Object.hasOwn(DESFECHO, acao) ? DESFECHO[acao] : undefined;
}

// O head curto da rodada desta revisão, de `rodadasDoPr`.
function rodadaDesta(r: Revisao | undefined) {
  return r?.rodadasDoPr?.itens.find((item) => item.id === r.id);
}

// A revisão publicada: todas as etapas feitas, sem trilho, e o que saiu.
export function andamentoDaPostada(acao: string | undefined, detalhe: Revisao | undefined): Andamento {
  const d = desfechoDe(acao);
  const bloqueio = acao === 'request_changes' ? detalhe?.achados?.find((a) => a.severidade === 'blocking')?.titulo : undefined;
  const texto = d ? `Revisão postada: ${d.verbo}${bloqueio ? `, ${semPonto(bloqueio)}` : ''}.` : 'Revisão postada.';
  const head = rodadaDesta(detalhe)?.head;
  const apoio = juntar(head ? `commit ${head}` : '', detalhe?.execucao ? resumoDaExecucao(detalhe.execucao) : '');
  return { tipo: 'postada', etapa: TODAS_FEITAS, tom: d?.tom ?? 'ok', texto, apoio, barra: null };
}

// ---------- as pílulas ----------

export type TomDaPilula = 'ok' | 'aviso' | 'falha' | 'neutro';
export type IconeDaPilula = '✓' | '!' | '✕' | '\u2013';

export interface Pilula {
  rotulo: 'Checks obrigatórios' | 'Card' | 'Parecer';
  tom: TomDaPilula;
  icone: IconeDaPilula;
  texto: string;
}

// o neutro é o traço curto do desenho, por escape: o texto do código fica sem travessão
const ICONE: Record<TomDaPilula, IconeDaPilula> = { ok: '✓', aviso: '!', falha: '✕', neutro: '\u2013' };

function pilula(rotulo: Pilula['rotulo'], tom: TomDaPilula, texto: string): Pilula {
  return { rotulo, tom, icone: ICONE[tom], texto };
}

function herdados(c: ChecksDoHead): string {
  if (!c.herdados.length) return '';
  const nomes = c.herdados.slice(0, 2).map((h) => h.nome).join(', ');
  const resto = c.herdados.length > 2 ? ` e mais ${c.herdados.length - 2}` : '';
  return ` · ${nomes}${resto} ${c.herdados.length === 1 ? 'herdado' : 'herdados'} da base`;
}

export function pilulaDosChecks(c: ChecksDoHead | undefined, semDado: string): Pilula {
  if (!c) return pilula('Checks obrigatórios', 'neutro', semDado);
  if (!c.conferidoNoHead) return pilula('Checks obrigatórios', 'neutro', 'Não conferidos no commit revisado');
  if (c.semExigencia) return pilula('Checks obrigatórios', 'neutro', 'A base não exige check');
  if (c.naoVerdes.length) return pilula('Checks obrigatórios', 'falha', `${c.naoVerdes.length} fora do verde${herdados(c)}`);
  return pilula('Checks obrigatórios', 'ok', `Verdes${herdados(c)}`);
}

export function pilulaDosCriterios(criterios: readonly CriterioDoCard[] | undefined, card: string | undefined, semDado: string): Pilula {
  if (!criterios?.length) return pilula('Card', 'neutro', card ? `${card}: critérios não declarados` : semDado);
  const atendidos = criterios.filter((c) => c.atende === true).length;
  const texto = `${atendidos} de ${criterios.length} ${criterios.length === 1 ? 'critério atendido' : 'critérios atendidos'}`;
  return pilula('Card', atendidos === criterios.length ? 'ok' : 'aviso', texto);
}

function bloqueios(detalhe: Revisao | undefined): string {
  const n = detalhe?.achados?.filter((a) => a.severidade === 'blocking').length ?? 0;
  return n ? ` · ${n} ${n === 1 ? 'bloqueio' : 'bloqueios'}` : '';
}

export function pilulaDoParecer(acao: string | undefined, detalhe: Revisao | undefined): Pilula {
  if (acao === 'approve') return pilula('Parecer', 'ok', 'Aprovado');
  if (acao === 'request_changes') return pilula('Parecer', 'falha', `Pediu mudanças${bloqueios(detalhe)}`);
  if (acao === 'comment') return pilula('Parecer', 'aviso', 'Comentado');
  return pilula('Parecer', 'neutro', 'Nada foi publicado');
}

// Enquanto roda: os checks só são lidos no fim; o card, pela etapa e pela chave que o motor grava
// logo depois de ler (`card` da sessão; ausente depois da etapa, nenhum card foi lido); o parecer,
// em análise.
export function pilulasDaSessao(etapa: number, card?: string): Pilula[] {
  let doCard = pilula('Card', 'neutro', 'Nenhum card lido');
  if (etapa < CARD) doCard = pilula('Card', 'neutro', 'Ainda não lido');
  else if (etapa === CARD) doCard = pilula('Card', 'neutro', 'Lendo os critérios');
  else if (card) doCard = pilula('Card', 'ok', `${card} lido`);
  return [pilula('Checks obrigatórios', 'neutro', 'Lidos no fim da revisão'), doCard, pilula('Parecer', 'neutro', 'Em análise')];
}

export function pilulasDaFalha(etapa: number): Pilula[] {
  return [
    pilula('Checks obrigatórios', 'neutro', 'Não lidos'),
    pilula('Card', 'neutro', etapa > CARD ? 'Lido, sem parecer' : 'Ainda não lido'),
    pilula('Parecer', 'neutro', 'Nada foi publicado'),
  ];
}

// A postada: com o detalhe de GET /api/decision, os checks e os critérios; sem ele (carregando,
// falhou ou revisão anterior a 17/11/2026), o traço com o que se sabe.
export function pilulasDaPostada(acao: string | undefined, card: string | undefined, detalhe: Revisao | undefined, carregando: boolean): Pilula[] {
  const semDado = carregando ? 'Carregando' : 'Sem leitura gravada';
  return [
    pilulaDosChecks(detalhe?.checks, semDado),
    pilulaDosCriterios(detalhe?.criteriosDoCard, card, carregando ? 'Carregando' : 'Sem card'),
    pilulaDoParecer(acao, detalhe),
  ];
}

// ---------- a linha de contexto ----------

function tamanho(t: Revisao['tamanhoDoPr']): string {
  if (!t) return '';
  const arquivos = `${t.arquivos} ${t.arquivos === 1 ? 'arquivo' : 'arquivos'}`;
  return t.adicoes !== undefined && t.remocoes !== undefined ? `${arquivos}, +${t.adicoes} −${t.remocoes}` : arquivos;
}

// `perfil` é o rótulo do perfil do Claude que a sessão usa (perfilId lido em config.claudeProfiles).
export function contextoDaSessao(s: { arquivosPr?: number; pedido?: { por: string; em: string }; startedAt?: number }, fuso?: string, perfil?: string): string {
  const arquivos = s.arquivosPr ? `${s.arquivosPr} ${s.arquivosPr === 1 ? 'arquivo' : 'arquivos'}` : '';
  const pedido = s.pedido ? horaCurta(s.pedido.em, fuso) : '';
  const quando = pedido ? `pedido por @${s.pedido?.por} às ${pedido}` : (horaCurta(s.startedAt, fuso) ? `começou às ${horaCurta(s.startedAt, fuso)}` : '');
  return juntar(arquivos, quando, perfil ? `Claude: ${perfil}` : '');
}

// O rótulo do perfil do Claude pelo id: o `label` do perfil em config.claudeProfiles, ou o próprio
// id quando o perfil não está na lista (ou não tem rótulo).
export function rotuloDoPerfil(id: string | undefined, perfis: readonly { id: string; label?: string }[] | undefined): string {
  if (!id) return '';
  return perfis?.find((p) => p.id === id)?.label || id;
}

export function contextoDaFila(pr: { updatedAt?: string }, fuso?: string): string {
  const quando = dataHora(pr.updatedAt, fuso);
  return quando ? `atualizado em ${quando}` : '';
}

export function contextoDaPostada(r: { card?: string; resolvedAt?: number }, detalhe: Revisao | undefined, fuso?: string): string {
  const rodada = rodadaDesta(detalhe)?.rodada;
  const card = r.card ?? detalhe?.card;
  const hora = horaCurta(r.resolvedAt, fuso);
  return juntar(rodada ? `${rodada}ª rodada` : '', card ? `card ${card}` : '', tamanho(detalhe?.tamanhoDoPr), hora ? `postado às ${hora}` : '');
}

// A duração da revisão postada: a do diário quando ele sabe, senão a das etapas da sessão.
export function duracaoDaPostada(r: { stages?: { totalMs: number } }, detalhe: Revisao | undefined): string {
  const ms = detalhe?.execucao?.duracaoMs ?? (r.stages?.totalMs ? r.stages.totalMs : undefined);
  return ms === undefined ? '' : tempoDecorrido(ms);
}

// O que segura um PR da fila, pelo que o motor diz: a parada, o conflito com a base, a
// retentativa automática (com `aPartirDe`, o reset do limite do plano) e o início que espera o
// clique. Todos se resolvem sozinhos ou com o clique: o que não volta sozinho está em De fora.
export interface EsperaDaFila {
  parada?: string;
  manual?: boolean;
  conflito?: boolean;
  retentativa?: Retentativa;
}

// O rodapé da fila: a posição e o que segura o PR, quando o motor diz.
export function textoDaFila(posicao: number, o: EsperaDaFila, fuso?: string): string {
  if (o.parada) return o.parada;
  if (o.conflito) return `${posicao}º na fila, em conflito com a base: volta sozinho quando o conflito for resolvido. Revisar agora não espera.`;
  if (o.retentativa) {
    const quando = dataHora(o.retentativa.aPartirDe, fuso);
    if (quando) return `${posicao}º na fila, esperando o limite do plano: tenta de novo a partir de ${quando}.`;
    const n = o.retentativa.tentativas;
    return `${posicao}º na fila: nova tentativa automática${n > 0 ? ` (${n}ª)` : ''} quando abrir uma vaga.`;
  }
  if (o.manual) return `${posicao}º na fila: o motor não abre esta revisão sozinho, ela começa por Revisar agora.`;
  return `${posicao}º na fila: começa quando abrir uma vaga.`;
}

// A cor do ponto do rodapé da fila, que repete o texto: segue sozinho (ok), espera algo (aviso),
// parou (falha).
export function tomDaFila(o: EsperaDaFila): 'ok' | 'aviso' | 'falha' {
  if (o.parada) return 'falha';
  return o.conflito || o.retentativa || o.manual ? 'aviso' : 'ok';
}
