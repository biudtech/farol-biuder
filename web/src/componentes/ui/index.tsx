// As peças comuns das telas no desenho enxuto (o canvas aprovado pelo dono, 17/11/2026):
// uma linha por item, o detalhe sob demanda, estado por bolinha e chip com texto e um
// carregamento próprio para cada processo. Estilo só por classe: a CSP de produção recusa o
// atributo style (src/proxy.ts).
import type { ReactNode, SyntheticEvent } from 'react';
import estilos from './ui.module.css';

export { estilos as ui };

export type Tom = 'ok' | 'aviso' | 'ruim' | 'neutro' | 'marca';

function classes(...nomes: Array<string | false | undefined | null>): string {
  return nomes.filter(Boolean).join(' ');
}

// ---------- página ----------

interface PropsDaPagina {
  titulo: ReactNode;
  sub?: ReactNode;
  acoes?: ReactNode;
  estreita?: boolean;
  tituloMenor?: boolean;
  // id do h1, para quem leva o foco ao título
  idDoTitulo?: string;
  children: ReactNode;
}

// O título da tela, a frase de resumo logo abaixo e as ações à direita.
export function Pagina({ titulo, sub, acoes, estreita, tituloMenor, idDoTitulo, children }: PropsDaPagina) {
  return (
    <div className={classes(estilos.pagina, estreita && estilos.paginaEstreita)}>
      <div className={estilos.cabecalho}>
        <div className={estilos.cabecalhoTexto}>
          <h1 className={classes(estilos.titulo, tituloMenor && estilos.tituloMenor)} id={idDoTitulo} tabIndex={idDoTitulo ? -1 : undefined}>{titulo}</h1>
          {sub ? <p className={estilos.sub}>{sub}</p> : null}
        </div>
        {acoes ? <div className={estilos.cabecalhoAcoes}>{acoes}</div> : null}
      </div>
      {children}
    </div>
  );
}

// O nível de um título de seção. O padrão é 2 (a seção da página); dentro de um cartão, o título
// fica abaixo do título do cartão.
export type NivelDoTitulo = 2 | 3 | 4 | 5 | 6;

export function TituloDeNivel({ nivel, className, id, children }: { nivel: NivelDoTitulo; className?: string; id?: string; children: ReactNode }) {
  const Titulo = `h${nivel}` as const;
  return <Titulo id={id} className={className}>{children}</Titulo>;
}

interface PropsDaSecao {
  titulo: string;
  nivel?: NivelDoTitulo;
  // o que fica à direita do título (um link, uma pílula)
  extra?: ReactNode;
  // a contagem logo depois do título, numa pílula (a marca, na seção que roda agora)
  contagem?: { n: number; tom?: 'marca'; rotulo: string };
  children: ReactNode;
  rotulo?: string;
}

