// As frases das linhas "Critérios do card", "Checks do head" e "Execução" do detalhe de uma revisão, sobre o que
// GET /api/decision manda (lib/engine/detalhe-da-decisao.js, na raiz). Sem React. Nada aqui é
// calculado além de juntar o que veio: a soma do custo e da duração é do motor.
import type { AchadoDaRevisao, ChecksDoHead, CriterioDoCard, ExecucaoDaRevisao, RodadaDoPr, Severidade, TamanhoDoPr } from '@/contratos/historico';
import { dolar } from '@/consumo/formato';
import { textoDaDuracao } from './consulta';

const ESTADO_DO_CHECK: Record<string, string> = { vermelho: 'falhou', rodando: 'ainda rodando', ausente: 'não começou' };

export function textoDoEstadoDoCheck(estado: string): string {
  return Object.hasOwn(ESTADO_DO_CHECK, estado) ? ESTADO_DO_CHECK[estado] as string : estado || 'estado não informado';
}

function herdadosNaLinha(herdados: readonly { nome: string }[]): string {
  if (!herdados.length) return '';
  const nomes = herdados.slice(0, 2).map((c) => c.nome).join(', ');
  const resto = herdados.length > 2 ? ` e mais ${herdados.length - 2}` : '';
  return ` · ${nomes}${resto} ${herdados.length === 1 ? 'herdado' : 'herdados'}`;
}

// O resumo na própria linha: "tudo verde · osv herdado", "1 fora do verde", ou que a leitura
// não foi no commit revisado (aí nada do que veio fala do head da decisão).
export function resumoDosChecks(c: ChecksDoHead): string {
  if (!c.conferidoNoHead) return 'não conferidos no commit revisado';
  if (c.semExigencia) return 'a base não exige check';
  const base = c.naoVerdes.length ? `${c.naoVerdes.length} fora do verde` : 'tudo verde';
  return base + herdadosNaLinha(c.herdados);
}

// "7 min · US$ 2,84": o que o diário sabe da rodada. Sem duração nem custo, diz quantas
// tentativas o diário tem dela.
export function resumoDaExecucao(e: ExecucaoDaRevisao): string {
  const partes: string[] = [];
  if (e.duracaoMs !== undefined) partes.push(textoDaDuracao(e.duracaoMs));
  if (e.custoUsd !== undefined) partes.push(`${dolar(e.custoUsd)}${e.custoEstimado ? ' (estimado)' : ''}`);
  if (partes.length) return partes.join(' · ');
  return e.tentativas === 1 ? '1 tentativa no diário' : `${e.tentativas} tentativas no diário`;
}

// "2 de 3 atendidos", e quantos ficaram sem conferir quando há: a contagem do que a sessão
// declarou, critério a critério.
export function resumoDosCriterios(criterios: readonly CriterioDoCard[]): string {
  const atendidos = criterios.filter((c) => c.atende === true).length;
  const semConferir = criterios.filter((c) => c.atende === null).length;
  const base = `${atendidos} de ${criterios.length} atendidos`;
  return semConferir ? `${base} · ${semConferir} sem conferir` : base;
}

// A severidade do achado, como o desenho: o que bloqueia, a sugestão, a pergunta e o detalhe.
export const ROTULO_DA_SEVERIDADE: Record<Severidade, string> = { blocking: 'Bloqueia', suggestion: 'Sugestão', question: 'Pergunta', nitpick: 'Detalhe' };

const SITUACAO_DO_ACHADO: Record<string, string> = { persiste: 'persiste da rodada anterior', resolvido: 'resolvido nesta rodada', retirado: 'retirado nesta rodada' };

export function textoDaSituacao(situacao: string | undefined): string {
  return situacao && Object.hasOwn(SITUACAO_DO_ACHADO, situacao) ? SITUACAO_DO_ACHADO[situacao] as string : '';
}

// "src/x.ts:267", ou só o arquivo quando a sessão não disse a linha.
export function localDoAchado(a: AchadoDaRevisao): string {
  if (!a.arquivo) return '';
  return a.linha ? `${a.arquivo}:${a.linha}` : a.arquivo;
}

// "14 arquivos, +612 −148", ou só os arquivos quando a revisão não gravou adições e remoções.
export function textoDoTamanho(t: TamanhoDoPr): string {
  const arquivos = t.arquivos === 1 ? '1 arquivo' : `${t.arquivos} arquivos`;
  return t.adicoes !== undefined && t.remocoes !== undefined ? `${arquivos}, +${t.adicoes} −${t.remocoes}` : arquivos;
}

const PUBLICADO_NA_RODADA: Record<string, string> = { approve: 'aprovou', request_changes: 'pediu mudanças', comment: 'comentou' };
const PARECER_NA_RODADA: Record<string, string> = { approve: 'aprovar', request_changes: 'pedir mudanças', comment: 'comentar' };

// "3ª · 17/11, 13:21 · a3f91c2 · pediu mudanças": a rodada, a hora, o head curto e o desfecho. O
// que não foi publicado diz isso, com o parecer da sessão quando há.
export function textoDaRodada(r: RodadaDoPr, quando: (ms: number) => string): string {
  let desfecho: string;
  if (r.pendente) desfecho = 'na mesa, nada postado ainda';
  else if (r.publicado) desfecho = PUBLICADO_NA_RODADA[r.publicado] ?? r.publicado;
  else desfecho = r.parecer ? `nada publicado (o parecer era ${PARECER_NA_RODADA[r.parecer] ?? r.parecer})` : 'nada publicado';
  return [`${r.rodada}ª`, r.em ? quando(r.em) : '', r.head ?? '', desfecho].filter(Boolean).join(' · ');
}

const ESTADO_DO_CRITERIO = { sim: 'Atende', nao: 'Não atende', nulo: 'Não conferido' } as const;

export function textoDoCriterio(atende: boolean | null): string {
  if (atende === null) return ESTADO_DO_CRITERIO.nulo;
  return atende ? ESTADO_DO_CRITERIO.sim : ESTADO_DO_CRITERIO.nao;
}
