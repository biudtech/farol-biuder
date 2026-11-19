'use client';

// As duas leituras do Histórico: a página da lista e a revisão do detalhe. Cada pedido novo
// aborta o anterior, e a resposta só é gravada pelo pedido que ainda vale. O "carregando" não
// é estado guardado: é a diferença entre o pedido de agora e o da última resposta.
import { useEffect, useMemo, useRef, useState } from 'react';
import { lerDetalheDaRevisao, lerPaginaDoHistorico, type DetalheDaRevisao, type PaginaDoHistorico, type Revisao } from '@/contratos/historico';
import { caminhoDaPagina, caminhoDoDetalhe, mensagemDaFalha, type Consulta, type DetalheAberto } from '@/historico/consulta';
import type { Cliente, Resultado } from '@/transporte/cliente';

type Falha = Extract<Resultado<never>, { ok: false }>;

interface Guardado {
  pedido: string;
  pagina: PaginaDoHistorico | null;
  // quando a página chegou: é o "hoje" dos grupos por dia
  lidaEm: number;
  falha: Falha | null;
  // a marca das resolvidas do snapshot quando esta página chegou
  marca: string | null;
  // os repositórios da última resposta boa: o seletor não esvazia num erro
  repos: readonly string[];
}

export interface LeituraDaPagina {
  carregando: boolean;
  // A última página lida com sucesso. Durante uma carga é a anterior, que a tela mostra
  // apagada; depois de uma falha também, com o erro em cima.
  pagina: PaginaDoHistorico | null;
  // quando a página mostrada chegou: o "hoje" dos grupos por dia
  lidaEm: number;
  falha: Falha | null;
  repos: readonly string[];
  // o snapshot passou a ter revisão resolvida que esta página não viu
  haNovas: boolean;
}

const SEM_REPOS: readonly string[] = Object.freeze([]);

export function usePagina(cliente: Pick<Cliente, 'get'>, consulta: Consulta, recarga: number, marcaAtual: string | null): LeituraDaPagina {
  const [guardado, setGuardado] = useState<Guardado | null>(null);
  const caminho = caminhoDaPagina(consulta);
  const pedido = `${recarga}|${caminho}`;
  const marca = useRef(marcaAtual);
  useEffect(() => { marca.current = marcaAtual; });

  useEffect(() => {
    const controle = new AbortController();
    void cliente.get(caminho, lerPaginaDoHistorico, { sinal: controle.signal }).then((r) => {
      // o pedido foi trocado por outro: a resposta dele não vale mais
      if (controle.signal.aborted) return;
      setGuardado((antes) => (r.ok
        ? { pedido, pagina: r.dados, lidaEm: Date.now(), falha: null, marca: marca.current, repos: r.dados.repos }
        // na falha, a última página boa fica: a tela a mostra com o erro em cima
        : { pedido, pagina: antes?.pagina ?? null, lidaEm: antes?.lidaEm ?? Date.now(), falha: r, marca: antes?.marca ?? null, repos: antes?.repos ?? SEM_REPOS }));
    });
    return () => controle.abort();
  }, [cliente, caminho, pedido]);

  const carregando = guardado?.pedido !== pedido;
  // A página chegou antes do primeiro snapshot: a primeira marca que aparecer vale como a da
  // carga, em vez de virar "há revisões novas" sem ter entrado nenhuma.
  if (guardado && !carregando && guardado.marca === null && marcaAtual !== null) setGuardado({ ...guardado, marca: marcaAtual });

  return {
    carregando,
    pagina: guardado?.pagina ?? null,
    lidaEm: guardado?.lidaEm ?? 0,
    falha: carregando ? null : guardado?.falha ?? null,
    repos: guardado?.repos ?? SEM_REPOS,
    haNovas: !carregando && guardado !== null && guardado.marca !== null && marcaAtual !== null && guardado.marca !== marcaAtual,
  };
}

export type LeituraDoDetalhe =
  | { fase: 'carregando' }
  // `outra`: a revisão veio pela chave do PR e não é a que o endereço pedia
  // `complementando`: a revisão é a da página, e o complemento de GET /api/decision ainda não voltou
  | { fase: 'pronto'; revisao: Revisao; outra: boolean; complementando?: true }
  | { fase: 'ausente' }
  | { fase: 'erro'; texto: string };

