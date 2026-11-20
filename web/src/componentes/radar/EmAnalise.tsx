'use client';

// A seção "Em análise": um cartão por sessão em curso (o cartão único, src/componentes/cartao). O
// cabeçalho diz o PR, o autor e o contexto, com o perfil do Claude; as pílulas, o que já se sabe
// dos checks, do card (a chave `card` da sessão) e do parecer; a faixa, a porcentagem da revisão
// inteira com a barra única, as etapas do motor (que nunca recuam), o tempo, o típico e o que a
// sessão faz agora. Depois das sessões vêm as que sumiram sem resultado e cujo PR não está mais na fila
// (com o PR na fila, a falha aparece no cartão da fila).
import { memo, useState, type ReactNode } from 'react';
import type { LinhaDoFeed, SessaoAtiva } from '@/contratos/radar';
import type { PerfilDoClaude } from '@/contratos/sistema';
import { Botao, Secao, ui } from '@/componentes/ui';
import {
  andamentoDaFalha, andamentoDaSessao, andamentoIniciando, contextoDaSessao, etapaDoProgresso, pilulasDaFalha, pilulasDaSessao,
  rotuloDoPerfil, SEM_SINAL_MS, tempoDecorrido, ultimoEvento,
} from '@/radar/cartao';
import type { Falha } from '@/radar/falhas';
import { nomeDoPr } from '@/radar/formato';
import { AcoesDoItem } from './AcoesDoItem';
import { AbrirNoGitHub, BotaoOcupado, Cartao, Faixa, useAgora, usePassou } from '@/componentes/cartao/Cartao';
import type { ControleDeAcoes } from './useAcoes';
import estilos from './Radar.module.css';

const POSTAGEM = 4;
const CODIGO = 2;
const CONFERENCIA = 3;

interface PropsDaFaixaDaSessao {
  sessao: SessaoAtiva;
  etapa: number;
  ultimo: number | undefined;
  outras: number;
  desvio: number;
  de: string;
  acao: ReactNode;
}

// A faixa da sessão: o único pedaço do cartão com o relógio de 1 s. O tempo e o "sem sinal"
// contam na hora do motor (a do navegador menos o desvio), porque as horas da sessão são dele.
function FaixaDaSessao({ sessao: s, etapa, ultimo, outras, desvio, de, acao }: PropsDaFaixaDaSessao) {
  const agora = useAgora() - desvio;
  const andamento = andamentoDaSessao({
    etapa, progresso: s.progresso, ultimoEvento: ultimo, agora, outras,
    costumaMs: s.estimativa?.ateOFimMs ?? s.estimativa?.tipicoMs, conta: s.pr?.account,
  });
  const tempo = s.startedAt ? tempoDecorrido(agora - s.startedAt) : '';
  return <Faixa andamento={andamento} de={de} tempo={tempo} acao={acao} />;
}

interface PropsDaSessao {
  sessao: SessaoAtiva;
  // o último sinal de vida da sessão, na hora do motor (ultimoEvento: a linha mais nova do feed, o
  // modelo escrevendo ou o começo): número, para a linha nova do feed de uma sessão não redesenhar
  // o cartão das outras
  ultimo: number | undefined;
  outras: number;
  // a diferença entre o relógio do navegador e o do motor, em ms
  desvio: number;
  controle: ControleDeAcoes;
  // o rótulo do perfil do Claude que a sessão usa, já lido de config.claudeProfiles
  perfil?: string;
}

// Com memo: a linha nova do feed de uma sessão não redesenha as outras. O cabeçalho, o avatar e
// as pílulas não têm relógio: só a faixa redesenha a cada segundo, e a borda do "sem sinal" vira
// com um disparo só, na hora (usePassou).
const CartaoDaSessao = memo(function CartaoDaSessao({ sessao: s, ultimo, outras, desvio, controle, perfil }: PropsDaSessao) {
  const chave = s.pr?.key ?? s.keys?.[0] ?? '';
  const de = chave ? nomeDoPr(chave) : (s.label ?? `Sessão ${s.id}`);
  const doMotor = etapaDoProgresso(s.progresso);
  // A etapa nunca recua: um estado atrasado (a reconexão, um patch fora de ordem) não faz a faixa
  // voltar. Ajuste de estado no desenho, como o React prevê para estado que depende de propriedade.
  const [piso, setPiso] = useState(doMotor);
  if (doMotor > piso) setPiso(doMotor);
  const etapa = Math.max(piso, doMotor);
  // o "sem sinal" só vale com o modelo trabalhando; o prazo vai para o relógio do navegador
  const comModelo = etapa === CODIGO || etapa === CONFERENCIA;
  const mudo = usePassou(comModelo && ultimo !== undefined ? ultimo + desvio + SEM_SINAL_MS + 1 : undefined);
  let acao = null;
  if (s.cancelled) acao = <Botao pequeno fantasma ocupado="Cancelando…" aria-label={`Cancelando a sessão de ${de}`}>Cancelar</Botao>;
  else if (s.cancellable === true) {
    acao = (
      <AcoesDoItem
        pequeno
        botoes={[{ acao: { tipo: 'cancelar', id: s.id, alvo: `sessao:${s.id}`, nome: `a sessão de ${de}` }, fantasma: true, ocupado: 'Cancelando…' }]}
        controle={controle}
      />
    );
  }
  return (
    <Cartao
      tom={mudo ? 'aviso' : 'rodando'}
      chave={chave || de}
      url={s.pr?.url}
      autor={s.pr?.author}
      titulo={s.pr?.title || de}
      contexto={contextoDaSessao(s, undefined, perfil)}
      estado={mudo ? 'em análise, sem sinal do modelo' : 'em análise'}
      botoes={(
        <>
          <BotaoOcupado texto={etapa >= POSTAGEM ? 'Postando' : 'Revisando'} de={de} chave={chave || undefined} />
          {chave ? <AbrirNoGitHub chave={chave} url={s.pr?.url} /> : null}
        </>
      )}
      pilulas={pilulasDaSessao(etapa, s.card)}
    >
      <FaixaDaSessao sessao={s} etapa={etapa} ultimo={ultimo} outras={outras} desvio={desvio} de={de} acao={acao} />
      {!s.cancelled && s.cancellable === false ? <p className={estilos.nota}>A revisão já está sendo concluída e não pode mais ser cancelada.</p> : null}
    </Cartao>
  );
});

