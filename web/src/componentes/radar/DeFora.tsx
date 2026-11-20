'use client';

// "De fora da fila" (redesenho de 19/11/2026): os PRs pedidos à conta que o motor não vai revisar
// sozinho (`deFora`, lib/engine/de-fora.js). Eles não aparecem na Fila nem na contagem dela; aqui
// ficam três peças que abrem o mesmo painel:
// - o botão flutuante no canto do Radar, com o rótulo e o número;
// - a pílula ao lado do título da Fila, com o número;
// - o painel lateral: os filtros por motivo, um cartão por PR com o motivo em destaque (em frase,
//   src/radar/de-fora.ts), quando volta à fila e "Revisar mesmo assim", que é o mesmo pedido do
//   Revisar de hoje (POST /api/review com a URL do PR).
// Com zero PRs de fora, o botão e a pílula não aparecem. O painel é um diálogo modal: fecha no X,
// no Esc e no fundo, prende o foco enquanto aberto e devolve o foco a quem o abriu. O resultado
// das ações (`resultado`, o anúncio discreto do Radar) vai dentro dele enquanto está aberto,
// para ser visto e anunciado no modal; e quando o cartão com o foco sai (o PR foi para a revisão),
// o foco vai ao cartão seguinte, ou ao X, e nunca fica solto na página.
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import type { MotivoDeFora, PrDeFora } from '@/contratos/de-fora';
import { contarPorMotivo, filtrarDeFora, fraseDoMotivo } from '@/radar/de-fora';
import { nomeDoPr } from '@/radar/formato';
import { ui } from '@/componentes/ui';
import { AbrirNoGitHub, Cartao, Rodape } from '@/componentes/cartao/Cartao';
import { AcoesDoItem } from './AcoesDoItem';
import type { ControleDeAcoes } from './useAcoes';
import estilos from './DeFora.module.css';

// O estado do painel e a volta do foco: guarda quem abriu, e devolve o foco a ele ao fechar (ou
// ao conteúdo principal, se ele saiu da tela enquanto o painel estava aberto).
export function usePainelDeFora() {
  const [aberto, setAberto] = useState(false);
  const origem = useRef<HTMLElement | null>(null);
  const abrir = useCallback((evento: MouseEvent<HTMLElement>) => {
    origem.current = evento.currentTarget;
    setAberto(true);
  }, []);
  const fechar = useCallback(() => {
    setAberto(false);
    const alvo = origem.current?.isConnected ? origem.current : document.getElementById('conteudo');
    alvo?.focus();
  }, []);
  return { aberto, abrir, fechar };
}

const quantos = (n: number): string => (n === 1 ? '1 PR' : `${n} PRs`);

