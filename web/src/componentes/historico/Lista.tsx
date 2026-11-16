'use client';

// A lista de uma página do Histórico. É lista com título por item, e não tabela: são oito
// campos por revisão, que em 375 px só cabem empilhados. Cada item tem o PR como título de
// terceiro nível e os campos numa lista de descrição, com o nome de cada um escrito.
import { memo } from 'react';
import type { Revisao } from '@/contratos/historico';
import { parecerQueDifere, textoDoPublicado, textoDoStatus } from '@/historico/rotulos';
import { dataComAno, nomeDoPr } from '@/radar/formato';
import { ReferenciaDoPr } from '../radar/Bloco';
import comuns from '../radar/Radar.module.css';
import estilos from './Historico.module.css';

// O id do botão que abre a revisão: é para ele que o foco volta quando o detalhe fecha.
export function idDoBotao(id: string): string {
  return `ver-revisao-${id}`;
}

export function Campo({ nome, children }: { nome: string; children: string }) {
  return (
    <div className={estilos.par}>
      <dt>{nome}</dt>
      <dd>{children}</dd>
    </div>
  );
}

interface PropsDoItem {
  revisao: Revisao;
  aoAbrir(revisao: Revisao): void;
}

const Item = memo(function Item({ revisao: r, aoAbrir }: PropsDoItem) {
  const nome = nomeDoPr(r.key);
  const quando = dataComAno(r.resolvedAt);
  const parecer = parecerQueDifere(r);
  return (
    <li className={comuns.cartao}>
      <h3 className={comuns.tituloDoCartao}><ReferenciaDoPr chave={r.key} url={r.pr?.url} /></h3>
      {r.pr?.title ? <p className={comuns.tituloDoPr}>{r.pr.title}</p> : null}
      <dl className={estilos.campos}>
        {r.pr?.author ? <Campo nome="Autor">{r.pr.author}</Campo> : null}
        {r.card ? <Campo nome="Card">{r.card}</Campo> : null}
        <Campo nome="Publicado">{textoDoPublicado(r)}</Campo>
        {parecer ? <Campo nome="Parecer da revisão">{parecer}</Campo> : null}
        <Campo nome="Situação">{textoDoStatus(r.status)}</Campo>
        <Campo nome="Quando">{quando || 'Sem data registrada'}</Campo>
      </dl>
      <div className={comuns.botoes}>
        <button
          id={idDoBotao(r.id)}
          type="button"
          className={comuns.botao}
          aria-label={`Ver a revisão de ${nome}${quando ? `, de ${quando}` : ''}`}
          onClick={() => aoAbrir(r)}
        >
          Ver a revisão
        </button>
      </div>
    </li>
  );
});

interface Props {
  itens: readonly Revisao[];
  aoAbrir(revisao: Revisao): void;
}

export const Lista = memo(function Lista({ itens, aoAbrir }: Props) {
  return (
    <ul className={comuns.lista}>
      {itens.map((revisao) => <Item key={revisao.id} revisao={revisao} aoAbrir={aoAbrir} />)}
    </ul>
  );
});
