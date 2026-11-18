'use client';

// A seção "Postadas hoje": das revisões resolvidas que o snapshot traz, as publicadas hoje, no
// fuso do navegador (postadasDeHoje, src/radar/postadas.ts). Um cartão por revisão, no molde do
// cartão da autoanálise: a borda pela cor do que saiu (aprovado verde, pediu mudanças vermelho,
// comentado âmbar), as pílulas e a faixa com todas as etapas feitas. Os checks, os critérios do
// card, os achados, a rodada, o tamanho e a execução só vêm em GET /api/decision: o cartão busca
// o detalhe de cada revisão uma vez e, sem ele, as pílulas dizem o traço. O snapshot traz só as 30
// mais recentes: num dia cheio, as mais antigas do dia ficam só no Histórico, e o link do
// cabeçalho leva para lá.
import Link from 'next/link';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { lerDetalheDaRevisao, type Revisao } from '@/contratos/historico';
import { Secao, ui } from '@/componentes/ui';
import { caminhoDoDetalhe } from '@/historico/consulta';
import { andamentoDaPostada, contextoDaPostada, duracaoDaPostada, pilulasDaPostada } from '@/radar/cartao';
import { nomeDoPr } from '@/radar/formato';
import { postadasDeHoje, type Postada } from '@/radar/postadas';
import type { Cliente } from '@/transporte/cliente';
import { AcoesDoItem } from './AcoesDoItem';
import { AbrirNoGitHub, BotaoOcupado, Cartao, Faixa } from './Cartao';
import { FaixaIniciando } from './EmAnalise';
import type { ControleDeAcoes } from './useAcoes';
import estilos from './Radar.module.css';

// undefined: ainda buscando; null: a busca falhou ou o motor não achou a revisão
type Detalhes = ReadonlyMap<string, Revisao | null>;

// O detalhe de cada postada, buscado uma vez por id. A busca que falha não se repete nesta aba:
// o cartão fica com as pílulas sem dado, sem inventar.
function useDetalhes(postadas: readonly Postada[], cliente: Pick<Cliente, 'get'> | undefined): Detalhes {
  const [detalhes, setDetalhes] = useState<Detalhes>(() => new Map());
  const pedidos = useRef(new Set<string>());
  useEffect(() => {
    if (!cliente) return undefined;
    const controle = new AbortController();
    const feitos = pedidos.current;
    // os pedidos desta rodada que ainda não voltaram: se a rodada acabar antes, saem da lista na
    // hora, para a próxima pedir de novo
    const emCurso = new Set<string>();
    for (const p of postadas) {
      if (feitos.has(p.id)) continue;
      feitos.add(p.id);
      emCurso.add(p.id);
      void cliente.get(caminhoDoDetalhe(p.chave, p.id), lerDetalheDaRevisao, { sinal: controle.signal }).then((r) => {
        if (controle.signal.aborted) return;
        emCurso.delete(p.id);
        const revisao = r.ok && r.dados.encontrada && r.dados.revisao.id === p.id ? r.dados.revisao : null;
        setDetalhes((antes) => new Map(antes).set(p.id, revisao));
      });
    }
    return () => {
      controle.abort();
      for (const id of emCurso) feitos.delete(id);
    };
  }, [postadas, cliente]);
  return detalhes;
}

function CartaoDaPostada({ p, detalhe, carregando, iniciadaEm, controle }: {
  p: Postada;
  detalhe: Revisao | undefined;
  carregando: boolean;
  iniciadaEm?: number;
  controle?: ControleDeAcoes;
}) {
  const nome = nomeDoPr(p.chave);
  const andamento = andamentoDaPostada(p.acao, detalhe);
  const verResultado = (
    <Link className={`${ui.botao} ${ui.pequeno} ${estilos.botaoLink}`} href={p.endereco}>
      Ver resultado{' '}<span className={ui.soLeitor}>de {p.chave}</span>
    </Link>
  );
  let revisar = null;
  if (iniciadaEm !== undefined) revisar = <BotaoOcupado texto="Revisando" de={nome} chave={p.chave} />;
  else if (p.url && controle) {
    revisar = <AcoesDoItem pequeno botoes={[{ acao: { tipo: 'revisar', url: p.url, deNovo: true, alvo: p.chave, nome }, primario: true }]} controle={controle} />;
  }
  return (
    <Cartao
      tom={iniciadaEm !== undefined ? 'rodando' : andamento.tom}
      chave={p.chave}
      url={p.url ?? undefined}
      autor={p.autor}
      titulo={p.titulo}
      contexto={contextoDaPostada(p, detalhe)}
      estado={iniciadaEm !== undefined ? 'iniciando a revisão' : p.desfecho}
      botoes={<>{revisar}<AbrirNoGitHub chave={p.chave} url={p.url} /></>}
      pilulas={pilulasDaPostada(p.acao, p.card, detalhe, carregando)}
    >
      {iniciadaEm !== undefined ? <FaixaIniciando desde={iniciadaEm} de={nome} /> : (
        <Faixa andamento={andamento} de={nome} tempo={duracaoDaPostada({ stages: p.totalMs ? { totalMs: p.totalMs } : undefined }, detalhe)} acao={verResultado} />
      )}
    </Cartao>
  );
}

interface Props {
  // `decisions.resolved` do snapshot, como veio
  resolvidas: readonly unknown[];
  // quem busca o detalhe de cada revisão (GET /api/decision); sem ele, as pílulas ficam sem dado
  cliente?: Pick<Cliente, 'get'>;
  controle?: ControleDeAcoes;
  iniciadas?: ReadonlyMap<string, number>;
  // o instante que conta como agora; existe para o teste
  agora?: number;
}

const NENHUMA: ReadonlyMap<string, never> = new Map<string, never>();

export const PostadasHoje = memo(function PostadasHoje({ resolvidas, cliente, controle, iniciadas = NENHUMA, agora }: Props) {
  // "Hoje" é lido quando a lista muda: a tela não tem relógio próprio. Uma aba aberta da
  // véspera troca de dia quando chega a próxima revisão resolvida.
  const { postadas, ilegiveis } = useMemo(() => postadasDeHoje(resolvidas, agora), [resolvidas, agora]);
  const detalhes = useDetalhes(postadas, cliente);
  return (
    <Secao titulo="Postadas hoje" extra={<Link className={ui.link} href="/historico">Ver histórico</Link>}>
      {ilegiveis ? (
        <p className={ui.nota}>
          {ilegiveis === 1
            ? '1 revisão recente chegou do motor numa forma que esta tela não lê e ficou de fora da lista.'
            : `${ilegiveis} revisões recentes chegaram do motor numa forma que esta tela não lê e ficaram de fora da lista.`}
        </p>
      ) : null}
      {postadas.length ? (
        <div className={estilos.cartoes}>
          {postadas.map((p) => (
            <CartaoDaPostada
              key={p.id}
              p={p}
              detalhe={detalhes.get(p.id) ?? undefined}
              carregando={Boolean(cliente) && !detalhes.has(p.id)}
              iniciadaEm={iniciadas.get(p.chave)}
              controle={controle}
            />
          ))}
        </div>
      ) : (
        <p className={ui.vazio}>Nenhuma revisão postada hoje.</p>
      )}
    </Secao>
  );
});
