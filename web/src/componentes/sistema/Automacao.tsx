'use client';

// A seção Automação: CI antes de aprovar, revisões ao mesmo tempo, modelo e esforço. Os
// modelos vêm do catálogo do motor (`modelos` do snapshot); os níveis de esforço e a faixa do
// paralelismo são cópia conferida por teste contra o motor (src/sistema/automacao.ts). O
// salvar manda a POST /api/settings só as chaves que a pessoa alterou nesta edição, e a
// resposta é conferida.
import { useEffect, useId } from 'react';
import type { ConfigDoSistema, Modelos } from '@/contratos/sistema';
import type { Acao } from '@/radar/acoes';
import {
  EFEITO_DO_ESFORCO, EFEITO_DO_MODELO, EFEITO_DO_PARALELO, ESFORCOS, NOME_DO_CAMPO_DE_ESFORCO, PARALELO_MAXIMO, PARALELO_MINIMO, aceitaEsforco, ampliacoesDaAutomacao,
  automacaoDe, conflitosDaAutomacao, corpoDaAutomacao, efeitoDoCi, marcaDaAutomacao, notaDoLimiteTotal, paraleloValido, rotuloDoEsforco, rotuloDoModelo, selecaoDe,
  type Automacao as Chaves,
} from '@/sistema/automacao';
import { refazerCampos } from '@/sistema/rascunho';
import type { ControleDeAcoes } from '../radar/useAcoes';
import comuns from '../radar/Radar.module.css';
import { PeDoFormulario } from './Formulario';
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
}

function EditorDaAutomacao({ chaves, modelos, limiteTotal, controle, impedimento, aoMudar }: PropsDoEditor) {
  const { valor: rascunho, partida, alterado, mudouNoMotor, conflitos, editar, descartar } = useRascunho<Chaves, Chaves>(chaves, igual, marcaDaAutomacao, refazer);
  const idDoCi = useId();
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
  const acao: Acao | null = Object.keys(corpo).length
    ? { tipo: 'automacao', alvo: ALVO_DA_AUTOMACAO, nome: 'a automação', corpo, ampliacoes: ampliacoesDaAutomacao(chaves, corpo) }
    : null;
  const comEsforco = aceitaEsforco(selecoes, rascunho.reviewModel);
  const nota = notaDoLimiteTotal(limiteTotal);

  return (
    <>
      <div className={estilos.opcao}>
        <input id={idDoCi} type="checkbox" checked={rascunho.aguardarCiParaAprovar} aria-describedby={`${idDoCi}-efeito`} onChange={(evento) => editar({ ...rascunho, aguardarCiParaAprovar: evento.target.checked })} />
        <div>
          <label htmlFor={idDoCi}>CI obrigatório antes de aprovar</label>
          <p id={`${idDoCi}-efeito`} className={comuns.meta}>{efeitoDoCi(rascunho.aguardarCiParaAprovar)}</p>
        </div>
      </div>

      <div className={estilos.campo}>
        <label className={comuns.rotulo} htmlFor={idDoParalelo}>Revisões ao mesmo tempo</label>
        <select id={idDoParalelo} className={comuns.entrada} value={String(rascunho.parallelReviews)} aria-describedby={`${idDoParalelo}-efeito`} onChange={(evento) => editar({ ...rascunho, parallelReviews: Number(evento.target.value) })}>
          {PARALELOS.map((n) => <option key={n} value={n}>{n}</option>)}
          {!paraleloValido(rascunho.parallelReviews) ? <option value={rascunho.parallelReviews}>{rascunho.parallelReviews} (fora da faixa que esta tela conhece)</option> : null}
        </select>
        <p id={`${idDoParalelo}-efeito`} className={comuns.meta}>{EFEITO_DO_PARALELO}</p>
        {nota ? <p className={comuns.meta}>{nota}</p> : null}
      </div>

      <div className={estilos.campo}>
        <label className={comuns.rotulo} htmlFor={idDoModelo}>Modelo da revisão</label>
        <select id={idDoModelo} className={comuns.entrada} value={rascunho.reviewModel} aria-describedby={`${idDoModelo}-efeito`} onChange={(evento) => editar({ ...rascunho, reviewModel: evento.target.value })}>
          {selecoes.map((s) => <option key={s.valor} value={s.valor}>{rotuloDoModelo(selecoes, s.valor)}</option>)}
          {!selecaoDe(selecoes, rascunho.reviewModel) ? <option value={rascunho.reviewModel}>{rotuloDoModelo(selecoes, rascunho.reviewModel)}</option> : null}
        </select>
        <p id={`${idDoModelo}-efeito`} className={comuns.meta}>{EFEITO_DO_MODELO}</p>
        {!selecoes.length ? <p className={`${comuns.nota} ${comuns.bloqueio}`}>Atenção: o motor não mandou o catálogo de modelos, então não há outra opção para escolher aqui.</p> : null}
      </div>

      <div className={estilos.campo}>
        <label className={comuns.rotulo} htmlFor={idDoEsforco}>{NOME_DO_CAMPO_DE_ESFORCO}</label>
        <select id={idDoEsforco} className={comuns.entrada} value={rascunho.reviewEffort} aria-describedby={`${idDoEsforco}-efeito`} onChange={(evento) => editar({ ...rascunho, reviewEffort: evento.target.value })}>
          <option value="">{rotuloDoEsforco('')}</option>
          {ESFORCOS.map((nivel) => <option key={nivel} value={nivel}>{rotuloDoEsforco(nivel)}</option>)}
          {rascunho.reviewEffort !== '' && !(ESFORCOS as readonly string[]).includes(rascunho.reviewEffort) ? <option value={rascunho.reviewEffort}>{rotuloDoEsforco(rascunho.reviewEffort)}</option> : null}
        </select>
        <p id={`${idDoEsforco}-efeito`} className={comuns.meta}>{EFEITO_DO_ESFORCO}</p>
        {!comEsforco ? <p className={comuns.nota}>Aviso: com o modelo escolhido o motor não usa este valor: a seleção escolhe o effort sozinha. O valor fica gravado e volta a valer com outro modelo.</p> : null}
      </div>

      <PeDoFormulario
        oQue="a automação"
        alterado={alterado}
        mudouNoMotor={mudouNoMotor}
        conflitos={conflitosDaAutomacao(conflitos, chaves, rascunho)}
        aoDescartar={descartar}
        impedimento={impedimento}
        erro={null}
        acao={acao}
        controle={controle}
        nota="O salvar manda só as chaves que você alterou nesta seção: política e perfis não vão junto, e o que outra pessoa mudou nas outras chaves não é desfeito. Vale para as próximas sessões e decisões do motor."
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
}

export function Automacao({ config, modelos, controle, impedimento, aoMudar }: Props) {
  const idDoTitulo = useId();
  const chaves = automacaoDe(config);
  return (
    <section id="automacao" className={estilos.secao} aria-labelledby={idDoTitulo}>
      <h2 id={idDoTitulo} className={estilos.tituloDaSecao}>Automação</h2>
      {chaves ? (
        <EditorDaAutomacao chaves={chaves} modelos={modelos} limiteTotal={config?.globalParallelReviews} controle={controle} impedimento={impedimento} aoMudar={aoMudar} />
      ) : (
        <p className={`${comuns.nota} ${comuns.bloqueio}`}>
          Atenção: o motor não mandou as chaves de automação a esta tela (CI antes de aprovar, revisões ao mesmo tempo, modelo e esforço). Sem o valor de agora não há de onde editar.
        </p>
      )}
    </section>
  );
}