function Seta() {
  return (
    <svg className={estilos.seta} aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

interface PropsDoAbrir {
  n: number;
  aoAbrir: (evento: MouseEvent<HTMLElement>) => void;
  aberto?: boolean;
}

// O botão flutuante: "De fora da fila", "Ver os PRs e o motivo de cada um" e o número.
export function BotaoDeFora({ n, aoAbrir, aberto }: PropsDoAbrir) {
  if (n < 1) return null;
  return (
    <button type="button" className={estilos.flutuante} onClick={aoAbrir} aria-haspopup="dialog" aria-expanded={aberto ?? false}>
      <span className={estilos.numeroDoFlutuante} aria-hidden="true">{n}</span>
      <span className={estilos.textoDoFlutuante}>
        <span className={estilos.rotuloDoFlutuante}>De fora da fila<span className={ui.soLeitor}>{`: ${quantos(n)}.`}</span></span>
        <span className={estilos.subDoFlutuante}>Ver os PRs e o motivo de cada um</span>
      </span>
      <Seta />
    </button>
  );
}

// A pílula ao lado do título da Fila.
export function PilulaDeFora({ n, aoAbrir, aberto }: PropsDoAbrir) {
  if (n < 1) return null;
  return (
    <button type="button" className={estilos.pilula} onClick={aoAbrir} aria-haspopup="dialog" aria-expanded={aberto ?? false}>
      <span className={estilos.numeroDaPilula}>{n}</span>
      <span>de fora da fila<span className={ui.soLeitor}>, ver os PRs e o motivo de cada um</span></span>
      <Seta />
    </button>
  );
}

function Alerta() {
  return (
    <svg className={estilos.iconeDoMotivo} aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16.5h.01" />
    </svg>
  );
}

const CartaoDeFora = memo(function CartaoDeFora({ item, controle }: { item: PrDeFora; controle: ControleDeAcoes }) {
  const nome = nomeDoPr(item.key);
  const frase = fraseDoMotivo(item);
  const topo = (
    <div className={estilos.motivo} data-tom={frase.tom}>
      <Alerta />
      <div className={estilos.textoDoMotivo}>
        <strong className={estilos.tituloDoMotivo}>{frase.titulo}</strong>
        <span className={estilos.detalheDoMotivo}>{frase.detalhe}</span>
      </div>
    </div>
  );
  // o ignorado ganha o Restaurar, o mesmo da seção Ignorados do Radar
  const restaurar = item.motivo === 'ignorado' ? [{ acao: { tipo: 'restaurar' as const, chave: item.key, alvo: item.key, nome } }] : [];
  const revisar = item.url ? [{ acao: { tipo: 'revisar' as const, url: item.url, mesmoAssim: true as const, alvo: item.key, nome } }] : [];
  const botoes = [...restaurar, ...revisar];
  const acoes = (
    <>
      <AbrirNoGitHub chave={item.key} url={item.url} />
      {botoes.length ? <AcoesDoItem pequeno botoes={botoes} controle={controle} /> : null}
    </>
  );
  return (
    <Cartao
      compacto
      tom="fila"
      chave={item.key}
      url={item.url}
      autor={item.author}
      titulo={item.title || nome}
      contexto=""
      estado={`de fora da fila: ${frase.titulo}`}
      topo={topo}
    >
      <Rodape tom="fila" texto={frase.volta} acao={acoes} />
    </Cartao>
  );
});

// Os elementos que recebem o foco pelo Tab dentro do painel.
const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface PropsDoPainel {
  itens: readonly PrDeFora[];
  aberto: boolean;
  aoFechar: () => void;
  controle: ControleDeAcoes;
  // o anúncio discreto das ações, que vem para dentro do painel enquanto ele está aberto
  resultado?: ReactNode;
}

export function PainelDeFora({ itens, aberto, aoFechar, controle, resultado }: PropsDoPainel) {
  const idDoTitulo = useId();
  const idDaFrase = useId();
  const caixa = useRef<HTMLDivElement>(null);
  const fechar = useRef<HTMLButtonElement>(null);
  const [escolhido, setEscolhido] = useState<MotivoDeFora | null>(null);
  const contagens = useMemo(() => contarPorMotivo(itens), [itens]);
  // o motivo escolhido que ficou sem PR volta a "Todos"
  const filtro = escolhido !== null && contagens.some((c) => c.motivo === escolhido) ? escolhido : null;
  const visiveis = useMemo(() => filtrarDeFora(itens, filtro), [itens, filtro]);
  const lista = useRef<HTMLDivElement>(null);
  // a posição do cartão que tem o foco, para saber aonde ir quando ele sai
  const posicaoDoFoco = useRef<number | null>(null);

  // ao abrir, o foco vai ao fechar, o primeiro controle do painel
  useEffect(() => {
    if (aberto) fechar.current?.focus();
  }, [aberto]);

  // O cartão com o foco saiu da lista: o foco vai ao cartão que ficou no lugar dele (o seguinte),
  // ou ao último, ou ao X quando a lista esvaziou.
  useLayoutEffect(() => {
    const posicao = posicaoDoFoco.current;
    if (!aberto || posicao === null || !caixa.current) return;
    const ativo = document.activeElement;
    if (ativo instanceof Node && ativo !== document.body && caixa.current.contains(ativo)) return;
    posicaoDoFoco.current = null;
    const cartoes = [...(lista.current?.querySelectorAll<HTMLElement>('article') ?? [])];
    const alvo = cartoes[Math.min(posicao, cartoes.length - 1)];
    const focavel = alvo?.querySelector<HTMLElement>(FOCAVEIS);
    (focavel ?? fechar.current)?.focus();
  }, [aberto, visiveis]);

  // guarda a posição do cartão que recebeu o foco; o foco fora dos cartões apaga a posição
  const aoFocar = (evento: FocusEvent<HTMLDivElement>) => {
    const cartao = evento.target instanceof Element ? evento.target.closest('article') : null;
    const cartoes = [...(lista.current?.querySelectorAll('article') ?? [])];
    const posicao = cartao ? cartoes.indexOf(cartao) : -1;
    posicaoDoFoco.current = posicao >= 0 ? posicao : null;
  };

  if (!aberto) return null;

  // Esc fecha; Tab e Shift+Tab giram dentro do painel
  const teclas = (evento: KeyboardEvent<HTMLDivElement>) => {
    if (evento.key === 'Escape') {
      evento.preventDefault();
      aoFechar();
      return;
    }
    if (evento.key !== 'Tab' || !caixa.current) return;
    const focaveis = [...caixa.current.querySelectorAll<HTMLElement>(FOCAVEIS)].filter((el) => el.getAttribute('aria-hidden') !== 'true');
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    if (!primeiro || !ultimo) return;
    const ativo = document.activeElement;
    const dentro = ativo instanceof Node && caixa.current.contains(ativo);
    if (evento.shiftKey && (ativo === primeiro || !dentro)) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && (ativo === ultimo || !dentro)) {
      evento.preventDefault();
      primeiro.focus();
    }
  };

  return (
    <div className={estilos.camada}>
      {/* o fundo escurecido: clicar nele fecha, como o X (o teclado usa o X e o Esc) */}
      <div className={estilos.fundo} aria-hidden="true" onClick={aoFechar} />
      <div
        ref={caixa}
        className={estilos.painel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idDoTitulo}
        aria-describedby={idDaFrase}
        onKeyDown={teclas}
        onFocus={aoFocar}
      >
        <div className={estilos.cabecaDoPainel}>
          <div>
            <h2 id={idDoTitulo} className={estilos.tituloDoPainel}>De fora com justificativa</h2>
            <p id={idDaFrase} className={estilos.fraseDoPainel}>
              {`${quantos(itens.length)} que o Farol deixou de revisar sozinho. Não contam na fila. O Revisar continua funcionando em todos.`}
            </p>
          </div>
          <button ref={fechar} type="button" className={estilos.fechar} onClick={aoFechar} aria-label="Fechar o painel e voltar à fila">
            <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12" /><path d="M18 6L6 18" />
            </svg>
          </button>
        </div>

        {itens.length ? (
          <div className={estilos.filtros} role="group" aria-label="Filtrar por motivo">
            <button type="button" className={estilos.filtro} aria-pressed={filtro === null} onClick={() => setEscolhido(null)}>
              Todos <span className={estilos.numeroDoFiltro}>{itens.length}</span>
            </button>
            {contagens.map((c) => (
              <button key={c.motivo} type="button" className={estilos.filtro} aria-pressed={filtro === c.motivo} onClick={() => setEscolhido(c.motivo)}>
                {c.rotulo} <span className={estilos.numeroDoFiltro}>{c.n}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div ref={lista} className={estilos.lista}>
          {visiveis.length ? visiveis.map((item) => <CartaoDeFora key={item.key} item={item} controle={controle} />) : (
            <p className={ui.vazio}>Nenhum PR de fora da fila agora.</p>
          )}
        </div>
        {resultado ? <div className={estilos.peDoPainel}>{resultado}</div> : null}
      </div>
    </div>
  );
}
