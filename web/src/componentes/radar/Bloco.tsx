import { linkDoPr } from '@/radar/formato';
import { ui } from '@/componentes/ui';
import estilos from './Radar.module.css';

// As peças de PR que as telas repetem. O conteúdo é sempre texto: nada que vem do motor entra
// como HTML, e o link só sai para o GitHub por HTTPS (linkDoPr).

// A chave do PR, como link quando a URL é do GitHub por HTTPS, e como texto no resto.
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

// "Abrir no GitHub", no detalhe de uma linha. O nome acessível leva a chave, para o leitor de
// tela distinguir os links da lista. Sem URL do GitHub por HTTPS, não há link.
export function AbrirNoGitHub({ chave, url, className }: { chave: string; url: string | null | undefined; className?: string }) {
  const href = linkDoPr(url ?? undefined);
  if (!href) return null;
  return (
    <a className={className ? `${ui.link} ${className}` : ui.link} href={href} target="_blank" rel="noreferrer noopener">
      Abrir no GitHub
      <span className={ui.soLeitor}>: {chave} (abre em nova aba)</span>
    </a>
  );
}
