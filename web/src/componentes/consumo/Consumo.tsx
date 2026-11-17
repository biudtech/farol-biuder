'use client';

// A tela Consumo, no desenho enxuto: no topo o período e o botão Filtrar; um número grande (o
// custo estimado do período) com o gráfico por dia; e, fechados numa linha cada, os detalhes
// do período, as quebras, as execuções, as sessões recentes e a auditoria do registro.
//
// A auditoria do registro e as sessões recentes vêm da chave `usage` do snapshot; o período
// (somas, gasto por dia, quebras e diário) vem de GET /api/usage, onde quem soma, filtra e
// pagina é o motor. A tela fatia e formata: não soma itens e não tem preço por modelo. Ela só
// mede: o motor não tem teto de gasto, e nada aqui pausa revisão. A consulta mora no endereço
// da página.
//
// O relatório não se refaz a cada evento do fluxo: quando o snapshot passa a contar sessão que
// o relatório não viu, aparece um aviso com o botão Atualizar, e a pessoa decide quando.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { App } from '@/estado/app';
import { app as appDoNavegador, useApp } from '@/estado/instancia';
import {
  CONSULTA_VAZIA, ehRecusaDeCampo, marcaDoConsumo, mensagemDaFalha, temPeriodo, textoDoDiarioVazio, textoDoPeriodo, textoDoResultado, textoDoVazio, type Consulta,
} from '@/consumo/consulta';
import { RegiaoDeResultado } from '../radar/RegiaoDeResultado';
import { BarraDeCarga, Botao, Esqueleto, Pagina, ui } from '../ui';
import { AuditoriaDoRegistro } from './AuditoriaDoRegistro';
import { Diario } from './Diario';
import { Filtrar, FiltrosAtivos, SeletorDePeriodo } from './Filtros';
import { TabelaPorDia } from './GraficoPorDia';
import { PorModelo, PorTipo } from './Quebras';
import { CustoDoPeriodo, DetalhesDoPeriodo } from './ResumoDoPeriodo';
import { SessoesRecentes } from './SessoesRecentes';
import { useEnderecoDoConsumo, useRelatorio } from './useConsumo';
import estilos from './Consumo.module.css';

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
  const recados = useApp((e) => e.recados, app);

  const [recarga, setRecarga] = useState(0);
  const { carregando, relatorio, motivo, falha, opcoes, fim, haNovo } = useRelatorio(app.cliente, consulta, recarga, marcaDoConsumo(sessoesContadas));

  const regiao = useRef<HTMLDivElement>(null);

  // Página do diário além do fim: o motor devolve a última. O endereço passa a dizer a página
  // que está na tela, trocando a entrada em vez de empilhar outra.
  const paginaDoMotor = !carregando && relatorio ? relatorio.history.page + 1 : null;
  const foraDoFim = paginaDoMotor !== null && paginaDoMotor !== consulta.pagina;
  useEffect(() => {
    if (foraDoFim && paginaDoMotor !== null) ir({ ...consulta, pagina: paginaDoMotor }, 'trocar');
  }, [foraDoFim, paginaDoMotor, consulta, ir]);

  const aoBuscar = useCallback((q: string) => ir({ ...consulta, q, pagina: 1 }, 'trocar'), [consulta, ir]);
  const aoMudar = useCallback((para: Consulta, modo: 'empilhar' | 'trocar') => ir(para, modo), [ir]);
  const aoLimpar = useCallback(() => ir(CONSULTA_VAZIA, 'empilhar'), [ir]);
  const aoIrParaPagina = useCallback((para: number) => ir({ ...consulta, pagina: para }, 'empilhar'), [consulta, ir]);
  const aoAtualizar = useCallback(() => setRecarga((n) => n + 1), []);

  const esperando = carregando || foraDoFim;
  // só o zero que o motor mandou é "sem execução"
  const semExecucao = relatorio?.totals.attempts === 0;
  // a página sem nada ainda: o esqueleto fala por ela, e a região viva espera o resultado
  const primeiraCarga = esperando && !relatorio && !falha && !motivo;
  const anuncio = relatorio && !esperando ? textoDoResultado(relatorio) : '';
  const periodo = relatorio?.range ?? null;
  const sub = periodo ? `${textoDoPeriodo(periodo)}, em dias de Brasília` : 'Quanto as sessões de IA do motor consumiram.';

  const acoes = (
    <>
      <SeletorDePeriodo consulta={consulta} periodo={periodo} fim={fim} aoMudar={aoMudar} />
      <Filtrar consulta={consulta} opcoes={opcoes} periodo={periodo} aoMudar={aoMudar} />
    </>
  );

  return (
    <Pagina titulo="Consumo" sub={sub} acoes={acoes}>
      <FiltrosAtivos consulta={consulta} periodo={periodo} aoMudar={aoMudar} aoLimpar={aoLimpar} />

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
          {ehRecusaDeCampo(falha) ? (
            <Botao onClick={aoLimpar}>Limpar período e filtros</Botao>
          ) : (
            <Botao onClick={aoAtualizar}>Tentar de novo</Botao>
          )}
        </div>
      ) : null}

      {motivo ? (
        <div className={ui.erro} role="alert">
          <span><strong>Sem relatório:</strong> o motor respondeu que não entrega o consumo deste pedido. O que ele disse: {motivo}</span>
          <span className={ui.fila}>
            {temPeriodo(consulta) ? (
              <Botao onClick={() => ir({ ...consulta, inicio: '', fim: '', pagina: 1 }, 'empilhar')}>Voltar ao período padrão</Botao>
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
              <p className={ui.nota}>
                Atenção: {relatorio.descartados} linha(s) deste relatório chegaram em formato que esta tela não lê e ficaram de fora das tabelas.
              </p>
            ) : null}
            <CustoDoPeriodo relatorio={relatorio} vazio={textoDoVazio(consulta)} />
            {semExecucao ? null : <DetalhesDoPeriodo relatorio={relatorio} />}
            {semExecucao ? null : <TabelaPorDia relatorio={relatorio} />}
            {semExecucao ? null : <PorTipo relatorio={relatorio} />}
            {semExecucao ? null : <PorModelo relatorio={relatorio} />}
            <Diario
              diario={relatorio.history}
              periodo={relatorio.range}
              q={consulta.q}
              vazio={textoDoDiarioVazio(consulta)}
              ocupado={esperando}
              abertaDeInicio={consulta.q !== '' || consulta.pagina > 1}
              aoBuscar={aoBuscar}
              aoIr={aoIrParaPagina}
            />
          </div>
        </>
      ) : null}

      <div className={ui.lista}>
        <SessoesRecentes sessoes={sessoes} descartadas={sessoesDescartadas ?? 0} desde={desde} />
        <AuditoriaDoRegistro auditoria={auditoria} />
      </div>

      <RegiaoDeResultado regiao={regiao} resultado={null} recados={recados} aoDispensar={() => app.dispensarRecados()} />
    </Pagina>
  );
}
