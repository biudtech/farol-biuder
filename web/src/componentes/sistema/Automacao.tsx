'use client';

// A seção Automação: revisões ao mesmo tempo, modelo e esforço. É só o miolo: a linha que abre
// é do Sistema.tsx. Os modelos vêm do catálogo do motor (`modelos` do snapshot); os níveis de
// esforço e a faixa do paralelismo são cópia conferida por teste contra o motor
// (src/sistema/automacao.ts). O salvar manda a POST /api/settings só as chaves que a pessoa
// alterou nesta edição, e a resposta é conferida. A espera do CI antes de aprovar não está
// aqui: o revisor é autônomo e nunca espera (desenho de 17/11/2026), e a chave só muda pelo
// arquivo ou pela API.
import { useEffect, useId } from 'react';
import { ui } from '@/componentes/ui';
import type { ConfigDoSistema, Modelos } from '@/contratos/sistema';
import type { Acao } from '@/radar/acoes';
import {
  EFEITO_DO_ESFORCO, EFEITO_DO_MODELO, EFEITO_DO_PARALELO, ESFORCOS, NOME_DO_CAMPO_DE_ESFORCO, PARALELO_MAXIMO, PARALELO_MINIMO, aceitaEsforco,
  automacaoDe, conflitosDaAutomacao, corpoDaAutomacao, marcaDaAutomacao, notaDoLimiteTotal, paraleloValido, rotuloDoEsforco, rotuloDoModelo, selecaoDe,
  type Automacao as Chaves,
} from '@/sistema/automacao';
import { refazerCampos } from '@/sistema/rascunho';
import type { ControleDeAcoes } from '../radar/useAcoes';
import { PeDoFormulario, type UltimoSalvar } from './Formulario';
import { useRascunho } from './useRascunho';
import estilos from './Sistema.module.css';

export const ALVO_DA_AUTOMACAO = 'sistema:automacao';
const PARALELOS = Array.from({ length: PARALELO_MAXIMO - PARALELO_MINIMO + 1 }, (_, i) => PARALELO_MINIMO + i);
const igual = (chaves: Chaves): Chaves => chaves;
const refazer = (partida: Chaves, rascunho: Chaves, nova: Chaves) => refazerCampos(partida, rascunho, nova);

interface PropsDoEditor {
  chaves: Chaves;
  modelos: Modelos | undefined;
  limiteTotal: number | undefined;
  controle: ControleDeAcoes;
  impedimento: string | null;
  aoMudar(alterado: boolean): void;
  ultimo: UltimoSalvar | null;
}