const CARREGANDO: LeituraDoDetalhe = Object.freeze({ fase: 'carregando' });
const AUSENTE: LeituraDoDetalhe = Object.freeze({ fase: 'ausente' });

// A revisão aberta. Vem da página carregada quando está nela; fora dela (endereço colado, a
// lista andou), é pedida ao motor pela chave do PR, que devolve a mais recente daquele PR.
// Mesmo da página ela é pedida, pela chave e pelo id: os checks do head, a execução e os critérios
// do card só vêm por
// GET /api/decision (lib/engine/detalhe-da-decisao.js), e o id faz o motor devolver esta revisão e
// não a mais recente do PR. Enquanto a resposta não chega, ou se ela falhar ou trouxer outra
// revisão, a da página é mostrada sem essas linhas.
// `listaLida`: a página da lista já respondeu (com dados ou com falha); antes disso não dá
// para saber se o item está nela.
// O que só a resposta por chave traz (os checks, a execução, os critérios do card, os achados com
// arquivo e linha, as rodadas do PR e o tamanho dele), quando ela é a mesma revisão da página.
const DO_DETALHE = ['checks', 'execucao', 'criteriosDoCard', 'achados', 'rodadasDoPr', 'tamanhoDoPr'] as const;

function comOComplemento(daPagina: Revisao, r: Resultado<DetalheDaRevisao> | null): Revisao {
  if (!r?.ok || !r.dados.encontrada || r.dados.revisao.id !== daPagina.id) return daPagina;
  const daRota = r.dados.revisao;
  const presentes = DO_DETALHE.filter((chave) => daRota[chave] !== undefined);
  if (!presentes.length) return daPagina;
  return { ...daPagina, ...Object.fromEntries(presentes.map((chave) => [chave, daRota[chave]])) };
}

export function useDetalhe(
  cliente: Pick<Cliente, 'get'>,
  aberto: DetalheAberto | null,
  itens: readonly Revisao[] | undefined,
  listaLida: boolean,
  tentativa: number,
): LeituraDoDetalhe | null {
  const [buscado, setBuscado] = useState<{ pedido: string; r: Resultado<DetalheDaRevisao> } | null>(null);
  const id = aberto?.id ?? '';
  const daPagina = useMemo(() => (id ? itens?.find((item) => item.id === id) : undefined), [itens, id]);
  // O endereço pode trazer só o id (sem `pr`): da página, a chave é a do próprio item.
  const chave = aberto?.chave || daPagina?.key || '';
  const buscar = id !== '' && chave !== '' && (daPagina !== undefined || listaLida);
  // da página, a revisão é certa e vai pelo id; fora dela, o endereço pode ser velho, e vale a
  // mais recente do PR (com o aviso de que é outra)
  const comId = daPagina !== undefined;
  const pedido = `${tentativa}|${id}|${chave}`;

  useEffect(() => {
    if (!buscar) return undefined;
    const controle = new AbortController();
    void cliente.get(caminhoDoDetalhe(chave, comId ? id : undefined), lerDetalheDaRevisao, { sinal: controle.signal }).then((r) => {
      if (!controle.signal.aborted) setBuscado({ pedido, r });
    });
    return () => controle.abort();
  }, [cliente, buscar, chave, pedido, comId, id]);

  return useMemo<LeituraDoDetalhe | null>(() => {
    if (!id) return null;
    if (daPagina) {
      const chegou = buscado?.pedido === pedido;
      const pronta = { fase: 'pronto' as const, revisao: comOComplemento(daPagina, chegou ? buscado.r : null), outra: false };
      // "complementando" só quando há pedido no ar: sem ele, a resposta nunca chegaria
      return chegou || !buscar ? pronta : { ...pronta, complementando: true as const };
    }
    if (!listaLida) return CARREGANDO;
    if (!chave) return AUSENTE;
    if (buscado?.pedido !== pedido) return CARREGANDO;
    const { r } = buscado;
    if (!r.ok) return { fase: 'erro', texto: mensagemDaFalha(r) || 'A busca da revisão foi interrompida.' };
    if (!r.dados.encontrada) return AUSENTE;
    return { fase: 'pronto', revisao: r.dados.revisao, outra: r.dados.revisao.id !== id };
  }, [id, chave, daPagina, listaLida, buscado, pedido, buscar]);
}
