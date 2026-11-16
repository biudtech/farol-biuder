'use client';

// Os botões de um item do Radar. Enquanto uma ação do item está no ar, todos ficam
// desabilitados e o que foi clicado diz "Enviando". A ação que publica (Aprovar, Pedir
// mudanças) ou que joga trabalho fora (Cancelar) troca os botões por uma pergunta, no
// próprio cartão, antes de enviar.
import { useEffect, useId, useRef, useState } from 'react';
import { confirmacaoDa, idDa, nomeDa, rotuloDa, type Acao } from '@/radar/acoes';
import type { ControleDeAcoes } from './useAcoes';
import estilos from './Radar.module.css';

export interface BotaoDoItem {
  acao: Acao;
  primario?: boolean;
}

interface Props {
  // todos com o mesmo alvo
  botoes: readonly BotaoDoItem[];
  controle: ControleDeAcoes;
}

export function AcoesDoItem({ botoes, controle }: Props) {
  const [pergunta, setPergunta] = useState<Acao | null>(null);
  const voltar = useRef<HTMLButtonElement>(null);
  // A ação cujo botão abriu a pergunta: é para ele que o foco volta. Guarda o id, não o
  // elemento, porque os botões saem da tela enquanto a pergunta está aberta e voltam outros.
  const origem = useRef<string | null>(null);
  const botoesNaTela = useRef(new Map<string, HTMLButtonElement>());
  const idDoTitulo = useId();
  const idDoTexto = useId();

  useEffect(() => {
    if (pergunta) {
      voltar.current?.focus();
      return;
    }
    if (origem.current !== null) botoesNaTela.current.get(origem.current)?.focus();
    origem.current = null;
  }, [pergunta]);

  const alvo = botoes[0]?.acao.alvo;
  if (alvo === undefined) return null;
  const enviando = controle.emCurso(alvo);
  const confirmacao = pergunta ? confirmacaoDa(pergunta) : null;

  if (pergunta && confirmacao) {
    return (
      <div className={estilos.confirmacao} role="group" aria-labelledby={idDoTitulo} aria-describedby={idDoTexto}>
        <p id={idDoTitulo} className={estilos.confirmacaoTitulo}>{confirmacao.titulo}</p>
        <p id={idDoTexto}>{confirmacao.texto}</p>
        <div className={estilos.botoes}>
          <button ref={voltar} type="button" className={estilos.botao} onClick={() => setPergunta(null)}>
            Voltar sem enviar
          </button>
          <button
            type="button"
            className={`${estilos.botao} ${estilos.primario}`}
            aria-label={`${confirmacao.confirmar}: ${pergunta.nome}`}
            onClick={() => {
              // enviou: o foco não volta ao botão, que vai estar desabilitado
              origem.current = null;
              setPergunta(null);
              void controle.disparar(pergunta);
            }}
          >
            {confirmacao.confirmar}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={estilos.botoes}>
      {botoes.map(({ acao, primario }) => {
        const esteEnvia = enviando === idDa(acao);
        return (
          <button
            key={idDa(acao)}
            ref={(elemento) => {
              if (elemento) botoesNaTela.current.set(idDa(acao), elemento);
              else botoesNaTela.current.delete(idDa(acao));
            }}
            type="button"
            className={primario ? `${estilos.botao} ${estilos.primario}` : estilos.botao}
            disabled={enviando !== null}
            aria-label={esteEnvia ? `Enviando: ${nomeDa(acao)}` : nomeDa(acao)}
            onClick={() => {
              if (confirmacaoDa(acao)) {
                origem.current = idDa(acao);
                setPergunta(acao);
                return;
              }
              void controle.disparar(acao);
            }}
          >
            {esteEnvia ? 'Enviando…' : rotuloDa(acao)}
          </button>
        );
      })}
    </div>
  );
}
