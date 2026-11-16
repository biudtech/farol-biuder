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
  // como a tela chama o que está sendo editado: "a conta e a política", "o teto de Assinatura"
  oQue: string;
  alterado: boolean;
  mudouNoMotor: boolean;
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

export function PeDoFormulario({ oQue, alterado, mudouNoMotor, aoDescartar, impedimento, erro, acao, controle, nota }: Props) {
  return (
    <>
      {mudouNoMotor ? (
        <p className={comuns.nota} role="status">
          Aviso: {oQue} mudou no motor enquanto você editava (outra aba, ou outra pessoa). Salvar grava o que está neste formulário por cima do que o motor tem agora.
        </p>
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
