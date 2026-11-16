'use client';

// O rascunho de um formulário do Sistema: o que a pessoa editou, partindo do que o motor
// mandou. É o molde do editor de perfil do Time: quando o valor do motor muda com a edição
// aberta, o rascunho acompanha se nada foi editado (ou se o motor ficou igual ao rascunho,
// que é o salvar daqui chegando); senão a edição fica e a tela avisa, com o descartar.
import { useCallback, useState } from 'react';

export interface Rascunho<T> {
  valor: T;
  // houve edição que ainda não está no motor
  alterado: boolean;
  // o motor mudou o valor com a edição aberta, e as duas divergem
  mudouNoMotor: boolean;
  editar(novo: T): void;
  // joga a edição fora e volta ao que o motor tem agora
  descartar(): void;
}

// `partir` monta o rascunho do valor do motor; `marcaDe` diz quando dois rascunhos são o
// mesmo. As duas precisam ser estáveis (funções de módulo).
export function useRascunho<M, T>(doMotor: M, partir: (motor: M) => T, marcaDe: (rascunho: T) => string): Rascunho<T> {
  const [estado, setEstado] = useState(() => {
    const valor = partir(doMotor);
    return { base: marcaDe(valor), valor };
  });
  const daqui = partir(doMotor);
  const noMotor = marcaDe(daqui);
  const editado = marcaDe(estado.valor);
  let mudouNoMotor = false;
  // ajuste de estado no desenho, como o React prevê para estado que depende de propriedade
  if (estado.base !== noMotor) {
    if (editado === estado.base || editado === noMotor) setEstado({ base: noMotor, valor: daqui });
    else mudouNoMotor = true;
  }
  const editar = useCallback((novo: T) => setEstado((antes) => ({ base: antes.base, valor: novo })), []);
  const descartar = (): void => setEstado({ base: noMotor, valor: daqui });
  return { valor: estado.valor, alterado: editado !== noMotor, mudouNoMotor, editar, descartar };
}
