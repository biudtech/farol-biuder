'use client';

// As peças do cartão de um PR no Radar, no molde do cartão da autoanálise do Farol: a casca com a
// borda pela cor do estado, o cabeçalho (avatar, chave, autor, título e contexto), os botões, as
// três pílulas e a faixa (etapas, tempo, ação, trilho e rodapé). O que cada peça diz vem pronto
// de src/radar/cartao.ts. Sem estilo em linha: a CSP recusa, e a largura do trilho vai como
// atributo do SVG.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Spinner, ui } from '@/componentes/ui';
import { etapasDaFaixa, iniciais, urlDoAvatar, type Andamento, type Pilula, type TomDoCartao } from '@/radar/cartao';
import { linkDoPr } from '@/radar/formato';
import estilos from './Radar.module.css';

function classes(...nomes: Array<string | false | undefined>): string {
  return nomes.filter(Boolean).join(' ');
}

// O relógio de 1 s. Quem o chama redesenha a cada segundo: por isso ele mora só nos componentes
// do tempo e da faixa (FaixaDaSessao, FaixaIniciando), e o cabeçalho, o avatar e as pílulas do
// cartão ficam de fora.
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
export function Avatar({ login }: { login: string | undefined }) {
  const url = urlDoAvatar(login);
  const [falhou, setFalhou] = useState<string | null>(null);
  if (!url || falhou === url) return <span className={estilos.avatar} aria-hidden="true">{iniciais(login)}</span>;
  return (
    // A foto vem do GitHub, fora do otimizador do Next (que o servidor de socket não serve); a
    // origem está no img-src da CSP.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={estilos.avatar}
      src={url}
      alt=""
      width={36}
      height={36}
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

interface PropsDoCartao {
  tom: TomDoCartao;
  chave: string;
  url?: string;
  autor?: string;
  titulo: string;
  contexto: string;
  // os marcadores ao lado do autor (rascunho, parada, em conflito)
  marcas?: ReactNode;
  botoes: ReactNode;
  pilulas?: readonly Pilula[];
  // a faixa ou o rodapé
  children?: ReactNode;
  // o estado em texto, para quem não vê a cor da borda
  estado: string;
}

export function Cartao({ tom, chave, url, autor, titulo, contexto, marcas, botoes, pilulas, children, estado }: PropsDoCartao) {
  const href = linkDoPr(url);
  return (
    <article className={estilos.cartaoDoPr} data-tom={tom} aria-label={`${chave}: ${estado}`}>
      <div className={estilos.cabecaDoCartao}>
        <Avatar login={autor} />
        <div className={estilos.corpoDoCartao}>
          <div className={estilos.linhaDaChave}>
            {href ? (
              <a className={estilos.chaveDoPr} href={href} target="_blank" rel="noreferrer noopener">
                {chave}<span className={ui.soLeitor}> (abre em nova aba)</span>
              </a>
            ) : <span className={estilos.chaveDoPr}>{chave}</span>}
            {autor ? <span className={estilos.quem}>{autor}</span> : null}
            {marcas}
            <span className={ui.soLeitor}>{`, ${estado}`}</span>
          </div>
          <h3 className={estilos.tituloDoPr}>{titulo}</h3>
          {contexto ? <p className={estilos.contexto}>{contexto}</p> : null}
        </div>
        <div className={estilos.botoesDoCartao}>{botoes}</div>
      </div>
      {pilulas?.length ? (
        <ul className={estilos.pilulas} aria-label="Resumo">
          {pilulas.map((p) => (
            <li key={p.rotulo} className={estilos.pilula} data-tom={p.tom}>
              <span className={estilos.iconeDaPilula} aria-hidden="true">{p.icone}</span>
              <span className={estilos.textoDaPilula}>
                <span className={estilos.rotuloDaPilula}>{p.rotulo}</span>
                <span className={estilos.valorDaPilula}>{p.texto}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {children}
    </article>
  );
}

function Trilho({ andamento: a, de }: { andamento: Andamento; de: string }) {
  if (!a.barra) return null;
  if (a.barra.tipo === 'definida') {
    return (
      <span
        className={estilos.trilho}
        role="progressbar"
        aria-label={`Leitura dos arquivos de ${de}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={a.barra.pct}
        aria-valuetext={`${a.barra.pct}%, ${a.barra.texto}`}
      >
        <svg viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <rect className={estilos.cheio} x={0} y={0} width={a.barra.pct} height={4} rx={2} />
        </svg>
      </span>
    );
  }
  return (
    <span className={estilos.trilho} role="progressbar" aria-label={`Andamento de ${de}`} aria-valuetext={a.texto}>
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

export function Faixa({ andamento: a, de, tempo, acao }: PropsDaFaixa) {
  const etapas = etapasDaFaixa(a);
  return (
    <div className={estilos.faixa} role="group" aria-label={`Andamento da revisão de ${de}`}>
      <div className={estilos.topoDaFaixa}>
        <ol className={estilos.etapasDaFaixa} aria-label="Etapas">
          {etapas.map((e) => (
            <li key={e.nome} className={estilos.etapaDaFaixa} data-estado={e.estado} aria-current={e.estado === 'agora' ? 'step' : undefined}>
              {e.nome !== etapas[0]?.nome ? <span className={estilos.liga} data-feita={e.ligaFeita} aria-hidden="true" /> : null}
              <span className={estilos.marcador} aria-hidden="true">
                {e.estado === 'agora' ? <span className={estilos.giro} /> : null}
                {e.estado === 'feita' ? '✓' : null}
                {e.estado === 'erro' ? '!' : null}
              </span>
              {e.nome}
              <span className={ui.soLeitor}>{` (${ESTADO_EM_TEXTO[e.estado]})`}</span>
            </li>
          ))}
        </ol>
        <div className={estilos.ladoDaFaixa}>
          {tempo ? <span className={estilos.tempo}>{tempo}</span> : null}
          {acao}
        </div>
      </div>
      <Trilho andamento={a} de={de} />
      <Rodape tom={a.tom} texto={a.texto} apoio={a.apoio} semTrilho={!a.barra} />
    </div>
  );
}

// O rodapé: o texto à esquerda, na cor do estado, e o apoio à direita.
export function Rodape({ tom, texto, apoio, semTrilho }: { tom: TomDoCartao; texto: string; apoio: string; semTrilho?: boolean }) {
  return (
    <div className={estilos.rodapeDaFaixa} data-sem-trilho={semTrilho ? 'sim' : undefined}>
      <span className={estilos.textoDaFaixa} data-tom={tom}>{texto}</span>
      {apoio ? <span className={estilos.apoio}>{apoio}</span> : null}
    </div>
  );
}

// A faixa só com o rodapé: a fila, que ainda não começou.
export function FaixaDaFila({ texto, apoio }: { texto: string; apoio: string }) {
  return (
    <div className={estilos.faixa}>
      <Rodape tom="fila" texto={texto} apoio={apoio} semTrilho />
    </div>
  );
}
