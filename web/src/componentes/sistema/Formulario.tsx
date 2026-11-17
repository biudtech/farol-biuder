'use client';

// As peças comuns do Sistema: o par rótulo e valor (uma linha com o nome à esquerda e o valor à
// direita), e o pé de cada formulário, que diz o estado da edição (sem alteração, salvo,
// bloqueada, com erro, ou com N alterações por salvar) e oferece o Descartar e o Salvar.
import type { ReactNode } from 'react';
import { Chip, ui } from '@/componentes/ui';
import type { Acao } from '@/radar/acoes';
import type { ControleDeAcoes } from '../radar/useAcoes';
import { AcaoComPergunta } from './AcaoComPergunta';
import estilos from './Sistema.module.css';

export function Par({ nome, children }: { nome: string; children: ReactNode }) {
  return (
    <div className={estilos.par}>
      <dt>{nome}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// O desfecho do último salvar desta seção, para o pé dizer "Salvo às" ou o erro.
export interface UltimoSalvar {
  ok: boolean;
  // hora do aceite, já escrita ("14:31")
  hora: string;
}

interface Props {
  // como a tela chama o que está sendo editado: "a conta e a política", "a automação"
  oQue: string;
  alterado: boolean;
  // quantos campos o salvar leva
  alteracoes: number;
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
  ultimo?: UltimoSalvar | null;
}

export function PeDoFormulario({ oQue, alterado, alteracoes, mudouNoMotor, conflitos = [], aoDescartar, impedimento, erro, acao, controle, nota, ultimo }: Props) {
  const contagem = alteracoes === 1 ? '1 alteração por salvar.' : `${alteracoes} alterações por salvar.`;
  return (
    <div className={estilos.pe}>
      {mudouNoMotor ? (
        <div className={ui.nota} role="status">
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
      {alterado && erro ? <p className={ui.erro} role="alert">Erro: {erro}</p> : null}
      {alterado && impedimento ? <p className={ui.nota}>Bloqueado: {impedimento}</p> : null}
      {alterado && ultimo && !ultimo.ok ? (
        <p className={ui.erro}>Erro ao salvar: o motor não gravou esta edição. O que ele disse está no resultado, no fim da página; a edição continua aqui para tentar de novo.</p>
      ) : null}
      {alterado && !erro && !impedimento && acao && nota ? <p className={ui.mini}>{nota}</p> : null}
      {!alterado ? (
        <div className={estilos.rodape}>
          <span className={ui.mini}>Sem alteração por salvar.</span>
          {ultimo?.ok ? <Chip tom="ok" pequeno>Salvo às {ultimo.hora}</Chip> : null}
        </div>
      ) : (
        <div className={estilos.rodape}>
          <span className={ui.mini}>{alteracoes ? contagem : 'Alteração que o motor não aceita.'}</span>
          <div className={ui.fila}>
            <button type="button" className={`${ui.botao} ${ui.fantasma}`} aria-label={`Descartar a edição de ${oQue}`} onClick={aoDescartar}>Descartar</button>
            {!erro && !impedimento && acao ? <AcaoComPergunta acao={acao} controle={controle} ocupado="Salvando…" primario rotulo="Salvar" /> : null}
          </div>
        </div>
      )}
    </div>
  );
}
