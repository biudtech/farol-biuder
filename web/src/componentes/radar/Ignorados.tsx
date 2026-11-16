'use client';

// O bloco dos ignorados, com Restaurar. O snapshot não traz a lista dos PRs ignorados no
// motor: o bloco mostra só o que foi ignorado nesta aba, e diz isso.
import { memo } from 'react';
import { AcoesDoItem } from './AcoesDoItem';
import { Bloco } from './Bloco';
import type { ControleDeAcoes, Ignorado } from './useAcoes';
import estilos from './Radar.module.css';

export const Ignorados = memo(function Ignorados({ ignorados, controle }: { ignorados: readonly Ignorado[]; controle: ControleDeAcoes }) {
  return (
    <Bloco
      titulo="Ignorados"
      quantidade={ignorados.length}
      vazio="Nenhum PR ignorado nesta aba. O motor não manda a lista do que já foi ignorado, então só aparece aqui o que você ignorar agora."
    >
      <p className={estilos.meta}>Só o que foi ignorado nesta aba. A lista some ao recarregar a página.</p>
      <ul className={estilos.lista}>
        {ignorados.map((i) => (
          <li key={i.chave} className={`${estilos.cartao} ${estilos.linha}`}>
            <h3 className={estilos.tituloDoCartao}><span className={estilos.referencia}>{i.chave}</span></h3>
            <AcoesDoItem botoes={[{ acao: { tipo: 'restaurar', chave: i.chave, alvo: i.chave, nome: i.nome } }]} controle={controle} />
          </li>
        ))}
      </ul>
    </Bloco>
  );
});
