'use client';

// A tela Radar: o que o revisor autônomo está fazendo agora. No topo, a contagem do que está
// na tela e o "Revisar um PR"; depois "Em análise", "Fila", "Postadas hoje" e os ignorados
// desta aba. Não há mesa: o front não aprova, não pede mudanças e não pula pendência. As
// pendências (`decisions.pending`) viram uma linha só, "N sem nada postado", com o link para o
// Histórico, que mostra cada uma; com pendência a tela não diz "Tudo revisado". A tela não recalcula regra do motor e não muda nada por conta própria depois
// de um POST: quem muda a tela é o snapshot que chega pelo fluxo.
//
// Cada chave do snapshot é lida por um seletor próprio, e as seções são `memo`: a seção só é
// redesenhada quando a fatia dela muda de referência. Uma linha nova de feed troca só
// `activity`, e não redesenha a fila nem as postadas.
import Link from 'next/link';
import { useId, useMemo } from 'react';
import { Simbolo } from '@/componentes/Logo';
import { Esqueleto, Pagina, ui } from '@/componentes/ui';
import type { App } from '@/estado/app';
import { app as appDoNavegador, useApp } from '@/estado/instancia';
import { CHECAR } from '@/radar/acoes';
import { avisosDoMotor, chavesAusentes, fatiarFila, resumoDoTopo, textoDaChecagem, textoDaFilaVazia, textoDasPendencias, textoDoTudoEmDia } from '@/radar/fatias';
import { AcoesDoItem } from './AcoesDoItem';
import { EmAnalise } from './EmAnalise';
import { Fila } from './Fila';
import { Ignorados } from './Ignorados';
import { PostadasHoje } from './PostadasHoje';
import { RegiaoDeResultado } from './RegiaoDeResultado';
import { RevisarUmPr } from './RevisarUmPr';
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
  const idDoTudoEmDia = useId();

  const { fila, emEspera } = useMemo(
    () => fatiarFila(filaDoMotor ?? NENHUM, emEsperaDoMotor ?? NENHUM, sessoes ?? NENHUM),
    [filaDoMotor, emEsperaDoMotor, sessoes],
  );
  // o PR que voltou para a fila não é mais um ignorado
  const ignoradosFora = useMemo(
    () => ignorados.filter((i) => !(filaDoMotor ?? NENHUM).some((pr) => pr.key === i.chave)),
    [ignorados, filaDoMotor],
  );

  const doTopo = { status, error: erro, account: conta, lastCheckAt: ultimaChecagem, nextCheckAt: proximaChecagem, buscasPausadas };
  const avisos = temEstado ? avisosDoMotor(doTopo) : [];
  const ausentes = temEstado ? chavesAusentes({ activeSessions: sessoes, queue: filaDoMotor, decisions: decisoes }) : [];
  const emAnalise = sessoes?.length ?? 0;
  const naFila = fila.length + emEspera.length;
  const pendentes = decisoes?.pending.length ?? 0;
  // Tudo em dia: a primeira checagem já terminou, o estado chegou inteiro e não há nada em
  // análise, na fila nem guardado sem publicar.
  const tudoEmDia = temEstado && !ausentes.length && Boolean(ultimaChecagem) && emAnalise === 0 && naFila === 0 && pendentes === 0;
  // "Hoje" é lido quando a próxima checagem muda: a tela não tem relógio próprio.
  const fraseDoTudoEmDia = useMemo(() => textoDoTudoEmDia({ nextCheckAt: proximaChecagem }), [proximaChecagem]);

  return (
    <Pagina
      titulo="Radar"
      sub={temEstado ? resumoDoTopo(emAnalise, naFila) : undefined}
      acoes={temEstado ? <RevisarUmPr checagem={textoDaChecagem(doTopo)} controle={controle} /> : undefined}
    >
      {temEstado ? (
        <>
          {avisos.length || ausentes.length ? (
            <ul className={`${ui.lista} ${estilos.semMarcador}`} aria-label="Avisos do motor">
              {avisos.map((aviso) => (
                <li key={aviso.texto} className={aviso.tom === 'erro' ? ui.erro : ui.nota}>
                  <span><strong>{ROTULO_DO_AVISO[aviso.tom]}</strong> {aviso.texto}</span>
                  {aviso.checar ? <AcoesDoItem pequeno botoes={[{ acao: CHECAR, ocupado: 'Checando…' }]} controle={controle} /> : null}
                </li>
              ))}
              {ausentes.length ? (
                <li className={ui.erro}>
                  <span><strong>Erro:</strong> o estado do motor chegou sem {ausentes.join(', ')}, ou com forma inesperada: a seção aparece vazia até o próximo estado.</span>
                </li>
              ) : null}
            </ul>
          ) : null}

          {pendentes > 0 ? (
            <p className={`${ui.nota} ${estilos.pendentes}`}>
              <span>{textoDasPendencias(pendentes)}</span>
              <Link className={ui.link} href="/historico">Ver no Histórico</Link>
            </p>
          ) : null}

          {tudoEmDia ? (
            <section className={`${ui.cartao} ${estilos.tudoEmDia}`} aria-labelledby={idDoTudoEmDia}>
              <Simbolo />
              <h2 id={idDoTudoEmDia} className={estilos.tituloDoTudoEmDia}>Tudo revisado</h2>
              <p className={ui.mini}>{fraseDoTudoEmDia}</p>
            </section>
          ) : (
            <>
              <EmAnalise sessoes={sessoes ?? NENHUM} feeds={feeds ?? SEM_FEEDS} controle={controle} />
              <Fila
                fila={fila}
                emEspera={emEspera}
                detalhes={detalhes}
                estacionados={estacionados}
                inicioAutomatico={inicioAutomatico}
                emConflito={emConflito}
                vazio={textoDaFilaVazia(doTopo)}
                checando={status === 'checking' && !ultimaChecagem}
                controle={controle}
              />
            </>
          )}
          <PostadasHoje resolvidas={decisoes?.resolved ?? NENHUM} />
          <Ignorados ignorados={ignoradosFora} controle={controle} />
        </>
      ) : (
        <Esqueleto texto="Carregando o estado do motor." linhas={3} bloco />
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
    </Pagina>
  );
}