export function Secao({ titulo, nivel = 2, extra, contagem, children, rotulo }: PropsDaSecao) {
  return (
    <section className={estilos.secao} aria-label={rotulo ?? titulo}>
      <div className={estilos.secaoCabecalho}>
        <div className={estilos.secaoTituloEContagem}>
          <TituloDeNivel nivel={nivel} className={estilos.secaoTitulo}>{titulo}</TituloDeNivel>
          {contagem ? (
            <span className={estilos.secaoContagem} data-tom={contagem.tom}>
              {contagem.n}<span className={estilos.soLeitor}> {contagem.rotulo}</span>
            </span>
          ) : null}
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}

// ---------- a linha que abre ----------

interface PropsDaLinha {
  // o que aparece fechado: só texto e marcação de frase (nada clicável dentro)
  resumo: ReactNode;
  children: ReactNode;
  aberta?: boolean;
  aoAlternar?: (aberta: boolean) => void;
  className?: string;
  rotulo?: string;
  // para quem precisa abrir a linha de fora (o "Ver o review postado" do Histórico)
  id?: string;
}

// Uma linha por item e o detalhe num clique. É o <details> do navegador: o teclado (Enter e
// espaço no resumo) e o leitor de tela (expandido ou recolhido) vêm de graça, e nada some da
// árvore quando fecha. `aberta` é só o estado inicial.
export function Linha({ resumo, children, aberta, aoAlternar, className, rotulo, id }: PropsDaLinha) {
  const alternar = aoAlternar
    ? (evento: SyntheticEvent<HTMLDetailsElement>) => aoAlternar(evento.currentTarget.open)
    : undefined;
  return (
    <details id={id} className={classes(estilos.linha, className)} open={aberta} onToggle={alternar} aria-label={rotulo}>
      <summary className={estilos.resumo}>{resumo}</summary>
      <div className={estilos.corpo}>{children}</div>
    </details>
  );
}

// ---------- estado ----------

// A bolinha é decorativa: o estado vai escrito ao lado, ou no texto escondido.
export function Bolinha({ tom, rotulo }: { tom: Tom; rotulo?: string }) {
  return (
    <>
      <span className={estilos.bolinha} data-tom={tom} aria-hidden="true" />
      {rotulo ? <span className={estilos.soLeitor}>{rotulo}</span> : null}
    </>
  );
}

export function Chip({ tom = 'neutro', pequeno, children }: { tom?: Tom; pequeno?: boolean; children: ReactNode }) {
  return <span className={classes(estilos.chip, pequeno && estilos.chipPequeno)} data-tom={tom}>{children}</span>;
}

// ---------- carregamento ----------

export type TamanhoDoSpinner = 'p' | 'm' | 'g';

// Pequeno dentro de chip e botão, médio em bloco, grande em página. Com rótulo vira região
// de status; sem rótulo é decorativo (o texto ao lado diz o que acontece).
export function Spinner({ tamanho = 'm', rotulo }: { tamanho?: TamanhoDoSpinner; rotulo?: string }) {
  if (rotulo) return <span className={estilos.spinner} data-tamanho={tamanho} role="status" aria-label={rotulo} />;
  return <span className={estilos.spinner} data-tamanho={tamanho} aria-hidden="true" />;
}

// A página que ainda não tem nada: blocos no lugar do conteúdo, e a frase para o leitor.
export function Esqueleto({ texto, linhas = 4, bloco }: { texto: string; linhas?: number; bloco?: boolean }) {
  return (
    <div className={estilos.esqueletos} aria-busy="true">
      <p className={estilos.mini} role="status">{texto}</p>
      {bloco ? <span className={classes(estilos.esqueleto, estilos.esqueletoBloco)} aria-hidden="true" /> : null}
      {Array.from({ length: linhas }, (_, i) => (
        <span key={i} className={classes(estilos.esqueleto, estilos.esqueletoLinha)} aria-hidden="true" />
      ))}
    </div>
  );
}

// A barra sem fim do topo da lista: troca de filtro ou de página, com a lista anterior apagada.
export function BarraDeCarga({ rotulo }: { rotulo: string }) {
  return (
    <div className={estilos.barra} role="progressbar" aria-label={rotulo} aria-busy="true">
      <i />
    </div>
  );
}

interface PropsDoBotao {
  children: ReactNode;
  // o que o botão diz enquanto a ação está no ar ("Salvando…"); com ele, o botão fica desabilitado
  ocupado?: string | false;
  primario?: boolean;
  fantasma?: boolean;
  pequeno?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  onClick?: () => void;
  className?: string;
  'aria-describedby'?: string;
  'aria-label'?: string;
}

// O botão do Farol. Com `ocupado`, mostra o spinner pequeno e o texto do processo.
export function Botao({ children, ocupado, primario, fantasma, pequeno, disabled, type = 'button', onClick, className, ...aria }: PropsDoBotao) {
  return (
    <button
      type={type}
      className={classes(estilos.botao, primario && estilos.primario, fantasma && estilos.fantasma, pequeno && estilos.pequeno, className)}
      disabled={disabled || Boolean(ocupado)}
      onClick={onClick}
      {...aria}
    >
      {ocupado ? <><Spinner tamanho="p" />{ocupado}</> : children}
    </button>
  );
}
