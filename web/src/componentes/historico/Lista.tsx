'use client';

// A lista do Histórico, no desenho enxuto: uma linha por revisão, agrupada pelo dia em que foi
// resolvida (Hoje, Ontem, depois a data, no fuso do navegador). Fechada, a linha diz o que foi
// publicado (a bolinha, com o texto escondido para o leitor), o título do PR e a hora; aberta,
// o PR, o autor, o desfecho em texto e "Abrir a revisão". A revisão que não publicou nada
// oferece "Revisar de novo" ali mesmo.
//
// As pendências da mesa (`decisions.pending` do snapshot) vêm antes, num grupo próprio: o front
// não tem mais mesa, e elas não podem sumir. Aparecem como "nada postado", sem nenhuma ação de
// mesa (aprovar, pedir mudanças, comentar, pular).
import { memo } from 'react';
import type { Revisao } from '@/contratos/historico';
import type { Pendencia } from '@/contratos/radar';
import { agruparPorDia, horaCurta } from '@/historico/dias';
import { foiPublicado, parecerQueDifere, textoDoPublicado, textoDoStatus, tomDoDesfecho } from '@/historico/rotulos';
import { dataComAno, nomeDoPr, prDaUrl } from '@/radar/formato';
import { AcoesDoItem } from '../radar/AcoesDoItem';
import type { ControleDeAcoes } from '../radar/useAcoes';
import { Bolinha, Linha, ui } from '../ui';
import estilos from './Historico.module.css';

// O id do botão que abre a revisão: é para ele que o foco volta quando o detalhe fecha.
export function idDoBotao(id: string): string {
  return `ver-revisao-${id}`;
}

// O da pendência é outro: a mesma decisão pode estar nas pendências e, logo depois, na página.
export function idDoBotaoDaPendencia(id: string): string {
  return `ver-pendencia-${id}`;
}

function meta(chave: string, autor: string | undefined, desfecho: string): string {
  return [chave, autor, desfecho].filter(Boolean).join(' · ');
}

function RevisarDeNovo({ chave, url, controle }: { chave: string; url: string | undefined; controle: ControleDeAcoes }) {
  const pr = prDaUrl(url ?? '');
  if (!pr) return null;
  return <AcoesDoItem botoes={[{ acao: { tipo: 'revisar', alvo: chave, nome: nomeDoPr(chave), url: pr.url, deNovo: true } }]} controle={controle} />;
}

interface PropsDaLinha {
  revisao: Revisao;
  aoAbrir(revisao: Revisao): void;
  controle: ControleDeAcoes;
}

const LinhaDaRevisao = memo(function LinhaDaRevisao({ revisao: r, aoAbrir, controle }: PropsDaLinha) {
  const nome = nomeDoPr(r.key);
  const publicado = textoDoPublicado(r);
  const parecer = parecerQueDifere(r);
  const quando = dataComAno(r.resolvedAt);
  return (
    <Linha
      resumo={(
        <>
          <Bolinha tom={tomDoDesfecho(r)} rotulo={`${publicado}:`} />
          <span className={`${ui.t} ${estilos.tituloDaLinha}`}>{r.pr?.title || r.key}</span>
          <span className={ui.r}>{horaCurta(r.resolvedAt) || 'sem hora'}</span>
        </>
      )}
    >
      {r.blockedReason ? <p className={ui.texto}>{r.blockedReason}</p> : null}
      <p className={ui.mini}>{meta(r.key, r.pr?.author, publicado)}</p>
      <p className={ui.mini}>
        {textoDoStatus(r.status)}
        {parecer ? `; parecer da revisão: ${parecer}` : ''}
        {r.card ? `; card ${r.card}` : ''}
        {quando ? `; ${quando}` : ''}
      </p>
      <div className={ui.fila}>
        <button
          id={idDoBotao(r.id)}
          type="button"
          className={ui.link}
          aria-label={`Abrir a revisão de ${nome}${quando ? `, de ${quando}` : ''}`}
          onClick={() => aoAbrir(r)}
        >
          Abrir a revisão
        </button>
      </div>
      {foiPublicado(r.action) ? null : <RevisarDeNovo chave={r.key} url={r.pr?.url} controle={controle} />}
    </Linha>
  );
});

