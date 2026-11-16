import { useId, type ReactNode } from 'react';
import { linkDoPr } from '@/radar/formato';
import estilos from './Radar.module.css';

interface Props {
  titulo: string;
  quantidade: number;
  // a linha que o bloco mostra quando não tem item
  vazio: string;
  // Itens que o motor mandou e esta tela não conseguiu ler. Entram no título e viram um
  // aviso: o bloco não diz que está vazio com item escondido.
  ilegiveis?: number;
  children?: ReactNode;
}

// Um bloco do Radar: título de segundo nível com a contagem, e a lista ou a linha de vazio.
export function Bloco({ titulo, quantidade, vazio, ilegiveis = 0, children }: Props) {
  const id = useId();
  return (
    <section className={estilos.bloco} aria-labelledby={id}>
      <h2 id={id} className={estilos.tituloDoBloco}>
        {titulo}{' '}
        <span className={estilos.contagem}>
          ({quantidade}{ilegiveis ? `, e mais ${ilegiveis} que esta tela não lê` : ''})
        </span>
      </h2>
      {ilegiveis ? (
        <p className={`${estilos.nota} ${estilos.bloqueio}`}>
          Atenção: {ilegiveis} pendência(s) chegaram em formato que esta tela não lê; veja o log do navegador.
        </p>
      ) : null}
      {quantidade === 0 && !ilegiveis ? <p className={estilos.vazio}>{vazio}</p> : null}
      {quantidade > 0 ? children : null}
    </section>
  );
}

// A chave do PR, como link quando a URL é do GitHub por HTTPS, e como texto no resto. O
// conteúdo é sempre texto: nada que vem do motor entra como HTML.
export function ReferenciaDoPr({ chave, url }: { chave: string; url: string | undefined }) {
  const href = linkDoPr(url);
  if (!href) return <span className={estilos.referencia}>{chave}</span>;
  return (
    <a className={estilos.referencia} href={href} target="_blank" rel="noreferrer noopener">
      {chave}
      <span className={estilos.soLeitor}> (abre em nova aba)</span>
    </a>
  );
}
