'use client';

// O estado das ações do Radar: o que está no ar, o resultado da última e o que foi ignorado
// nesta aba. Nada aqui mexe no snapshot: depois do POST, quem muda a tela é o estado que o
// motor empurra pelo fluxo.
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { executar, idDa, textoDoEnvio, type Acao, type DesfechoAceito } from '@/radar/acoes';
import type { Cliente } from '@/transporte/cliente';

// info: o pedido está no ar ("Enviando"). ok e erro: o que o motor respondeu.
export interface ResultadoDaAcao {
  tom: 'info' | 'ok' | 'erro';
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
  // Leva o foco à região do resultado: é para onde ele vai quando o botão que o tinha sai
  // da tela (a pergunta de confirmação que fechou).
  focarResultado(): void;
}

// `aoAceitar`: chamado depois de cada aceite do motor, com a ação e o desfecho (o Sistema usa
// para ir ao pareamento quando a sessão revogada era a deste navegador).
export function useAcoes(cliente: Pick<Cliente, 'post'>, aoAceitar?: (acao: Acao, desfecho: DesfechoAceito) => void) {
  const [noAr, setNoAr] = useState<ReadonlyMap<string, string>>(() => new Map());
  // a trava de verdade contra o clique dobrado: o estado só chega no próximo desenho
  const alvosNoAr = useRef(new Set<string>());
  const montado = useRef(true);
  const regiao: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);
  const [resultado, setResultado] = useState<ResultadoDaAcao | null>(null);
  const [ignorados, setIgnorados] = useState<readonly Ignorado[]>([]);
  // a versão mais nova do aviso, sem refazer o `disparar` a cada desenho
  const avisarAceite = useRef(aoAceitar);
  useEffect(() => { avisarAceite.current = aoAceitar; }, [aoAceitar]);

  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);

  const disparar = useCallback(async (acao: Acao): Promise<boolean> => {
    if (alvosNoAr.current.has(acao.alvo)) return false;
    alvosNoAr.current.add(acao.alvo);
    setNoAr((antes) => new Map(antes).set(acao.alvo, idDa(acao)));
    // a região viva anuncia o envio, e depois o que o motor respondeu
    setResultado({ tom: 'info', texto: textoDoEnvio(acao) });
    const desfecho = await executar(cliente, acao);
    alvosNoAr.current.delete(acao.alvo);
    if (!montado.current) return false;
    setNoAr((antes) => {
      const depois = new Map(antes);
      depois.delete(acao.alvo);
      return depois;
    });
    // a sessão acabou com o pedido no ar: a tela vai ao pareamento, sem mensagem
    if (desfecho.tipo === 'cancelado') {
      setResultado(null);
      return false;
    }
    setResultado({ tom: desfecho.tipo, texto: desfecho.texto });
    if (desfecho.tipo !== 'ok') return false;
    if (acao.tipo === 'ignorar') setIgnorados((antes) => [...antes.filter((i) => i.chave !== acao.chave), { chave: acao.chave, nome: acao.nome }]);
    if (acao.tipo === 'restaurar') setIgnorados((antes) => antes.filter((i) => i.chave !== acao.chave));
    avisarAceite.current?.(acao, desfecho);
    return true;
  }, [cliente]);

  const focarResultado = useCallback(() => { regiao.current?.focus(); }, []);
  const controle = useMemo<ControleDeAcoes>(
    () => ({ emCurso: (alvo) => noAr.get(alvo) ?? null, disparar, focarResultado }),
    [noAr, disparar, focarResultado],
  );
  const dispensar = useCallback(() => setResultado(null), []);

  return { controle, resultado, dispensar, ignorados, regiao };
}
