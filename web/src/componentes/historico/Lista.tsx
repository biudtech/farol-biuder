'use client';

// A lista do Histórico no cartão único (redesenho, lote 4): um cartão por revisão, agrupado pelo
// dia em que foi resolvida, no fuso de Brasília ("Hoje, 19 de novembro · 9 revisões"). Fechado, o
// cartão diz o autor, a chave, a hora e a rodada, o título e o selo do que foi publicado; a seta
// abre o detalhe no próprio cartão (o mesmo endereço de antes, `?id=&chave=`, e o voltar do
// navegador fecha). Aberto, ele ganha as pílulas (checks, card e parecer), a análise inteira
// (Analise, Detalhe.tsx) e o rodapé com a hora, o tempo, as sessões, o custo e os perfis, e as
// ações "Ver o review postado" (abre a linha do review completo e leva o foco a ela) e "Revisar
// de novo". A revisão que não publicou nada oferece
// "Revisar de novo" também fechada.
//
// As pendências da mesa (`decisions.pending` do snapshot) vêm antes, num grupo próprio: o front
// não tem mais mesa, e elas não podem sumir. Aparecem como "nada postado", sem nenhuma ação de
// mesa (aprovar, pedir mudanças, comentar, pular).
import { memo, useId } from 'react';
import type { Contestacao as Registro, Revisao } from '@/contratos/historico';
import type { Pendencia } from '@/contratos/radar';
import { contextoDoCartao, instanteDoCartao, rodapeDoCartao, temTextoDoReview, tomDoCartao } from '@/historico/cartao';
import { agruparPorDia, horaCurta, tituloDoGrupo } from '@/historico/dias';
import { foiPublicado, rotuloDoDesfecho, tomDoDesfecho } from '@/historico/rotulos';
import { pilulasDaPostada } from '@/radar/cartao';
import { nomeDoPr, prDaUrl } from '@/radar/formato';
import { AbrirNoGitHub, Cartao, Rodape } from '../cartao/Cartao';
import { AcoesDoItem } from '../radar/AcoesDoItem';
import type { ControleDeAcoes } from '../radar/useAcoes';
import { Bolinha, Chip, Linha, ui } from '../ui';
import { Analise, type PerfisDoClaude } from './Detalhe';
import type { LeituraDoDetalhe } from './useHistorico';
import estilos from './Historico.module.css';

// O id do botão que abre e fecha o cartão: é para ele que o foco volta quando o detalhe fecha.
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

function RevisarDeNovo({ chave, url, controle, primario }: { chave: string; url: string | undefined; controle: ControleDeAcoes; primario?: boolean }) {
  const pr = prDaUrl(url ?? '');
  if (!pr) return null;
  return <AcoesDoItem pequeno botoes={[{ acao: { tipo: 'revisar', alvo: chave, nome: nomeDoPr(chave), url: pr.url, deNovo: true }, primario }]} controle={controle} />;
}

// A seta do cartão: um botão de verdade, com um nome fixo e o estado só em aria-expanded (o
// leitor de tela já diz "expandido" ou "recolhido"; um nome que muda repetiria isso).
function Seta({ id, aberto, controla, nome, aoClicar }: { id: string; aberto: boolean; controla: string; nome: string; aoClicar(): void }) {
  return (
    <button
      id={id}
      type="button"
      className={`${ui.botao} ${ui.pequeno} ${estilos.seta}`}
      aria-expanded={aberto}
      aria-controls={aberto ? controla : undefined}
      aria-label={`Detalhe de ${nome}`}
      data-aberto={aberto ? 'sim' : undefined}
      onClick={aoClicar}
    >
      <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  );
}

interface PropsDoCartao {
  revisao: Revisao;
  // a leitura do detalhe, quando este cartão é o aberto
  leitura: LeituraDoDetalhe | null;
  registro: Registro | undefined;
  perfis: PerfisDoClaude;
  aoAlternar(revisao: Revisao): void;
  controle: ControleDeAcoes;
}

