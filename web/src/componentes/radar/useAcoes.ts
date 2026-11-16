'use client';

// O estado das ações do Radar: o que está no ar, o resultado da última e o que foi ignorado
// nesta aba. Nada aqui mexe no snapshot: depois do POST, quem muda a tela é o estado que o
// motor empurra pelo fluxo.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { executar, idDa, type Acao } from '@/radar/acoes';
import type { Cliente } from '@/transporte/cliente';

export interface ResultadoDaAcao {
  tom: 'ok' | 'erro';
  texto: string;
}

// PR ignorado por esta aba. O snapshot não traz a lista dos ignorados do motor, então só dá
// para oferecer o Restaurar do que saiu daqui, e a lista some ao recarregar a página.
export interface Ignorado {
  chave: string;
  nome: string;
}

export interface ControleDeAcoes {
  // o id (idDa) da ação que está no ar para o alvo, ou null
  emCurso(alvo: string): string | null;
  // Envia a ação. Devolve true quando o motor aceitou. Com outra ação do mesmo alvo no ar,
  // não envia nada.
  disparar(acao: Acao): Promise<boolean>;
}

export function useAcoes(cliente: Pick<Cliente, 'post'>) {
  const [noAr, setNoAr] = useState<ReadonlyMap<string, string>>(() => new Map());
  // a trava de verdade contra o clique dobrado: o estado só chega no próximo desenho
  const alvosNoAr = useRef(new Set<string>());
  const montado = useRef(true);
  const [resultado, setResultado] = useState<ResultadoDaAcao | null>(null);
  const [ignorados, setIgnorados] = useState<readonly Ignorado[]>([]);

  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);

  const disparar = useCallback(async (acao: Acao): Promise<boolean> => {
    if (alvosNoAr.current.has(acao.alvo)) return false;
    alvosNoAr.current.add(acao.alvo);
    setNoAr((antes) => new Map(antes).set(acao.alvo, idDa(acao)));
    setResultado(null);
    const desfecho = await executar(cliente, acao);
    alvosNoAr.current.delete(acao.alvo);
    if (!montado.current) return false;
    setNoAr((antes) => {
      const depois = new Map(antes);
      depois.delete(acao.alvo);
      return depois;
    });
    // a sessão acabou com o pedido no ar: a tela vai ao pareamento, sem mensagem
    if (desfecho.tipo === 'cancelado') return false;
    setResultado({ tom: desfecho.tipo, texto: desfecho.texto });
    if (desfecho.tipo !== 'ok') return false;
    if (acao.tipo === 'ignorar') setIgnorados((antes) => [...antes.filter((i) => i.chave !== acao.chave), { chave: acao.chave, nome: acao.nome }]);
    if (acao.tipo === 'restaurar') setIgnorados((antes) => antes.filter((i) => i.chave !== acao.chave));
    return true;
  }, [cliente]);

  const controle = useMemo<ControleDeAcoes>(() => ({ emCurso: (alvo) => noAr.get(alvo) ?? null, disparar }), [noAr, disparar]);
  const dispensar = useCallback(() => setResultado(null), []);

  return { controle, resultado, dispensar, ignorados };
}
