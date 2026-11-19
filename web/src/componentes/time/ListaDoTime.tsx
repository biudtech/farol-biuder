'use client';

// A grade do Time (redesenho, lote 4): um cartão por pessoa, na ordem em que o motor mandou, na
// casca do cartão único (componentes/cartao). Cada cartão diz a foto, o nome e o login, o papel
// ("Sem papel", em âmbar, quando não há), os números de 30 dias que o motor manda (GET /api/team,
// `numeros`), "O que o Farol já aprendeu" (os pontos mais recentes que o motor anotou no
// dossiê), os domínios do perfil (`config.people`) e as ações Ver dossiê e Editar papel, que
// abrem o dossiê na própria página (Editar papel já com o papel no foco). Nada aqui é calculado:
// sem os números do motor, o cartão diz isso em vez de mostrar zero.
import { memo, useId } from 'react';
import type { Autor, Pessoa, Pessoas } from '@/contratos/time';
import { aprendizados, dominiosDoCartao, iniciais, markdownDosPontos, nomeDaPessoa, numerosDoCartao, papelCurto, perfilDe } from '@/time/time';
import { Avatar as FotoDoAutor, estilosDoCartao } from '../cartao/Cartao';
import { Markdown } from '../Markdown';
import { ui } from '../ui';
import estilos from './Time.module.css';

// O id do botão Ver dossiê: é para ele que o foco volta quando o dossiê fecha.
export function idDoBotao(login: string): string {
  return `ver-dossie-${encodeURIComponent(login.toLowerCase())}`;
}

// O avatar com as iniciais, no cabeçalho do dossiê. É enfeite: o nome vai escrito ao lado.
export function Avatar({ nome, grande }: { nome: string; grande?: boolean }) {
  return <span className={grande ? `${estilos.avatar} ${estilos.avatarGrande}` : estilos.avatar} aria-hidden="true">{iniciais(nome)}</span>;
}

interface PropsDoCartao {
  login: string;
  // ausente em quem só tem perfil gravado
  autor?: Autor;
  perfil: Pessoa | undefined;
  aoAbrir(login: string): void;
  aoEditar(login: string): void;
}

const CartaoDaPessoa = memo(function CartaoDaPessoa({ login, autor, perfil, aoAbrir, aoEditar }: PropsDoCartao) {
  const idDoNome = useId();
  const nome = nomeDaPessoa(login, autor);
  const numeros = numerosDoCartao(autor?.numeros);
  const pontos = aprendizados(autor);
  const dominios = dominiosDoCartao(perfil);
  let semNumeros = 'Sem números dos últimos 30 dias: o motor só os manda para quem teve PR com a primeira revisão publicada na janela, e com o histórico no ar.';
  if (!autor) semNumeros = 'Sem dossiê: o motor ainda não resolveu revisão de PR desta pessoa.';
  return (
    <li className={estilos.itemDaGrade}>
      <article className={`${estilosDoCartao.cartao} ${estilos.cartaoDaPessoa}`} aria-labelledby={idDoNome}>
        <div className={estilos.cabecaDaPessoa}>
          <FotoDoAutor login={login} />
          <div className={estilos.nomeDaPessoa}>
            <h2 id={idDoNome} className={estilos.nome}>{nome}</h2>
            <span className={estilos.login}>@{login}</span>
          </div>
          <span className={estilos.papel} data-sem-papel={perfil?.papel ? undefined : 'sim'}>
            <span className={ui.soLeitor}>Papel: </span>{papelCurto(perfil)}
          </span>
        </div>

        {numeros.length ? (
          <dl className={estilos.numerosDoCartao} aria-label={`Últimos ${autor?.numeros?.janelaDias ?? 30} dias`}>
            {numeros.map((n) => (
              <div key={n.rotulo} className={estilos.caixa}>
                <dt>{n.rotulo}</dt>
                <dd data-tom={n.tom}>{n.valor}</dd>
              </div>
            ))}
          </dl>
        ) : <p className={ui.mini}>{semNumeros}</p>}

        <section className={estilos.aprendeu} aria-label="O que o Farol já aprendeu">
          <h3 className={estilos.tituloDoAprendeu}>O que o Farol já aprendeu</h3>
          {pontos.length ? <Markdown texto={markdownDosPontos(pontos)} nivelBase={4} /> : (
            <p className={ui.mini}>{autor ? 'O motor ainda não anotou nenhum ponto no dossiê.' : 'Nada ainda: o dossiê nasce na primeira revisão resolvida.'}</p>
          )}
        </section>

        {dominios.length ? (
          <ul className={estilos.dominios} aria-label="Domínios">
            {dominios.map((d) => <li key={d} className={estilos.dominio}>{d}</li>)}
          </ul>
        ) : null}

        <div className={estilos.peDaPessoa}>
          <button id={idDoBotao(login)} type="button" className={ui.botao} onClick={() => aoAbrir(login)}>
            Ver dossiê{' '}<span className={ui.soLeitor}>de {nome}</span>
          </button>
          <button type="button" className={ui.botao} onClick={() => aoEditar(login)}>
            Editar papel{' '}<span className={ui.soLeitor}>de {nome}</span>
          </button>
        </div>
      </article>
    </li>
  );
});

interface Props {
  autores: readonly Autor[];
  // logins com perfil gravado e sem dossiê
  soComPerfil: readonly string[];
  pessoas: Pessoas | undefined;
  aoAbrir(login: string): void;
  aoEditar(login: string): void;
}

export const ListaDoTime = memo(function ListaDoTime({ autores, soComPerfil, pessoas, aoAbrir, aoEditar }: Props) {
  return (
    <ul className={estilos.grade} aria-label="Pessoas do Time">
      {autores.map((autor) => <CartaoDaPessoa key={`d:${autor.login}`} login={autor.login} autor={autor} perfil={perfilDe(pessoas, autor.login)} aoAbrir={aoAbrir} aoEditar={aoEditar} />)}
      {soComPerfil.map((login) => <CartaoDaPessoa key={`p:${login}`} login={login} perfil={perfilDe(pessoas, login)} aoAbrir={aoAbrir} aoEditar={aoEditar} />)}
    </ul>
  );
});
