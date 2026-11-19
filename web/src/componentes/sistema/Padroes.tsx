'use client';

// O assunto Padrões do time: o texto que o time combinou e quer que o revisor considere em todo
// PR (src/sistema/padroes.ts). É dado, não instrução: desvio vira sugestão com o padrão citado e
// só bloqueia quando também é defeito. O salvar manda o texto inteiro, que troca o anterior, a
// POST /api/accounts/edit; texto vazio tira os padrões. O que foi digitado fica no campo se o
// salvar falhar.
import { useEffect, useId } from 'react';
import { ui } from '@/componentes/ui';
import type { ContaRevisora } from '@/contratos/sistema';
import type { Acao } from '@/radar/acoes';
import { TETO_GRAVADO, contagemDosPadroes, marcaDosPadroes } from '@/sistema/padroes';
import type { Refeito } from '@/sistema/rascunho';
import type { ControleDeAcoes } from '../radar/useAcoes';
import { PeDoFormulario, type UltimoSalvar } from './Formulario';
import { useRascunho } from './useRascunho';
import estilos from './Sistema.module.css';

export const ALVO_DOS_PADROES = 'sistema:padroes';
const igual = (texto: string): string => texto;
// Um campo só: o texto da pessoa fica, e conflita quando o motor também mudou para outro.
function refazer(partida: string, rascunho: string, nova: string): Refeito<string> {
  const conflito = marcaDosPadroes(nova) !== marcaDosPadroes(partida) && marcaDosPadroes(nova) !== marcaDosPadroes(rascunho);
  return { valor: rascunho, conflitos: conflito ? ['padroes'] : [] };
}

interface PropsDoEditor {
  conta: ContaRevisora;
  controle: ControleDeAcoes;
  impedimento: string | null;
  aoMudar(alterado: boolean): void;
  ultimo: UltimoSalvar | null;
}

function EditorDosPadroes({ conta, controle, impedimento, aoMudar, ultimo }: PropsDoEditor) {
  const { valor: rascunho, alterado, mudouNoMotor, conflitos, editar, descartar } = useRascunho<string, string>(conta.padroes ?? '', igual, marcaDosPadroes, refazer);
  const idDoTexto = useId();
  useEffect(() => {
    aoMudar(alterado);
    return () => aoMudar(false);
  }, [alterado, aoMudar]);

  const acao: Acao | null = alterado ? { tipo: 'padroes', alvo: ALVO_DOS_PADROES, nome: `@${conta.user}`, user: conta.user, texto: rascunho.trim() } : null;

  return (
    <>
      {conta.padroesComSegredo ? (
        <p className={ui.nota}>
          Aviso: o texto guardado no motor tem trecho com cara de credencial, mostrado aqui como [segredo omitido]. Salvar grava o texto como está neste campo, sem o segredo.
        </p>
      ) : null}
      <div className={estilos.campo}>
        <label className={ui.rotulo} htmlFor={idDoTexto}>Texto dos padrões, um por linha</label>
        <textarea
          id={idDoTexto}
          className={`${ui.campo} ${estilos.areaDeTexto}`}
          rows={9}
          value={rascunho}
          maxLength={TETO_GRAVADO}
          aria-describedby={`${idDoTexto}-contagem`}
          onChange={(evento) => editar(evento.target.value)}
        />
        <p id={`${idDoTexto}-contagem`} className={ui.mini}>{contagemDosPadroes(rascunho)}</p>
      </div>
      <PeDoFormulario
        oQue="os padrões do time"
        alterado={alterado}
        alteracoes={alterado ? 1 : 0}
        mudouNoMotor={mudouNoMotor}
        conflitos={conflitos.length ? ['Os padrões mudaram no motor e no seu formulário, cada um de um jeito. Salvar grava o seu texto inteiro por cima.'] : []}
        aoDescartar={descartar}
        impedimento={impedimento}
        erro={null}
        acao={acao}
        controle={controle}
        ultimo={ultimo}
        nota={rascunho.trim() ? 'O salvar troca o texto inteiro dos padrões pelo deste campo. Vale para as revisões que começarem daqui em diante.' : 'O campo está vazio: salvar tira os padrões do time, e a revisão segue sem eles.'}
      />
    </>
  );
}

interface Props {
  conta: ContaRevisora | undefined;
  controle: ControleDeAcoes;
  impedimento: string | null;
  aoMudar(alterado: boolean): void;
  ultimo: UltimoSalvar | null;
}

export function Padroes({ conta, controle, impedimento, aoMudar, ultimo }: Props) {
  if (!conta) return <p className={ui.nota}>Atenção: o motor não mandou a conta revisora a esta tela, e os padrões moram nela.</p>;
  if (!conta.user) return <p className={ui.vazio}>Sem conta revisora não há padrões a editar: eles moram na conta.</p>;
  return (
    <>
      <p className={ui.mini}>
        O que o Farol confere em todo PR além das regras do próprio repositório: padrões de projeto, nomes, camadas, o que evitar. O texto vai à revisão como dado: desvio vira sugestão citando o padrão, e só bloqueia quando também é defeito. Se um padrão conflitar com uma regra do repositório, a do repositório vale.
      </p>
      <EditorDosPadroes conta={conta} controle={controle} impedimento={impedimento} aoMudar={aoMudar} ultimo={ultimo} />
    </>
  );
}
