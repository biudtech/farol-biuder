'use client';

// Uma leitura sob demanda do Sistema (o diagnóstico, um teste, a lista de sessões): o pedido
// novo aborta o anterior, a resposta só é gravada pelo pedido que ainda vale, e sair da
// página aborta o que estiver no ar. A última leitura boa fica na tela durante a carga
// seguinte e depois de uma falha.
import { useCallback, useEffect, useRef, useState } from 'react';
import { mensagemDaFalha } from '@/historico/consulta';
import type { Resultado } from '@/transporte/cliente';

export interface Chamada<T> {
  carregando: boolean;
  // a última resposta boa
  dados: T | null;
  // a frase da última falha; some na chamada seguinte
  erro: string | null;
  // Faz a chamada. Devolve os dados, ou null na falha e no cancelamento.
  chamar(pedir: (sinal: AbortSignal) => Promise<Resultado<T>>): Promise<T | null>;
}

export function useChamada<T>(): Chamada<T> {
  const [estado, setEstado] = useState<{ carregando: boolean; dados: T | null; erro: string | null }>({ carregando: false, dados: null, erro: null });
  const emCurso = useRef<AbortController | null>(null);

  useEffect(() => () => { emCurso.current?.abort(); }, []);

  const chamar = useCallback(async (pedir: (sinal: AbortSignal) => Promise<Resultado<T>>): Promise<T | null> => {
    emCurso.current?.abort();
    const controle = new AbortController();
    emCurso.current = controle;
    setEstado((antes) => ({ ...antes, carregando: true, erro: null }));
    const r = await pedir(controle.signal);
    // o pedido foi trocado por outro, ou a página saiu: a resposta dele não vale mais
    if (controle.signal.aborted) return null;
    if (r.ok) {
      setEstado({ carregando: false, dados: r.dados, erro: null });
      return r.dados;
    }
    // cancelado: a sessão acabou com o pedido no ar, e a tela vai ao pareamento
    setEstado((antes) => ({ ...antes, carregando: false, erro: mensagemDaFalha(r) || null }));
    return null;
  }, []);

  return { ...estado, chamar };
}
