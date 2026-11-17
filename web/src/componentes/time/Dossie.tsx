'use client';

// O dossiê de uma pessoa, aberto na própria página: o que o motor guarda sobre ela. No alto, o
// avatar, o nome e uma linha com o papel e o que o motor sustenta (quantas entradas guarda e o
// dia da mais recente: o motor não manda números por pessoa). Embaixo, uma linha por assunto:
// "O que o Farol observa" aberta (os pontos que o motor anotou nas entradas, de markdown), e
// fechadas, com o resumo na própria linha, a calibração (papel e competência), os números das
// entradas listadas, as últimas revisões e as contestações. Remover a pessoa fica no fim,
// discreto, e pergunta antes.
//
// O foco vai ao título ao abrir, e Escape fecha. Fechar com edição de perfil por salvar
// pergunta antes de descartar (Escape e "Voltar à lista do Time"). O voltar do navegador não
// passa por aqui: ele troca o endereço, e a edição vai embora sem pergunta.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Autor, EntradaDeMemoria, Pessoa, PessoasCruas } from '@/contratos/time';
import { textoDoDesfecho } from '@/historico/rotulos';
import { dataComAno, nomeDoPr } from '@/radar/formato';
import {
  CONTESTACOES_NO_PROMPT, TETO_DE_ENTRADAS, contagemDosDesfechos, dataDaEntrada, desfechoDaEntrada, marcaDoPerfil, markdownDosPontos, nomeDaPessoa, papelCurto,
  prDaEntrada, resumoDaCalibracao, tipoDoDesfecho, type ContestacaoDoAutor, type DesfechoDaEntrada,
} from '@/time/time';
import type { Conexao } from '@/transporte/cliente';
import { Markdown } from '../Markdown';
import type { ControleDeAcoes } from '../radar/useAcoes';
import { Bolinha, Botao, Linha, ui, type Tom } from '../ui';
import { EditorDoPerfil, alvoDaPessoa } from './EditorDoPerfil';
import { Avatar } from './ListaDoTime';
import { RemoverDoTime } from './RemoverDoTime';
import estilos from './Time.module.css';

// carregando: a lista ainda não respondeu. ausente: o motor não tem dossiê nem perfil deste
// login. semLista: a lista falhou e não há carga anterior (o erro, com o Tentar de novo,
// fica no topo da página).
export type LeituraDoDossie =
  | { fase: 'carregando' }
  | { fase: 'pronto'; autor: Autor | undefined; perfil: Pessoa | undefined }
  | { fase: 'ausente' }
  | { fase: 'semLista' };

const TOM_DO_DESFECHO: Record<DesfechoDaEntrada, Tom> = { aprovacao: 'ok', mudancas: 'aviso', comentario: 'neutro', outro: 'neutro' };

const entradas = (n: number): string => (n === 1 ? '1 entrada' : `${n} entradas`);
const pontos = (n: number): string => (n === 1 ? '1 ponto' : `${n} pontos`);

// A frase sob o nome: o papel e o que o motor sustenta, sem número que ele não manda.
function subDoDossie(login: string, autor: Autor | undefined, perfil: Pessoa | undefined): string {
  const partes = [`@${login}`, papelCurto(perfil)];
  if (!autor) partes.push('sem dossiê');
  else if (!autor.entries.length) partes.push('dossiê sem entradas');
  else {
    partes.push(`${entradas(autor.entries.length)} na memória`);
    const dia = dataDaEntrada(autor.entries[0]?.date);
    if (dia) partes.push(`a mais recente em ${dia}`);
  }
  return partes.join(' · ');
}

// O dia, o PR e o que foi publicado, o que houver.
function tituloDaEntrada(entrada: EntradaDeMemoria): string {
  return [dataDaEntrada(entrada.date), prDaEntrada(entrada.ref), desfechoDaEntrada(entrada.verdict)].filter(Boolean).join(', ');
}

