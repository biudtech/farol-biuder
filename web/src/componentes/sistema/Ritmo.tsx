'use client';

// O assunto Ritmo da revisão: de quanto em quanto tempo o motor olha o GitHub, se a rodada nova
// continua a conversa da anterior, e se a contestação do autor é analisada sozinha
// (src/sistema/ritmo.ts). O salvar manda a POST /api/settings só as chaves que a pessoa alterou
// nesta edição, e a resposta é conferida. Nenhuma das três muda o que o motor publica.
import { useEffect, useId } from 'react';
import { ui } from '@/componentes/ui';
import type { ConfigDoSistema } from '@/contratos/sistema';
import type { Acao } from '@/radar/acoes';
import { refazerCampos } from '@/sistema/rascunho';
import {
  EFEITO_DA_CONTESTACAO, EFEITO_DA_RETOMADA, EFEITO_DO_INTERVALO, INTERVALOS, conflitosDoRitmo, corpoDoRitmo, intervaloValido, marcaDoRitmo, ritmoDe, textoDoIntervalo,
  type Ritmo as Chaves,
} from '@/sistema/ritmo';
import type { ControleDeAcoes } from '../radar/useAcoes';
import { PeDoFormulario, type UltimoSalvar } from './Formulario';
import { useRascunho } from './useRascunho';
import estilos from './Sistema.module.css';

export const ALVO_DO_RITMO = 'sistema:ritmo';
const igual = (chaves: Chaves): Chaves => chaves;
const refazer = (partida: Chaves, rascunho: Chaves, nova: Chaves) => refazerCampos(partida, rascunho, nova);

interface PropsDoEditor {
  chaves: Chaves;
  controle: ControleDeAcoes;
  impedimento: string | null;
  aoMudar(alterado: boolean): void;
  ultimo: UltimoSalvar | null;
}

function Opcao({ id, rotulo, efeito, marcado, aoMudar }: { id: string; rotulo: string; efeito: string; marcado: boolean; aoMudar(valor: boolean): void }) {
  return (
    <div className={estilos.ajuste}>
      <div className={estilos.opcao}>
        <input id={id} type="checkbox" checked={marcado} aria-describedby={`${id}-efeito`} onChange={(evento) => aoMudar(evento.target.checked)} />
        <div>
          <label htmlFor={id}>{rotulo}</label>
          <p id={`${id}-efeito`} className={ui.mini}>{efeito}</p>
        </div>
      </div>
    </div>
  );
}

function EditorDoRitmo({ chaves, controle, impedimento, aoMudar, ultimo }: PropsDoEditor) {
  const { valor: rascunho, partida, alterado, mudouNoMotor, conflitos, editar, descartar } = useRascunho<Chaves, Chaves>(chaves, igual, marcaDoRitmo, refazer);
  const idDoIntervalo = useId();
  const idDaRetomada = useId();
  const idDaContestacao = useId();
  useEffect(() => {
    aoMudar(alterado);
    return () => aoMudar(false);
  }, [alterado, aoMudar]);

  const corpo = corpoDoRitmo(partida, rascunho);
  const acao: Acao | null = Object.keys(corpo).length ? { tipo: 'ritmo', alvo: ALVO_DO_RITMO, nome: 'o ritmo da revisão', corpo } : null;

  return (
    <>
      <div className={estilos.ajuste}>
        <div className={estilos.campo}>
          <label className={ui.rotulo} htmlFor={idDoIntervalo}>Checar o GitHub a cada</label>
          <select id={idDoIntervalo} className={ui.campo} value={String(rascunho.intervalSeconds)} aria-describedby={`${idDoIntervalo}-efeito`} onChange={(evento) => editar({ ...rascunho, intervalSeconds: Number(evento.target.value) })}>
            {INTERVALOS.map((s) => <option key={s} value={s}>{textoDoIntervalo(s)}</option>)}
            {!(INTERVALOS as readonly number[]).includes(rascunho.intervalSeconds) ? (
              <option value={rascunho.intervalSeconds}>{textoDoIntervalo(rascunho.intervalSeconds)}{intervaloValido(rascunho.intervalSeconds) ? ' (definido no motor)' : ' (fora da faixa que esta tela conhece)'}</option>
            ) : null}
          </select>
          <p id={`${idDoIntervalo}-efeito`} className={ui.mini}>{EFEITO_DO_INTERVALO}</p>
        </div>
      </div>
      <Opcao id={idDaRetomada} rotulo="Retomar a sessão na rodada nova" efeito={EFEITO_DA_RETOMADA} marcado={rascunho.reReviewResume} aoMudar={(valor) => editar({ ...rascunho, reReviewResume: valor })} />
      <Opcao id={idDaContestacao} rotulo="Analisar sozinho a contestação do autor" efeito={EFEITO_DA_CONTESTACAO} marcado={rascunho.autoPushback} aoMudar={(valor) => editar({ ...rascunho, autoPushback: valor })} />
      <p className={ui.mini}>Commit novo no meio de uma revisão não tem ajuste: o review do commit antigo nunca é publicado, e o PR volta à fila para o head novo.</p>

      <PeDoFormulario
        oQue="o ritmo da revisão"
        alterado={alterado}
        alteracoes={Object.keys(corpo).length}
        mudouNoMotor={mudouNoMotor}
        conflitos={conflitosDoRitmo(conflitos, chaves, rascunho)}
        aoDescartar={descartar}
        impedimento={impedimento}
        erro={null}
        acao={acao}
        controle={controle}
        ultimo={ultimo}
        nota="O salvar manda só as chaves que você alterou aqui: o que outra pessoa mudou nas outras não é desfeito."
      />
    </>
  );
}

interface Props {
  config: ConfigDoSistema | undefined;
  controle: ControleDeAcoes;
  impedimento: string | null;
  aoMudar(alterado: boolean): void;
  ultimo: UltimoSalvar | null;
}

export function Ritmo({ config, controle, impedimento, aoMudar, ultimo }: Props) {
  const chaves = ritmoDe(config);
  if (!chaves) return <p className={ui.nota}>Atenção: o motor não mandou as chaves do ritmo a esta tela (intervalo da checagem, retomada e contestação). Sem o valor de agora não há de onde editar.</p>;
  return <EditorDoRitmo chaves={chaves} controle={controle} impedimento={impedimento} aoMudar={aoMudar} ultimo={ultimo} />;
}
