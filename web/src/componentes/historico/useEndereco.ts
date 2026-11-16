'use client';

// A consulta do Histórico mora no endereço da página: quem copia o endereço leva a busca, os
// filtros, a página e a revisão aberta, e o voltar do navegador desfaz a última troca.
//
// A leitura é do Next (useSearchParams); a escrita é pela History API do navegador, que o Next
// integra ao roteador (node_modules/next/dist/docs, "Native History API"): o endereço muda
// sem pedir a página de novo ao servidor.
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { enderecoDa, lerEndereco, type Consulta, type DetalheAberto } from '@/historico/consulta';

// empilhar: entra no histórico do navegador (filtro, página, abrir e fechar a revisão).
// trocar: substitui a entrada atual (a busca enquanto se digita, a página corrigida).
export type ModoDeIr = 'empilhar' | 'trocar';

export interface Endereco {
  consulta: Consulta;
  detalhe: DetalheAberto | null;
  ir(consulta: Consulta, detalhe: DetalheAberto | null, modo: ModoDeIr): void;
}

export function useEndereco(): Endereco {
  const params = useSearchParams();
  const caminho = usePathname();
  const { consulta, detalhe } = useMemo(() => lerEndereco(params), [params]);
  const ir = useCallback((para: Consulta, aberto: DetalheAberto | null, modo: ModoDeIr) => {
    const query = enderecoDa(para, aberto);
    const url = query ? `${caminho}?${query}` : caminho;
    if (modo === 'trocar') window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
  }, [caminho]);
  return { consulta, detalhe, ir };
}
