'use client';

// A tela Consumo (redesenho, lote 5): no topo os períodos prontos; a barra de filtros (busca,
// repositório, autor, modelo e perfil) e as pílulas do que está escolhido; os números do período;
// o plano de cada perfil do Claude; o custo por dia e por repositório (clicáveis: o clique vira
// filtro); por modelo e por gatilho; e cada sessão, paginada, com a linha que abre e Baixar CSV.
//
// O período vem de GET /api/usage, onde quem soma, filtra e pagina é o motor. Com um dia clicado
// vão dois pedidos: o do dia (tudo na tela) e o do período inteiro, só para o gráfico por dia e os
// períodos prontos. O plano, as sessões recentes e a auditoria vêm do snapshot. A tela fatia e
// formata: não soma itens e não tem preço por modelo. Ela só mede: o motor não tem teto de
// gasto, e nada aqui pausa revisão. A consulta mora no endereço da página.
//
// O relatório não se refaz a cada evento do fluxo: quando o snapshot passa a contar sessão que
// o relatório não viu, aparece um aviso com o botão Atualizar, e a pessoa decide quando.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { App } from '@/estado/app';
import { app as appDoNavegador, useApp } from '@/estado/instancia';
import {
  CONSULTA_VAZIA, caminhoDoPeriodo, caminhoDoRelatorio, comDia, ehRecusaDeCampo, marcaDoConsumo, mensagemDaFalha, temPeriodo, textoDoDiarioVazio, textoDoPeriodo, textoDoResultado, textoDoVazio, type Consulta,
} from '@/consumo/consulta';
import { perfisDoPlano } from '@/consumo/plano';
import type { Relatorio } from '@/contratos/consumo';
import { AnuncioDaTela } from '../radar/AnuncioDaTela';
import { BarraDeCarga, Botao, Esqueleto, Pagina, ui } from '../ui';
import { AuditoriaDoRegistro } from './AuditoriaDoRegistro';
import { CustoPorDia } from './CustoPorDia';
import { BarraDeFiltros, Periodos, Pilulas } from './Filtros';
import { Numeros, PlanoDosPerfis } from './Numeros';
import { PorGatilho, PorModelo, PorRepositorio } from './Quebras';
import { DetalhesDoPeriodo, notasDoPeriodo } from './ResumoDoPeriodo';
import { BaixarCsv, Sessoes } from './Sessoes';
import { SessoesRecentes } from './SessoesRecentes';
import { useEnderecoDoConsumo, useRelatorio } from './useConsumo';
import estilos from './Consumo.module.css';

const ID_DO_TITULO = 'consumo-titulo';
const SEM_SESSOES: readonly string[] = Object.freeze([]);

interface Props {
  // existe para o teste trocar a instância
  app?: App;
}

