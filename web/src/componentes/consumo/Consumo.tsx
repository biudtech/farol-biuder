'use client';

// A tela Consumo: o estado do teto e as sessões recentes vêm da chave `usage` do snapshot; o
// período (somas, gasto por dia, quebras e diário) vem de GET /api/usage, onde quem soma,
// filtra e pagina é o motor. A tela fatia e formata: não soma itens, não tem preço por modelo
// e não decide pausa. A consulta mora no endereço da página.
//
// O relatório não se refaz a cada evento do fluxo: quando o snapshot passa a contar sessão que
// o relatório não viu, aparece um aviso com o botão Atualizar, e a pessoa decide quando.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { App } from '@/estado/app';
import { app as appDoNavegador, useApp } from '@/estado/instancia';
import {
  CONSULTA_VAZIA, ehRecusaDeCampo, marcaDoConsumo, mensagemDaFalha, temPeriodo, textoDoDiarioVazio, textoDoResultado, textoDoVazio, type Consulta,
} from '@/consumo/consulta';
import { RegiaoDeResultado } from '../radar/RegiaoDeResultado';
import comuns from '../radar/Radar.module.css';
import { Diario } from './Diario';
import { Filtros } from './Filtros';
import { GraficoPorDia } from './GraficoPorDia';
import { PorModelo, PorTipo } from './Quebras';
import { ResumoDoPeriodo } from './ResumoDoPeriodo';
import { ResumoDoTeto } from './ResumoDoTeto';
import { SessoesRecentes } from './SessoesRecentes';
import { useEnderecoDoConsumo, useRelatorio } from './useConsumo';
import estilos from './Consumo.module.css';

interface Props {
  // existe para o teste trocar a instância
  app?: App;
}

export function Consumo({ app = appDoNavegador }: Props) {
  const { consulta, ir } = useEnderecoDoConsumo();
  const tetos = useApp((e) => e.snapshot?.usage?.budgets, app);
  const tetosDescartados = useApp((e) => e.snapshot?.usage?.budgetsDescartados, app);
  const auditoria = useApp((e) => e.snapshot?.usage?.auditoria, app);
  const sessoes = useApp((e) => e.snapshot?.usage?.recentSessions, app);
  const sessoesDescartadas = useApp((e) => e.snapshot?.usage?.sessoesDescartadas, app);
  const desde = useApp((e) => e.snapshot?.usage?.sessionsSince, app);
  const sessoesContadas = useApp((e) => e.snapshot?.usage?.sessoesContadas, app);
  const recados = useApp((e) => e.recados, app);

  const [recarga, setRecarga] = useState(0);
  const { carregando, relatorio, motivo, falha, opcoes, fim, haNovo } = useRelatorio(app.cliente, consulta, recarga, marcaDoConsumo(sessoesContadas));

  const tituloDoDiario = useRef<HTMLHeadingElement>(null);
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
  const aoIrParaPagina = useCallback((para: number) => {
    ir({ ...consulta, pagina: para }, 'empilhar');
    // o foco vai ao título do diário: quem estava no pé da tabela volta ao começo dela
    tituloDoDiario.current?.focus();
  }, [consulta, ir]);
  const aoAtualizar = useCallback(() => setRecarga((n) => n + 1), []);

  const esperando = carregando || foraDoFim;
  // só o zero que o motor mandou é "sem execução"
  const semExecucao = relatorio?.totals.attempts === 0;
  let anuncio = '';
  if (relatorio && !esperando) anuncio = textoDoResultado(relatorio);
  else if (esperando && !relatorio) anuncio = 'Carregando o consumo.';

  return (
    <div className={estilos.consumo}>
      <h1 className={comuns.titulo}>Consumo</h1>

      <ResumoDoTeto tetos={tetos} descartados={tetosDescartados ?? 0} auditoria={auditoria} />

      <Filtros consulta={consulta} opcoes={opcoes} periodo={relatorio?.range ?? null} fim={fim} aoBuscar={aoBuscar} aoMudar={aoMudar} aoLimpar={aoLimpar} />

      {haNovo ? (
        <p className={estilos.novas} role="status">
          O motor registrou sessão nova desde a última carga deste relatório. Ela pode não entrar neste recorte: o aviso não olha o período nem os filtros.{' '}
          <button type="button" className={comuns.botao} onClick={aoAtualizar}>Atualizar</button>
        </p>
      ) : null}

      <p className={comuns.meta} role="status" aria-live="polite" aria-label="Resultado da consulta">{anuncio}</p>

      {falha ? (
        <div className={estilos.erro} role="alert">
          <p><strong>Erro:</strong> {mensagemDaFalha(falha) || 'A carga do consumo foi interrompida.'}</p>
          {ehRecusaDeCampo(falha) ? (
            <button type="button" className={comuns.botao} onClick={aoLimpar}>Limpar período e filtros</button>
          ) : (
            <button type="button" className={comuns.botao} onClick={aoAtualizar}>Tentar de novo</button>
          )}
        </div>
      ) : null}

      {motivo ? (
        <div className={estilos.erro} role="alert">
          <p><strong>Sem relatório:</strong> o motor respondeu que não entrega o consumo deste pedido. O que ele disse: {motivo}</p>
          <div className={comuns.botoes}>
            {temPeriodo(consulta) ? (
              <button type="button" className={comuns.botao} onClick={() => ir({ ...consulta, inicio: '', fim: '', pagina: 1 }, 'empilhar')}>Voltar ao período padrão</button>
            ) : null}
            <button type="button" className={comuns.botao} onClick={aoAtualizar}>Tentar de novo</button>
          </div>
        </div>
      ) : null}

      {relatorio ? (
        <div className={estilos.relatorio} aria-busy={esperando} data-esmaecida={esperando ? '' : undefined}>
          {relatorio.descartados ? (
            <p className={`${comuns.nota} ${comuns.bloqueio}`}>
              Atenção: {relatorio.descartados} linha(s) deste relatório chegaram em formato que esta tela não lê e ficaram de fora das tabelas.
            </p>
          ) : null}
          <ResumoDoPeriodo relatorio={relatorio} vazio={textoDoVazio(consulta)} />
          {semExecucao ? null : <GraficoPorDia relatorio={relatorio} />}
          {semExecucao ? null : <PorTipo relatorio={relatorio} />}
          {semExecucao ? null : <PorModelo relatorio={relatorio} />}
          <Diario diario={relatorio.history} periodo={relatorio.range} vazio={textoDoDiarioVazio(consulta)} ocupado={esperando} titulo={tituloDoDiario} aoIr={aoIrParaPagina} />
        </div>
      ) : null}

      <SessoesRecentes sessoes={sessoes} descartadas={sessoesDescartadas ?? 0} desde={desde} />

      <RegiaoDeResultado regiao={regiao} resultado={null} recados={recados} aoDispensar={() => app.dispensarRecados()} />
    </div>
  );
}