const CartaoDaRevisao = memo(function CartaoDaRevisao({ revisao: daPagina, leitura, registro, perfis, aoAlternar, controle }: PropsDoCartao) {
  const idDoCorpo = useId();
  const idDoReview = useId();
  const aberto = leitura !== null;
  const complementando = leitura?.fase === 'pronto' && leitura.complementando === true;
  // a revisão da página com o complemento de GET /api/decision, quando ele chegou
  const r = leitura?.fase === 'pronto' ? leitura.revisao : daPagina;
  const nome = nomeDoPr(r.key);
  const naoPostou = r.status === 'pending' || !foiPublicado(r.action);
  const desfecho = rotuloDoDesfecho(r);
  const texto = temTextoDoReview(r);
  const rodape = rodapeDoCartao(r, perfis);
  // "Ver o review postado" abre a linha do review completo e leva o foco a ela
  const verReview = (): void => {
    const linha = document.getElementById(idDoReview);
    if (!(linha instanceof HTMLDetailsElement)) return;
    linha.open = true;
    linha.scrollIntoView?.({ block: 'nearest' });
    linha.querySelector('summary')?.focus();
  };

  return (
    <Cartao
      tom={tomDoCartao(r)}
      chave={r.key}
      url={r.pr?.url}
      autor={r.pr?.author}
      titulo={r.pr?.title || r.key}
      contexto={contextoDoCartao(r)}
      estado={desfecho}
      botoes={(
        <>
          <Chip tom={tomDoDesfecho(r)}>{desfecho}</Chip>
          {!aberto && naoPostou ? <RevisarDeNovo chave={r.key} url={r.pr?.url} controle={controle} /> : null}
          <Seta id={idDoBotao(daPagina.id)} aberto={aberto} controla={idDoCorpo} nome={nome} aoClicar={() => aoAlternar(daPagina)} />
        </>
      )}
      pilulas={aberto ? pilulasDaPostada(r.action, r.card, r, complementando) : undefined}
      nivelDoTitulo={4}
    >
      {r.blockedReason && !aberto ? <p className={`${ui.mini} ${estilos.motivoFechado}`}>{r.blockedReason}</p> : null}
      {aberto ? (
        <div id={idDoCorpo} className={estilos.corpoDoCartao} role="region" aria-label={`Revisão de ${nome}`}>
          {complementando ? <p className={ui.mini} role="status">Carregando os achados, os critérios e a execução desta revisão.</p> : null}
          {/* debaixo do h4 do cartão, as seções da análise são h5 */}
          <Analise revisao={r} registro={registro} controle={controle} perfis={perfis} idDoReview={idDoReview} nivel={5} />
          <Rodape
            tom="fila"
            texto={rodape || 'Sem hora, tempo nem custo registrados'}
            acao={(
              <span className={estilos.acoesDoCartao}>
                {texto !== 'sem' ? (
                  <button type="button" className={`${ui.botao} ${ui.pequeno}`} aria-controls={idDoReview} onClick={verReview}>
                    {texto === 'postado' ? 'Ver o review postado' : 'Ver o texto da revisão'}
                    {' '}<span className={ui.soLeitor}>de {nome}</span>
                  </button>
                ) : null}
                <AbrirNoGitHub chave={r.key} url={r.pr?.url} />
                {prDaUrl(r.pr?.url ?? '') ? (
                  <RevisarDeNovo chave={r.key} url={r.pr?.url} controle={controle} primario={naoPostou} />
                ) : (
                  <span className={ui.mini}>Sem o endereço do PR no GitHub, não dá para pedir revisão nova daqui.</span>
                )}
              </span>
            )}
          />
        </div>
      ) : null}
    </Cartao>
  );
});

interface Props {
  itens: readonly Revisao[];
  // o "hoje" dos grupos: quando a página chegou
  agora: number;
  // a página carregada é uma de várias: a contagem do dia é desta página
  variasPaginas: boolean;
  // o id da revisão aberta e a leitura dela
  abertoId: string | null;
  leitura: LeituraDoDetalhe | null;
  contestacoes: Readonly<Record<string, Registro>> | undefined;
  perfis: PerfisDoClaude;
  aoAlternar(revisao: Revisao): void;
  controle: ControleDeAcoes;
}

export const Lista = memo(function Lista({ itens, agora, variasPaginas, abertoId, leitura, contestacoes, perfis, aoAlternar, controle }: Props) {
  // o mesmo instante da hora do contexto do cartão
  const grupos = agruparPorDia(itens, instanteDoCartao, agora);
  return (
    <div className={estilos.grupos}>
      {grupos.map((grupo) => (
        <section key={grupo.chave} className={estilos.grupoDoDia} aria-label={grupo.rotulo}>
          <h3 className={estilos.tituloDoDia}>{tituloDoGrupo(grupo.rotulo, grupo.itens.length, variasPaginas)}</h3>
          {grupo.itens.map((revisao) => (
            <CartaoDaRevisao
              key={revisao.id}
              revisao={revisao}
              leitura={revisao.id === abertoId ? leitura : null}
              registro={revisao.id === abertoId && contestacoes && Object.hasOwn(contestacoes, revisao.key) ? contestacoes[revisao.key] : undefined}
              perfis={perfis}
              aoAlternar={aoAlternar}
              controle={controle}
            />
          ))}
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
