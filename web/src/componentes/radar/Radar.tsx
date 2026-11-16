'use client';

// A tela Radar: fatia o snapshot nos blocos e liga os botões às ações. Não recalcula regra
// do motor (ordem, elegibilidade, veredito e motivo chegam prontos) e não muda nada por
// conta própria depois de um POST: quem muda a tela é o snapshot que chega pelo fluxo.
//
// Cada chave do snapshot é lida por um seletor próprio, e os blocos são `memo`: o bloco só é
// redesenhado quando a fatia dele muda de referência. Uma linha nova de feed troca só
// `activity`, e não redesenha a fila nem as pendências.
import { useMemo } from 'react';
import type { App } from '@/estado/app';
import { app as appDoNavegador, useApp } from '@/estado/instancia';
import { avisosDoMotor, chavesAusentes, fatiarFila, fatiarPendencias, textoDaChecagem, textoDaFilaVazia } from '@/radar/fatias';
import { AcoesGerais } from './AcoesGerais';
import { AnalisandoAgora } from './AnalisandoAgora';
import { EsperandoOCi } from './EsperandoOCi';
import { Fila } from './Fila';
import { Ignorados } from './Ignorados';
import { PrecisaDeVoce } from './PrecisaDeVoce';
import { RegiaoDeResultado } from './RegiaoDeResultado';
import { useAcoes } from './useAcoes';
import estilos from './Radar.module.css';

interface Props {
  // existe para o teste trocar a instância
  app?: App;
}

// Listas vazias de referência fixa, para a chave ausente não virar lista nova a cada desenho.
const NENHUM: readonly never[] = Object.freeze([]);
const SEM_FEEDS = Object.freeze({});

// O que diferencia erro de informação não é só a cor: cada linha começa dizendo o que é.
const ROTULO_DO_AVISO = { erro: 'Erro:', info: 'Aviso:' } as const;

export function Radar({ app = appDoNavegador }: Props) {
  const temEstado = useApp((e) => e.snapshot !== null, app);
  const status = useApp((e) => e.snapshot?.status, app);
  const erro = useApp((e) => e.snapshot?.error, app);
  const conta = useApp((e) => e.snapshot?.account, app);
  const ultimaChecagem = useApp((e) => e.snapshot?.lastCheckAt, app);
  const proximaChecagem = useApp((e) => e.snapshot?.nextCheckAt, app);
  const buscasPausadas = useApp((e) => e.snapshot?.buscasPausadas, app);
  const decisoes = useApp((e) => e.snapshot?.decisions, app);
  const sessoes = useApp((e) => e.snapshot?.activeSessions, app);
  const feeds = useApp((e) => e.snapshot?.activity, app);
  const filaDoMotor = useApp((e) => e.snapshot?.queue, app);
  const emEsperaDoMotor = useApp((e) => e.snapshot?.headlessWaitingPrs, app);
  const detalhes = useApp((e) => e.snapshot?.headlessWaitingDetails, app);
  const estacionados = useApp((e) => e.snapshot?.parked, app);
  const inicioAutomatico = useApp((e) => e.snapshot?.inicioAutomatico, app);
  const emConflito = useApp((e) => e.snapshot?.esperaConflito, app);
  const recados = useApp((e) => e.recados, app);

  const { controle, resultado, dispensar, ignorados, regiao } = useAcoes(app.cliente);

  const pendentes = decisoes?.pending ?? NENHUM;
  const { precisam, esperando } = useMemo(() => fatiarPendencias(pendentes), [pendentes]);
  const { fila, emEspera } = useMemo(
    () => fatiarFila(filaDoMotor ?? NENHUM, emEsperaDoMotor ?? NENHUM, sessoes ?? NENHUM, pendentes),
    [filaDoMotor, emEsperaDoMotor, sessoes, pendentes],
  );
  // o PR que voltou para a fila não é mais um ignorado
  const ignoradosFora = useMemo(
    () => ignorados.filter((i) => !(filaDoMotor ?? NENHUM).some((pr) => pr.key === i.chave)),
    [ignorados, filaDoMotor],
  );

  const doTopo = { status, error: erro, account: conta, lastCheckAt: ultimaChecagem, nextCheckAt: proximaChecagem, buscasPausadas };
  const avisos = temEstado ? avisosDoMotor(doTopo) : [];
  const ausentes = temEstado ? chavesAusentes({ decisions: decisoes, activeSessions: sessoes, queue: filaDoMotor }) : [];

  return (
    <div className={estilos.radar}>
      <h1 className={estilos.titulo}>Radar</h1>

      {temEstado ? (
        <>
          {avisos.length || ausentes.length ? (
            <ul className={estilos.avisos} aria-label="Avisos do motor">
              {avisos.map((aviso) => (
                <li key={aviso.texto} className={estilos.aviso} data-tom={aviso.tom}>
                  <strong>{ROTULO_DO_AVISO[aviso.tom]}</strong> {aviso.texto}
                </li>
              ))}
              {ausentes.length ? (
                <li className={estilos.aviso} data-tom="erro">
                  <strong>Erro:</strong> o estado do motor chegou sem {ausentes.join(', ')}, ou com forma inesperada: o bloco aparece vazio até o próximo estado.
                </li>
              ) : null}
            </ul>
          ) : null}

          <AcoesGerais checagem={textoDaChecagem(doTopo)} controle={controle} />
          <PrecisaDeVoce pendencias={precisam} ilegiveis={decisoes?.ilegiveis ?? 0} controle={controle} />
          <AnalisandoAgora sessoes={sessoes ?? NENHUM} feeds={feeds ?? SEM_FEEDS} controle={controle} />
          <EsperandoOCi pendencias={esperando} controle={controle} />
          <Fila
            fila={fila}
            emEspera={emEspera}
            detalhes={detalhes}
            estacionados={estacionados}
            inicioAutomatico={inicioAutomatico}
            emConflito={emConflito}
            vazio={textoDaFilaVazia(doTopo)}
            controle={controle}
          />
          <Ignorados ignorados={ignoradosFora} controle={controle} />
        </>
      ) : (
        <p className={estilos.vazio} role="status">Carregando o estado do motor.</p>
      )}

      <RegiaoDeResultado
        regiao={regiao}
        resultado={resultado}
        recados={recados}
        aoDispensar={() => {
          dispensar();
          app.dispensarRecados();
        }}
      />
    </div>
  );
}
