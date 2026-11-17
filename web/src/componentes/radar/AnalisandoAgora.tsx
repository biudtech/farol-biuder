'use client';

// O bloco "Analisando agora": as sessões em curso, cada uma com o feed e o Cancelar. O feed
// é texto de fora (o que a sessão está fazendo) e entra sempre como texto.
import { memo } from 'react';
import type { LinhaDoFeed, ProgressoDaRevisao, SessaoAtiva } from '@/contratos/radar';
import { chavesDoFeed, dataHora, hora, nomeDoPr } from '@/radar/formato';
import { AcoesDoItem } from './AcoesDoItem';
import { Bloco, ReferenciaDoPr } from './Bloco';
import type { ControleDeAcoes } from './useAcoes';
import estilos from './Radar.module.css';

function Feed({ linhas, de }: { linhas: readonly LinhaDoFeed[]; de: string }) {
  if (!linhas.length) return <p className={estilos.meta}>O feed desta sessão ainda não tem linha.</p>;
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

// A porcentagem que o motor calcula (lib/engine/progresso-revisao.js): o número, a barra e a
// etapa. A contagem de arquivos e o tempo restante só aparecem quando o motor os manda. A barra
// é SVG porque a CSP de produção recusa estilo em linha, e a largura vai como atributo.
function Progresso({ progresso: p, de }: { progresso: ProgressoDaRevisao; de: string }) {
  const etapa = `etapa ${p.etapa} de ${p.totalEtapas}: ${p.rotuloDaEtapa}`;
  const detalhes = [
    p.arquivosTotais !== undefined ? `${p.arquivosLidos ?? 0} de ${p.arquivosTotais} arquivos` : '',
    p.restanteEstimadoMs !== undefined ? faltam(p.restanteEstimadoMs) : '',
  ].filter(Boolean);
  return (
    <div className={estilos.progresso}>
      <div className={estilos.cabecaDoProgresso}>
        <span className={estilos.percentual}>{`${p.percentual}%`}</span>
        <span className={estilos.etapaDoProgresso}>{etapa}</span>
      </div>
      <div
        role="progressbar" aria-label={`Andamento de ${de}`} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={p.percentual} aria-valuetext={`${p.percentual}%, ${etapa}`} className={estilos.barraDoProgresso}
      >
        <svg viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <rect className={estilos.trilhoDoProgresso} x={0} y={0} width={100} height={6} />
          <rect className={estilos.preenchidoDoProgresso} x={0} y={0} width={p.percentual} height={6} />
        </svg>
      </div>
      {detalhes.length ? (
        <p className={estilos.meta}>
          {detalhes.map((d, i) => (
            <span key={d}>{i ? <span aria-hidden="true"> · </span> : null}<span>{d}</span></span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

// Com memo: a linha nova do feed de uma sessão não redesenha o cartão das outras.
const Cartao = memo(function Cartao({ sessao: s, feed, controle }: { sessao: SessaoAtiva; feed: readonly LinhaDoFeed[]; controle: ControleDeAcoes }) {
  const chave = s.pr?.key ?? s.keys?.[0] ?? '';
  const rotulo = s.label ?? `Sessão ${s.id}`;
  const de = chave ? nomeDoPr(chave) : rotulo;
  const inicio = dataHora(s.startedAt);
  return (
    <li className={estilos.cartao}>
      <h3 className={estilos.tituloDoCartao}>
        {chave ? <ReferenciaDoPr chave={chave} url={s.pr?.url} /> : <span className={estilos.referencia}>{rotulo}</span>}
      </h3>
      {s.pr?.title ? <p className={estilos.tituloDoPr}>{s.pr.title}</p> : null}
      <p className={estilos.meta}>
        {[chave ? rotulo : '', s.pr?.author ? `PR de ${s.pr.author}` : '', inicio ? `Começou em ${inicio}` : ''].filter(Boolean).join(' · ')}
      </p>
      {s.progresso ? <Progresso progresso={s.progresso} de={de} /> : null}
      <Feed linhas={feed} de={de} />
      {s.cancelled ? <p className={estilos.nota}>Cancelamento aceito: a sessão está encerrando.</p> : null}
      {!s.cancelled && s.cancellable === false ? <p className={estilos.meta}>A revisão já está sendo concluída e não pode mais ser cancelada.</p> : null}
      {!s.cancelled && s.cancellable === true ? (
        <AcoesDoItem botoes={[{ acao: { tipo: 'cancelar', id: s.id, alvo: `sessao:${s.id}`, nome: `a sessão de ${de}` } }]} controle={controle} />
      ) : null}
    </li>
  );
});

interface Props {
  sessoes: readonly SessaoAtiva[];
  // o feed de cada sessão, por id (a chave `activity` do snapshot)
  feeds: Readonly<Record<string, LinhaDoFeed[]>>;
  controle: ControleDeAcoes;
}

const SEM_LINHAS: readonly LinhaDoFeed[] = [];

export const AnalisandoAgora = memo(function AnalisandoAgora({ sessoes, feeds, controle }: Props) {
  return (
    <Bloco titulo="Analisando agora" quantidade={sessoes.length} vazio="Nenhuma sessão em curso.">
      <ul className={estilos.lista}>
        {sessoes.map((s) => (
          <Cartao key={s.id} sessao={s} feed={Object.hasOwn(feeds, s.id) ? (feeds[s.id] ?? SEM_LINHAS) : SEM_LINHAS} controle={controle} />
        ))}
      </ul>
    </Bloco>
  );
});
