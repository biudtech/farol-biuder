'use client';

// As quebras do período (redesenho, lote 5): por repositório, por modelo e por gatilho, cada uma
// num painel com uma linha por item (nome, barra e valor). As somas são do motor. A barra é a
// fatia do custo de cada linha sobre a maior da lista, só para desenhar; o valor está escrito ao
// lado, então a barra é decorativa. O nome do repositório é um botão: o clique vira filtro.
import { memo, useMemo } from 'react';
import type { Relatorio, SomaComNome, SomaDoModelo } from '@/contratos/consumo';
import { dolar, fracao, inteiro, rotuloDoGatilho, rotuloDoModelo, tokensCurtos } from '@/consumo/formato';
import { ui } from '../ui';
import estilos from './Consumo.module.css';

// A barra horizontal: largura em atributo do SVG, que a CSP aceita.
export function BarraHorizontal({ fracao: largura }: { fracao: number }) {
  return (
    <span className={estilos.trilho} aria-hidden="true">
      <svg viewBox="0 0 100 10" preserveAspectRatio="none" focusable="false">
        {largura > 0 ? <rect className={estilos.cheio} x={0} y={0} width={largura} height={10} /> : null}
      </svg>
    </span>
  );
}

// o número das quebras é de tentativas (`attempts`): cada uma é uma execução de IA, não uma sessão
// da tabela "Cada sessão", que conta operações
const execucoes = (n: number | undefined): string => (n === undefined ? 'sem dado' : `${inteiro(n)} ${n === 1 ? 'execução' : 'execuções'}`);

// do maior custo para o menor (é formatação); `porUltimo` vai para o fim
function porCusto<T extends { costUsd?: number }>(lista: readonly T[], porUltimo: (item: T) => boolean = () => false): T[] {
  return [...lista].sort((a, b) => Number(porUltimo(a)) - Number(porUltimo(b)) || (b.costUsd ?? -1) - (a.costUsd ?? -1));
}

function maiorCusto(lista: readonly { costUsd?: number }[]): number {
  return Math.max(0, ...lista.map((item) => item.costUsd ?? 0).filter(Number.isFinite));
}

interface PropsDoRepo {
  relatorio: Relatorio;
  // o filtro de repositório do endereço
  escolhido: string;
  aoEscolher(repo: string): void;
}

