'use client';

// A diferença entre o relógio do navegador e o do motor. As horas da sessão (o começo, o sinal de
// vida, as linhas do feed) são do motor; o relógio da tela é do navegador. Sem a diferença, um
// motor adiantado deixava o tempo decorrido parado em "0 s", e um atrasado acendia o "sem sinal"
// antes da hora. A medida é feita na chegada de cada retrato, contra o `agora` que o motor manda
// nele (snapshot(), server.js), e arredondada ao segundo (desvioDoRelogio).
import { useState } from 'react';
import { desvioDoRelogio } from '@/radar/cartao';

// o relógio entra de fora para o teste; a tela usa o do navegador
const relogio = (): number => Date.now();

// Só troca com 2 s ou mais de diferença da medida anterior: o atraso de entrega do retrato varia,
// e trocar a cada empurrão redesenharia as seções sem motivo.
const FOLGA_MS = 2000;

export function useDesvio(horaDoMotor: number | undefined): number {
  const [medida, setMedida] = useState(() => ({ hora: horaDoMotor, desvio: horaDoMotor === undefined ? 0 : desvioDoRelogio(horaDoMotor, relogio()) }));
  // Ajuste de estado no desenho, como o React prevê para estado que depende de propriedade.
  if (horaDoMotor !== undefined && horaDoMotor !== medida.hora) {
    const novo = desvioDoRelogio(horaDoMotor, relogio());
    const primeira = medida.hora === undefined;
    setMedida({ hora: horaDoMotor, desvio: primeira || Math.abs(novo - medida.desvio) >= FOLGA_MS ? novo : medida.desvio });
  }
  return medida.desvio;
}