function Observa({ login, autor }: { login: string; autor: Autor | undefined }) {
  const comPontos = autor?.entries.filter((e) => e.bullets.length) ?? [];
  const total = comPontos.reduce((soma, e) => soma + e.bullets.length, 0);
  let resumo = 'sem dossiê';
  if (autor) resumo = autor.entries.length ? pontos(total) : 'sem entradas';
  return (
    <Linha aberta rotulo="O que o Farol observa" resumo={<><span className={ui.t}>O que o Farol observa</span><span className={`${ui.r} ${ui.empurra}`}>{resumo}</span></>}>
      {!autor ? <p className={ui.vazio}>O motor não tem dossiê de @{login}: nenhuma revisão de PR desta pessoa ficou registrada na memória.</p> : null}
      {autor && !autor.entries.length ? <p className={ui.vazio}>O dossiê de @{login} existe, mas está sem entradas.</p> : null}
      {autor?.entries.length && !comPontos.length ? <p className={ui.mini}>As revisões guardadas não têm pontos anotados.</p> : null}
      {comPontos.length ? (
        <>
          {/* a ordem é a do motor: a entrada mais recente primeiro */}
          {comPontos.map((entrada, i) => (
            <div key={i} className={estilos.observacao}>
              <h2 className={ui.grupo}>{tituloDaEntrada(entrada) || 'Entrada sem data, PR nem desfecho registrados'}</h2>
              <Markdown texto={markdownDosPontos(entrada.bullets)} nivelBase={3} />
            </div>
          ))}
          <p className={ui.mini}>
            O que o motor anotou em cada revisão resolvida. Ele guarda as {TETO_DE_ENTRADAS} mais recentes, e a sessão lê este dossiê ao revisar um PR novo desta pessoa.
          </p>
        </>
      ) : null}
    </Linha>
  );
}

function Numeros({ autor, contestacoes }: { autor: Autor; contestacoes: number }) {
  const contagem = contagemDosDesfechos(autor.entries);
  const caixas: Array<[string, number]> = [
    ['Entradas guardadas', autor.entries.length],
    ['Aprovações', contagem.aprovacao],
    ['Pedidos de mudança', contagem.mudancas],
    ['Comentários', contagem.comentario],
  ];
  if (contagem.outro) caixas.push(['Outros desfechos', contagem.outro]);
  if (contestacoes) caixas.push(['Contestações', contestacoes]);
  return (
    <Linha rotulo="Números" resumo={<><span className={ui.t}>Números</span><span className={`${ui.r} ${ui.empurra}`}>{entradas(autor.entries.length)} · {contagem.aprovacao === 1 ? '1 aprovação' : `${contagem.aprovacao} aprovações`}</span></>}>
      <dl className={`${ui.grade4} ${estilos.numeros}`}>
        {caixas.map(([nome, valor]) => (
          <div key={nome} className={estilos.numero}>
            <dt>{nome}</dt>
            <dd>{valor}</dd>
          </div>
        ))}
      </dl>
      <p className={ui.mini}>
        Contados nas entradas que o motor guarda (as {TETO_DE_ENTRADAS} mais recentes). O motor não manda números por pessoa: não há total de PRs nem taxa de aprovação.
      </p>
    </Linha>
  );
}

function Ultimas({ autor }: { autor: Autor }) {
  return (
    <Linha rotulo="Últimas revisões" resumo={<><span className={ui.t}>Últimas revisões</span><span className={`${ui.r} ${ui.empurra}`}>{autor.entries.length}</span></>}>
      <ul className={estilos.ultimas}>
        {autor.entries.map((entrada, i) => {
          const desfecho = desfechoDaEntrada(entrada.verdict);
          const texto = [prDaEntrada(entrada.ref) || 'PR não registrado', dataDaEntrada(entrada.date)].filter(Boolean).join(' · ');
          return (
            <li key={i} className={estilos.ultima}>
              <Bolinha tom={TOM_DO_DESFECHO[tipoDoDesfecho(entrada.verdict)]} rotulo={desfecho ? `${desfecho}: ` : 'Sem desfecho registrado: '} />
              <span>{texto}</span>
            </li>
          );
        })}
      </ul>
    </Linha>
  );
}

