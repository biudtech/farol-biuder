'use client';

// A faixa do topo quando o fluxo de eventos cai com a tela já desenhada: diz que o que está na
// tela é do último estado recebido, desde quando, e quando sai a próxima tentativa (o recuo do
// cliente, de 3 a 30 s, src/transporte/recuo.ts). "Tentar agora" adianta a tentativa sem zerar o
// recuo. Sem snapshot não há o que avisar: a tela é a de conexão (Aplicacao.tsx).
import type { App } from '@/estado/app';
import { app as appDoNavegador, useApp } from '@/estado/instancia';
import { hora, horaCurta } from '@/radar/formato';
import { Botao, ui } from './ui';
import estilos from './Casca.module.css';

export function textoDaQueda(quedaEm: number, proximaTentativaEm: number | null): string {
  const quando = horaCurta(quedaEm);
  const inicio = quando ? `Sem motor: a conexão caiu às ${quando}.` : 'Sem motor: a conexão caiu.';
  const proxima = proximaTentativaEm === null ? 'Tentando reconectar…' : `A próxima tentativa sai às ${hora(proximaTentativaEm)}.`;
  return `${inicio} O que está na tela é do último estado recebido. ${proxima}`;
}

export function FaixaDeQueda({ app = appDoNavegador }: { app?: App }) {
  const caiu = useApp((e) => e.snapshot !== null && (e.conexao === 'reconectando' || e.conexao === 'sem-motor'), app);
  const quedaEm = useApp((e) => e.quedaEm, app);
  const proxima = useApp((e) => e.proximaTentativaEm, app);
  if (!caiu || quedaEm === null) return null;
  return (
    <div className={`${ui.erro} ${estilos.faixaDeQueda}`} role="status">
      <span>{textoDaQueda(quedaEm, proxima)}</span>
      <Botao pequeno ocupado={proxima === null ? 'Tentando reconectar…' : undefined} onClick={() => app.tentarReconectar()}>Tentar agora</Botao>
    </div>
  );
}
