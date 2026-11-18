'use client';

// A seção "Em análise": uma linha por sessão em curso, com o título, a porcentagem e a barra.
// Num clique abre o detalhe: a etapa, os arquivos e quanto falta (quando o motor manda), o
// feed, o link do PR e o Cancelar. O feed é texto de fora (o que a sessão está fazendo) e
// entra sempre como texto.
import { memo } from 'react';
import type { LinhaDoFeed, ProgressoDaRevisao, SessaoAtiva } from '@/contratos/radar';
import { Botao, Linha, Secao, Spinner, ui } from '@/componentes/ui';
import { chaveCurta, chavesDoFeed, dataHora, hora, nomeDoPr } from '@/radar/formato';
import { AcoesDoItem } from './AcoesDoItem';
import { AbrirNoGitHub } from './Bloco';
import type { ControleDeAcoes } from './useAcoes';
import estilos from './Radar.module.css';

function Feed({ linhas, de }: { linhas: readonly LinhaDoFeed[]; de: string }) {
  if (!linhas.length) return <p className={ui.mini}>O feed desta sessão ainda não tem linha.</p>;
  // A chave de cada linha não depende da posição: quando o motor corta as antigas, as que
  // ficam mantêm a chave e o React não refaz a lista inteira.
  const chaves = chavesDoFeed(linhas);
  // a mais recente primeiro: é a que diz o que a sessão faz agora
  const recentes = linhas.map((linha, i) => ({ linha, chave: chaves[i] })).reverse();
  return (
    // rolável pelo teclado: por isso o tabIndex e o nome
    <ol className={estilos.feed} aria-label={`Feed de ${de}, a linha mais recente primeiro`} tabIndex={0}>
      {recentes.map(({ linha, chave }) => (
        <li key={chave} className={estilos.linhaDoFeed} data-tipo={linha.k === 'warn' ? 'aviso' : undefined}>
          <span className={estilos.horaDoFeed}>{hora(linha.t)}</span>
          <span>{linha.k === 'warn' ? 'Aviso: ' : ''}{linha.a ? `[${linha.a}] ` : ''}{linha.text}</span>
        </li>
      ))}
    </ol>
  );
}

const MINUTO_MS = 60000;

function faltam(ms: number): string {
  return ms < MINUTO_MS ? 'faltam menos de 1 min' : `faltam ~${Math.round(ms / MINUTO_MS)} min`;
}

// A barra da porcentagem que o motor calcula (lib/engine/progresso-revisao.js). É SVG porque a
// CSP de produção recusa estilo em linha, e a largura vai como atributo.
function Barra({ progresso: p, de }: { progresso: ProgressoDaRevisao; de: string }) {
  const etapa = `etapa ${p.etapa} de ${p.totalEtapas}: ${p.rotuloDaEtapa}`;
  return (
    <span
      role="progressbar" aria-label={`Andamento de ${de}`} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={p.percentual} aria-valuetext={`${p.percentual}%, ${etapa}`} className={estilos.barraDoProgresso}
    >
      <svg viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <rect className={estilos.trilhoDoProgresso} x={0} y={0} width={100} height={6} />
        <rect className={estilos.preenchidoDoProgresso} x={0} y={0} width={p.percentual} height={6} />
      </svg>
    </span>
  );
}

// A linha do detalhe com a etapa, os arquivos e quanto falta. Arquivos, o arquivo da vez e o tempo
// restante só aparecem quando o motor os manda; com a lista das etapas, o arquivo da vez vai nela.
function detalheDoProgresso(p: ProgressoDaRevisao): string {
  return [
    `Etapa ${p.etapa} de ${p.totalEtapas}: ${p.rotuloDaEtapa}`,
    p.arquivosTotais !== undefined ? `${p.arquivosLidos ?? 0} de ${p.arquivosTotais} arquivos` : '',
    p.arquivoAtual && !p.etapas ? `último lido: ${p.arquivoAtual}` : '',
    p.restanteEstimadoMs !== undefined ? faltam(p.restanteEstimadoMs) : '',
  ].filter(Boolean).join(' · ');
}

const primeiraMaiuscula = (texto: string): string => texto.charAt(0).toUpperCase() + texto.slice(1);