function Contestacoes({ registros }: { registros: readonly ContestacaoDoAutor[] }) {
  if (!registros.length) return null;
  return (
    <Linha rotulo="Contestações" resumo={<><span className={ui.t}>Contestações</span><span className={`${ui.r} ${ui.empurra}`}>{registros.length}</span></>}>
      <ul className={estilos.ultimas}>
        {registros.map(({ chave, registro }) => {
          const quando = dataComAno(registro.at);
          return (
            <li key={chave}>
              <strong>{nomeDoPr(chave)}:</strong>{' '}
              {registro.status === 'pending' ? 'suspeita do motor, ainda sem confirmação' : textoDoDesfecho(registro.outcome)}
              {quando ? `, em ${quando}` : ''}
              {registro.note ? `. Nota: ${registro.note}` : ''}
            </li>
          );
        })}
      </ul>
      <p className={ui.mini}>
        Só leitura. No prompt das próximas revisões dos PRs desta pessoa entram só as {CONTESTACOES_NO_PROMPT} confirmadas mais recentes; suspeita sem confirmação não entra. O desfecho se confirma ou se apaga no detalhe da revisão, no Histórico.
      </p>
    </Linha>
  );
}

interface Props {
  // o login do endereço
  login: string;
  leitura: LeituraDoDossie;
  // `config.people` do snapshot como o motor mandou
  cru: PessoasCruas | undefined;
  ilegiveis: number;
  conexao: Conexao;
  emDia: boolean;
  contestacoes: readonly ContestacaoDoAutor[];
  controle: ControleDeAcoes;
  // a lista está sendo lida de novo: o que está na tela é da carga anterior
  ocupado: boolean;
  // o erro da carga e o aviso de lista velha, que valem também com o dossiê aberto
  avisos?: ReactNode;
  aoFechar(): void;
}

