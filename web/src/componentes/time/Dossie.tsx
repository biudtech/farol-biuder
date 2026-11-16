'use client';

// O dossiê de uma pessoa, aberto na própria página: o que o motor guarda sobre ela. As
// entradas de memória vêm de GET /api/team, uma a uma, com o dia, o PR e o que foi publicado
// quando o motor diz; o perfil vem de `config.people`, e as contestações, de `pushbacks`. O
// foco vai ao título ao abrir, e Escape fecha. As ações são duas: salvar papel e competência
// e remover a pessoa do Time, que apaga o dossiê, o perfil e as contestações e pergunta antes.
//
// Fechar com edição de perfil por salvar pergunta antes de descartar (Escape e "Voltar à
// lista"). O voltar do navegador não passa por aqui: ele troca o endereço, e a edição vai
// embora sem pergunta.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Autor, Pessoa, PessoasCruas } from '@/contratos/time';
import { textoDoDesfecho } from '@/historico/rotulos';
import { dataComAno, nomeDoPr } from '@/radar/formato';
import {
  CONTESTACOES_NO_PROMPT, TETO_DE_ENTRADAS, dataDaEntrada, desfechoDaEntrada, marcaDoPerfil, markdownDosPontos, prDaEntrada, textoDaCompetencia, textoDoPapel,
  type ContestacaoDoAutor,
} from '@/time/time';
import type { Conexao } from '@/transporte/cliente';
import { Markdown } from '../Markdown';
import { AcoesDoItem } from '../radar/AcoesDoItem';
import type { ControleDeAcoes } from '../radar/useAcoes';
import comuns from '../radar/Radar.module.css';
import { EditorDoPerfil, alvoDaPessoa } from './EditorDoPerfil';
import { Campo } from './ListaDoTime';
import estilos from './Time.module.css';

// carregando: a lista ainda não respondeu. ausente: o motor não tem dossiê nem perfil deste
// login. semLista: a lista falhou e não há carga anterior (o erro, com o Tentar de novo,
// fica no topo da página).
export type LeituraDoDossie =
  | { fase: 'carregando' }
  | { fase: 'pronto'; autor: Autor | undefined; perfil: Pessoa | undefined }
  | { fase: 'ausente' }
  | { fase: 'semLista' };

function Memoria({ login, autor }: { login: string; autor: Autor | undefined }) {
  const id = useId();
  return (
    <section className={estilos.secao} aria-labelledby={id}>
      <h3 id={id} className={estilos.tituloDaSecao}>Memória de revisões</h3>
      {!autor ? <p className={comuns.vazio}>O motor não tem dossiê de @{login}: nenhuma revisão de PR desta pessoa ficou registrada na memória.</p> : null}
      {autor && !autor.entries.length ? <p className={comuns.vazio}>O dossiê de @{login} existe, mas está sem entradas.</p> : null}
      {autor?.entries.length ? (
        <>
          <p className={comuns.meta}>
            Uma entrada por revisão resolvida, a mais recente primeiro, com o que o motor anotou sobre o trabalho. Ele guarda as {TETO_DE_ENTRADAS} mais recentes, e o protocolo da sessão de revisão manda ler este dossiê ao revisar um PR novo desta pessoa.
          </p>
          <ol className={estilos.entradas}>
            {autor.entries.map((entrada, i) => {
              const titulo = [dataDaEntrada(entrada.date), prDaEntrada(entrada.ref), desfechoDaEntrada(entrada.verdict)].filter(Boolean).join(', ');
              return (
                <li key={i} className={estilos.entrada}>
                  <h4 className={estilos.tituloDaEntrada}>{titulo || 'Entrada sem data, PR nem desfecho registrados'}</h4>
                  {entrada.bullets.length
                    ? <Markdown texto={markdownDosPontos(entrada.bullets)} nivelBase={5} />
                    : <p className={comuns.meta}>Sem pontos anotados nesta revisão.</p>}
                </li>
              );
            })}
          </ol>
        </>
      ) : null}
    </section>
  );
}

