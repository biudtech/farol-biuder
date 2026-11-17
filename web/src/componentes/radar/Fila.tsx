'use client';

// A seção "Fila": uma linha por PR, com o título e o repositório. Num clique abre o detalhe: a
// chave, o autor, a hora, a posição, o motivo de espera que o motor mandou, Revisar agora,
// Ignorar e o link do PR. Primeiro vêm os PRs da fila, na ordem do motor; depois os que já
// saíram dela e esperam vaga de execução. Esses não têm botão, porque um segundo disparo
// abriria duas revisões do mesmo commit. Quem tira daqui o PR que já está em "Em análise" é
// fatiarFila (src/radar/fatias.ts), antes de a lista chegar.
import { memo } from 'react';
import type { DetalheDaEspera, EsperaConflito, Estacionado, InicioAutomatico, ItemDaFila, PrEmEspera } from '@/contratos/radar';
import { Chip, Linha, Secao, Spinner, ui } from '@/componentes/ui';
import { dataHora, nomeDoPr, repoDaChave, textoDaEspera, textoDoEstacionado } from '@/radar/formato';
import { AcoesDoItem } from './AcoesDoItem';
import { AbrirNoGitHub } from './Bloco';
import type { ControleDeAcoes } from './useAcoes';

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
  // a linha de quando não há nada (depende de a primeira checagem já ter terminado)
  vazio: string;
  // a primeira checagem está em curso: a linha de vazio ganha o spinner
  checando?: boolean;
  controle: ControleDeAcoes;
}

export const Fila = memo(function Fila({ fila, emEspera, detalhes, estacionados, inicioAutomatico, emConflito, vazio, checando, controle }: Props) {
  if (!fila.length && !emEspera.length) {
    return (
      <Secao titulo="Fila">
        <p className={ui.vazio}>{checando ? <><Spinner tamanho="p" /> </> : null}{vazio}</p>
      </Secao>
    );
  }
  return (
    <Secao titulo="Fila">
      <div className={ui.lista}>
        {fila.map((pr, i) => {
          const nome = nomeDoPr(pr.key);
          const base = { alvo: pr.key, nome };
          const atualizado = dataHora(pr.updatedAt);
          const parada = de(estacionados, pr.key);
          const conflito = de(emConflito, pr.key) !== undefined;
          const meta = [pr.key, pr.author ?? '', atualizado ? `atualizado em ${atualizado}` : '', `${i + 1}º na fila`].filter(Boolean).join(' · ');
          return (
            <Linha
              key={pr.key}
              resumo={
                <>
                  <span className={ui.t}>{pr.title || nome}</span>
                  {pr.isDraft ? <Chip pequeno>rascunho</Chip> : null}
                  {parada ? <Chip pequeno tom="ruim">parada</Chip> : null}
                  {conflito ? <Chip pequeno tom="aviso">em conflito</Chip> : null}
                  <span className={`${ui.r} ${ui.empurra}`}>{repoDaChave(pr.key)}</span>
                </>
              }
            >
              <p className={ui.mini}>{meta}</p>
              {parada ? <p className={ui.nota}>{textoDoEstacionado(parada)}</p> : null}
              {de(inicioAutomatico, pr.key) === false ? (
                <p className={ui.nota}>O motor não abre a revisão deste PR sozinho: ela começa por Revisar agora.</p>
              ) : null}
              {conflito ? (
                <p className={ui.nota}>Em conflito com a base: a revisão automática espera o conflito ser resolvido. Revisar agora não espera.</p>
              ) : null}
              <div className={ui.fila}>
                <AcoesDoItem
                  pequeno
                  botoes={[
                    { acao: { ...base, tipo: 'revisar', url: pr.url }, primario: true },
                    { acao: { ...base, tipo: 'ignorar', chave: pr.key }, fantasma: true },
                  ]}
                  controle={controle}
                />
                <AbrirNoGitHub chave={pr.key} url={pr.url} className={ui.empurra} />
              </div>
            </Linha>
          );
        })}
        {emEspera.map((pr) => {
          const detalhe = de(detalhes, pr.key);
          const vaga = detalhe?.posicao !== undefined ? `Esperando vaga · ${detalhe.posicao}º` : 'Esperando vaga';
          return (
            <Linha
              key={`espera:${pr.key}`}
              resumo={
                <>
                  <span className={ui.t}>{pr.title || nomeDoPr(pr.key)}</span>
                  <Chip pequeno tom="aviso">{vaga}</Chip>
                  <span className={`${ui.r} ${ui.empurra}`}>{repoDaChave(pr.key)}</span>
                </>
              }
            >
              <p className={ui.mini}>{[pr.key, pr.author ?? ''].filter(Boolean).join(' · ')}</p>
              <p className={ui.mini}>{textoDaEspera(detalhe)}</p>
              <AbrirNoGitHub chave={pr.key} url={pr.url} />
            </Linha>
          );
        })}
      </div>
    </Secao>
  );
});