// O clique em Revisar ou Tentar de novo, antes de o motor abrir a sessão: "Iniciando a revisão.",
// com o tempo desde o clique (as duas horas são do navegador, sem desvio).
export function FaixaIniciando({ desde, de }: { desde: number; de: string }) {
  const agora = useAgora();
  return <Faixa andamento={andamentoIniciando()} de={de} tempo={tempoDecorrido(agora - desde)} />;
}

interface PropsDaFalha {
  falha: Falha & { motivo: string };
  iniciadaEm?: number;
  controle: ControleDeAcoes;
}

// A falha some sozinha (useFalhas): com sessão ou decisão nova do PR, ou depois de um tempo curto.
export function CartaoDaFalha({ falha: f, iniciadaEm, controle }: PropsDaFalha) {
  const de = nomeDoPr(f.chave);
  const andamento = andamentoDaFalha(f.etapa, f.motivo);
  const tempo = f.inicio ? tempoDecorrido(f.fimNoMotor - f.inicio) : '';
  const botoes = (
    <>
      {iniciadaEm !== undefined ? <BotaoOcupado texto="Revisando" de={de} chave={f.chave} /> : null}
      {iniciadaEm === undefined && f.url ? (
        <AcoesDoItem pequeno botoes={[{ acao: { tipo: 'revisar', url: f.url, falhou: true, alvo: f.chave, nome: de }, primario: true }]} controle={controle} />
      ) : null}
      <AbrirNoGitHub chave={f.chave} url={f.url} />
    </>
  );
  return (
    <Cartao
      tom={iniciadaEm !== undefined ? 'rodando' : 'falha'}
      chave={f.chave}
      url={f.url}
      autor={f.autor}
      titulo={f.titulo || de}
      contexto=""
      estado={iniciadaEm !== undefined ? 'iniciando a revisão' : 'a sessão terminou sem resultado'}
      botoes={botoes}
      pilulas={pilulasDaFalha(f.etapa)}
    >
      {iniciadaEm !== undefined ? <FaixaIniciando desde={iniciadaEm} de={de} /> : (
        <Faixa andamento={andamento} de={de} tempo={tempo} />
      )}
    </Cartao>
  );
}

interface Props {
  sessoes: readonly SessaoAtiva[];
  // o feed de cada sessão, por id (a chave `activity` do snapshot)
  feeds: Readonly<Record<string, LinhaDoFeed[]>>;
  // as sessões que sumiram sem resultado e cujo PR não está na fila
  falhas?: ReadonlyArray<Falha & { motivo: string }>;
  // os PRs com o Revisar clicado e a sessão ainda não aberta, com a hora do clique
  iniciadas?: ReadonlyMap<string, number>;
  // a diferença entre o relógio do navegador e o do motor, em ms (0 sem medida)
  desvio?: number;
  controle: ControleDeAcoes;
  // os perfis do Claude (config.claudeProfiles), para dizer o rótulo do perfil de cada sessão
  perfis?: readonly PerfilDoClaude[];
}

const NENHUMA_FALHA: ReadonlyArray<Falha & { motivo: string }> = [];
const NENHUMA_INICIADA: ReadonlyMap<string, number> = new Map<string, number>();

export const EmAnalise = memo(function EmAnalise({ sessoes, feeds, falhas = NENHUMA_FALHA, iniciadas = NENHUMA_INICIADA, desvio = 0, controle, perfis }: Props) {
  const vazio = !sessoes.length && !falhas.length;
  return (
    <Secao titulo="Em análise" contagem={sessoes.length ? { n: sessoes.length, tom: 'marca', rotulo: sessoes.length === 1 ? 'sessão' : 'sessões' } : undefined}>
      {vazio ? <p className={ui.vazio}>Nenhuma sessão em curso.</p> : (
        <div className={estilos.cartoes}>
          {sessoes.map((s) => (
            <CartaoDaSessao
              key={s.id}
              sessao={s}
              ultimo={ultimoEvento(Object.hasOwn(feeds, s.id) ? (feeds[s.id] ?? []) : [], s.startedAt, s.ultimoSinalEm)}
              outras={sessoes.length - 1}
              desvio={desvio}
              controle={controle}
              perfil={rotuloDoPerfil(s.perfilId, perfis)}
            />
          ))}
          {falhas.map((f) => (
            <CartaoDaFalha key={`falha:${f.chave}`} falha={f} iniciadaEm={iniciadas.get(f.chave)} controle={controle} />
          ))}
        </div>
      )}
    </Secao>
  );
});
