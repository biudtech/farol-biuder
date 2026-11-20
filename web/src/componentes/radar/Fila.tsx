'use client';

// A seção "Fila": um cartão por PR, no molde do cartão da autoanálise, com a borda neutra. O
// canto diz a posição; o rodapé, o que segura o PR (a parada, o conflito, o limite do plano, a
// retentativa automática, o início que espera o clique), com Revisar agora, Ignorar e Abrir no
// GitHub. Primeiro vêm os PRs da fila, na
// ordem do motor; depois os que já saíram dela e esperam vaga de execução. Esses não têm botão,
// porque um segundo disparo abriria duas revisões do mesmo commit. Quem tira daqui o PR que já
// está em "Em análise", e o de De fora da fila, é fatiarFila (src/radar/fatias.ts), antes de a
// lista chegar.
//
// Ao clicar em Revisar agora o cartão vira "Iniciando a revisão." na hora, antes do motor; e o
// PR cuja última sessão sumiu sem resultado mostra a falha no próprio cartão, com Tentar de novo;
// ela some sozinha (useFalhas), sem botão de dispensar.
import { memo, type ReactNode } from 'react';
import type { Retentativa } from '@/contratos/de-fora';
import type { DetalheDaEspera, EsperaConflito, Estacionado, InicioAutomatico, ItemDaFila, PrEmEspera } from '@/contratos/radar';
import { Chip, Secao, Spinner, ui } from '@/componentes/ui';
import { andamentoDaFalha, contextoDaFila, pilulasDaFalha, tempoDecorrido, textoDaFila, tomDaFila } from '@/radar/cartao';
import type { Falha } from '@/radar/falhas';
import { nomeDoPr, textoDaEspera, textoDoEstacionado } from '@/radar/formato';
import { AcoesDoItem } from './AcoesDoItem';
import { AbrirNoGitHub, BotaoOcupado, Cartao, Faixa, FaixaDaFila } from '@/componentes/cartao/Cartao';
import { FaixaIniciando } from './EmAnalise';
import type { ControleDeAcoes } from './useAcoes';
import estilos from './Radar.module.css';

// Lê um mapa do motor pela chave do PR, só como propriedade própria.
function de<T>(mapa: Readonly<Record<string, T>> | undefined, chave: string): T | undefined {
  return mapa && Object.hasOwn(mapa, chave) ? mapa[chave] : undefined;
}

interface Props {
  fila: readonly ItemDaFila[];
  emEspera: readonly PrEmEspera[];
  detalhes?: Readonly<Record<string, DetalheDaEspera>>;
  estacionados?: Readonly<Record<string, Estacionado>>;
  inicioAutomatico?: Readonly<InicioAutomatico>;
  emConflito?: Readonly<EsperaConflito>;
  // a retentativa automática por PR (emRetentativa), com o limite do plano
  emRetentativa?: Readonly<Record<string, Retentativa>>;
  // a pílula de De fora da fila, ao lado do título (só quando há PR de fora)
  extra?: ReactNode;
  // a linha de quando não há nada (depende de a primeira checagem já ter terminado)
  vazio: string;
  // a primeira checagem está em curso: a linha de vazio ganha o spinner
  checando?: boolean;
  // as sessões que sumiram sem resultado, por chave do PR
  falhas?: ReadonlyMap<string, Falha & { motivo: string }>;
  // os PRs com o Revisar clicado e a sessão ainda não aberta, com a hora do clique
  iniciadas?: ReadonlyMap<string, number>;
  controle: ControleDeAcoes;
}

const NENHUMA: ReadonlyMap<string, never> = new Map<string, never>();

