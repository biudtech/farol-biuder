'use client';

// Os números do período (redesenho, lote 5) e o plano de cada perfil do Claude. Os números são os
// que o motor somou em GET /api/usage; a tela não divide nem soma: custo médio por revisão seria
// conta dela, e não entra (lacuna no web/README.md). O plano vem do snapshot (src/consumo/plano.ts).
import { memo } from 'react';
import type { Relatorio } from '@/contratos/consumo';
import { dolar, inteiro, tokensCurtos } from '@/consumo/formato';
import type { PerfilNoPlano } from '@/consumo/plano';
import { Chip, ui } from '../ui';
import { BarraHorizontal } from './Quebras';
import estilos from './Consumo.module.css';

interface Numero {
  rotulo: string;
  valor: string;
  nota: string;
}

export function numerosDoPeriodo(relatorio: Relatorio): Numero[] {
  const { totals, completed, retries } = relatorio;
  const calculado = totals.estimatedUsd !== undefined && totals.estimatedUsd > 0 ? `, ${dolar(totals.estimatedUsd)} calculados pelo motor` : '';
  const desconhecido = totals.unknownCost !== undefined && totals.unknownCost > 0 ? `; ${inteiro(totals.unknownCost)} de custo desconhecido fora da soma` : '';
  return [
    { rotulo: 'Custo estimado', valor: dolar(totals.costUsd), nota: `O valor que cada sessão informa, não cobrança${calculado}${desconhecido}.` },
    {
      rotulo: 'Revisões concluídas',
      valor: completed ? inteiro(completed.reviews) : 'sem dado',
      nota: completed ? `Em ${inteiro(completed.prs)} ${completed.prs === 1 ? 'PR' : 'PRs'}. Concluída não quer dizer publicada.` : 'O motor não mandou a contagem.',
    },
    {
      rotulo: 'Execuções de IA',
      valor: inteiro(totals.attempts),
      nota: retries === undefined ? 'Cada tentativa conta.' : `${inteiro(retries)} ${retries === 1 ? 'é retentativa' : 'são retentativas'} de uma operação.`,
    },
    {
      rotulo: 'Tokens de saída',
      valor: tokensCurtos(totals.outputTokens),
      nota: `Mais ${tokensCurtos(totals.thinkingTokens)} de pensamento e ${tokensCurtos(totals.inputTokens)} de entrada.`,
    },
  ];
}

export const Numeros = memo(function Numeros({ relatorio }: { relatorio: Relatorio }) {
  return (
    <ul className={estilos.numeros} aria-label="Números do período">
      {numerosDoPeriodo(relatorio).map((n) => (
        <li key={n.rotulo} className={estilos.numeroCartao}>
          <span className={estilos.rotuloDoNumero}>{n.rotulo}</span>
          <span className={estilos.numero}>{n.valor}</span>
          <span className={estilos.notaDoNumero}>{n.nota}</span>
        </li>
      ))}
    </ul>
  );
});

interface PropsDoPlano {
  perfis: PerfilNoPlano[];
  // o snapshot ainda não chegou
  semSnapshot: boolean;
}

export const PlanoDosPerfis = memo(function PlanoDosPerfis({ perfis, semSnapshot }: PropsDoPlano) {
  return (
    <section className={estilos.bloco} aria-labelledby="consumo-plano">
      <h2 id="consumo-plano" className={estilos.tituloDoBloco}>Plano de cada perfil do Claude</h2>
      {semSnapshot ? <p className={ui.mini}>O estado do motor ainda não chegou.</p> : null}
      {!semSnapshot && !perfis.length ? <p className={ui.mini}>O motor não mandou nenhum perfil do Claude.</p> : null}
      {perfis.length ? (
        <ul className={estilos.perfis}>
          {perfis.map((perfil) => (
            <li key={perfil.id} className={`${estilos.painel} ${estilos.perfil}`} data-tom={perfil.selo.tom}>
              <div className={estilos.topoDoPerfil}>
                <h3 className={estilos.nomeDoPerfil}>{perfil.nome}</h3>
                <Chip pequeno tom={perfil.selo.tom}>{perfil.selo.texto}</Chip>
              </div>
              {perfil.janelas.map((janela) => (
                <div key={janela.nome} className={estilos.janela}>
                  <div className={estilos.textoDaJanela}><span><b>{janela.nome}</b></span><span>{janela.texto}</span></div>
                  <BarraHorizontal fracao={janela.fracao} />
                </div>
              ))}
              {perfil.aviso ? <p className={ui.mini}>{perfil.aviso}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {perfis.length ? <p className={ui.mini}>O uso de cada janela é o que o motor leu do plano. Só informa: o motor troca de perfil no limite do plano, e o gasto não segura revisão.</p> : null}
    </section>
  );
});
