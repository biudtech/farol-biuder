'use client';

// O dossiê de uma pessoa, aberto na própria página: o que o motor guarda sobre ela. As
// entradas de memória vêm de GET /api/team, uma a uma, com o dia, o PR e o que foi publicado
// quando o motor diz; o perfil vem de `config.people`, e as contestações, de `pushbacks`. O
// foco vai ao título ao abrir, e Escape fecha. As ações são duas: salvar papel e competência
// e remover a pessoa do Time, que apaga tudo e pergunta antes.
import { useEffect, useId, useRef } from 'react';
import type { Autor, Pessoa, Pessoas } from '@/contratos/time';
import { textoDoDesfecho } from '@/historico/rotulos';
import { dataComAno, nomeDoPr } from '@/radar/formato';
import {
  TETO_DE_ENTRADAS, chaveDaPessoa, dataDaEntrada, desfechoDaEntrada, marcaDoPerfil, markdownDosPontos, prDaEntrada, textoDaCompetencia, textoDoPapel,
  type ContestacaoDoAutor,
} from '@/time/time';
import type { Conexao } from '@/transporte/cliente';
import { Markdown } from '../Markdown';
import { AcoesDoItem } from '../radar/AcoesDoItem';
import type { ControleDeAcoes } from '../radar/useAcoes';
import comuns from '../radar/Radar.module.css';
import { EditorDoPerfil } from './EditorDoPerfil';
import { Campo } from './ListaDoTime';
import estilos from './Time.module.css';

// carregando: a lista ainda não respondeu. ausente: o motor não tem dossiê nem perfil deste
// login. erro: a lista falhou e não há carga anterior.
export type LeituraDoDossie =
  | { fase: 'carregando' }
  | { fase: 'pronto'; autor: Autor | undefined; perfil: Pessoa | undefined }
  | { fase: 'ausente' }
  | { fase: 'erro'; texto: string };

function Memoria({ login, autor }: { login: string; autor: Autor | undefined }) {
  const id = useId();
  return (
    <section className={estilos.secao} aria-labelledby={id}>
      <h3 id={id} className={estilos.tituloDaSecao}>Memória de revisões</h3>
      {!autor ? <p className={comuns.vazio}>O motor não tem dossiê de @{login}: nenhuma revisão de PR desta pessoa ficou registrada.</p> : null}
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
        O que o motor guarda de quando esta pessoa contestou uma revisão. As confirmadas entram no prompt das próximas revisões dos PRs dela. O desfecho se confirma ou se apaga no detalhe da revisão, no Histórico.
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
  pessoas: Pessoas | undefined;
  ilegiveis: number;
  conexao: Conexao;
  contestacoes: readonly ContestacaoDoAutor[];
  controle: ControleDeAcoes;
  // a lista está sendo lida de novo: o que está na tela é da carga anterior
  ocupado: boolean;
  aoFechar(): void;
  aoTentarDeNovo(): void;
}

export function Dossie({ login, leitura, pessoas, ilegiveis, conexao, contestacoes, controle, ocupado, aoFechar, aoTentarDeNovo }: Props) {
  const titulo = useRef<HTMLHeadingElement>(null);
  const idDoTitulo = useId();
  const idDoPerfil = useId();
  const idDaRemocao = useId();
  // o login como o motor o listou, quando há dossiê: é ele que vai no pedido de remoção
  const doMotor = leitura.fase === 'pronto' && leitura.autor ? leitura.autor.login : login;

  useEffect(() => { titulo.current?.focus(); }, []);

  // Escape fecha de qualquer lugar da página, menos de dentro de um campo de texto ou de um
  // seletor: ali Escape é do campo. A pergunta de confirmação trata o próprio Escape e não
  // deixa o evento chegar aqui.
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape' || evento.defaultPrevented) return;
      const alvo = evento.target;
      if (alvo instanceof HTMLElement && (alvo.isContentEditable || alvo.matches('input, textarea, select'))) return;
      aoFechar();
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [aoFechar]);

  return (
    <section className={estilos.dossie} aria-labelledby={idDoTitulo} aria-busy={ocupado} data-esmaecida={ocupado ? '' : undefined}>
      <div className={estilos.topoDoDossie}>
        <h2 id={idDoTitulo} ref={titulo} className={estilos.tituloDoDossie} tabIndex={-1}>Dossiê de @{doMotor}</h2>
        <button type="button" className={comuns.botao} onClick={aoFechar}>Voltar à lista</button>
      </div>

      {leitura.fase === 'carregando' ? <p className={comuns.vazio} role="status">Carregando o dossiê.</p> : null}
      {leitura.fase === 'ausente' ? (
        <p className={comuns.nota} role="status">
          O motor não tem dossiê nem perfil de @{login}. Se a pessoa acabou de ser removida, é isso mesmo: não sobrou nada. Volte à lista.
        </p>
      ) : null}
      {leitura.fase === 'erro' ? (
        <div className={estilos.erro} role="alert">
          <p><strong>Erro:</strong> {leitura.texto}</p>
          <button type="button" className={comuns.botao} onClick={aoTentarDeNovo}>Tentar de novo</button>
        </div>
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
            <EditorDoPerfil login={doMotor} perfil={leitura.perfil} pessoas={pessoas} ilegiveis={ilegiveis} conexao={conexao} controle={controle} />
          </section>

          <Memoria login={doMotor} autor={leitura.autor} />
          <Contestacoes registros={contestacoes} />

          <section className={estilos.secao} aria-labelledby={idDaRemocao}>
            <h3 id={idDaRemocao} className={estilos.tituloDaSecao}>Remover do Time</h3>
            <p className={comuns.meta}>
              Apaga do motor o dossiê, o papel e a competência e as contestações desta pessoa, de uma vez e sem volta. O motor não apaga uma entrada só. Nada muda no GitHub.
            </p>
            <AcoesDoItem
              botoes={[{
                acao: {
                  tipo: 'removerAutor',
                  alvo: `time:${chaveDaPessoa(doMotor)}`,
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
