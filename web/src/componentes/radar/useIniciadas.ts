'use client';

// O "Iniciando a revisão." que aparece na hora do clique em Revisar, antes do servidor. O motor
// só abre a sessão depois: até ela aparecer em `activeSessions` (ou o PR ir esperar vaga), o
// cartão do PR mostra o começo, com o tempo desde o clique. Recusa do motor desfaz na hora; sem
// sessão em 2 min (o motor aceitou e não abriu), o cartão volta ao que era.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PrEmEspera, SessaoAtiva } from '@/contratos/radar';
import type { Acao } from '@/radar/acoes';
import type { ControleDeAcoes } from './useAcoes';

export const PRAZO_DO_INICIO_MS = 120000;

const relogio = (): number => Date.now();

function sem(mapa: ReadonlyMap<string, number>, chaves: (chave: string) => boolean): ReadonlyMap<string, number> {
  const fora = [...mapa.keys()].filter(chaves);
  if (!fora.length) return mapa;
  const novo = new Map(mapa);
  for (const chave of fora) novo.delete(chave);
  return novo;
}

export function useIniciadas(controle: ControleDeAcoes, sessoes: readonly SessaoAtiva[], emEspera: readonly PrEmEspera[]) {
  const [iniciadas, setIniciadas] = useState<ReadonlyMap<string, number>>(() => new Map());

  // a sessão abriu (ou o PR foi esperar vaga): o cartão do PR deixa de dizer que está iniciando
  const abertas = useMemo(() => new Set([...sessoes.map((s) => s.pr?.key ?? s.keys?.[0] ?? ''), ...emEspera.map((p) => p.key)]), [sessoes, emEspera]);
  const [vistas, setVistas] = useState(abertas);
  if (vistas !== abertas) {
    setVistas(abertas);
    const depois = sem(iniciadas, (chave) => abertas.has(chave));
    if (depois !== iniciadas) setIniciadas(depois);
  }

  useEffect(() => {
    if (!iniciadas.size) return undefined;
    const primeira = Math.min(...iniciadas.values());
    const id = setTimeout(() => setIniciadas((antes) => sem(antes, (chave) => relogio() - (antes.get(chave) ?? 0) >= PRAZO_DO_INICIO_MS)), Math.max(0, primeira + PRAZO_DO_INICIO_MS - relogio()));
    return () => clearTimeout(id);
  }, [iniciadas]);

  const disparar = useCallback(async (acao: Acao): Promise<boolean> => {
    if (acao.tipo !== 'revisar' || controle.emCurso(acao.alvo) !== null) return controle.disparar(acao);
    setIniciadas((antes) => new Map(antes).set(acao.alvo, relogio()));
    const aceito = await controle.disparar(acao);
    if (!aceito) setIniciadas((antes) => sem(antes, (chave) => chave === acao.alvo));
    return aceito;
  }, [controle]);

  const comInicio = useMemo<ControleDeAcoes>(() => ({ ...controle, disparar }), [controle, disparar]);
  return { iniciadas, controle: comInicio };
}
