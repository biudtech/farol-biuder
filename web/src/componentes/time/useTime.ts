'use client';

// As duas leituras da tela Time: a lista de GET /api/team e o login do dossiê aberto, que
// mora no endereço. O pedido novo aborta o anterior, e a resposta só é gravada pelo pedido
// que ainda vale. O "carregando" não é estado guardado: é a diferença entre o pedido de agora
// e o da última resposta. Nada do que chega aqui vai a localStorage nem ao console.
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lerTime, type Time } from '@/contratos/time';
import { enderecoDoTime, lerEnderecoDoTime } from '@/time/time';
import type { Cliente, Resultado } from '@/transporte/cliente';

type Falha = Extract<Resultado<never>, { ok: false }>;

interface Guardado {
  pedido: number;
  time: Time | null;
  falha: Falha | null;
  // a marca das revisões resolvidas do snapshot quando esta lista chegou
  marca: string | null;
}

export interface LeituraDoTime {
  carregando: boolean;
  // A última lista lida. Durante uma carga é a anterior, que a tela mostra esmaecida; depois
  // de uma falha é a última boa, com o erro ao lado.
  time: Time | null;
  falha: Falha | null;
  // o motor resolveu revisão depois desta carga: a memória pode ter ganhado entrada
  haNovas: boolean;
}

export const CAMINHO_DO_TIME = '/api/team';

export function useTime(cliente: Pick<Cliente, 'get'>, recarga: number, marcaAtual: string | null): LeituraDoTime {
  const [guardado, setGuardado] = useState<Guardado | null>(null);
  const marca = useRef(marcaAtual);
  useEffect(() => { marca.current = marcaAtual; });

  useEffect(() => {
    const controle = new AbortController();
    void cliente.get(CAMINHO_DO_TIME, lerTime, { sinal: controle.signal }).then((r) => {
      // o pedido foi trocado por outro, ou a página saiu: a resposta dele não vale mais
      if (controle.signal.aborted) return;
      setGuardado((antes) => (r.ok
        ? { pedido: recarga, time: r.dados, falha: null, marca: marca.current }
        : { pedido: recarga, time: antes?.time ?? null, falha: r, marca: antes?.marca ?? null }));
    });
    return () => controle.abort();
  }, [cliente, recarga]);

  const carregando = guardado?.pedido !== recarga;
  // A lista chegou antes do primeiro snapshot: a primeira marca que aparecer vale como a da
  // carga, em vez de virar "há revisões novas" sem ter entrado nenhuma.
  if (guardado && !carregando && guardado.marca === null && marcaAtual !== null) setGuardado({ ...guardado, marca: marcaAtual });

  return {
    carregando,
    time: guardado?.time ?? null,
    falha: carregando ? null : guardado?.falha ?? null,
    haNovas: !carregando && guardado !== null && guardado.falha === null && guardado.marca !== null && marcaAtual !== null && guardado.marca !== marcaAtual,
  };
}

export interface EnderecoDoTime {
  // o login do dossiê aberto, ou null com a lista na tela
  autor: string | null;
  // Abrir e fechar o dossiê empilham uma entrada: o voltar do navegador desfaz. `trocar`
  // substitui a entrada atual: é o fechar depois de uma remoção, para o voltar do navegador
  // não reabrir o dossiê de quem saiu.
  ir(autor: string | null, modo?: 'empilhar' | 'trocar'): void;
}

// A leitura é do Next (useSearchParams); a escrita é pela History API, que o Next integra ao
// roteador, como no Histórico (src/componentes/historico/useEndereco.ts).
export function useEnderecoDoTime(): EnderecoDoTime {
  const params = useSearchParams();
  const caminho = usePathname();
  const autor = useMemo(() => lerEnderecoDoTime(params), [params]);
  const ir = useCallback((para: string | null, modo: 'empilhar' | 'trocar' = 'empilhar') => {
    const query = enderecoDoTime(para);
    const url = query ? `${caminho}?${query}` : caminho;
    if (modo === 'trocar') window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
  }, [caminho]);
  return { autor, ir };
}
