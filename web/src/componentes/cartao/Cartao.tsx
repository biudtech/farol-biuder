'use client';

// O cartão único de um PR (redesenho de 19/11/2026): o mesmo em todas as telas, no molde do
// cartão da autoanálise do Farol. A casca tem a borda pela cor do estado; o cabeçalho, a foto do
// autor, a chave, o autor, o ramo, o contexto e o título; depois as pílulas e o corpo, que cada
// tela escolhe (a faixa da revisão, o rodapé da fila, o motivo de De fora). Muda só a borda e o
// que o cartão mostra pelo estado.
//
// O que cada peça diz vem pronto de src/radar/cartao.ts (sem React). Sem estilo em linha: a CSP
// recusa, e a largura das barras vai como atributo do SVG.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Spinner, ui } from '@/componentes/ui';
import { etapasDaFaixa, iniciais, urlDoAvatar, type Andamento, type Pilula, type TomDoCartao } from '@/radar/cartao';
import { linkDoPr } from '@/radar/formato';
import estilos from './Cartao.module.css';

export { estilos as estilosDoCartao };

function classes(...nomes: Array<string | false | undefined>): string {
  return nomes.filter(Boolean).join(' ');
}

// O relógio de 1 s. Quem o chama redesenha a cada segundo: por isso ele mora só nos componentes
// do tempo e da faixa, e o cabeçalho, o avatar e as pílulas do cartão ficam de fora.
export function useAgora(intervaloMs = 1000): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), intervaloMs);
    return () => clearInterval(id);
  }, [intervaloMs]);
  return agora;
}

// true a partir do `instante` (no relógio do navegador), com um disparo só, na hora: quem precisa
// saber se um prazo passou não redesenha a cada segundo.
export function usePassou(instante: number | undefined): boolean {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (instante === undefined) return undefined;
    const id = setTimeout(() => setAgora(Date.now()), Math.max(0, instante - Date.now()));
    return () => clearTimeout(id);
  }, [instante]);
  return instante !== undefined && agora >= instante;
}

// A foto do GitHub do autor, e as iniciais quando não há login com forma de login ou a imagem
// falha. O login já está escrito ao lado: a imagem é decoração (alt vazio).
export function Avatar({ login, pequeno }: { login: string | undefined; pequeno?: boolean }) {
  const url = urlDoAvatar(login);
  const [falhou, setFalhou] = useState<string | null>(null);
  const tamanho = pequeno ? 40 : 44;
  if (!url || falhou === url) return <span className={estilos.avatar} data-pequeno={pequeno ? 'sim' : undefined} aria-hidden="true">{iniciais(login)}</span>;
  return (
    // A foto vem do GitHub, fora do otimizador do Next (que o servidor de socket não serve); a
    // origem está no img-src da CSP.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={estilos.avatar}
      data-pequeno={pequeno ? 'sim' : undefined}
      src={url}
      alt=""
      width={tamanho}
      height={tamanho}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFalhou(url)}
    />
  );
}

// "Abrir no GitHub" com cara de botão fantasma. Sem URL do GitHub por HTTPS, não há link.
export function AbrirNoGitHub({ chave, url }: { chave: string; url: string | null | undefined }) {
  const href = linkDoPr(url ?? undefined);
  if (!href) return null;
  return (
    <a className={classes(ui.botao, ui.fantasma, ui.pequeno, estilos.botaoLink)} href={href} target="_blank" rel="noreferrer noopener">
      Abrir no GitHub
      <span className={ui.soLeitor}>: {chave} (abre em nova aba)</span>
    </a>
  );
}

// Os PRs com o Revisar (ou Tentar de novo, ou Revisar de novo) clicado há pouco. O botão clicado
// sai da tela e o foco cairia no body: o botão ocupado que nasce no lugar, no cartão da fila ou
// no da sessão que abriu, pega o foco, mas só se ele ficou solto.
const PRAZO_DO_FOCO_MS = 120000;
const focoPendente = new Map<string, number>();

export function marcarFoco(chave: string): void {
  focoPendente.set(chave, Date.now());
}

function focoSolto(): boolean {
  const ativo = document.activeElement;
  return ativo === null || ativo === document.body;
}

