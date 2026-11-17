'use client';

// Os ignorados desta aba, com Restaurar. O snapshot não traz a lista dos PRs ignorados no
// motor: a seção mostra só o que foi ignorado nesta aba, diz isso, e some quando não há nada.
import { memo } from 'react';
import { Secao, ui } from '@/componentes/ui';
import { AcoesDoItem } from './AcoesDoItem';
import type { ControleDeAcoes, Ignorado } from './useAcoes';
import estilos from './Radar.module.css';

export const Ignorados = memo(function Ignorados({ ignorados, controle }: { ignorados: readonly Ignorado[]; controle: ControleDeAcoes }) {
  if (!ignorados.length) return null;
  return (
    <Secao titulo="Ignorados">
      <p className={ui.mini}>Só o que foi ignorado nesta aba. A lista some ao recarregar a página.</p>
      <ul className={`${ui.lista} ${estilos.semMarcador}`}>
        {ignorados.map((i) => (
          <li key={i.chave} className={estilos.ignorado}>
            <span className={ui.t}>{i.chave}</span>
            <AcoesDoItem pequeno botoes={[{ acao: { tipo: 'restaurar', chave: i.chave, alvo: i.chave, nome: i.nome } }]} controle={controle} />
          </li>
        ))}
      </ul>
    </Secao>
  );
});
