'use client';

// O endereço e a leitura do Consumo, no molde do Histórico: a consulta mora na query string
// (lida pelo Next, escrita pela History API), cada pedido novo aborta o anterior e a resposta
// só é gravada pelo pedido que ainda vale. O "carregando" não é estado guardado: é a diferença
// entre o pedido de agora e o da última resposta.
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lerRespostaDoConsumo, type OpcoesDeFiltro, type Relatorio } from '@/contratos/consumo';
import { caminhoDoRelatorio, enderecoDa, lerEndereco, type Consulta } from '@/consumo/consulta';
import type { Cliente, Resultado } from '@/transporte/cliente';

// empilhar: entra no histórico do navegador (período, filtro, página).
// trocar: substitui a entrada atual (a busca e a data enquanto se digita, a página corrigida).
export type ModoDeIr = 'empilhar' | 'trocar';

export interface Endereco {
  consulta: Consulta;
  ir(consulta: Consulta, modo: ModoDeIr): void;
}

export function useEnderecoDoConsumo(): Endereco {
  const params = useSearchParams();
  const caminho = usePathname();
  const consulta = useMemo(() => lerEndereco(params), [params]);
  const ir = useCallback((para: Consulta, modo: ModoDeIr) => {
    const query = enderecoDa(para);
    const url = query ? `${caminho}?${query}` : caminho;
    if (modo === 'trocar') window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
  }, [caminho]);
  return { consulta, ir };
}

type Falha = Extract<Resultado<never>, { ok: false }>;

const SEM_OPCOES: OpcoesDeFiltro = Object.freeze({ kind: [], model: [], repo: [] });

interface Guardado {
  pedido: string;
  relatorio: Relatorio | null;
  // a frase com que o motor disse que não entrega o relatório (200 com `ok: false`)
  motivo: string | null;
  falha: Falha | null;
  // a marca do consumo no snapshot quando este relatório chegou
  marca: string | null;
  // da última resposta boa: os seletores e os períodos prontos não somem num erro
  opcoes: OpcoesDeFiltro;
  fim: string | null;
}

export interface LeituraDoConsumo {
  carregando: boolean;
  // O último relatório lido. Durante uma carga é o anterior, que a tela mostra esmaecido.
  relatorio: Relatorio | null;
  motivo: string | null;
  falha: Falha | null;
  opcoes: OpcoesDeFiltro;
  // o último dia do relatório mais recente: é dele que saem os períodos prontos
  fim: string | null;
  // o snapshot passou a contar sessão que este relatório não viu
  haNovo: boolean;
}

export function useRelatorio(cliente: Pick<Cliente, 'get'>, consulta: Consulta, recarga: number, marcaAtual: string | null): LeituraDoConsumo {
  const [guardado, setGuardado] = useState<Guardado | null>(null);
  const caminho = caminhoDoRelatorio(consulta);
  const pedido = `${recarga}|${caminho}`;
  const marca = useRef(marcaAtual);
  useEffect(() => { marca.current = marcaAtual; });

  useEffect(() => {
    const controle = new AbortController();
    void cliente.get(caminho, lerRespostaDoConsumo, { sinal: controle.signal }).then((r) => {
      // o pedido foi trocado por outro: a resposta dele não vale mais
      if (controle.signal.aborted) return;
      setGuardado((antes) => {
        const mantido = { marca: antes?.marca ?? null, opcoes: antes?.opcoes ?? SEM_OPCOES, fim: antes?.fim ?? null };
        if (!r.ok) return { pedido, relatorio: null, motivo: null, falha: r, ...mantido };
        if (!r.dados.ok) return { pedido, relatorio: null, motivo: r.dados.motivo, falha: null, ...mantido };
        const { relatorio } = r.dados;
        return { pedido, relatorio, motivo: null, falha: null, marca: marca.current, opcoes: relatorio.options, fim: relatorio.range.end };
      });
    });
    return () => controle.abort();
  }, [cliente, caminho, pedido]);

  const carregando = guardado?.pedido !== pedido;
  // O relatório chegou antes do primeiro snapshot: a primeira marca que aparecer vale como a
  // da carga, em vez de virar "há consumo novo" sem ter entrado nenhum.
  if (guardado && !carregando && guardado.relatorio && guardado.marca === null && marcaAtual !== null) setGuardado({ ...guardado, marca: marcaAtual });

  return {
    carregando,
    relatorio: guardado?.relatorio ?? null,
    motivo: carregando ? null : guardado?.motivo ?? null,
    falha: carregando ? null : guardado?.falha ?? null,
    opcoes: guardado?.opcoes ?? SEM_OPCOES,
    fim: guardado?.fim ?? null,
    haNovo: !carregando && guardado !== null && guardado.relatorio !== null && guardado.marca !== null && marcaAtual !== null && guardado.marca !== marcaAtual,
  };
}
