import { useId, type ReactNode } from 'react';
import { linkDoPr } from '@/radar/formato';
import estilos from './Radar.module.css';

interface Props {
  titulo: string;
  quantidade: number;
  // a linha que o bloco mostra quando não tem item
  vazio: string;
  children?: ReactNode;
}

// Um bloco do Radar: título de segundo nível com a contagem, e a lista ou a linha de vazio.
export function Bloco({ titulo, quantidade, vazio, children }: Props) {
  const id = useId();
  return (
    <section className={estilos.bloco} aria-labelledby={id}>
      <h2 id={id} className={estilos.tituloDoBloco}>
        {titulo} <span className={estilos.contagem}>({quantidade})</span>
      </h2>
      {quantidade === 0 ? <p className={estilos.vazio}>{vazio}</p> : children}
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
