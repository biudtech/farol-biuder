'use client';

// A lista do Time: uma linha por pessoa, na ordem em que o motor mandou, com o avatar das
// iniciais, o nome e o papel à direita ("Sem papel", em âmbar, quando não há). A linha é um
// botão que abre o dossiê na própria página. Nada aqui é calculado.
import { memo } from 'react';
import type { Autor, Pessoa, Pessoas } from '@/contratos/time';
import { iniciais, nomeDaPessoa, papelCurto, perfilDe } from '@/time/time';
import { ui } from '../ui';
import estilos from './Time.module.css';

// O id do botão que abre o dossiê: é para ele que o foco volta quando o dossiê fecha.
export function idDoBotao(login: string): string {
  return `ver-dossie-${encodeURIComponent(login.toLowerCase())}`;
}

// O avatar com as iniciais. É enfeite: o nome vai escrito ao lado.
export function Avatar({ nome, grande }: { nome: string; grande?: boolean }) {
  return <span className={grande ? `${estilos.avatar} ${estilos.avatarGrande}` : estilos.avatar} aria-hidden="true">{iniciais(nome)}</span>;
}

interface PropsDaLinha {
  login: string;
  // ausente em quem só tem perfil gravado
  autor?: Autor;
  perfil: Pessoa | undefined;
  aoAbrir(login: string): void;
}

const LinhaDaPessoa = memo(function LinhaDaPessoa({ login, autor, perfil, aoAbrir }: PropsDaLinha) {
  const nome = nomeDaPessoa(login, autor);
  return (
    <li>
      <button id={idDoBotao(login)} type="button" className={ui.linhaLink} onClick={() => aoAbrir(login)}>
        <Avatar nome={nome} />
        <span className={ui.t}>{nome}</span>
        {/* O login vai ao leitor de tela quando o nome é outro: é ele que identifica a pessoa.
            Os espaços ficam fora dos spans: o nome acessível não guarda espaço da borda de um. */}
        {nome !== login ? <>{' '}<span className={ui.soLeitor}>(@{login}),</span></> : <span className={ui.soLeitor}>,</span>}
        {' '}
        <span className={`${ui.r} ${ui.empurra}${perfil?.papel ? '' : ` ${estilos.semPapel}`}`}>{papelCurto(perfil)}</span>
      </button>
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
    <ul className={`${ui.lista} ${estilos.semMarcador}`} aria-label="Pessoas do Time">
      {autores.map((autor) => <LinhaDaPessoa key={`d:${autor.login}`} login={autor.login} autor={autor} perfil={perfilDe(pessoas, autor.login)} aoAbrir={aoAbrir} />)}
      {soComPerfil.map((login) => <LinhaDaPessoa key={`p:${login}`} login={login} perfil={perfilDe(pessoas, login)} aoAbrir={aoAbrir} />)}
    </ul>
  );
});