function Contestacoes({ registros }: { registros: readonly ContestacaoDoAutor[] }) {
  const id = useId();
  if (!registros.length) return null;
  return (
    <section className={estilos.secao} aria-labelledby={id}>
      <h3 id={id} className={estilos.tituloDaSecao}>Contestações registradas</h3>
      <p className={comuns.meta}>
        O que o motor guarda de quando esta pessoa contestou uma revisão. No prompt das próximas revisões dos PRs dela entram só as {CONTESTACOES_NO_PROMPT} confirmadas mais recentes; suspeita sem confirmação não entra. O desfecho se confirma ou se apaga no detalhe da revisão, no Histórico.
      </p>
      <ul className={comuns.motivos}>
        {registros.map(({ chave, registro }) => {
          const quando = dataComAno(registro.at);
          return (
            <li key={chave}>
              <span className={comuns.tipoDoMotivo}>{nomeDoPr(chave)}:</span>{' '}
              {registro.status === 'pending' ? 'suspeita do motor, ainda sem confirmação' : textoDoDesfecho(registro.outcome)}
              {quando ? `, em ${quando}` : ''}
              {registro.note ? `. Nota: ${registro.note}` : ''}
            </li>
          );
        })}
      </ul>
    </section>
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
  aoFechar(): void;
}

export function Dossie({ login, leitura, cru, ilegiveis, conexao, emDia, contestacoes, controle, ocupado, aoFechar }: Props) {
  const titulo = useRef<HTMLHeadingElement>(null);
  const continuar = useRef<HTMLButtonElement>(null);
  // onde o foco estava quando a pergunta de descarte abriu: é para lá que ele volta
  const antesDaPergunta = useRef<HTMLElement | null>(null);
  const idDoTitulo = useId();
  const idDoPerfil = useId();
  const idDaRemocao = useId();
  const idDaPergunta = useId();
  const idDoTextoDaPergunta = useId();
  // há papel ou competência editados e não salvos (quem diz é o editor)
  const [alterado, setAlterado] = useState(false);
  const [perguntando, setPerguntando] = useState(false);
  // o login como o motor o listou, quando há dossiê: é ele que vai no pedido de remoção
  const doMotor = leitura.fase === 'pronto' && leitura.autor ? leitura.autor.login : login;
  // a pergunta só existe com edição por salvar: se o estado do motor igualou o rascunho, some
  const pergunta = perguntando && alterado && leitura.fase === 'pronto';

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
  // editando". A pergunta de confirmação de uma ação trata o próprio Escape e não deixa o
  // evento chegar aqui.
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

  return (
    <section className={estilos.dossie} aria-labelledby={idDoTitulo} aria-busy={ocupado} data-esmaecida={ocupado ? '' : undefined}>
      <div className={estilos.topoDoDossie}>
        <h2 id={idDoTitulo} ref={titulo} className={estilos.tituloDoDossie} tabIndex={-1}>Dossiê de @{doMotor}</h2>
        <button type="button" className={comuns.botao} onClick={pedirFechar}>Voltar à lista</button>
      </div>

      {pergunta ? (
        <div className={comuns.confirmacao} role="group" aria-labelledby={idDaPergunta} aria-describedby={idDoTextoDaPergunta}>
          <p id={idDaPergunta} className={comuns.confirmacaoTitulo}>Descartar a edição do perfil de @{doMotor}?</p>
          <p id={idDoTextoDaPergunta}>
            O papel e a competência que você alterou não foram salvos. Voltar à lista descarta a edição: nada foi enviado ao motor, e o perfil dele continua como está.
          </p>
          <div className={comuns.botoes}>
            <button ref={continuar} type="button" className={comuns.botao} onClick={seguirEditando}>Continuar editando</button>
            <button type="button" className={`${comuns.botao} ${comuns.primario}`} aria-label={`Descartar a edição do perfil de @${doMotor} e voltar à lista`} onClick={aoFechar}>
              Descartar e voltar à lista
            </button>
          </div>
        </div>
      ) : null}

      {leitura.fase === 'carregando' ? <p className={comuns.vazio} role="status">Carregando o dossiê.</p> : null}
      {leitura.fase === 'semLista' ? <p className={comuns.nota} role="status">Sem a lista do Time não dá para mostrar o dossiê de @{login}. O erro e o Tentar de novo estão no topo da página.</p> : null}
      {leitura.fase === 'ausente' ? (
        <p className={comuns.nota} role="status">
          O motor não tem dossiê nem perfil de @{login}. Se a pessoa acabou de ser removida do Time, é o esperado: a remoção apaga o dossiê, o perfil e as contestações. As revisões dos PRs dela continuam no Histórico e no log do motor.
        </p>
      ) : null}

      {leitura.fase === 'pronto' ? (
        <>
          <dl className={estilos.campos}>
            {leitura.autor?.name ? <Campo nome="Nome">{leitura.autor.name}</Campo> : null}
            <Campo nome="Login no GitHub">{doMotor}</Campo>
            <Campo nome="Entradas de memória">{leitura.autor?.entries.length ? String(leitura.autor.entries.length) : 'Nenhuma'}</Campo>
            <Campo nome="Papel">{textoDoPapel(leitura.perfil)}</Campo>
            <Campo nome="Competência">{textoDaCompetencia(leitura.perfil)}</Campo>
          </dl>

          <section className={estilos.secao} aria-labelledby={idDoPerfil}>
            <h3 id={idDoPerfil} className={estilos.tituloDaSecao}>Papel e competência</h3>
            <EditorDoPerfil login={doMotor} perfil={leitura.perfil} cru={cru} ilegiveis={ilegiveis} conexao={conexao} emDia={emDia} controle={controle} aoMudar={setAlterado} />
          </section>

          <Memoria login={doMotor} autor={leitura.autor} />
          <Contestacoes registros={contestacoes} />

          <section className={estilos.secao} aria-labelledby={idDaRemocao}>
            <h3 id={idDaRemocao} className={estilos.tituloDaSecao}>Remover do Time</h3>
            <p className={comuns.meta}>
              Apaga do motor três coisas desta pessoa, de uma vez e sem volta: o dossiê, o papel e a competência, e as contestações. O motor não apaga uma entrada só. As revisões dos PRs dela continuam no Histórico e no log do motor, e nada muda no GitHub.
            </p>
            <AcoesDoItem
              botoes={[{
                acao: {
                  tipo: 'removerAutor',
                  alvo: alvoDaPessoa(doMotor),
                  nome: `@${doMotor}`,
                  login: doMotor,
                  entradas: leitura.autor?.entries.length ?? 0,
                  temPerfil: marcaDoPerfil(leitura.perfil) !== '',
                  contestacoes: contestacoes.length,
                },
              }]}
              controle={controle}
            />
          </section>
        </>
      ) : null}
    </section>
  );
}
