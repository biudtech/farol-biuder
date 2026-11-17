// As frases das linhas "Checks do head" e "Execução" do detalhe de uma revisão, sobre o que
// GET /api/decision manda (lib/engine/detalhe-da-decisao.js, na raiz). Sem React. Nada aqui é
// calculado além de juntar o que veio: a soma do custo e da duração é do motor.
import type { ChecksDoHead, ExecucaoDaRevisao } from '@/contratos/historico';
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
