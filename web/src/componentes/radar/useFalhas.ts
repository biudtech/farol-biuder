'use client';

// As sessões que sumiram sem resultado, nesta aba (src/radar/falhas.ts tem a regra). O motor não
// guarda a lista: quem vê a sessão sair é a tela, comparando um estado com o anterior. Recarregar
// a página esquece as falhas, e Dispensar tira uma.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Estacionado, LinhaDoFeed, Pendencia, SessaoAtiva } from '@/contratos/radar';
import { CARENCIA_MS, falhaSuperada, motivoDaFalha, sumidas, vistaDa, visivel, type Falha, type SessaoVista } from '@/radar/falhas';

export type FalhaComMotivo = Falha & { motivo: string };

interface Entrada {
  sessoes: readonly SessaoAtiva[];
  feeds: Readonly<Record<string, LinhaDoFeed[]>>;
  pendentes: readonly Pendencia[];
  resolvidas: readonly unknown[];
  estacionados?: Readonly<Record<string, Estacionado>>;
}

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

export function useFalhas({ sessoes, feeds, pendentes, resolvidas, estacionados }: Entrada) {
  const [visto, setVisto] = useState(() => ({ sessoes, feeds, lista: vistas(sessoes, feeds, []) }));
  const [falhas, setFalhas] = useState<readonly Falha[]>([]);
  // Ajuste de estado no desenho, como o React prevê para estado que depende de propriedade: a
  // sessão que estava no estado anterior e não está neste vira falha candidata.
  if (visto.sessoes !== sessoes || visto.feeds !== feeds) {
    const novas = visto.sessoes !== sessoes ? sumidas(visto.lista, sessoes, relogio()) : [];
    setVisto({ sessoes, feeds, lista: vistas(sessoes, feeds, visto.lista) });
    if (novas.length) setFalhas((antes) => [...antes.filter((f) => !novas.some((n) => n.chave === f.chave)), ...novas]);
  }

  // A falha só aparece depois da carência: a decisão pode chegar no estado seguinte.
  const [agora, setAgora] = useState(relogio);
  useEffect(() => {
    const pendente = falhas.filter((f) => !visivel(f, agora));
    if (!pendente.length) return undefined;
    // a espera conta do relógio de agora, não do último instante guardado (que pode ser antigo)
    const espera = Math.max(0, Math.min(...pendente.map((f) => f.sumiuEm + CARENCIA_MS - relogio())));
    const id = setTimeout(() => setAgora(relogio()), espera + 50);
    return () => clearTimeout(id);
  }, [falhas, agora]);

  const lista = useMemo<FalhaComMotivo[]>(
    () => falhas
      .filter((f) => visivel(f, agora) && !falhaSuperada(f, { sessoes, pendentes, resolvidas }))
      .map((f) => ({ ...f, motivo: motivoDaFalha(f, estacionados && Object.hasOwn(estacionados, f.chave) ? estacionados[f.chave] : undefined) })),
    [falhas, agora, sessoes, pendentes, resolvidas, estacionados],
  );
  const dispensar = useCallback((chave: string) => setFalhas((antes) => antes.filter((f) => f.chave !== chave)), []);
  return { falhas: lista, dispensar };
}