export function Dossie({ login, leitura, cru, ilegiveis, conexao, emDia, contestacoes, controle, ocupado, avisos, aoFechar }: Props) {
  const titulo = useRef<HTMLHeadingElement>(null);
  const continuar = useRef<HTMLButtonElement>(null);
  // onde o foco estava quando a pergunta de descarte abriu: é para lá que ele volta
  const antesDaPergunta = useRef<HTMLElement | null>(null);
  const idDaPergunta = useId();
  const idDoTextoDaPergunta = useId();
  // há papel ou competência editados e não salvos (quem diz é o editor)
  const [alterado, setAlterado] = useState(false);
  const [perguntando, setPerguntando] = useState(false);
  const pronto = leitura.fase === 'pronto' ? leitura : null;
  // o login como o motor o listou, quando há dossiê: é ele que vai no pedido de remoção
  const doMotor = pronto?.autor ? pronto.autor.login : login;
  // a pergunta só existe com edição por salvar: se o estado do motor igualou o rascunho, some
  const pergunta = perguntando && alterado && pronto !== null;

  useEffect(() => { titulo.current?.focus(); }, []);

  // Fechar o dossiê: direto quando não há edição por salvar, com pergunta quando há.
  const pedirFechar = useCallback(() => {
    if (!alterado || leitura.fase !== 'pronto') {
      aoFechar();
      return;
    }
    antesDaPergunta.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPerguntando(true);
  }, [alterado, leitura.fase, aoFechar]);

  const seguirEditando = useCallback(() => {
    setPerguntando(false);
    (antesDaPergunta.current?.isConnected ? antesDaPergunta.current : titulo.current)?.focus();
  }, []);

  useEffect(() => {
    if (pergunta) continuar.current?.focus();
  }, [pergunta]);

  // Escape fecha de qualquer lugar da página, menos de dentro de um campo de texto ou de um
  // seletor: ali Escape é do campo. Com a pergunta de descarte aberta, Escape é "continuar
  // editando". A pergunta de remoção trata o próprio Escape e não deixa o evento chegar aqui.
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape' || evento.defaultPrevented) return;
      if (pergunta) {
        seguirEditando();
        return;
      }
      const alvo = evento.target;
      if (alvo instanceof HTMLElement && (alvo.isContentEditable || alvo.matches('input, textarea, select'))) return;
      pedirFechar();
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [pergunta, pedirFechar, seguirEditando]);

  const nome = nomeDaPessoa(doMotor, pronto?.autor);

  return (
    <section
      className={`${ui.pagina} ${ui.paginaEstreita} ${estilos.dossie}${ocupado ? ` ${ui.apagada}` : ''}`}
      aria-label={`Dossiê de @${doMotor}`}
      aria-busy={ocupado}
    >
      <button type="button" className={`${ui.link} ${estilos.voltar}`} onClick={pedirFechar} aria-label="Voltar à lista do Time">
        <span aria-hidden="true">←</span> Time
      </button>

      <div className={estilos.cabecalho}>
        {pronto ? <Avatar nome={nome} grande /> : <span className={`${ui.esqueleto} ${estilos.avatarEsqueleto}`} aria-hidden="true" />}
        <div className={estilos.cabecalhoTexto}>
          <h1 ref={titulo} className={`${ui.titulo} ${ui.tituloMenor}`} tabIndex={-1}>{pronto ? nome : `@${login}`}</h1>
          {pronto ? <p className={ui.sub}>{subDoDossie(doMotor, pronto.autor, pronto.perfil)}</p> : null}
        </div>
      </div>

      {avisos}

      {pergunta ? (
        <div className={`${ui.nota} ${estilos.pergunta}`} role="group" aria-labelledby={idDaPergunta} aria-describedby={idDoTextoDaPergunta}>
          <p id={idDaPergunta} className={estilos.tituloDaPergunta}>Descartar a edição do perfil de @{doMotor}?</p>
          <p id={idDoTextoDaPergunta} className={ui.texto}>
            O papel e a competência que você alterou não foram salvos. Voltar à lista descarta a edição: nada foi enviado ao motor, e o perfil dele continua como está.
          </p>
          <div className={ui.fila}>
            <button ref={continuar} type="button" className={ui.botao} onClick={seguirEditando}>Continuar editando</button>
            <Botao primario aria-label={`Descartar a edição do perfil de @${doMotor} e voltar à lista`} onClick={aoFechar}>
              Descartar e voltar à lista
            </Botao>
          </div>
        </div>
      ) : null}

      {leitura.fase === 'carregando' ? (
        <div className={estilos.esqueletoDoDossie} aria-busy="true">
          <p className={ui.mini} role="status">Carregando o dossiê.</p>
          <div className={ui.grade4} aria-hidden="true">
            {[0, 1, 2, 3].map((i) => <span key={i} className={`${ui.esqueleto} ${estilos.blocoEsqueleto}`} />)}
          </div>
        </div>
      ) : null}
      {leitura.fase === 'semLista' ? <p className={ui.nota} role="status">Sem a lista do Time não dá para mostrar o dossiê de @{login}. O erro e o Tentar de novo estão no topo da página.</p> : null}
      {leitura.fase === 'ausente' ? (
        <p className={ui.nota} role="status">
          O motor não tem dossiê nem perfil de @{login}. Se a pessoa acabou de ser removida do Time, é o esperado: a remoção apaga o dossiê, o perfil e as contestações. As revisões dos PRs dela continuam no Histórico e no log do motor.
        </p>
      ) : null}

      {pronto ? (
        <>
          <div className={ui.lista}>
            <Observa login={doMotor} autor={pronto.autor} />
            <Linha
              rotulo="Como revisar os PRs desta pessoa"
              resumo={<><span className={ui.t}>Como revisar os PRs desta pessoa</span><span className={`${ui.r} ${ui.empurra}`}>{resumoDaCalibracao(pronto.perfil)}</span></>}
            >
              <EditorDoPerfil login={doMotor} perfil={pronto.perfil} cru={cru} ilegiveis={ilegiveis} conexao={conexao} emDia={emDia} controle={controle} aoMudar={setAlterado} />
            </Linha>
            {pronto.autor?.entries.length ? <Numeros autor={pronto.autor} contestacoes={contestacoes.length} /> : null}
            {pronto.autor?.entries.length ? <Ultimas autor={pronto.autor} /> : null}
            <Contestacoes registros={contestacoes} />
          </div>

          <RemoverDoTime
            controle={controle}
            acao={{
              tipo: 'removerAutor',
              alvo: alvoDaPessoa(doMotor),
              nome: `@${doMotor}`,
              login: doMotor,
              entradas: pronto.autor?.entries.length ?? 0,
              temPerfil: marcaDoPerfil(pronto.perfil) !== '',
              contestacoes: contestacoes.length,
            }}
          />
        </>
      ) : null}
    </section>
  );
}
