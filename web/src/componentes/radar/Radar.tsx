'use client';

// A tela Radar: fatia o snapshot nos blocos e liga os botões às ações. Não recalcula regra
// do motor (ordem, elegibilidade, veredito e motivo chegam prontos) e não muda nada por
// conta própria depois de um POST: quem muda a tela é o snapshot que chega pelo fluxo.
import { useMemo } from 'react';
import type { App } from '@/estado/app';
import { app as appDoNavegador, useApp } from '@/estado/instancia';
import { avisosDoMotor, chavesAusentes, fatiarPendencias, textoDaChecagem, textoDaFilaVazia } from '@/radar/fatias';
import { AcoesGerais } from './AcoesGerais';
import { AnalisandoAgora } from './AnalisandoAgora';
import { EsperandoOCi } from './EsperandoOCi';
import { Fila } from './Fila';
import { Ignorados } from './Ignorados';
import { PrecisaDeVoce } from './PrecisaDeVoce';
import { useAcoes } from './useAcoes';
import estilos from './Radar.module.css';

interface Props {
  // existe para o teste trocar a instância
  app?: App;
}

const SEM_FEEDS = Object.freeze({});

export function Radar({ app = appDoNavegador }: Props) {
  const snapshot = useApp((e) => e.snapshot, app);
  const { controle, resultado, dispensar, ignorados } = useAcoes(app.cliente);
  const pendentes = snapshot?.decisions?.pending;
  const { precisam, esperando } = useMemo(() => fatiarPendencias(pendentes ?? []), [pendentes]);

  const fila = snapshot?.queue ?? [];
  // o PR que voltou para a fila não é mais um ignorado
  const ignoradosFora = ignorados.filter((i) => !fila.some((pr) => pr.key === i.chave));
  const avisos = snapshot ? avisosDoMotor(snapshot) : [];
  const ausentes = snapshot ? chavesAusentes(snapshot) : [];

  return (
    <div className={estilos.radar}>
      <h1 className={estilos.titulo}>Radar</h1>

      {snapshot ? (
        <>
          {avisos.length || ausentes.length ? (
            <ul className={estilos.avisos} aria-label="Avisos do motor">
              {avisos.map((aviso) => <li key={aviso.texto} className={estilos.aviso} data-tom={aviso.tom}>{aviso.texto}</li>)}
              {ausentes.length ? (
                <li className={estilos.aviso} data-tom="erro">
                  O estado do motor chegou sem {ausentes.join(', ')}, ou com forma inesperada: o bloco aparece vazio até o próximo estado.
                </li>
              ) : null}
            </ul>
          ) : null}

          <AcoesGerais checagem={textoDaChecagem(snapshot)} controle={controle} />
          <PrecisaDeVoce pendencias={precisam} controle={controle} />
          <AnalisandoAgora sessoes={snapshot.activeSessions ?? []} feeds={snapshot.activity ?? SEM_FEEDS} controle={controle} />
          <EsperandoOCi pendencias={esperando} controle={controle} />
          <Fila
            fila={fila}
            emEspera={snapshot.headlessWaitingPrs ?? []}
            detalhes={snapshot.headlessWaitingDetails}
            estacionados={snapshot.parked}
            inicioAutomatico={snapshot.inicioAutomatico}
            emConflito={snapshot.esperaConflito}
            vazio={textoDaFilaVazia(snapshot)}
            controle={controle}
          />
          <Ignorados ignorados={ignoradosFora} controle={controle} />
        </>
      ) : (
        <p className={estilos.vazio} role="status">Carregando o estado do motor.</p>
      )}

      {/* sempre montada, para o leitor de tela anunciar o resultado quando ele chega */}
      <div className={estilos.resultado} role="status" aria-live="polite" aria-label="Resultado da última ação">
        {resultado ? (
          <div className={estilos.recado} data-tom={resultado.tom}>
            <p>{resultado.texto}</p>
            <button type="button" className={estilos.botao} onClick={dispensar}>Dispensar</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