interface Props {
  itens: readonly Revisao[];
  // o "hoje" dos grupos: quando a página chegou
  agora: number;
  aoAbrir(revisao: Revisao): void;
  controle: ControleDeAcoes;
}

export const Lista = memo(function Lista({ itens, agora, aoAbrir, controle }: Props) {
  const grupos = agruparPorDia(itens, (r) => r.resolvedAt, agora);
  return (
    <div className={ui.lista}>
      {grupos.map((grupo) => (
        <section key={grupo.chave} className={ui.lista} aria-label={grupo.rotulo}>
          <h3 className={ui.grupo}>{grupo.rotulo}</h3>
          {grupo.itens.map((revisao) => <LinhaDaRevisao key={revisao.id} revisao={revisao} aoAbrir={aoAbrir} controle={controle} />)}
        </section>
      ))}
    </div>
  );
});

// O que o motor diz sobre por que a pendência não publicou, quando diz: o motivo fixo dele
// (`blockedReason`) e, se a publicação falhou, se ele ainda tenta sozinho (`postRetry`).
function motivoDaPendencia(p: Pendencia): string {
  const partes: string[] = [];
  if (p.blockedReason) partes.push(p.blockedReason);
  if (p.postRetry) {
    partes.push(p.postRetry.exhausted
      ? `A publicação falhou e o motor desistiu de tentar sozinho depois de ${p.postRetry.attempts} tentativa(s).`
      : 'A publicação falhou e o motor está tentando de novo sozinho.');
  }
  return partes.join(' ');
}

interface PropsDasPendencias {
  pendencias: readonly Pendencia[];
  // itens de `decisions.pending` que a borda descartou (sem id ou sem chave)
  ilegiveis: number;
  aoAbrir(pendencia: Pendencia): void;
  controle: ControleDeAcoes;
}

export const Pendencias = memo(function Pendencias({ pendencias, ilegiveis, aoAbrir, controle }: PropsDasPendencias) {
  if (!pendencias.length && !ilegiveis) return null;
  return (
    <section className={ui.lista} aria-label="Sem nada postado ainda">
      <h2 className={ui.grupo}>Sem nada postado ainda</h2>
      <p className={ui.mini}>
        Revisões que o motor guardou sem publicar. Vêm do estado ao vivo do motor: não passam pela busca, pelos filtros nem pelas páginas.
      </p>
      {ilegiveis ? (
        <p className={ui.nota}>Atenção: {ilegiveis} revisão(ões) sem nada postado chegaram em formato que esta tela não lê e ficaram de fora.</p>
      ) : null}
      {pendencias.map((p) => {
        const nome = nomeDoPr(p.key);
        const motivo = motivoDaPendencia(p);
        return (
          <Linha
            key={p.id}
            resumo={(
              <>
                <Bolinha tom="neutro" rotulo="Nada postado:" />
                <span className={`${ui.t} ${estilos.tituloDaLinha}`}>{p.pr?.title || p.key}</span>
                <span className={ui.r}>{horaCurta(p.createdAt) || 'sem hora'}</span>
              </>
            )}
          >
            <p className={ui.texto}>O motor não postou nada ainda.{motivo ? ` ${motivo}` : ''}</p>
            <p className={ui.mini}>{meta(p.key, p.pr?.author, 'nada postado')}</p>
            <div className={ui.fila}>
              <button id={idDoBotaoDaPendencia(p.id)} type="button" className={ui.link} aria-label={`Abrir a revisão de ${nome}, sem nada postado`} onClick={() => aoAbrir(p)}>
                Abrir a revisão
              </button>
            </div>
            <RevisarDeNovo chave={p.key} url={p.pr?.url} controle={controle} />
          </Linha>
        );
      })}
    </section>
  );
});