function CartaoDaFila({ pr, posicao, parada, conflito, manual, retentativa, falha, iniciadaEm, controle }: {
  pr: ItemDaFila;
  posicao: number;
  parada?: Estacionado;
  conflito: boolean;
  manual: boolean;
  retentativa?: Retentativa;
  falha?: Falha & { motivo: string };
  iniciadaEm?: number;
  controle: ControleDeAcoes;
}) {
  const nome = nomeDoPr(pr.key);
  const base = { alvo: pr.key, nome };
  const marcas = (
    <>
      {pr.isDraft ? <Chip pequeno>rascunho</Chip> : null}
      {parada ? <Chip pequeno tom="ruim">parada</Chip> : null}
      {conflito ? <Chip pequeno tom="aviso">em conflito</Chip> : null}
    </>
  );
  const comum = { chave: pr.key, url: pr.url, autor: pr.author, titulo: pr.title || nome, contexto: contextoDaFila(pr), marcas };

  if (iniciadaEm !== undefined) {
    return (
      <Cartao {...comum} tom="rodando" estado="iniciando a revisão" botoes={<><BotaoOcupado texto="Revisando" de={nome} chave={pr.key} /><AbrirNoGitHub chave={pr.key} url={pr.url} /></>}>
        <FaixaIniciando desde={iniciadaEm} de={nome} />
      </Cartao>
    );
  }
  if (falha) {
    return (
      <Cartao
        {...comum}
        tom="falha"
        estado="a última sessão terminou sem resultado"
        pilulas={pilulasDaFalha(falha.etapa)}
        botoes={(
          <>
            <AcoesDoItem
              pequeno
              botoes={[{ acao: { ...base, tipo: 'revisar', url: pr.url, falhou: true }, primario: true }, { acao: { ...base, tipo: 'ignorar', chave: pr.key }, fantasma: true }]}
              controle={controle}
            />
            <AbrirNoGitHub chave={pr.key} url={pr.url} />
          </>
        )}
      >
        <Faixa
          andamento={andamentoDaFalha(falha.etapa, falha.motivo)}
          de={nome}
          tempo={falha.inicio ? tempoDecorrido(falha.fimNoMotor - falha.inicio) : ''}
        />
      </Cartao>
    );
  }
  const espera = { parada: parada ? textoDoEstacionado(parada) : undefined, conflito, manual, retentativa };
  return (
    <Cartao
      {...comum}
      tom="fila"
      estado={`${posicao}º na fila`}
      botoes={<span className={estilos.posicao} aria-hidden="true">{posicao}º</span>}
    >
      <FaixaDaFila
        texto={textoDaFila(posicao, espera)}
        ponto={tomDaFila(espera)}
        acoes={(
          <>
            <AcoesDoItem
              pequeno
              botoes={[{ acao: { ...base, tipo: 'revisar', url: pr.url }, primario: true }, { acao: { ...base, tipo: 'ignorar', chave: pr.key }, fantasma: true }]}
              controle={controle}
            />
            <AbrirNoGitHub chave={pr.key} url={pr.url} />
          </>
        )}
      />
    </Cartao>
  );
}

export const Fila = memo(function Fila({
  fila, emEspera, detalhes, estacionados, inicioAutomatico, emConflito, emRetentativa, extra, vazio, checando, falhas = NENHUMA, iniciadas = NENHUMA, controle,
}: Props) {
  if (!fila.length && !emEspera.length) {
    return (
      <Secao titulo="Fila" extra={extra}>
        <p className={ui.vazio}>{checando ? <><Spinner tamanho="p" /> </> : null}{vazio}</p>
      </Secao>
    );
  }
  return (
    <Secao titulo="Fila" extra={extra} contagem={{ n: fila.length + emEspera.length, rotulo: fila.length + emEspera.length === 1 ? 'PR na fila' : 'PRs na fila' }}>
      <div className={estilos.cartoes}>
        {fila.map((pr, i) => (
          <CartaoDaFila
            key={pr.key}
            pr={pr}
            posicao={i + 1}
            parada={de(estacionados, pr.key)}
            conflito={de(emConflito, pr.key) !== undefined}
            manual={de(inicioAutomatico, pr.key) === false}
            retentativa={de(emRetentativa, pr.key)}
            falha={falhas.get(pr.key)}
            iniciadaEm={iniciadas.get(pr.key)}
            controle={controle}
          />
        ))}
        {emEspera.map((pr) => {
          const detalhe = de(detalhes, pr.key);
          const vaga = detalhe?.posicao !== undefined ? `Esperando vaga · ${detalhe.posicao}º` : 'Esperando vaga';
          const nome = nomeDoPr(pr.key);
          return (
            <Cartao
              key={`espera:${pr.key}`}
              tom="fila"
              chave={pr.key}
              url={pr.url}
              autor={pr.author}
              titulo={pr.title || nome}
              contexto=""
              estado="esperando vaga de execução"
              marcas={<Chip pequeno tom="aviso">{vaga}</Chip>}
              botoes={<AbrirNoGitHub chave={pr.key} url={pr.url} />}
            >
              <FaixaDaFila texto={textoDaEspera(detalhe)} ponto="aviso" />
            </Cartao>
          );
        })}
      </div>
    </Secao>
  );
});