export function Consumo({ app = appDoNavegador }: Props) {
  const { consulta, ir } = useEnderecoDoConsumo();
  const auditoria = useApp((e) => e.snapshot?.usage?.auditoria, app);
  const sessoes = useApp((e) => e.snapshot?.usage?.recentSessions, app);
  const sessoesDescartadas = useApp((e) => e.snapshot?.usage?.sessoesDescartadas, app);
  const desde = useApp((e) => e.snapshot?.usage?.sessionsSince, app);
  const sessoesContadas = useApp((e) => e.snapshot?.usage?.sessoesContadas, app);
  const config = useApp((e) => e.snapshot?.config, app);
  const claudePerfis = useApp((e) => e.snapshot?.claudePerfis, app);
  const ativas = useApp((e) => e.snapshot?.activeSessions, app);
  const temSnapshot = useApp((e) => e.snapshot !== null, app);
  const recados = useApp((e) => e.recados, app);

  const [recarga, setRecarga] = useState(0);
  const marca = marcaDoConsumo(sessoesContadas);
  const { carregando, relatorio, motivo, falha, opcoes, fim, haNovo } = useRelatorio(app.cliente, caminhoDoRelatorio(consulta), recarga, marca);
  // com um dia clicado, o período inteiro para o gráfico e os períodos prontos
  const doPeriodo = useRelatorio(app.cliente, caminhoDoPeriodo(consulta), recarga, marca);

  // O último relatório do período inteiro que a tela teve sem dia clicado, com a chave dele (o
  // pedido do período sem dia, busca e página, que não mudam a série). No primeiro clique num dia
  // o pedido do período ainda não voltou: o gráfico segue com este, em vez de desmontar e levar
  // junto o foco do botão clicado, e os períodos prontos seguem valendo.
  const chaveDoPeriodo = caminhoDoRelatorio({ ...consulta, dia: '', q: '', pagina: 1 });
  const [anterior, setAnterior] = useState<{ chave: string; relatorio: Relatorio } | null>(null);
  if (!consulta.dia && !carregando && relatorio && (anterior?.relatorio !== relatorio || anterior.chave !== chaveDoPeriodo)) {
    setAnterior({ chave: chaveDoPeriodo, relatorio });
  }
  const reserva = anterior?.chave === chaveDoPeriodo ? anterior.relatorio : null;
  const relatorioDoPeriodo = consulta.dia
    ? (doPeriodo.carregando ? reserva ?? doPeriodo.relatorio : doPeriodo.relatorio)
    : relatorio;
  const fimDoPeriodo = consulta.dia ? doPeriodo.fim ?? reserva?.range.end ?? null : fim;

  const emUso = useMemo(() => (ativas ?? []).map((s) => s.perfilId).filter((id): id is string => Boolean(id)), [ativas]);
  const perfis = useMemo(() => perfisDoPlano(config, claudePerfis, emUso.length ? emUso : SEM_SESSOES), [config, claudePerfis, emUso]);
  const nomes = useMemo(() => new Map((config?.claudeProfiles ?? []).map((p) => [p.id, p.label || p.id])), [config]);
  const rotuloDoPerfil = useCallback((id: string) => nomes.get(id) ?? id, [nomes]);

  const regiao = useRef<HTMLDivElement>(null);
  const tituloDasSessoes = useRef<HTMLHeadingElement>(null);
  // A pílula e o Limpar filtros somem com o clique: o foco vai ao título, que fica.
  const focarTitulo = useCallback(() => { document.getElementById(ID_DO_TITULO)?.focus(); }, []);

  // Página além do fim: o motor devolve a última. O endereço passa a dizer a página que está na
  // tela, trocando a entrada em vez de empilhar outra.
  const paginaDoMotor = !carregando && relatorio ? relatorio.history.page + 1 : null;
  const foraDoFim = paginaDoMotor !== null && paginaDoMotor !== consulta.pagina;
  useEffect(() => {
    if (foraDoFim && paginaDoMotor !== null) ir({ ...consulta, pagina: paginaDoMotor }, 'trocar');
  }, [foraDoFim, paginaDoMotor, consulta, ir]);

  const aoBuscar = useCallback((q: string) => ir({ ...consulta, q, pagina: 1 }, 'trocar'), [consulta, ir]);
  const aoMudar = useCallback((para: Consulta, modo: 'empilhar' | 'trocar') => ir(para, modo), [ir]);
  const aoLimpar = useCallback(() => ir(CONSULTA_VAZIA, 'empilhar'), [ir]);
  const aoIrParaPagina = useCallback((para: number) => ir({ ...consulta, pagina: para }, 'empilhar'), [consulta, ir]);
  const aoEscolherDia = useCallback((dia: string) => ir(comDia(consulta, dia), 'empilhar'), [consulta, ir]);
  const aoEscolherRepo = useCallback((repo: string) => ir({ ...consulta, repo, pagina: 1 }, 'empilhar'), [consulta, ir]);
  const aoAtualizar = useCallback(() => setRecarga((n) => n + 1), []);

  // com um dia clicado, a tela espera também o pedido do período
  const esperando = carregando || foraDoFim || (consulta.dia !== '' && doPeriodo.carregando);
  // só o zero que o motor mandou é "sem execução"
  const semExecucao = relatorio?.totals.attempts === 0;
  // a página sem nada ainda: o esqueleto fala por ela, e a região viva espera o resultado
  const primeiraCarga = esperando && !relatorio && !falha && !motivo;
  const anuncio = relatorio && !esperando ? textoDoResultado(relatorio) : '';
  const periodo = relatorioDoPeriodo?.range ?? null;
  const notas = relatorio && !semExecucao ? notasDoPeriodo(relatorio) : [];

  return (
    <Pagina
      titulo="Consumo"
      idDoTitulo={ID_DO_TITULO}
      sub={periodo ? `Quanto o Farol gastou para revisar, de ${textoDoPeriodo(periodo)} em dias de Brasília, e quanto ainda há de plano em cada perfil do Claude. Só mede: nada aqui segura revisão.` : 'Quanto o Farol gastou para revisar e quanto ainda há de plano em cada perfil do Claude. Só mede: nada aqui segura revisão.'}
      acoes={<Periodos consulta={consulta} periodo={periodo} fim={fimDoPeriodo} aoMudar={aoMudar} />}
    >
      <BarraDeFiltros consulta={consulta} opcoes={opcoes} periodo={periodo} rotuloDoPerfil={rotuloDoPerfil} aoMudar={aoMudar} aoBuscar={aoBuscar} />
      <Pilulas consulta={consulta} periodo={periodo} rotuloDoPerfil={rotuloDoPerfil} aoMudar={aoMudar} aoLimpar={aoLimpar} aoSair={focarTitulo} />

      {haNovo ? (
        <p className={`${ui.nota} ${estilos.novas}`} role="status">
          O motor registrou sessão nova desde a última carga deste relatório. Ela pode não entrar neste recorte: o aviso não olha o período nem os filtros.{' '}
          <Botao pequeno onClick={aoAtualizar}>Atualizar</Botao>
        </p>
      ) : null}

      <p className={ui.soLeitor} role="status" aria-live="polite" aria-label="Resultado da consulta">{anuncio}</p>

      {falha ? (
        <div className={ui.erro} role="alert">
          <span><strong>Erro:</strong> {mensagemDaFalha(falha) || 'A carga do consumo foi interrompida.'}</span>
          {ehRecusaDeCampo(falha) ? <Botao onClick={aoLimpar}>Limpar período e filtros</Botao> : <Botao onClick={aoAtualizar}>Tentar de novo</Botao>}
        </div>
      ) : null}

      {consulta.dia && doPeriodo.falha ? (
        <div className={ui.erro} role="alert">
          <span><strong>Gráfico do período:</strong> {mensagemDaFalha(doPeriodo.falha) || 'A carga do período foi interrompida.'}</span>
          <Botao onClick={aoAtualizar}>Tentar de novo</Botao>
        </div>
      ) : null}

      {consulta.dia && doPeriodo.motivo ? (
        <div className={ui.erro} role="alert">
          <span><strong>Gráfico do período:</strong> o motor não entrega o período inteiro. O que ele disse: {doPeriodo.motivo}</span>
          <Botao onClick={aoAtualizar}>Tentar de novo</Botao>
        </div>
      ) : null}

      {motivo ? (
        <div className={ui.erro} role="alert">
          <span><strong>Sem relatório:</strong> o motor respondeu que não entrega o consumo deste pedido. O que ele disse: {motivo}</span>
          <span className={ui.fila}>
            {temPeriodo(consulta) || consulta.dia ? (
              <Botao onClick={() => ir({ ...consulta, inicio: '', fim: '', dia: '', pagina: 1 }, 'empilhar')}>Voltar ao período padrão</Botao>
            ) : null}
            <Botao onClick={aoAtualizar}>Tentar de novo</Botao>
          </span>
        </div>
      ) : null}

      {primeiraCarga ? <Esqueleto texto="Carregando o consumo." bloco linhas={3} /> : null}

      {relatorio ? (
        <>
          {esperando ? <BarraDeCarga rotulo="Carregando o consumo do novo pedido" /> : null}
          <div className={`${ui.lista} ${esperando ? ui.apagada : ''}`} aria-busy={esperando}>
            {relatorio.descartados ? (
              <p className={ui.nota}>Atenção: {relatorio.descartados} linha(s) deste relatório chegaram em formato que esta tela não lê e ficaram de fora.</p>
            ) : null}
            {semExecucao ? <p className={ui.vazio}>{textoDoVazio(consulta)}</p> : null}
            {notas.map((nota) => <p key={nota} className={ui.nota}>{nota}</p>)}
            <Numeros relatorio={relatorio} />
          </div>
        </>
      ) : null}

      <PlanoDosPerfis perfis={perfis} semSnapshot={!temSnapshot} />

      {relatorio ? (
        <div className={`${ui.lista} ${esperando ? ui.apagada : ''}`} aria-busy={esperando}>
          <div className={estilos.grade2}>
            {relatorioDoPeriodo ? <CustoPorDia relatorio={relatorioDoPeriodo} dia={consulta.dia} aoEscolher={aoEscolherDia} /> : null}
            <PorRepositorio relatorio={relatorio} escolhido={consulta.repo} aoEscolher={aoEscolherRepo} />
          </div>
          <div className={estilos.grade2}>
            <PorModelo relatorio={relatorio} />
            <PorGatilho relatorio={relatorio} />
          </div>
          <Sessoes
            diario={relatorio.history}
            vazio={textoDoDiarioVazio(consulta)}
            ocupado={esperando}
            aoIr={aoIrParaPagina}
            refDoTitulo={tituloDasSessoes}
            rotuloDoPerfil={rotuloDoPerfil}
            baixar={<BaixarCsv cliente={app.cliente} consulta={consulta} esperando={esperando} />}
          />
          {semExecucao ? null : <DetalhesDoPeriodo relatorio={relatorio} />}
        </div>
      ) : null}

      <div className={ui.lista}>
        <SessoesRecentes sessoes={sessoes} descartadas={sessoesDescartadas ?? 0} desde={desde} />
        <AuditoriaDoRegistro auditoria={auditoria} />
      </div>

      <AnuncioDaTela regiao={regiao} resultado={null} recados={recados} />
    </Pagina>
  );
}
