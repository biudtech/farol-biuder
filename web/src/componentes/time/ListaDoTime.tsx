'use client';

// A lista do Time: um cartão por pessoa, na ordem em que o motor mandou. Cada campo diz o
// próprio nome, e o botão diz de quem é o dossiê que abre. Nada aqui é calculado: a contagem
// é o tamanho da lista de entradas, e a última entrada é a primeira que o motor listou.
import { memo, type ReactNode } from 'react';
import type { Autor, Pessoa, Pessoas } from '@/contratos/time';
import { dataDaEntrada, desfechoDaEntrada, perfilDe, prDaEntrada, textoDaCompetencia, textoDoPapel } from '@/time/time';
import comuns from '../radar/Radar.module.css';
import estilos from './Time.module.css';

// O id do botão que abre o dossiê: é para ele que o foco volta quando o dossiê fecha.
export function idDoBotao(login: string): string {
  return `ver-dossie-${encodeURIComponent(login.toLowerCase())}`;
}

export function Campo({ nome, children }: { nome: string; children: ReactNode }) {
  return (
    <div className={estilos.par}>
      <dt>{nome}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// A entrada mais recente numa linha: o dia, o PR e o que foi publicado, o que houver.
function textoDaUltima(autor: Autor): string {
  const ultima = autor.entries[0];
  if (!ultima) return 'Nenhuma';
  return [dataDaEntrada(ultima.date), prDaEntrada(ultima.ref), desfechoDaEntrada(ultima.verdict)].filter(Boolean).join(', ') || 'Sem data registrada';
}

interface PropsDoCartao {
  login: string;
  // ausente em quem só tem perfil gravado
  autor?: Autor;
  perfil: Pessoa | undefined;
  aoAbrir(login: string): void;
}

const Cartao = memo(function Cartao({ login, autor, perfil, aoAbrir }: PropsDoCartao) {
  return (
    <li className={comuns.cartao}>
      <h3 className={comuns.tituloDoCartao}>
        <span className={comuns.referencia}>@{login}</span>
        {autor?.name ? <span className={estilos.nome}>{autor.name}</span> : null}
      </h3>
      <dl className={estilos.campos}>
        {autor ? <Campo nome="Entradas de memória">{autor.entries.length ? String(autor.entries.length) : 'Nenhuma'}</Campo> : null}
        {autor?.entries.length ? <Campo nome="Última entrada">{textoDaUltima(autor)}</Campo> : null}
        <Campo nome="Papel">{textoDoPapel(perfil)}</Campo>
        <Campo nome="Competência">{textoDaCompetencia(perfil)}</Campo>
      </dl>
      <div className={comuns.botoes}>
        <button id={idDoBotao(login)} type="button" className={comuns.botao} aria-label={`Ver o dossiê de @${login}`} onClick={() => aoAbrir(login)}>
          Ver o dossiê
        </button>
      </div>
    </li>
  );
});

interface Props {
  autores: readonly Autor[];
  // logins com perfil gravado e sem dossiê
  soComPerfil: readonly string[];
  pessoas: Pessoas | undefined;
  aoAbrir(login: string): void;
}

export const ListaDoTime = memo(function ListaDoTime({ autores, soComPerfil, pessoas, aoAbrir }: Props) {
  return (
    <ul className={comuns.lista}>
      {autores.map((autor) => <Cartao key={`d:${autor.login}`} login={autor.login} autor={autor} perfil={perfilDe(pessoas, autor.login)} aoAbrir={aoAbrir} />)}
      {soComPerfil.map((login) => <Cartao key={`p:${login}`} login={login} perfil={perfilDe(pessoas, login)} aoAbrir={aoAbrir} />)}
    </ul>
  );
});
