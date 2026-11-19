// O que a linha aberta de uma sessão mostra: os tokens por tipo, o tempo por etapa e as
// tentativas. Sem React. Os números são do motor; as contas daqui são de exibição e ficam
// dentro da mesma tentativa (a largura de cada faixa), nunca entre linhas ou tentativas.
import type { EtapaDaSessao, Execucao } from '@/contratos/consumo';
import { duracao, fracao, rotuloDoDesfecho } from './formato';

type Tokens = Pick<Execucao, 'inputTokens' | 'outputTokens' | 'thinkingTokens' | 'cacheReadTokens' | 'cacheCreationTokens'>;

const TIPOS = [
  { chave: 'input', campo: 'inputTokens', nome: 'Entrada' },
  { chave: 'output', campo: 'outputTokens', nome: 'Saída' },
  { chave: 'cacheRead', campo: 'cacheReadTokens', nome: 'Cache lido' },
  { chave: 'cacheCreation', campo: 'cacheCreationTokens', nome: 'Cache criado' },
  { chave: 'thinking', campo: 'thinkingTokens', nome: 'Pensamento' },
] as const;

const serve = (n: number | undefined): n is number => n !== undefined && Number.isFinite(n) && n >= 0;

// Os cinco tipos da mesma tentativa somados: é o total da linha, para a coluna Tokens e para a
// largura das faixas. undefined quando o motor não mandou nenhum.
export function somaDosTokens(e: Tokens): number | undefined {
  const valores = TIPOS.map((t) => e[t.campo]).filter(serve);
  return valores.length ? valores.reduce((a, b) => a + b, 0) : undefined;
}

export interface ParteDosTokens {
  chave: string;
  nome: string;
  valor: number;
  // a fatia no total da linha, de 0 a 100
  fracao: number;
}

// Os tipos que o motor mandou, do maior ao menor (no empate, a ordem da lista).
export function partesDosTokens(e: Tokens): ParteDosTokens[] {
  const total = somaDosTokens(e);
  return TIPOS.flatMap((t) => {
    const valor = e[t.campo];
    return serve(valor) ? [{ chave: t.chave, nome: t.nome, valor, fracao: fracao(valor, total) }] : [];
  }).sort((a, b) => b.valor - a.valor);
}

export interface BarraDaEtapa {
  id: string;
  nome: string;
  tempo: string;
  // relativa à etapa mais longa
  fracao: number;
}

export function barrasDasEtapas(etapas: readonly EtapaDaSessao[]): BarraDaEtapa[] {
  const maior = Math.max(0, ...etapas.map((e) => (serve(e.ms) ? e.ms : 0)));
  return etapas.map((e) => ({ id: e.id, nome: e.label ?? e.id, tempo: duracao(e.ms), fracao: fracao(e.ms, maior) }));
}

// Quantas tentativas e o desfecho de cada uma, da mais antiga à mais nova.
export function textoDasTentativas(tentativas: readonly Pick<Execucao, 'status'>[]): string {
  if (!tentativas.length) return 'sem dado';
  if (tentativas.length === 1) return '1';
  return `${tentativas.length}: ${tentativas.map((t) => rotuloDoDesfecho(t.status)).join(', depois ')}`;
}
