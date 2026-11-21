'use client';

// O botão de uma ação do Sistema (salvar uma seção, encerrar uma sessão), com a pergunta antes
// do envio quando a ação pede (confirmacaoDa) e o próprio processo no botão enquanto ela está no
// ar ("Salvando…", "Encerrando…"). A pergunta fica no lugar do botão, no próprio formulário ou
// na própria linha: o foco vai ao "Voltar sem enviar" ao abrir, volta ao botão ao cancelar e
// vai ao anúncio da tela ao enviar (o botão sai da tela).
import { useEffect, useId, useRef, useState } from 'react';
import { confirmacaoDa, idDa, nomeDa, rotuloDa, type Acao } from '@/radar/acoes';
import { Botao, ui } from '@/componentes/ui';
import type { ControleDeAcoes } from '../radar/useAcoes';
import estilos from './Sistema.module.css';
import { ResultadoNoItem } from '../radar/ResultadoNoItem';

interface Props {
  acao: Acao;
  controle: ControleDeAcoes;
  // o que o botão diz enquanto a ação está no ar
  ocupado: string;
  primario?: boolean;
  pequeno?: boolean;
  // o texto do botão, quando não é o rótulo da ação
  rotulo?: string;
}

export function AcaoComPergunta({ acao, controle, ocupado, primario, pequeno, rotulo }: Props) {
  const [perguntando, setPerguntando] = useState(false);
  const voltar = useRef<HTMLButtonElement>(null);
  const botao = useRef<HTMLDivElement>(null);
  // depois de cancelar, o foco volta ao botão da ação
  const devolverFoco = useRef(false);
  const idDoTitulo = useId();
  const idDoTexto = useId();
  const confirmacao = confirmacaoDa(acao);
  // a ação mudou com a pergunta aberta e não pede mais confirmação: a pergunta fecha
  const aberta = perguntando && confirmacao !== null;
  if (perguntando && !confirmacao) setPerguntando(false);

  useEffect(() => {
    if (aberta) voltar.current?.focus();
    else if (devolverFoco.current) {
      devolverFoco.current = false;
      botao.current?.querySelector('button')?.focus();
    }
  }, [aberta]);

  const enviando = controle.emCurso(acao.alvo);
  const esteEnvia = enviando === idDa(acao);

  if (aberta && confirmacao) {
    return (
      <div
        className={estilos.pergunta}
        role="group"
        aria-labelledby={idDoTitulo}
        aria-describedby={idDoTexto}
        onKeyDown={(evento) => {
          if (evento.key !== 'Escape') return;
          evento.stopPropagation();
          devolverFoco.current = true;
          setPerguntando(false);
        }}
      >
        <p id={idDoTitulo} className={estilos.tituloDaPergunta}>{confirmacao.titulo}</p>
        <p id={idDoTexto} className={ui.mini}>{confirmacao.texto}</p>
        <div className={estilos.botoesDaPergunta}>
          <button
            ref={voltar}
            type="button"
            className={`${ui.botao} ${ui.fantasma}`}
            onClick={() => { devolverFoco.current = true; setPerguntando(false); }}
          >
            Voltar sem enviar
          </button>
          <Botao
            primario
            aria-label={`${confirmacao.confirmar}: ${acao.nome}`}
            onClick={() => {
              setPerguntando(false);
              controle.focarResultado();
              void controle.disparar(acao);
            }}
          >
            {confirmacao.confirmar}
          </Botao>
        </div>
      </div>
    );
  }

  return (
    <div ref={botao} className={estilos.botaoDaAcao}>
      <Botao
        primario={primario}
        pequeno={pequeno}
        ocupado={esteEnvia ? ocupado : false}
        disabled={enviando !== null}
        aria-label={esteEnvia ? `${ocupado} ${nomeDa(acao)}` : nomeDa(acao)}
        onClick={() => {
          if (confirmacao) {
            setPerguntando(true);
            return;
          }
          void controle.disparar(acao);
        }}
      >
        {rotulo ?? rotuloDa(acao)}
      </Botao>
      <ResultadoNoItem resultado={controle.resultadoDe(acao.alvo)} />
    </div>
  );
}
