'use client';

// O rascunho de um formulário do Sistema: o que a pessoa editou, partindo do que o motor
// mandou. Guarda também a PARTIDA, que é o valor do motor que ela viu ao começar a editar: o
// que ela alterou é a diferença entre o rascunho e a partida, não a diferença contra o motor
// de agora.
//
// Quando o valor do motor muda com a edição aberta:
// - sem edição (ou com o motor igual ao rascunho, que é o salvar daqui chegando), o rascunho
//   acompanha o motor;
// - com edição, o rascunho é refeito sobre o valor novo (`refazer`): o campo que a pessoa não
//   tocou passa a mostrar o que o motor tem agora, e o que ela tocou fica com o valor dela. O
//   campo que os dois mexeram, cada um para um valor, volta em `conflitos`, para a tela dizer.
import { useCallback, useState } from 'react';
import type { Refeito } from '@/sistema/rascunho';

export interface Rascunho<T> {
  valor: T;
  // o valor do motor de onde a edição partiu (depois de refeito, o de agora)
  partida: T;
  // houve edição que ainda não está no motor
  alterado: boolean;
  // o motor mudou o valor com a edição aberta
  mudouNoMotor: boolean;
  // os campos em conflito desde que a edição começou
  conflitos: readonly string[];
  editar(novo: T): void;
  // joga a edição fora e volta ao que o motor tem agora
  descartar(): void;
}

interface Estado<T> {
  base: string;
  partida: T;
  valor: T;
  mudou: boolean;
  conflitos: readonly string[];
}

const SEM_CONFLITOS: readonly string[] = Object.freeze([]);

// `partir` monta o rascunho do valor do motor; `marcaDe` diz quando dois rascunhos são o
// mesmo; `refazer` refaz o rascunho sobre o valor novo do motor. As três precisam ser
// estáveis (funções de módulo).
export function useRascunho<M, T>(
  doMotor: M,
  partir: (motor: M) => T,
  marcaDe: (rascunho: T) => string,
  refazer: (partida: T, rascunho: T, novaPartida: T) => Refeito<T>,
): Rascunho<T> {
  const limpo = (motor: M): Estado<T> => {
    const valor = partir(motor);
    return { base: marcaDe(valor), partida: valor, valor, mudou: false, conflitos: SEM_CONFLITOS };
  };
  const [estado, setEstado] = useState(() => limpo(doMotor));
  const daqui = partir(doMotor);
  const noMotor = marcaDe(daqui);
  const editado = marcaDe(estado.valor);
  // ajuste de estado no desenho, como o React prevê para estado que depende de propriedade
  if (estado.base !== noMotor) {
    if (editado === estado.base || editado === noMotor) setEstado(limpo(doMotor));
    else {
      const refeito = refazer(estado.partida, estado.valor, daqui);
      setEstado({ base: noMotor, partida: daqui, valor: refeito.valor, mudou: true, conflitos: [...new Set([...estado.conflitos, ...refeito.conflitos])] });
    }
  }
  const alterado = editado !== noMotor;
  const editar = useCallback((novo: T) => setEstado((antes) => ({ ...antes, valor: novo })), []);
  const descartar = (): void => setEstado(limpo(doMotor));
  return {
    valor: estado.valor,
    partida: estado.partida,
    alterado,
    mudouNoMotor: estado.mudou && alterado,
    conflitos: alterado ? estado.conflitos : SEM_CONFLITOS,
    editar,
    descartar,
  };
}