// As etapas pelo nome, quando o motor manda a lista: as feitas com a marca, a atual com os
// arquivos (quando há) e as que faltam apagadas. O estado de cada uma vai em texto para o
// leitor de tela. Com 100% todas estão feitas.
function EtapasDaRevisao({ progresso: p }: { progresso: ProgressoDaRevisao & { etapas: string[] } }) {
  const concluida = p.percentual === 100;
  return (
    <ol className={estilos.etapas} aria-label="Etapas da revisão">
      {p.etapas.map((nome, i) => {
        const feita = concluida || i < p.etapa - 1;
        const atual = !concluida && i === p.etapa - 1;
        const contagem = atual && p.arquivosTotais !== undefined ? `: ${p.arquivosLidos ?? 0} de ${p.arquivosTotais} arquivos` : '';
        // o arquivo da vez, como o desenho: "Código: 9 de 20 arquivos · src/x.ts"
        const arquivos = atual && p.arquivoAtual ? `${contagem || ':'} · ${p.arquivoAtual}` : contagem;
        let estado = 'falta';
        if (feita) estado = 'feita';
        else if (atual) estado = 'agora';
        return (
          <li key={nome} className={estilos.etapa} data-estado={estado}>
            <span aria-hidden="true" className={estilos.marcaDaEtapa}>{feita ? '✓' : ''}</span>
            <span>{primeiraMaiuscula(nome)}{arquivos}</span>
            <span className={ui.soLeitor}>{` (${estado})`}</span>
          </li>
        );
      })}
    </ol>
  );
}

// Com memo: a linha nova do feed de uma sessão não redesenha a linha das outras.
const LinhaDaSessao = memo(function LinhaDaSessao({ sessao: s, feed, controle }: { sessao: SessaoAtiva; feed: readonly LinhaDoFeed[]; controle: ControleDeAcoes }) {
  const chave = s.pr?.key ?? s.keys?.[0] ?? '';
  const rotulo = s.label ?? `Sessão ${s.id}`;
  const de = chave ? nomeDoPr(chave) : rotulo;
  const titulo = s.pr?.title || (chave ? nomeDoPr(chave) : rotulo);
  const inicio = dataHora(s.startedAt);
  const p = s.progresso;
  const meta = [chave ? chaveCurta(chave) : '', p ? p.rotuloDaEtapa : '', s.cancelled ? 'cancelando' : ''].filter(Boolean).join(' · ');
  const quem = [chave, s.pr?.author ? `PR de ${s.pr.author}` : '', inicio ? `começou em ${inicio}` : ''].filter(Boolean).join(' · ');

  // A barra fica fora do <summary>: dentro dele o leitor de tela lê só o texto do botão de
  // abrir, e o role="progressbar" com o aria-valuetext se perderia. No resumo vai só texto.
  return (
    <div className={estilos.sessao}>
    <Linha
      className={estilos.linhaDaSessao}
      resumo={
        <span className={estilos.resumoDaSessao}>
          <span className={estilos.cabecaDaSessao}>
            <span className={ui.t}>{titulo}</span>
            {p ? <span className={estilos.percentual}>{`${p.percentual}%`}</span> : <Spinner tamanho="p" />}
          </span>
          {meta ? <span className={ui.r}>{meta}</span> : null}
        </span>
      }
    >
      {p ? <p className={ui.mini}>{detalheDoProgresso(p)}</p> : null}
      {p?.etapas ? <EtapasDaRevisao progresso={{ ...p, etapas: p.etapas }} /> : null}
      {quem ? <p className={ui.mini}>{quem}</p> : null}
      <Feed linhas={feed} de={de} />
      {!s.cancelled && s.cancellable === false ? <p className={ui.mini}>A revisão já está sendo concluída e não pode mais ser cancelada.</p> : null}
      <div className={ui.fila}>
        {chave ? <AbrirNoGitHub chave={chave} url={s.pr?.url} /> : null}
        <div className={ui.empurra}>
          {s.cancelled ? (
            <Botao pequeno ocupado="Cancelando…" aria-label={`Cancelando a sessão de ${de}`}>Cancelar</Botao>
          ) : null}
          {!s.cancelled && s.cancellable === true ? (
            <AcoesDoItem
              pequeno
              botoes={[{ acao: { tipo: 'cancelar', id: s.id, alvo: `sessao:${s.id}`, nome: `a sessão de ${de}` }, fantasma: true, ocupado: 'Cancelando…' }]}
              controle={controle}
            />
          ) : null}
        </div>
      </div>
    </Linha>
    {p ? <div className={estilos.barraDaSessao}><Barra progresso={p} de={de} /></div> : null}
    </div>
  );
});

interface Props {
  sessoes: readonly SessaoAtiva[];
  // o feed de cada sessão, por id (a chave `activity` do snapshot)
  feeds: Readonly<Record<string, LinhaDoFeed[]>>;
  controle: ControleDeAcoes;
}

const SEM_LINHAS: readonly LinhaDoFeed[] = [];

export const EmAnalise = memo(function EmAnalise({ sessoes, feeds, controle }: Props) {
  return (
    <Secao titulo="Em análise">
      {sessoes.length ? (
        <div className={ui.lista}>
          {sessoes.map((s) => (
            <LinhaDaSessao key={s.id} sessao={s} feed={Object.hasOwn(feeds, s.id) ? (feeds[s.id] ?? SEM_LINHAS) : SEM_LINHAS} controle={controle} />
          ))}
        </div>
      ) : (
        <p className={ui.vazio}>Nenhuma sessão em curso.</p>
      )}
    </Secao>
  );
});