export const PorRepositorio = memo(function PorRepositorio({ relatorio, escolhido, aoEscolher }: PropsDoRepo) {
  const ordenados = useMemo(() => porCusto(relatorio.repos ?? [], (r) => !r.name), [relatorio.repos]);
  const maior = maiorCusto(ordenados);
  return (
    <section className={estilos.painel} aria-labelledby="consumo-por-repo">
      <h2 id="consumo-por-repo" className={estilos.tituloDoPainel}>Por repositório</h2>
      {!relatorio.repos ? <p className={ui.mini}>O motor não mandou a quebra por repositório.</p> : null}
      {relatorio.repos && !ordenados.length ? <p className={ui.mini}>Nenhuma execução neste período.</p> : null}
      {ordenados.length ? (
        <ul className={estilos.quebras}>
          {ordenados.map((repo) => (
            <li key={repo.name || '(sem)'} className={estilos.quebra}>
              {repo.name ? (
                <button
                  type="button"
                  className={estilos.nomeClicavel}
                  aria-pressed={escolhido === repo.name}
                  aria-label={escolhido === repo.name ? `Tirar o filtro do repositório ${repo.name}` : `Filtrar pelo repositório ${repo.name}`}
                  onClick={() => aoEscolher(escolhido === repo.name ? '' : repo.name)}
                >
                  {repo.name.split('/').pop() || repo.name}
                </button>
              ) : <span className={estilos.nomeDaQuebra}>Sem repositório</span>}
              <BarraHorizontal fracao={fracao(repo.costUsd, maior)} />
              <span className={estilos.valorDaQuebra}><b>{dolar(repo.costUsd)}</b> · {execucoes(repo.attempts)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {ordenados.length ? <p className={ui.mini}>Clique no nome para filtrar a tela pelo repositório. Sem repositório é o que não é de um PR (ferramenta, conversa ou registro antigo).</p> : null}
    </section>
  );
});

function tokensDoModelo(modelo: SomaDoModelo): string {
  const partes = [`entrada ${tokensCurtos(modelo.inputTokens)}`, `saída ${tokensCurtos(modelo.outputTokens)}`];
  if (modelo.thinkingTokens !== undefined) partes.push(`pensamento ${tokensCurtos(modelo.thinkingTokens)}`);
  return `Tokens: ${partes.join(', ')}`;
}

export const PorModelo = memo(function PorModelo({ relatorio }: { relatorio: Relatorio }) {
  const ordenados = useMemo(() => porCusto(relatorio.models), [relatorio.models]);
  const maior = maiorCusto(ordenados);
  const desconhecidas = ordenados.filter((m) => (m.unknownCost ?? 0) > 0);
  return (
    <section className={estilos.painel} aria-labelledby="consumo-por-modelo">
      <h2 id="consumo-por-modelo" className={estilos.tituloDoPainel}>Por modelo</h2>
      {ordenados.length === 0 ? <p className={ui.mini}>Nenhum modelo com execução neste período.</p> : (
        <ul className={estilos.quebras}>
          {ordenados.map((modelo) => (
            <li key={modelo.name} className={estilos.quebra}>
              <span className={estilos.nomeDaQuebra}>{rotuloDoModelo(modelo.name)}</span>
              <BarraHorizontal fracao={fracao(modelo.costUsd, maior)} />
              <span className={estilos.valorDaQuebra}><b>{dolar(modelo.costUsd)}</b> · {execucoes(modelo.attempts)}</span>
              <span className={`${ui.mini} ${estilos.notaDaQuebra}`}>{tokensDoModelo(modelo)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className={ui.mini}>
        O custo de cada modelo é o que o provedor mediu para ele; quando a medida não fecha com a execução, a execução inteira fica em Sem atribuição por modelo. Uma execução com dois modelos conta nos dois.
        {desconhecidas.length ? ` Execuções de custo desconhecido não somam: ${desconhecidas.map((m) => `${inteiro(m.unknownCost)} em ${rotuloDoModelo(m.name)}`).join(', ')}.` : ''}
      </p>
    </section>
  );
});

export const PorGatilho = memo(function PorGatilho({ relatorio }: { relatorio: Relatorio }) {
  const ordenados = useMemo(() => porCusto<SomaComNome>(relatorio.porGatilho ?? [], (g) => !g.name), [relatorio.porGatilho]);
  const maior = maiorCusto(ordenados);
  return (
    <section className={estilos.painel} aria-labelledby="consumo-por-gatilho">
      <h2 id="consumo-por-gatilho" className={estilos.tituloDoPainel}>Para que foi o gasto</h2>
      {!relatorio.porGatilho ? <p className={ui.mini}>O motor não mandou a soma por gatilho.</p> : null}
      {relatorio.porGatilho && !ordenados.length ? <p className={ui.mini}>Nenhuma execução neste período.</p> : null}
      {ordenados.length ? (
        <ul className={estilos.quebras}>
          {ordenados.map((g) => (
            <li key={g.name || '(sem)'} className={estilos.quebra}>
              <span className={estilos.nomeDaQuebra}>{rotuloDoGatilho(g.name)}</span>
              <BarraHorizontal fracao={fracao(g.costUsd, maior)} />
              <span className={estilos.valorDaQuebra}><b>{dolar(g.costUsd)}</b> · {execucoes(g.attempts)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {ordenados.length ? <p className={ui.mini}>O gatilho é por que a execução rodou. Registro antigo, sem a marca, conta como primeira revisão; a revisão retomada depois de um reinício também.</p> : null}
    </section>
  );
});
