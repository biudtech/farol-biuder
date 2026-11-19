// O que o cartão de uma revisão do Histórico diz (redesenho, lote 4), sem React: a borda pelo que
// foi publicado, a linha de contexto, o rodapé com o que o diário de consumo sabe da rodada
// (GET /api/decision, `execucao`) e cada sessão dela. Nada aqui é calculado além de juntar o que
// veio: a soma do custo e da duração é do motor. As horas são de Brasília, como os grupos do dia.
import type { Gatilho, Revisao, SessaoDaRodada } from '@/contratos/historico';
import { dolar } from '@/consumo/formato';
import { rotuloDoPerfil, type TomDoCartao } from '@/radar/cartao';
import { textoDaDuracao } from './consulta';
import { FUSO_DO_HISTORICO, horaCurta } from './dias';
import { foiPublicado, tomDoDesfecho } from './rotulos';

type Perfis = readonly { id: string; label?: string }[] | undefined;

const juntar = (...partes: string[]): string => partes.filter(Boolean).join(' · ');

const TOM: Record<ReturnType<typeof tomDoDesfecho>, TomDoCartao> = { ok: 'ok', aviso: 'aviso', ruim: 'falha', neutro: 'fila' };

// Aprovado verde, comentado âmbar, pediu mudanças vermelho, nada postado na borda neutra.
export function tomDoCartao(r: Pick<Revisao, 'action' | 'status'>): TomDoCartao {
  return TOM[tomDoDesfecho(r)];
}

// "14:32 · rodada 2 de 2 · card BT-9": a rodada vem das rodadas do PR quando o detalhe chegou, e
// da comparação entre rodadas (a ordem desta) sem ele.
export function contextoDoCartao(r: Revisao, fuso: string = FUSO_DO_HISTORICO): string {
  const hora = horaCurta(r.resolvedAt ?? r.createdAt, fuso);
  const desta = r.rodadasDoPr?.itens.find((item) => item.id === r.id);
  let rodada = '';
  if (desta && r.rodadasDoPr) rodada = `rodada ${desta.rodada} de ${r.rodadasDoPr.itens.length}`;
  else if (r.rounds?.ordinal !== undefined && Number.isInteger(r.rounds.ordinal) && r.rounds.ordinal > 0) rodada = `${r.rounds.ordinal}ª rodada`;
  return juntar(hora, rodada, r.card ? `card ${r.card}` : '');
}

function nomesDosPerfis(ids: readonly string[] | undefined, perfis: Perfis): string {
  if (!ids?.length) return '';
  const nomes = ids.map((id) => rotuloDoPerfil(id, perfis));
  return `${nomes.length === 1 ? 'perfil' : 'perfis'} ${nomes.join(', ')}`;
}

// "14:32 · 12 min · 2 sessões · US$ 0,84 · perfil X". O tempo é o do diário quando ele sabe a
// rodada inteira, senão o das etapas desta sessão; as sessões são as que o motor listou (ou o
// total de tentativas, quando a lista não veio).
export function rodapeDoCartao(r: Revisao, perfis: Perfis, fuso: string = FUSO_DO_HISTORICO): string {
  const hora = horaCurta(r.resolvedAt ?? r.createdAt, fuso);
  const e = r.execucao;
  const ms = e?.duracaoMs ?? (r.stages?.totalMs ? r.stages.totalMs : undefined);
  const n = e ? (e.sessoes?.length ?? e.tentativas) : 0;
  const sessoes = n ? (n === 1 ? '1 sessão' : `${n} sessões`) : '';
  const custo = e?.custoUsd !== undefined ? `${dolar(e.custoUsd)}${e.custoEstimado ? ' (estimado)' : ''}` : '';
  if (!hora && !ms && !sessoes && !custo) return '';
  return juntar(hora, ms !== undefined ? textoDaDuracao(ms) : '', sessoes, custo, nomesDosPerfis(e?.perfis, perfis));
}

// Por que a sessão rodou (gatilho-da-sessao.js, na raiz).
export const ROTULO_DO_GATILHO: Record<Gatilho, string> = {
  primeira: 'primeira revisão',
  commit_novo: 'commit novo',
  rodada_extra: 'rodada extra no mesmo commit',
  contestacao: 'contestação do autor',
};

const RETOMADA: Record<string, string> = {
  retomada: 'retomou a conversa anterior',
  recusada: 'a retomada foi recusada e a conversa recomeçou',
  nova: 'conversa nova',
};

// O desfecho da tentativa no diário (DESFECHOS, lib/engine/usage-desfechos.js); `ok` não precisa ser dito.
const DESFECHO: Record<string, string> = {
  ok: '',
  erro: 'terminou com erro',
  cancelada: 'cancelada',
  parcial: 'terminou pela metade',
  descartada: 'descartada',
  interrompida: 'interrompida',
  desconhecido: '',
};

const proprio = (tabela: Record<string, string>, chave: string | undefined): string | undefined =>
  (chave !== undefined && Object.hasOwn(tabela, chave) ? tabela[chave] : undefined);

// "14:32 · commit novo · opus · perfil · 4 min · US$ 0,40 · retomou a conversa anterior".
export function textoDaSessao(s: SessaoDaRodada, perfis: Perfis, fuso: string = FUSO_DO_HISTORICO): string {
  const desfecho = proprio(DESFECHO, s.status) ?? `desfecho ${s.status}`;
  return juntar(
    horaCurta(s.em, fuso) || 'hora não registrada',
    s.gatilho ? ROTULO_DO_GATILHO[s.gatilho] : '',
    s.modelo ?? '',
    s.perfil ? rotuloDoPerfil(s.perfil, perfis) : '',
    s.duracaoMs !== undefined ? textoDaDuracao(s.duracaoMs) : '',
    s.custoUsd !== undefined ? dolar(s.custoUsd) : '',
    proprio(RETOMADA, s.retomada) ?? '',
    desfecho,
  );
}

// O texto do review que o motor gravou (reportMarkdown): `postado` quando a revisão publicou no
// PR, `naoPostado` quando há texto e nada saiu, `sem` quando não há texto.
export function temTextoDoReview(r: Pick<Revisao, 'action' | 'status' | 'reportMarkdown'>): 'postado' | 'naoPostado' | 'sem' {
  if (!r.reportMarkdown) return 'sem';
  return r.status !== 'pending' && foiPublicado(r.action) ? 'postado' : 'naoPostado';
}
