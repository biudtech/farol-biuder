'use client';

// Remover a pessoa do Time: um botão discreto que troca por uma pergunta antes de enviar. A
// pergunta é a de confirmacaoDa (src/radar/acoes.ts), que diz as três coisas apagadas, o que
// continua e que não se desfaz. Enquanto a remoção está no ar o botão diz "Removendo…"; com o
// salvar da mesma pessoa no ar (mesmo alvo), ele fica desabilitado.
import { useEffect, useId, useRef, useState } from 'react';
import { confirmacaoDa, idDa, type Acao } from '@/radar/acoes';
import type { ControleDeAcoes } from '../radar/useAcoes';
import { Botao, ui } from '../ui';
import estilos from './Time.module.css';

interface Props {
  acao: Extract<Acao, { tipo: 'removerAutor' }>;
  controle: ControleDeAcoes;
}

export function RemoverDoTime({ acao, controle }: Props) {
  const [perguntando, setPerguntando] = useState(false);
  // a pergunta fechou sem enviar: o foco volta ao botão
  const devolverFoco = useRef(false);
  const voltar = useRef<HTMLButtonElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const idDoTitulo = useId();
  const idDoTexto = useId();
  const confirmacao = confirmacaoDa(acao);
  const enviando = controle.emCurso(acao.alvo);

  useEffect(() => {
    if (perguntando) {
      voltar.current?.focus();
      return;
    }
    if (devolverFoco.current) {
      devolverFoco.current = false;
      area.current?.querySelector('button')?.focus();
    }
  }, [perguntando]);

  const fechar = (): void => {
    devolverFoco.current = true;
    setPerguntando(false);
  };

  if (perguntando && confirmacao) {
    return (
      <div
        className={`${ui.nota} ${estilos.pergunta}`}
        role="group"
        aria-labelledby={idDoTitulo}
        aria-describedby={idDoTexto}
        onKeyDown={(evento) => {
          if (evento.key !== 'Escape') return;
          evento.stopPropagation();
          evento.preventDefault();
          fechar();
        }}
      >
        <p id={idDoTitulo} className={estilos.tituloDaPergunta}>{confirmacao.titulo}</p>
        <p id={idDoTexto} className={ui.texto}>{confirmacao.texto}</p>
        <div className={ui.fila}>
          <button ref={voltar} type="button" className={ui.botao} onClick={fechar}>Voltar sem enviar</button>
          <Botao
            primario
            aria-label={`${confirmacao.confirmar}: ${acao.nome}`}
            onClick={() => {
              // enviou: o botão de remover fica ocupado, e o foco vai à região do resultado
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
    <div ref={area} className={estilos.remover}>
      <Botao fantasma pequeno ocupado={enviando === idDa(acao) ? 'Removendo…' : false} disabled={enviando !== null} onClick={() => setPerguntando(true)}>
        Remover <span className={ui.soLeitor}>{acao.nome}</span>{' '}do Time
      </Botao>
    </div>
  );
}
