'use client';

// As peças comuns dos formulários do Sistema: o par rótulo e valor, e o pé que diz o estado da
// edição (sem alteração, bloqueada, com erro, ou pronta para salvar) e oferece o descartar.
import type { ReactNode } from 'react';
import type { Acao } from '@/radar/acoes';
import { AcoesDoItem } from '../radar/AcoesDoItem';
import type { ControleDeAcoes } from '../radar/useAcoes';
import comuns from '../radar/Radar.module.css';
import estilos from './Sistema.module.css';

export function Par({ nome, children }: { nome: string; children: ReactNode }) {
  return (
    <div className={estilos.par}>
      <dt>{nome}</dt>
      <dd>{children}</dd>
    </div>
  );
}

interface Props {
  // como a tela chama o que está sendo editado: "a conta e a política", "a automação"
  oQue: string;
  alterado: boolean;
  mudouNoMotor: boolean;
  // os campos que a pessoa e o motor mudaram, cada um para um valor, já por extenso
  conflitos?: readonly string[];
  aoDescartar(): void;
  // por que o salvar está fechado (conexão, estado que não chegou), ou null
  impedimento: string | null;
  // o que no formulário não dá para mandar, ou null
  erro: string | null;
  // a ação de salvar, montada do rascunho; null quando não há o que mandar
  acao: Acao | null;
  controle: ControleDeAcoes;
  // o que o salvar manda, dito antes do botão
  nota?: string;
}

export function PeDoFormulario({ oQue, alterado, mudouNoMotor, conflitos = [], aoDescartar, impedimento, erro, acao, controle, nota }: Props) {
  return (
    <>
      {mudouNoMotor ? (
        <div className={comuns.nota} role="status">
          <p>
            Aviso: {oQue} mudou no motor enquanto você editava (outra aba, ou outra pessoa). O formulário passou a mostrar o que o motor tem agora nos campos que você não alterou, e o salvar leva só o que você alterou: o que a outra pessoa mudou não é desfeito.
          </p>
          {conflitos.length ? (
            <ul>
              {conflitos.map((conflito) => <li key={conflito}>{conflito}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
      {!alterado ? <p className={comuns.meta}>Sem alteração por salvar.</p> : null}
      {alterado && erro ? <p className={comuns.erroDoCampo} role="alert">Erro: {erro}</p> : null}
      {alterado && impedimento ? <p className={`${comuns.nota} ${comuns.bloqueio}`}>Bloqueado: {impedimento}</p> : null}
      {alterado && !erro && !impedimento && acao ? (
        <>
          {nota ? <p className={comuns.meta}>{nota}</p> : null}
          <AcoesDoItem botoes={[{ acao, primario: true }]} controle={controle} />
        </>
      ) : null}
      {alterado ? (
        <div className={comuns.botoes}>
          <button type="button" className={comuns.botao} onClick={aoDescartar}>Descartar a edição de {oQue}</button>
        </div>
      ) : null}
    </>
  );
}