// O botão do estado que roda ("Revisando", "Postando"): ocupado, com o spinner. Fica focável
// (aria-disabled em vez de disabled), para o foco do clique ter onde ficar.
export function BotaoOcupado({ texto, de, chave }: { texto: string; de: string; chave?: string }) {
  const botao = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const em = chave === undefined ? undefined : focoPendente.get(chave);
    if (em === undefined) return;
    if (Date.now() - em > PRAZO_DO_FOCO_MS) {
      focoPendente.delete(chave as string);
      return;
    }
    if (focoSolto()) botao.current?.focus();
  }, [chave]);
  return (
    <button ref={botao} type="button" className={classes(ui.botao, ui.pequeno, estilos.botaoOcupado)} aria-disabled="true" aria-label={`${texto} ${de}`}>
      <Spinner tamanho="p" />{texto}
    </button>
  );
}

// As pílulas de estado: o ícone, o rótulo e o valor, na cor do tom (que o texto repete).
export function Pilulas({ pilulas }: { pilulas: readonly Pilula[] }) {
  return (
    <ul className={estilos.pilulas} aria-label="Resumo">
      {pilulas.map((p) => (
        <li key={p.rotulo} className={estilos.pilula} data-tom={p.tom}>
          <span className={estilos.iconeDaPilula} aria-hidden="true">{p.icone}</span>
          <span className={estilos.rotuloDaPilula}>{p.rotulo}</span>
          <span className={estilos.valorDaPilula}>{p.texto}</span>
        </li>
      ))}
    </ul>
  );
}

interface PropsDoCartao {
  tom: TomDoCartao;
  chave: string;
  url?: string;
  autor?: string;
  // o ramo de origem e o de destino ("task/BT-1 → develop"), quando a tela tem
  ramo?: string;
  titulo: string;
  contexto: string;
  // os marcadores ao lado do autor (rascunho, parada, em conflito)
  marcas?: ReactNode;
  // o canto de cima à direita: botões, a posição na fila, um selo
  botoes?: ReactNode;
  pilulas?: readonly Pilula[];
  // o que vem antes do cabeçalho (o motivo em destaque, em De fora)
  topo?: ReactNode;
  // a faixa, o rodapé
  children?: ReactNode;
  // o estado em texto, para quem não vê a cor da borda
  estado: string;
  // o cartão dentro de um painel estreito: foto e título um pouco menores
  compacto?: boolean;
  // o nível do título do PR: 3 no Radar (debaixo do título da seção), 4 no Histórico (debaixo do
  // título do dia)
  nivelDoTitulo?: 3 | 4;
}

export function Cartao({ tom, chave, url, autor, ramo, titulo, contexto, marcas, botoes, pilulas, topo, children, estado, compacto, nivelDoTitulo = 3 }: PropsDoCartao) {
  const href = linkDoPr(url);
  const Titulo = nivelDoTitulo === 4 ? 'h4' : 'h3';
  return (
    <article className={estilos.cartao} data-tom={tom} data-compacto={compacto ? 'sim' : undefined} aria-label={`${chave}: ${estado}`}>
      {topo}
      <div className={estilos.cabeca}>
        <Avatar login={autor} pequeno={compacto} />
        <div className={estilos.corpo}>
          <div className={estilos.linhaDaChave}>
            {href ? (
              <a className={estilos.chave} href={href} target="_blank" rel="noreferrer noopener">
                {chave}<span className={ui.soLeitor}> (abre em nova aba)</span>
              </a>
            ) : <span className={estilos.chave}>{chave}</span>}
            {autor ? <span className={estilos.quem}>{autor}</span> : null}
            {ramo ? <span className={estilos.meta}>{ramo}</span> : null}
            {contexto ? <span className={estilos.meta}>{contexto}</span> : null}
            {marcas}
            <span className={ui.soLeitor}>{`, ${estado}`}</span>
          </div>
          <Titulo className={estilos.titulo}>{titulo}</Titulo>
        </div>
        {botoes ? <div className={estilos.botoes}>{botoes}</div> : null}
      </div>
      {pilulas?.length ? <Pilulas pilulas={pilulas} /> : null}
      {children}
    </article>
  );
}

