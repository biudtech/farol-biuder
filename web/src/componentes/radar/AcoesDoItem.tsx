'use client';

// Os botões de um item (Radar, Histórico, Time e Sistema). Enquanto uma ação do item está no
// ar, todos ficam desabilitados e o que foi clicado mostra o spinner e diz "Enviando" (ou o
// texto do processo, como "Cancelando…"). A ação que joga trabalho fora ou apaga (Cancelar,
// contestação, remover do Time, as do Sistema que pedem) troca os botões por uma pergunta, no
// próprio item, antes de enviar. O que o motor respondeu aparece embaixo dos botões e some
// sozinho (ResultadoNoItem).
import { useEffect, useId, useRef, useState } from 'react';
import { Spinner, ui } from '@/componentes/ui';
import { confirmacaoDa, idDa, nomeDa, rotuloDa, type Acao } from '@/radar/acoes';
import type { ControleDeAcoes } from './useAcoes';
import { ResultadoNoItem } from './ResultadoNoItem';
import estilos from './Radar.module.css';

export interface BotaoDoItem {
  acao: Acao;
  primario?: boolean;
  // botão sem contorno (Ignorar, Cancelar)
  fantasma?: boolean;
  // o que o botão diz enquanto a ação dele está no ar; sem isto, "Enviando…"
  ocupado?: string;
}

interface Props {
  // todos com o mesmo alvo
  botoes: readonly BotaoDoItem[];
  controle: ControleDeAcoes;
  // os botões no tamanho de dentro de uma linha
  pequeno?: boolean;
}

function classes(...nomes: Array<string | false | undefined>): string {
  return nomes.filter(Boolean).join(' ');
}

export function AcoesDoItem({ botoes, controle, pequeno }: Props) {
  // O id (idDa) da ação que está perguntando. A ação em si é lida dos botões a cada desenho:
  // se o motor mudou o item com a pergunta aberta, vale o item de agora, não o do clique.
  const [pergunta, setPergunta] = useState<string | null>(null);
  // a pergunta fechou sozinha, porque a ação deixou de ser oferecida
  const [fechouSozinha, setFechouSozinha] = useState(false);
  const voltar = useRef<HTMLButtonElement>(null);
  const aviso = useRef<HTMLParagraphElement>(null);
  // A ação cujo botão abriu a pergunta: é para ele que o foco volta. Guarda o id, não o
  // elemento, porque os botões saem da tela enquanto a pergunta está aberta e voltam outros.
  const origem = useRef<string | null>(null);
  const botoesNaTela = useRef(new Map<string, HTMLButtonElement>());
  const idDoTitulo = useId();
  const idDoTexto = useId();

  const perguntando = pergunta === null ? undefined : botoes.find((b) => idDa(b.acao) === pergunta)?.acao;
  const confirmacao = perguntando ? confirmacaoDa(perguntando) : null;
  // A ação da pergunta não está mais entre as permitidas (chegou commit novo, o PR passou a
  // ser da própria conta): a pergunta fecha, e a tela diz por quê. Ajuste de estado no
  // desenho, como o React prevê para estado que depende de propriedade.
  if (pergunta !== null && !confirmacao) {
    setPergunta(null);
    setFechouSozinha(true);
  }

  useEffect(() => {
    if (pergunta !== null) {
      voltar.current?.focus();
      return;
    }
    // quem estava na pergunta perdeu o elemento com o foco: ele vai ao aviso, ou ao botão
    if (fechouSozinha) {
      // só quando o foco ficou solto: quem estava em outro lugar da página não é puxado
      if (document.activeElement === null || document.activeElement === document.body) aviso.current?.focus();
    } else if (origem.current !== null) botoesNaTela.current.get(origem.current)?.focus();
    origem.current = null;
  }, [pergunta, fechouSozinha]);

  const alvo = botoes[0]?.acao.alvo;
  const enviando = alvo === undefined ? null : controle.emCurso(alvo);

  if (perguntando && confirmacao) {
    return (
      <div
        className={estilos.confirmacao}
        role="group"
        aria-labelledby={idDoTitulo}
        aria-describedby={idDoTexto}
        onKeyDown={(evento) => {
          if (evento.key !== 'Escape') return;
          evento.stopPropagation();
          setPergunta(null);
        }}
      >
        <p id={idDoTitulo} className={estilos.confirmacaoTitulo}>{confirmacao.titulo}</p>
        <p id={idDoTexto}>{confirmacao.texto}</p>
        <div className={estilos.botoes}>
          <button ref={voltar} type="button" className={classes(ui.botao, pequeno && ui.pequeno)} onClick={() => setPergunta(null)}>
            Voltar sem enviar
          </button>
          <button
            type="button"
            className={classes(ui.botao, ui.primario, pequeno && ui.pequeno)}
            aria-label={`${confirmacao.confirmar}: ${perguntando.nome}`}
            onClick={() => {
              // enviou: o botão de origem vai estar desabilitado, e o foco vai ao anúncio da
              // tela, que diz o resultado (nunca fica solto na página)
              origem.current = null;
              setPergunta(null);
              controle.focarResultado();
              void controle.disparar(perguntando);
            }}
          >
            {confirmacao.confirmar}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {fechouSozinha ? (
        <p ref={aviso} className={estilos.nota} role="status" tabIndex={-1}>
          A pergunta foi fechada: o motor mudou este item e a ação não está mais disponível. Nada foi enviado.
        </p>
      ) : null}
      {botoes.length ? (
        <div className={estilos.botoes}>
          {botoes.map(({ acao, primario, fantasma, ocupado }) => {
            const esteEnvia = enviando === idDa(acao);
            return (
              <button
                key={idDa(acao)}
                ref={(elemento) => {
                  if (elemento) botoesNaTela.current.set(idDa(acao), elemento);
                  else botoesNaTela.current.delete(idDa(acao));
                }}
                type="button"
                className={classes(ui.botao, primario && ui.primario, fantasma && ui.fantasma, pequeno && ui.pequeno)}
                disabled={enviando !== null}
                aria-label={esteEnvia ? `Enviando: ${nomeDa(acao)}` : nomeDa(acao)}
                onClick={() => {
                  setFechouSozinha(false);
                  if (confirmacaoDa(acao)) {
                    origem.current = idDa(acao);
                    setPergunta(idDa(acao));
                    return;
                  }
                  void controle.disparar(acao);
                }}
              >
                {esteEnvia ? <><Spinner tamanho="p" />{ocupado ?? 'Enviando…'}</> : rotuloDa(acao)}
              </button>
            );
          })}
        </div>
      ) : null}
      {alvo === undefined ? null : <ResultadoNoItem resultado={controle.resultadoDe(alvo)} />}
    </>
  );
}