function EditorDaAutomacao({ chaves, modelos, limiteTotal, controle, impedimento, aoMudar, ultimo }: PropsDoEditor) {
  const { valor: rascunho, partida, alterado, mudouNoMotor, conflitos, editar, descartar } = useRascunho<Chaves, Chaves>(chaves, igual, marcaDaAutomacao, refazer);
  const idDoParalelo = useId();
  const idDoModelo = useId();
  const idDoEsforco = useId();
  useEffect(() => {
    aoMudar(alterado);
    return () => aoMudar(false);
  }, [alterado, aoMudar]);

  const selecoes = modelos?.claude ?? [];
  // o que a pessoa alterou: a diferença contra o valor que ela viu ao começar a editar
  const corpo = corpoDaAutomacao(partida, rascunho);
  const acao: Acao | null = Object.keys(corpo).length ? { tipo: 'automacao', alvo: ALVO_DA_AUTOMACAO, nome: 'a automação', corpo } : null;
  const comEsforco = aceitaEsforco(selecoes, rascunho.reviewModel);
  const nota = notaDoLimiteTotal(limiteTotal);

  return (
    <>
      <div className={estilos.grade}>
        <div className={estilos.campo}>
          <label className={ui.rotulo} htmlFor={idDoParalelo}>Revisões ao mesmo tempo</label>
          <select id={idDoParalelo} className={ui.campo} value={String(rascunho.parallelReviews)} aria-describedby={`${idDoParalelo}-efeito`} onChange={(evento) => editar({ ...rascunho, parallelReviews: Number(evento.target.value) })}>
            {PARALELOS.map((n) => <option key={n} value={n}>{n}</option>)}
            {!paraleloValido(rascunho.parallelReviews) ? <option value={rascunho.parallelReviews}>{rascunho.parallelReviews} (fora da faixa que esta tela conhece)</option> : null}
          </select>
          <p id={`${idDoParalelo}-efeito`} className={ui.mini}>{EFEITO_DO_PARALELO}</p>
        </div>

        <div className={estilos.campo}>
          <label className={ui.rotulo} htmlFor={idDoModelo}>Modelo da revisão</label>
          <select id={idDoModelo} className={ui.campo} value={rascunho.reviewModel} aria-describedby={`${idDoModelo}-efeito`} onChange={(evento) => editar({ ...rascunho, reviewModel: evento.target.value })}>
            {selecoes.map((s) => <option key={s.valor} value={s.valor}>{rotuloDoModelo(selecoes, s.valor)}</option>)}
            {!selecaoDe(selecoes, rascunho.reviewModel) ? <option value={rascunho.reviewModel}>{rotuloDoModelo(selecoes, rascunho.reviewModel)}</option> : null}
          </select>
          <p id={`${idDoModelo}-efeito`} className={ui.mini}>{EFEITO_DO_MODELO}</p>
        </div>

        <div className={estilos.campo}>
          <label className={ui.rotulo} htmlFor={idDoEsforco}>{NOME_DO_CAMPO_DE_ESFORCO}</label>
          <select id={idDoEsforco} className={ui.campo} value={rascunho.reviewEffort} aria-describedby={`${idDoEsforco}-efeito`} onChange={(evento) => editar({ ...rascunho, reviewEffort: evento.target.value })}>
            <option value="">{rotuloDoEsforco('')}</option>
            {ESFORCOS.map((nivel) => <option key={nivel} value={nivel}>{rotuloDoEsforco(nivel)}</option>)}
            {rascunho.reviewEffort !== '' && !(ESFORCOS as readonly string[]).includes(rascunho.reviewEffort) ? <option value={rascunho.reviewEffort}>{rotuloDoEsforco(rascunho.reviewEffort)}</option> : null}
          </select>
          <p id={`${idDoEsforco}-efeito`} className={ui.mini}>{EFEITO_DO_ESFORCO}</p>
        </div>
      </div>
      {nota ? <p className={ui.mini}>{nota}</p> : null}
      {!selecoes.length ? <p className={ui.nota}>Atenção: o motor não mandou o catálogo de modelos, então não há outra opção para escolher aqui.</p> : null}
      {!comEsforco ? <p className={ui.nota}>Aviso: com o modelo escolhido o motor não usa este valor: a seleção escolhe o effort sozinha. O valor fica gravado e volta a valer com outro modelo.</p> : null}

      <PeDoFormulario
        oQue="a automação"
        alterado={alterado}
        alteracoes={Object.keys(corpo).length}
        mudouNoMotor={mudouNoMotor}
        conflitos={conflitosDaAutomacao(conflitos, chaves, rascunho)}
        aoDescartar={descartar}
        impedimento={impedimento}
        erro={null}
        acao={acao}
        controle={controle}
        ultimo={ultimo}
        nota="O salvar manda só as chaves que você alterou nesta seção: política e perfis não vão junto, e o que outra pessoa mudou nas outras chaves não é desfeito. Vale para as próximas sessões do motor."
      />
    </>
  );
}

interface Props {
  config: ConfigDoSistema | undefined;
  modelos: Modelos | undefined;
  controle: ControleDeAcoes;
  impedimento: string | null;
  aoMudar(alterado: boolean): void;
  ultimo: UltimoSalvar | null;
}

export function Automacao({ config, modelos, controle, impedimento, aoMudar, ultimo }: Props) {
  const chaves = automacaoDe(config);
  if (!chaves) {
    return <p className={ui.nota}>Atenção: o motor não mandou as chaves de automação a esta tela (revisões ao mesmo tempo, modelo e esforço). Sem o valor de agora não há de onde editar.</p>;
  }
  return <EditorDaAutomacao chaves={chaves} modelos={modelos} limiteTotal={config?.globalParallelReviews} controle={controle} impedimento={impedimento} aoMudar={aoMudar} ultimo={ultimo} />;
}
