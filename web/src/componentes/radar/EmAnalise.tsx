'use client';

// A seção "Em análise": um cartão por sessão em curso, no molde do cartão da autoanálise. O
// cabeçalho diz o PR, o autor e o contexto; as pílulas, o que já se sabe dos checks, do card e
// do parecer; a faixa, a etapa do motor (que nunca recua), o tempo, o trilho e o que a sessão faz
// agora. Depois das sessões vêm as que sumiram sem resultado e cujo PR não está mais na fila
// (com o PR na fila, a falha aparece no cartão da fila).
import { memo, useState } from 'react';
import type { LinhaDoFeed, SessaoAtiva } from '@/contratos/radar';
import { Botao, Secao, ui } from '@/componentes/ui';
import {
  andamentoDaFalha, andamentoDaSessao, andamentoIniciando, contextoDaSessao, etapaDoProgresso, pilulasDaFalha, pilulasDaSessao,
  tempoDecorrido, ultimoEvento,
} from '@/radar/cartao';
import type { Falha } from '@/radar/falhas';
import { nomeDoPr } from '@/radar/formato';
import { AcoesDoItem } from './AcoesDoItem';
import { AbrirNoGitHub, BotaoOcupado, Cartao, Faixa, useAgora } from './Cartao';
import type { ControleDeAcoes } from './useAcoes';
import estilos from './Radar.module.css';

const POSTAGEM = 4;

interface PropsDaSessao {
  sessao: SessaoAtiva;
  // o último evento da sessão (a linha mais nova do feed, ou o começo): número, para a linha
  // nova do feed de uma sessão não redesenhar o cartão das outras
  ultimo: number | undefined;
  outras: number;
  controle: ControleDeAcoes;
}

// Com memo: o relógio de cada cartão é dele, e a linha nova do feed de uma sessão não redesenha
// as outras.
const CartaoDaSessao = memo(function CartaoDaSessao({ sessao: s, ultimo, outras, controle }: PropsDaSessao) {
  const chave = s.pr?.key ?? s.keys?.[0] ?? '';
  const de = chave ? nomeDoPr(chave) : (s.label ?? `Sessão ${s.id}`);
  const doMotor = etapaDoProgresso(s.progresso);
  // A etapa nunca recua: um estado atrasado (a reconexão, um patch fora de ordem) não faz a faixa
  // voltar. Ajuste de estado no desenho, como o React prevê para estado que depende de propriedade.
  const [piso, setPiso] = useState(doMotor);
  if (doMotor > piso) setPiso(doMotor);
  const etapa = Math.max(piso, doMotor);
  const agora = useAgora();
  const andamento = andamentoDaSessao({
    etapa, progresso: s.progresso, ultimoEvento: ultimo, agora, outras,
    costumaMs: s.estimativa?.ateOFimMs ?? s.estimativa?.tipicoMs, conta: s.pr?.account,
  });
  const tempo = s.startedAt ? tempoDecorrido(agora - s.startedAt) : '';
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
      tom={andamento.tom}
      chave={chave || de}
      url={s.pr?.url}
      autor={s.pr?.author}
      titulo={s.pr?.title || de}
      contexto={contextoDaSessao(s)}
      estado={andamento.tipo === 'mudo' ? 'em análise, sem sinal do modelo' : 'em análise'}
      botoes={(
        <>
          <BotaoOcupado texto={etapa >= POSTAGEM ? 'Postando' : 'Revisando'} de={de} />
          {chave ? <AbrirNoGitHub chave={chave} url={s.pr?.url} /> : null}
        </>
      )}
      pilulas={pilulasDaSessao(etapa)}
    >
      <Faixa andamento={andamento} de={de} tempo={tempo} acao={acao} />
      {!s.cancelled && s.cancellable === false ? <p className={estilos.nota}>A revisão já está sendo concluída e não pode mais ser cancelada.</p> : null}
    </Cartao>
  );
});

// O clique em Revisar ou Tentar de novo, antes de o motor abrir a sessão: "Iniciando a revisão.",
// com o tempo desde o clique.
export function FaixaIniciando({ desde, de }: { desde: number; de: string }) {
  const agora = useAgora();
  return <Faixa andamento={andamentoIniciando()} de={de} tempo={tempoDecorrido(agora - desde)} />;
}

interface PropsDaFalha {
  falha: Falha & { motivo: string };
  iniciadaEm?: number;
  controle: ControleDeAcoes;
  aoDispensar: (chave: string) => void;
}

export function CartaoDaFalha({ falha: f, iniciadaEm, controle, aoDispensar }: PropsDaFalha) {
  const de = nomeDoPr(f.chave);
  const andamento = andamentoDaFalha(f.etapa, f.motivo);
  const tempo = f.inicio ? tempoDecorrido(f.sumiuEm - f.inicio) : '';
  const botoes = (
    <>
      {iniciadaEm !== undefined ? <BotaoOcupado texto="Revisando" de={de} /> : null}
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
        <Faixa
          andamento={andamento}
          de={de}
          tempo={tempo}
          acao={<Botao pequeno fantasma onClick={() => aoDispensar(f.chave)} aria-label={`Dispensar a falha de ${de}`}>Dispensar</Botao>}
        />
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
  controle: ControleDeAcoes;
  aoDispensarFalha?: (chave: string) => void;
}

const NENHUMA_FALHA: ReadonlyArray<Falha & { motivo: string }> = [];
const NENHUMA_INICIADA: ReadonlyMap<string, number> = new Map<string, number>();
const NADA = (): void => {};

export const EmAnalise = memo(function EmAnalise({ sessoes, feeds, falhas = NENHUMA_FALHA, iniciadas = NENHUMA_INICIADA, controle, aoDispensarFalha = NADA }: Props) {
  const vazio = !sessoes.length && !falhas.length;
  return (
    <Secao titulo="Em análise">
      {vazio ? <p className={ui.vazio}>Nenhuma sessão em curso.</p> : (
        <div className={estilos.cartoes}>
          {sessoes.map((s) => (
            <CartaoDaSessao
              key={s.id}
              sessao={s}
              ultimo={ultimoEvento(Object.hasOwn(feeds, s.id) ? (feeds[s.id] ?? []) : [], s.startedAt)}
              outras={sessoes.length - 1}
              controle={controle}
            />
          ))}
          {falhas.map((f) => (
            <CartaoDaFalha key={`falha:${f.chave}`} falha={f} iniciadaEm={iniciadas.get(f.chave)} controle={controle} aoDispensar={aoDispensarFalha} />
          ))}
        </div>
      )}
    </Secao>
  );
});
