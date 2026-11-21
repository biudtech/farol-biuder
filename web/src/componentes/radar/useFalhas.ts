'use client';

// As sessões que sumiram sem resultado, nesta aba (src/radar/falhas.ts tem a regra). O motor não
// guarda a lista: quem vê a sessão sair é a tela, comparando um estado com o anterior. Recarregar
// a página esquece as falhas. Nada pede clique para sumir (regra do dono de 20/11/2026): a falha
// sai com sessão ou decisão nova do PR, quando o PR sai da fila, ou sozinha depois de
// VALIDADE_DA_FALHA_MS (o teto).
import { useEffect, useMemo, useState } from 'react';
import type { Estacionado, LinhaDoFeed, Pendencia, SessaoAtiva } from '@/contratos/radar';
import { CARENCIA_MS, VALIDADE_DA_FALHA_MS, expirada, falhaSuperada, motivoDaFalha, saiuDaFila, sumidas, vistaDa, visivel, type Falha, type SessaoVista } from '@/radar/falhas';

export type FalhaComMotivo = Falha & { motivo: string };

interface Entrada {
  sessoes: readonly SessaoAtiva[];
  feeds: Readonly<Record<string, LinhaDoFeed[]>>;
  pendentes: readonly Pendencia[];
  resolvidas: readonly unknown[];
  estacionados?: Readonly<Record<string, Estacionado>>;
  // a diferença entre o relógio do navegador e o do motor, em ms
  desvio?: number;
  // as chaves dos PRs na fila do motor (a `queue`)
  fila?: ReadonlySet<string>;
}

const FILA_VAZIA: ReadonlySet<string> = new Set<string>();

function vistas(sessoes: readonly SessaoAtiva[], feeds: Entrada['feeds'], antes: readonly SessaoVista[]): SessaoVista[] {
  const lista: SessaoVista[] = [];
  for (const s of sessoes) {
    const anterior = antes.find((v) => v.id === s.id);
    const vista = vistaDa(s, Object.hasOwn(feeds, s.id) ? feeds[s.id] : undefined, anterior?.etapa);
    if (vista) lista.push(vista);
  }
  return lista;
}

// o relógio entra de fora para o teste; a tela usa o do navegador
const relogio = (): number => Date.now();

export function useFalhas({ sessoes, feeds, pendentes, resolvidas, estacionados, desvio = 0, fila = FILA_VAZIA }: Entrada) {
  const [visto, setVisto] = useState(() => ({ sessoes, feeds, lista: vistas(sessoes, feeds, []) }));
  const [falhas, setFalhas] = useState<readonly Falha[]>([]);
  // Ajuste de estado no desenho, como o React prevê para estado que depende de propriedade: a
  // sessão que estava no estado anterior e não está neste vira falha candidata.
  if (visto.sessoes !== sessoes || visto.feeds !== feeds) {
    const novas = visto.sessoes !== sessoes ? sumidas(visto.lista, sessoes, relogio(), desvio).map((f) => ({ ...f, naFila: fila.has(f.chave) })) : [];
    setVisto({ sessoes, feeds, lista: vistas(sessoes, feeds, visto.lista) });
    if (novas.length) setFalhas((antes) => [...antes.filter((f) => !novas.some((n) => n.chave === f.chave)), ...novas]);
  }
  // o PR que saiu da fila leva a falha junto, também da memória da aba (se voltar, não a traz)
  const [filaVista, setFilaVista] = useState(fila);
  if (filaVista !== fila) {
    setFilaVista(fila);
    if (falhas.some((f) => saiuDaFila(f, fila))) setFalhas((antes) => antes.filter((f) => !saiuDaFila(f, fila)));
  }

  // A falha só aparece depois da carência (a decisão pode chegar no estado seguinte) e sai
  // sozinha depois da validade. O relógio acorda no próximo desses instantes.
  const [agora, setAgora] = useState(relogio);
  useEffect(() => {
    const vivas = falhas.filter((f) => !expirada(f, agora));
    if (!vivas.length) return undefined;
    // a espera conta do relógio de agora, não do último instante guardado (que pode ser antigo)
    const instantes = vivas.map((f) => (visivel(f, agora) ? f.sumiuEm + CARENCIA_MS + VALIDADE_DA_FALHA_MS : f.sumiuEm + CARENCIA_MS));
    const espera = Math.max(0, Math.min(...instantes) - relogio());
    const id = setTimeout(() => {
      const instante = relogio();
      setAgora(instante);
      // a expirada sai da memória da aba também, não só da tela
      setFalhas((antes) => (antes.some((f) => expirada(f, instante)) ? antes.filter((f) => !expirada(f, instante)) : antes));
    }, espera + 50);
    return () => clearTimeout(id);
  }, [falhas, agora]);

  const lista = useMemo<FalhaComMotivo[]>(
    () => falhas
      .filter((f) => visivel(f, agora) && !saiuDaFila(f, fila) && !falhaSuperada(f, { sessoes, pendentes, resolvidas }))
      .map((f) => ({ ...f, motivo: motivoDaFalha(f, estacionados && Object.hasOwn(estacionados, f.chave) ? estacionados[f.chave] : undefined) })),
    [falhas, agora, sessoes, pendentes, resolvidas, estacionados, fila],
  );
  return { falhas: lista };
}