// A barra única da revisão: a porcentagem grande e a barra, com a frase de baixo. Indefinida (sem
// número) enquanto o motor não manda o progresso. A largura é atributo do SVG.
function Barra({ andamento: a, de }: { andamento: Andamento; de: string }) {
  if (!a.barra) return null;
  if (a.barra.tipo === 'definida') {
    return (
      <div className={estilos.percentual}>
        <span className={estilos.numero} aria-hidden="true">{a.barra.pct}%</span>
        <div className={estilos.colunaDaBarra}>
          <span
            className={estilos.barra}
            role="progressbar"
            aria-label={`Progresso da revisão de ${de}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={a.barra.pct}
            aria-valuetext={`${a.barra.pct}%, ${a.barra.texto}`}
          >
            <svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" focusable="false">
              <rect className={estilos.cheio} x={0} y={0} width={a.barra.pct} height={10} />
            </svg>
          </span>
          <span className={estilos.legenda}>{a.barra.texto}</span>
        </div>
      </div>
    );
  }
  return (
    <span className={estilos.barra} data-indefinida="sim" role="progressbar" aria-label={`Andamento de ${de}`} aria-valuetext={a.texto}>
      <i className={estilos.corre} />
    </span>
  );
}

const ESTADO_EM_TEXTO = { feita: 'feita', agora: 'agora', erro: 'parou aqui', falta: 'falta' } as const;

interface PropsDaFaixa {
  andamento: Andamento;
  // como o cartão chama o PR: "PR #12 de dono/repo"
  de: string;
  tempo: string;
  acao?: ReactNode;
}

// O andamento da revisão: a barra única, as cinco etapas como detalhe, e o rodapé com o que a
// sessão faz agora, o tempo e a ação.
export function Faixa({ andamento: a, de, tempo, acao }: PropsDaFaixa) {
  const etapas = etapasDaFaixa(a);
  return (
    <div className={estilos.faixa} role="group" aria-label={`Andamento da revisão de ${de}`}>
      <Barra andamento={a} de={de} />
      <ol className={estilos.etapas} aria-label="Etapas">
        {etapas.map((e) => (
          <li key={e.nome} className={estilos.etapa} data-estado={e.estado} aria-current={e.estado === 'agora' ? 'step' : undefined}>
            <span className={estilos.tracoDaEtapa} aria-hidden="true">
              {e.estado === 'agora' ? <i className={estilos.giro} /> : null}
            </span>
            <span className={estilos.nomeDaEtapa}>
              {e.estado === 'feita' ? <span aria-hidden="true">✓ </span> : null}
              {e.estado === 'erro' ? <span aria-hidden="true">! </span> : null}
              {e.nome}
            </span>
            <span className={ui.soLeitor}>{` (${ESTADO_EM_TEXTO[e.estado]})`}</span>
          </li>
        ))}
      </ol>
      <Rodape tom={a.tom} texto={a.texto} arquivo={a.arquivo} tempo={tempo} apoio={a.apoio} acao={acao} />
    </div>
  );
}

interface PropsDoRodape {
  tom: TomDoCartao | 'ok';
  texto: string;
  // o arquivo da vez, em código
  arquivo?: string;
  // o tempo decorrido (a faixa) e o apoio (o típico, a conta que posta), lado a lado
  tempo?: string;
  apoio?: string;
  acao?: ReactNode;
  // o ponto colorido antes do texto (a fila)
  ponto?: 'ok' | 'aviso' | 'falha';
}

// O rodapé: o texto à esquerda, na cor do estado, e o apoio e a ação à direita.
export function Rodape({ tom, texto, arquivo, tempo, apoio, acao, ponto }: PropsDoRodape) {
  return (
    <div className={estilos.rodape}>
      <span className={estilos.textoDoRodape} data-tom={tom}>
        {ponto ? <span className={estilos.ponto} data-tom={ponto} aria-hidden="true" /> : null}
        <span>
          {texto}
          {arquivo ? <> · agora em <code className={estilos.arquivo}>{arquivo}</code></> : null}
        </span>
      </span>
      {tempo || apoio || acao ? (
        <span className={estilos.ladoDoRodape}>
          {tempo || apoio ? (
            <span className={estilos.tempoEApoio}>
              {tempo ? <span className={estilos.tempo}>{tempo}</span> : null}
              {apoio ? <span className={estilos.apoio}>{apoio}</span> : null}
            </span>
          ) : null}
          {acao}
        </span>
      ) : null}
    </div>
  );
}

// O rodapé da fila, que ainda não começou: o ponto e o que segura o PR, e as ações à direita.
export function FaixaDaFila({ texto, ponto = 'ok', acoes }: { texto: string; ponto?: 'ok' | 'aviso' | 'falha'; acoes?: ReactNode }) {
  return (
    <div className={estilos.faixa}>
      <Rodape tom="fila" texto={texto} ponto={ponto} acao={acoes} />
    </div>
  );
}
