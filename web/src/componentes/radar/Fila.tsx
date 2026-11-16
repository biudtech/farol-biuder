'use client';

// O bloco "Fila": o que foi pedido à conta e ainda não tem sessão, na ordem do motor, com
// Revisar agora e Ignorar. Depois vêm os PRs que já saíram da fila e esperam vaga de
// execução: esses não têm botão, porque um segundo disparo abriria duas revisões do mesmo
// commit.
import type { DetalheDaEspera, EsperaConflito, Estacionado, InicioAutomatico, ItemDaFila, PrEmEspera } from '@/contratos/radar';
import { dataHora, nomeDoPr, textoDaEspera, textoDoEstacionado } from '@/radar/formato';
import { AcoesDoItem } from './AcoesDoItem';
import { Bloco, ReferenciaDoPr } from './Bloco';
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
  // a linha de quando não há nada (depende de a primeira checagem já ter terminado)
  vazio: string;
  controle: ControleDeAcoes;
}

export function Fila({ fila, emEspera, detalhes, estacionados, inicioAutomatico, emConflito, vazio, controle }: Props) {
  return (
    <Bloco titulo="Fila" quantidade={fila.length + emEspera.length} vazio={vazio}>
      <ul className={estilos.lista}>
        {fila.map((pr) => {
          const nome = nomeDoPr(pr.key);
          const base = { alvo: pr.key, nome };
          const atualizado = dataHora(pr.updatedAt);
          const parada = de(estacionados, pr.key);
          return (
            <li key={pr.key} className={estilos.cartao}>
              <h3 className={estilos.tituloDoCartao}>
                <ReferenciaDoPr chave={pr.key} url={pr.url} />
                {pr.isDraft ? <span className={estilos.selo}>rascunho</span> : null}
              </h3>
              {pr.title ? <p className={estilos.tituloDoPr}>{pr.title}</p> : null}
              <p className={estilos.meta}>
                {[pr.author ? `PR de ${pr.author}` : '', atualizado ? `Atualizado em ${atualizado}` : ''].filter(Boolean).join(' · ')}
              </p>
              {parada ? <p className={estilos.nota}>{textoDoEstacionado(parada)}</p> : null}
              {de(inicioAutomatico, pr.key) === false ? (
                <p className={estilos.nota}>O motor não abre a revisão deste PR sozinho: ela começa por Revisar agora.</p>
              ) : null}
              {de(emConflito, pr.key) ? (
                <p className={estilos.nota}>Em conflito com a base: a revisão automática espera o conflito ser resolvido. Revisar agora não espera.</p>
              ) : null}
              <AcoesDoItem
                botoes={[
                  { acao: { ...base, tipo: 'revisar', url: pr.url }, primario: true },
                  { acao: { ...base, tipo: 'ignorar', chave: pr.key } },
                ]}
                controle={controle}
              />
            </li>
          );
        })}
        {emEspera.map((pr) => (
          <li key={`espera:${pr.key}`} className={estilos.cartao}>
            <h3 className={estilos.tituloDoCartao}><ReferenciaDoPr chave={pr.key} url={pr.url} /></h3>
            {pr.title ? <p className={estilos.tituloDoPr}>{pr.title}</p> : null}
            <p className={estilos.meta}>{pr.author ? `PR de ${pr.author} · ` : ''}{textoDaEspera(de(detalhes, pr.key))}</p>
          </li>
        ))}
      </ul>
    </Bloco>
  );
}
