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
import { Esqueleto, Pagina, Spinner, ui } from '@/componentes/ui';
import type { App } from '@/estado/app';
import { app as appDoNavegador, useApp } from '@/estado/instancia';
import { CHECAR } from '@/radar/acoes';
import { avisosDoMotor, chavesAusentes, fatiarFila, resumoDoTopo, textoDaChecagem, textoDaChecagemEmCurso, textoDaFilaVazia, textoDasPendencias, textoDoTudoEmDia } from '@/radar/fatias';
import { AcoesDoItem } from './AcoesDoItem';
import { BotaoDeFora, PainelDeFora, PilulaDeFora, usePainelDeFora } from './DeFora';
import estilosDeFora from './DeFora.module.css';
import { EmAnalise } from './EmAnalise';
import { Fila } from './Fila';
import { Ignorados } from './Ignorados';
import { PostadasHoje } from './PostadasHoje';
import { RegiaoDeResultado } from './RegiaoDeResultado';
import { RevisarUmPr } from './RevisarUmPr';
import { useAcoes } from './useAcoes';
import { useDesvio } from './useDesvio';
import { useFalhas } from './useFalhas';
import { useIniciadas } from './useIniciadas';
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
  const checagem = useApp((e) => e.snapshot?.checagem, app);
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
  const deFora = useApp((e) => e.snapshot?.deFora, app);
  const emRetentativa = useApp((e) => e.snapshot?.emRetentativa, app);
  const perfis = useApp((e) => e.snapshot?.config?.claudeProfiles, app);
  const recados = useApp((e) => e.recados, app);
  // a diferença entre o relógio do navegador e o do motor, medida a cada retrato
  const desvio = useDesvio(useApp((e) => e.snapshot?.agora, app));

  const { controle: controleDasAcoes, resultado, dispensar, ignorados, regiao } = useAcoes(app.cliente);
  const idDoTudoEmDia = useId();
  // o painel De fora da fila: aberto pelo botão flutuante ou pela pílula da Fila
  const painelDeFora = usePainelDeFora();
  const nDeFora = deFora?.length ?? 0;
  // a pílula vai à Fila, que é memo: o elemento só muda quando o número ou o estado do painel muda
  const { abrir: abrirDeFora, aberto: deForaAberto } = painelDeFora;
  const pilulaDeFora = useMemo(() => <PilulaDeFora n={nDeFora} aoAbrir={abrirDeFora} aberto={deForaAberto} />, [nDeFora, abrirDeFora, deForaAberto]);

  const { fila, emEspera } = useMemo(
    () => fatiarFila(filaDoMotor ?? NENHUM, emEsperaDoMotor ?? NENHUM, sessoes ?? NENHUM, deFora ?? NENHUM),
    [filaDoMotor, emEsperaDoMotor, sessoes, deFora],
  );
  // o clique em Revisar vira "Iniciando a revisão." na hora, antes do motor
  const { iniciadas, controle } = useIniciadas(controleDasAcoes, sessoes ?? NENHUM, emEspera);
  // a sessão que some sem resultado: no cartão da fila quando o PR está nela, senão em Em análise
  const { falhas, dispensar: dispensarFalha } = useFalhas({
    sessoes: sessoes ?? NENHUM, feeds: feeds ?? SEM_FEEDS, pendentes: decisoes?.pending ?? NENHUM, resolvidas: decisoes?.resolved ?? NENHUM, estacionados, desvio,
  });
  const { falhasDaFila, falhasSoltas } = useMemo(() => {
    const naFila = new Set(fila.map((pr) => pr.key));
    const daFila = new Map(falhas.filter((f) => naFila.has(f.chave)).map((f) => [f.chave, f] as const));
    return { falhasDaFila: daFila, falhasSoltas: falhas.filter((f) => !naFila.has(f.chave) && !emEspera.some((pr) => pr.key === f.chave)) };
  }, [falhas, fila, emEspera]);
  // o PR que voltou para a fila não é mais um ignorado
  const ignoradosFora = useMemo(
    () => ignorados.filter((i) => !(filaDoMotor ?? NENHUM).some((pr) => pr.key === i.chave)),
    [ignorados, filaDoMotor],
  );

  const doTopo = { status, error: erro, account: conta, lastCheckAt: ultimaChecagem, nextCheckAt: proximaChecagem, checagem, buscasPausadas };
  const avisos = temEstado ? avisosDoMotor(doTopo) : [];
  const ausentes = temEstado ? chavesAusentes({ activeSessions: sessoes, queue: filaDoMotor, decisions: decisoes }) : [];
  const emAnalise = sessoes?.length ?? 0;
  const naFila = fila.length + emEspera.length;
  const pendentes = decisoes?.pending.length ?? 0;
  // Tudo em dia: a primeira checagem já terminou, o estado chegou inteiro e não há nada em
  // análise, na fila nem guardado sem publicar.
  const tudoEmDia = temEstado && !ausentes.length && Boolean(ultimaChecagem) && emAnalise === 0 && naFila === 0 && pendentes === 0 && !falhasSoltas.length;
  // "Hoje" é lido quando a próxima checagem muda: a tela não tem relógio próprio.
  const fraseDoTudoEmDia = useMemo(() => textoDoTudoEmDia({ nextCheckAt: proximaChecagem }), [proximaChecagem]);
  const elementoDaFila = (
    <Fila
      fila={fila}
      emEspera={emEspera}
      detalhes={detalhes}
      estacionados={estacionados}
      inicioAutomatico={inicioAutomatico}
      emConflito={emConflito}
      emRetentativa={emRetentativa}
      extra={pilulaDeFora}
      vazio={textoDaFilaVazia(doTopo)}
      checando={status === 'checking' && !ultimaChecagem}
      falhas={falhasDaFila}
      iniciadas={iniciadas}
      controle={controle}
      aoDispensarFalha={dispensarFalha}
    />
  );
  // A região de resultado das ações: dentro do painel De fora enquanto ele está aberto (o modal
  // esconde o resto da página do leitor de tela e cobre o pé da janela), no pé da página fora dele.
  const regiaoDeResultado = (
    <RegiaoDeResultado
      regiao={regiao}
      resultado={resultado}
      recados={recados}
      aoDispensar={() => {
        dispensar();
        app.dispensarRecados();
      }}
    />
  );
  const painelAberto = temEstado && painelDeFora.aberto;

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

          {/* a checagem em curso, com a contagem do motor; sem região viva: muda a cada segundo */}
          {status === 'checking' && checagem ? (
            <p className={`${ui.mini} ${estilos.checagemEmCurso}`}>
              <Spinner tamanho="p" />
              <span>{textoDaChecagemEmCurso(checagem)}</span>
            </p>
          ) : null}

          {pendentes > 0 ? (
            <p className={`${ui.nota} ${estilos.pendentes}`}>
              <span>{textoDasPendencias(pendentes)}</span>
              <Link className={ui.link} href="/historico">Ver no Histórico</Link>
            </p>
          ) : null}

          {tudoEmDia ? (
            <>
              <section className={`${ui.cartao} ${estilos.tudoEmDia}`} aria-labelledby={idDoTudoEmDia}>
                <Simbolo />
                <h2 id={idDoTudoEmDia} className={estilos.tituloDoTudoEmDia}>Tudo revisado</h2>
                <p className={ui.mini}>{fraseDoTudoEmDia}</p>
              </section>
              {/* com PR de fora, a Fila vazia fica, com a pílula: o painel não depende só do botão flutuante */}
              {nDeFora ? elementoDaFila : null}
            </>
          ) : (
            <>
              <EmAnalise
                sessoes={sessoes ?? NENHUM}
                feeds={feeds ?? SEM_FEEDS}
                falhas={falhasSoltas}
                iniciadas={iniciadas}
                desvio={desvio}
                controle={controle}
                aoDispensarFalha={dispensarFalha}
                perfis={perfis}
              />
              {elementoDaFila}
            </>
          )}
          <PostadasHoje resolvidas={decisoes?.resolved ?? NENHUM} cliente={app.cliente} controle={controle} iniciadas={iniciadas} />
          <Ignorados ignorados={ignoradosFora} controle={controle} />
          {nDeFora ? <div className={estilosDeFora.respiro} aria-hidden="true" /> : null}
          <BotaoDeFora n={nDeFora} aoAbrir={painelDeFora.abrir} aberto={painelDeFora.aberto} />
          <PainelDeFora
            itens={deFora ?? NENHUM}
            aberto={painelDeFora.aberto}
            aoFechar={painelDeFora.fechar}
            controle={controle}
            resultado={painelAberto ? regiaoDeResultado : undefined}
          />
        </>
      ) : (
        <Esqueleto texto="Carregando o estado do motor." linhas={3} bloco />
      )}

      {painelAberto ? null : regiaoDeResultado}
    </Pagina>
  );
}
