'use client';

// O detalhe de uma revisão, aberto na própria página, no desenho enxuto: o PR, o título, o
// chip do que foi publicado e a hora; a frase da avaliação técnica; os achados, uma linha por
// motivo, com o bloqueio aberto e o resto fechado; e "Mais detalhes" (critérios do card, checks,
// execução, rodadas, etapas e o review completo), tudo fechado, cada um com o resumo na própria linha. O foco vai
// ao título ao abrir, e Escape fecha. As ações são duas: revisar de novo e, quando o PR tem
// contestação registrada, o desfecho dela.
import { useEffect, useId, useRef } from 'react';
import type { Contestacao as Registro, Revisao } from '@/contratos/historico';
import type { Motivo } from '@/contratos/radar';
import { textoDaDuracao, type DetalheAberto } from '@/historico/consulta';
import { resumoDaExecucao, resumoDosChecks, resumoDosCriterios, textoDoCriterio, textoDoEstadoDoCheck } from '@/historico/detalhe';
import { dolar } from '@/consumo/formato';
import { foiPublicado, parecerQueDifere, rotuloDoDesfecho, textoDoPublicado, textoDoStatus, tomDoDesfecho } from '@/historico/rotulos';
import { ROTULO_DO_MOTIVO, dataComAno, linkDoPr, nomeDoPr, prDaUrl } from '@/radar/formato';
import { Markdown } from '../Markdown';
import { AcoesDoItem } from '../radar/AcoesDoItem';
import type { ControleDeAcoes } from '../radar/useAcoes';
import { Chip, Esqueleto, Linha, Secao, ui, type Tom } from '../ui';
import { Contestacao } from './Contestacao';
import type { LeituraDoDetalhe } from './useHistorico';
import estilos from './Historico.module.css';

function Campo({ nome, children }: { nome: string; children: string }) {
  return (
    <div className={estilos.par}>
      <dt>{nome}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const contagem = (valor: number | undefined): string => (valor !== undefined && Number.isInteger(valor) && valor >= 0 ? String(valor) : 'não informado');

function Achado({ rotulo, tom, motivo, aberta }: { rotulo: string; tom: Tom; motivo: Motivo; aberta?: boolean }) {
  return (
    <Linha
      aberta={aberta}
      rotulo={`${rotulo}: ${motivo.text}`}
      resumo={(
        <>
          <Chip tom={tom} pequeno>{rotulo}</Chip>
          <span className={`${ui.t} ${estilos.tituloDaLinha}`}>{motivo.text}</span>
        </>
      )}
    >
      <p className={ui.texto}>{motivo.text}</p>
      <p className={ui.mini}>Origem: {ROTULO_DO_MOTIVO[motivo.kind]}</p>
    </Linha>
  );
}

// Os achados com o que o item traz: o bloqueio (`blockedReason`), aberto; os motivos
// (`reasons`) e os pontos de atenção (`attention`), fechados. Nada além disso: o item não traz
// arquivo, linha nem trecho de código de cada achado.
function Achados({ revisao: r }: { revisao: Revisao }) {
  if (!r.blockedReason && !r.reasons.length && !r.attention.length) return null;
  return (
    <Secao titulo="Achados">
      {r.blockedReason ? <Achado rotulo="Bloqueio" tom="ruim" aberta motivo={{ text: r.blockedReason, kind: 'gate' }} /> : null}
      {r.reasons.map((m, i) => <Achado key={`m${i}`} rotulo="Motivo" tom="ruim" motivo={m} />)}
      {r.attention.map((m, i) => <Achado key={`a${i}`} rotulo="Ponto de atenção" tom="aviso" motivo={m} />)}
    </Secao>
  );
}

function Rodadas({ rodadas }: { rodadas: NonNullable<Revisao['rounds']> }) {
  return (
    <Linha
      rotulo="Rodadas"
      resumo={(
        <>
          <span className={`${ui.t} ${estilos.tituloDaLinha}`}>Rodadas</span>
          <span className={ui.r}>rodada {contagem(rodadas.ordinal)} · {contagem(rodadas.unresolvedCount)} pendência(s)</span>
        </>
      )}
    >
      <p className={ui.texto}>
        Rodada {contagem(rodadas.ordinal)}, com {contagem(rodadas.unresolvedCount)} pendência(s) rastreada(s).{' '}
        {rodadas.mode === 'enforce' ? 'A comparação entre rodadas está ativa.' : 'A comparação entre rodadas está em observação.'}{' '}
        {rodadas.unverified ? 'A memória das rodadas não foi verificada: isto não comprova que não há pendência.' : ''}
      </p>
      <dl className={estilos.campos}>
        <Campo nome="Rodadas anteriores referenciadas">{contagem(rodadas.parentCount)}</Campo>
        <Campo nome="Apontamentos sem resposta">{contagem(rodadas.droppedCount)}</Campo>
        <Campo nome="Novos em arquivo inalterado">{contagem(rodadas.lateCount)}</Campo>
        <Campo nome="Resolvidos em arquivo inalterado">{contagem(rodadas.resolvedOnUnchangedCount)}</Campo>
        <Campo nome="Contexto alterado">{rodadas.changedContext ? 'sim' : 'não registrado'}</Campo>
      </dl>
    </Linha>
  );
}

function Etapas({ etapas }: { etapas: NonNullable<Revisao['stages']> }) {
  return (
    <Linha
      rotulo="Etapas da sessão"
      resumo={(
        <>
          <span className={`${ui.t} ${estilos.tituloDaLinha}`}>Etapas da sessão</span>
          <span className={ui.r}>{etapas.totalMs > 0 ? textoDaDuracao(etapas.totalMs) : `${etapas.stages.length} etapa(s)`}</span>
        </>
      )}
    >
      <dl className={estilos.campos}>
        {etapas.stages.map((etapa, i) => <Campo key={i} nome={etapa.label || etapa.id || `Etapa ${i + 1}`}>{textoDaDuracao(etapa.ms)}</Campo>)}
        {etapas.totalMs > 0 ? <Campo nome="Total">{textoDaDuracao(etapas.totalMs)}</Campo> : null}
      </dl>
    </Linha>
  );
}

function tomDoCriterio(atende: boolean | null): Tom {
  if (atende === null) return 'neutro';
  return atende ? 'ok' : 'ruim';
}

function marcaDoCriterio(atende: boolean | null): string {
  if (atende === null) return '?';
  return atende ? '✓' : '✕';
}

// Os critérios do card um a um, como a sessão os declarou. A marca é visual; o estado vai em texto
// para o leitor de tela.
function CriteriosDoCard({ criterios, card }: { criterios: NonNullable<Revisao['criteriosDoCard']>; card: string | undefined }) {
  const titulo = card ? `Critérios do card ${card}` : 'Critérios do card';
  return (
    <Linha
      rotulo={titulo}
      resumo={(
        <>
          <span className={`${ui.t} ${estilos.tituloDaLinha}`}>{titulo}</span>
          <span className={ui.r}>{resumoDosCriterios(criterios)}</span>
        </>
      )}
    >
      <ul className={estilos.criterios}>
        {criterios.map((c, i) => (
          <li key={i} className={estilos.criterio}>
            <Chip tom={tomDoCriterio(c.atende)} pequeno><span aria-hidden="true">{marcaDoCriterio(c.atende)}</span><span className={ui.soLeitor}>{textoDoCriterio(c.atende)}</span></Chip>
            <span>{c.texto}</span>
          </li>
        ))}
      </ul>
      <p className={ui.mini}>O que a revisão declarou de cada critério. A decisão sobre o card é a do motor, pelo card inteiro e pela parte deste PR.</p>
    </Linha>
  );
}

// Os checks obrigatórios do head como o motor os leu no fim da revisão. Só o que faltava vem
// por nome: o motor não guarda a lista dos que estavam verdes.
function ChecksDoHead({ checks: c }: { checks: NonNullable<Revisao['checks']> }) {
  return (
    <Linha
      rotulo="Checks do head"
      resumo={(
        <>
          <span className={`${ui.t} ${estilos.tituloDaLinha}`}>Checks do head</span>
          <span className={ui.r}>{resumoDosChecks(c)}</span>
        </>
      )}
    >
      {!c.conferidoNoHead ? <p className={ui.nota}>A leitura dos checks não foi feita no commit revisado: o que segue não fala do head desta revisão.</p> : null}
      {c.semExigencia ? <p className={ui.texto}>O ruleset da branch de destino não exige check obrigatório.</p> : null}
      {c.conferidoNoHead && !c.semExigencia && !c.naoVerdes.length ? <p className={ui.texto}>Todos os checks obrigatórios estavam verdes no commit revisado.</p> : null}
      {c.naoVerdes.length || c.herdados.length ? (
        <dl className={estilos.campos}>
          {c.naoVerdes.map((check) => <Campo key={`n:${check.nome}`} nome={check.nome}>{textoDoEstadoDoCheck(check.estado)}</Campo>)}
          {c.herdados.map((check) => <Campo key={`h:${check.nome}`} nome={check.nome}>Falha também na base (herdado, não pesa)</Campo>)}
        </dl>
      ) : null}
    </Linha>
  );
}

function Execucao({ revisao: r }: { revisao: Revisao }) {
  const parecer = parecerQueDifere(r);
  const resolvida = dataComAno(r.resolvedAt);
  const criada = dataComAno(r.createdAt);
  const conferencia = r.verificationCheckpoint;
  const e = r.execucao;
  return (
    <Linha
      rotulo="Execução"
      resumo={(
        <>
          <span className={`${ui.t} ${estilos.tituloDaLinha}`}>Execução</span>
          <span className={ui.r}>{e ? resumoDaExecucao(e) : textoDoPublicado(r)}</span>
        </>
      )}
    >
      <dl className={estilos.campos}>
        {e?.duracaoMs !== undefined ? <Campo nome="Duração da rodada">{textoDaDuracao(e.duracaoMs)}</Campo> : null}
        {e?.custoUsd !== undefined ? <Campo nome={e.custoEstimado ? 'Custo estimado (parte calculada pelo motor)' : 'Custo estimado'}>{dolar(e.custoUsd)}</Campo> : null}
        {e?.modelos.length ? <Campo nome={e.modelos.length === 1 ? 'Modelo' : 'Modelos'}>{e.modelos.join(', ')}</Campo> : null}
        {e ? <Campo nome="Tentativas de revisão na rodada">{String(e.tentativas)}</Campo> : null}
        <Campo nome="Publicado">{textoDoPublicado(r)}</Campo>
        {parecer ? <Campo nome="Parecer da revisão">{parecer}</Campo> : null}
        <Campo nome="Situação">{textoDoStatus(r.status)}</Campo>
        {r.card ? <Campo nome="Card">{r.card}</Campo> : null}
        {criada ? <Campo nome="Análise concluída em">{criada}</Campo> : null}
        {resolvida ? <Campo nome="Resolvida em">{resolvida}</Campo> : null}
        {r.technical ? <Campo nome="Avaliação técnica">{r.technical.message}</Campo> : null}
        {conferencia && conferencia.total > 0 ? (
          <Campo nome="Verificação de afirmações">
            {`${conferencia.confirmedCount} confirmada(s) de ${conferencia.total}${conferencia.conflictCount ? `, com ${conferencia.conflictCount} divergência(s) entre passadas` : ''}`}
          </Campo>
        ) : null}
      </dl>
      {e ? (
        <p className={ui.mini}>
          A rodada são as tentativas de revisão deste PR desde a revisão anterior dele até esta, inclusive a que caiu e foi refeita.
          {e.inicioIncerto ? ' O histórico guardado está no teto e a revisão anterior pode ter sido descartada: pode faltar tentativa do começo.' : ''}
        </p>
      ) : null}
    </Linha>
  );
}

function ReviewCompleto({ revisao: r }: { revisao: Revisao }) {
  const parecer = parecerQueDifere(r);
  return (
    <Linha
      rotulo="Review completo"
      resumo={(
        <>
          <span className={`${ui.t} ${estilos.tituloDaLinha}`}>Review completo</span>
          <span className={ui.r}>{r.reportMarkdown ? 'texto gravado' : 'sem texto gravado'}</span>
        </>
      )}
    >
      {r.reportMarkdown && parecer && r.status !== 'pending' && foiPublicado(r.action) ? (
        <p className={ui.nota}>
          O que foi publicado difere do parecer da revisão: o texto abaixo pode não ser o que saiu no PR. O motor não diz de qual dos dois ele é.
        </p>
      ) : null}
      {r.reportMarkdown ? (
        <div className={estilos.parecer}><Markdown texto={r.reportMarkdown} /></div>
      ) : (
        <p className={ui.vazio}>Esta revisão ficou sem texto gravado.</p>
      )}
    </Linha>
  );
}

function Cabecalho({ revisao: r }: { revisao: Revisao }) {
  const github = linkDoPr(r.pr?.url);
  const quando = dataComAno(r.resolvedAt ?? r.createdAt);
  let momento = '';
  if (quando) {
    if (r.status !== 'pending' && foiPublicado(r.action)) momento = `publicado em ${quando}`;
    else if (r.resolvedAt) momento = `resolvida em ${quando}`;
    else momento = `análise concluída em ${quando}`;
  }
  return (
    <div className={ui.fila}>
      <Chip tom={tomDoDesfecho(r)}>{rotuloDoDesfecho(r)}</Chip>
      {momento ? <span className={ui.mini}>{momento}</span> : null}
      {github ? (
        <a className={`${ui.link} ${ui.empurra}`} href={github} target="_blank" rel="noreferrer noopener">
          Ver no GitHub <span className={ui.soLeitor}>(abre em nova aba)</span>
        </a>
      ) : null}
    </div>
  );
}

function Corpo({ revisao: r, outra, registro, controle }: { revisao: Revisao; outra: boolean; registro: Registro | undefined; controle: ControleDeAcoes }) {
  const idDasAcoes = useId();
  const nome = nomeDoPr(r.key);
  // a URL canônica do PR: é ela que vai ao motor, não a que veio no item
  const pr = prDaUrl(r.pr?.url ?? '');
  const naoPostou = r.status === 'pending' || !foiPublicado(r.action);

  return (
    <>
      {outra ? (
        <p className={ui.nota}>
          O endereço pedia outra revisão deste PR, que não está na página carregada. O motor só entrega por chave a revisão mais recente do PR, que é a mostrada aqui.
        </p>
      ) : null}

      <Cabecalho revisao={r} />
      {r.technical ? <p className={estilos.frase}>{r.technical.message}</p> : null}
      {naoPostou ? <p className={ui.mini}>{textoDoStatus(r.status)}. Nada desta revisão foi postado no GitHub.</p> : null}
      {r.prProprio ? <p className={ui.nota}>PR da própria conta revisora: o GitHub não aceita aprovação nem pedido de mudanças do autor.</p> : null}

      <Achados revisao={r} />

      <Secao titulo="Mais detalhes">
        {r.criteriosDoCard ? <CriteriosDoCard criterios={r.criteriosDoCard} card={r.card} /> : null}
        {r.checks ? <ChecksDoHead checks={r.checks} /> : null}
        <Execucao revisao={r} />
        {r.rounds ? <Rodadas rodadas={r.rounds} /> : null}
        {r.stages ? <Etapas etapas={r.stages} /> : null}
        <ReviewCompleto revisao={r} />
      </Secao>

      {registro ? <Contestacao key={`${registro.outcome}|${registro.status ?? ''}|${registro.at ?? ''}`} revisao={r} registro={registro} controle={controle} /> : null}

      <section className={estilos.pe} aria-labelledby={idDasAcoes}>
        <h2 id={idDasAcoes} className={ui.soLeitor}>Revisar de novo</h2>
        {pr ? (
          <>
            <AcoesDoItem botoes={[{ acao: { tipo: 'revisar', alvo: r.key, nome, url: pr.url, deNovo: true }, primario: naoPostou }]} controle={controle} />
            <p className={ui.mini}>
              Abre uma análise nova deste PR no motor. O clique não publica nada: quando a análise termina, o motor segue a política da conta, que pode publicar sozinha.
            </p>
          </>
        ) : (
          <p className={ui.mini}>Esta revisão não traz o endereço do PR no GitHub: não dá para pedir revisão nova daqui.</p>
        )}
      </section>
    </>
  );
}

interface Props {
  aberto: DetalheAberto;
  leitura: LeituraDoDetalhe;
  // `pushbacks` do snapshot, por chave de PR
  contestacoes: Readonly<Record<string, Registro>> | undefined;
  controle: ControleDeAcoes;
  aoFechar(): void;
  aoTentarDeNovo(): void;
}

export function Detalhe({ aberto, leitura, contestacoes, controle, aoFechar, aoTentarDeNovo }: Props) {
  const titulo = useRef<HTMLHeadingElement>(null);
  const pronta = leitura.fase === 'pronto' ? leitura.revisao : null;
  const chave = pronta ? pronta.key : aberto.chave;
  const nome = chave ? nomeDoPr(chave) : '';
  const rodada = pronta?.rounds?.ordinal;
  const meta = pronta
    ? [pronta.key, pronta.pr?.author, rodada !== undefined && Number.isInteger(rodada) && rodada > 0 ? `${rodada}ª rodada` : '', pronta.card].filter(Boolean).join(' · ')
    : chave;

  useEffect(() => { titulo.current?.focus(); }, []);

  // Escape fecha de qualquer lugar da página, menos de dentro de um campo de texto ou de um
  // seletor: ali Escape é do campo (desfaz a digitação, fecha a lista). A pergunta de
  // confirmação de uma ação trata o próprio Escape e não deixa o evento chegar aqui.
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
    <section className={estilos.detalhe} aria-label={nome ? `Revisão de ${nome}` : 'Revisão'}>
      <button type="button" className={`${ui.link} ${estilos.voltar}`} aria-label="Voltar ao Histórico" onClick={aoFechar}>
        <span aria-hidden="true">← </span>Histórico
      </button>

      <div className={estilos.topoDoDetalhe}>
        {meta ? <p className={ui.r}>{meta}</p> : null}
        <h1 ref={titulo} className={estilos.tituloDoDetalhe} tabIndex={-1}>
          {pronta?.pr?.title || (nome ? `Revisão de ${nome}` : 'Revisão')}
        </h1>
      </div>

      {leitura.fase === 'carregando' ? <Esqueleto texto="Carregando a revisão." linhas={3} bloco /> : null}
      {leitura.fase === 'ausente' ? (
        <p className={ui.nota} role="status">
          {aberto.chave
            ? 'Esta revisão não está na página carregada, e o motor não tem revisão deste PR para mostrar.'
            : 'Esta revisão não está na página carregada, e o endereço não diz de qual PR ela é.'}{' '}
          Volte à lista e abra pela linha dela.
        </p>
      ) : null}
      {leitura.fase === 'erro' ? (
        <div className={ui.erro} role="alert">
          <span><strong>Erro:</strong> {leitura.texto}</span>
          <button type="button" className={ui.botao} onClick={aoTentarDeNovo}>Tentar de novo</button>
        </div>
      ) : null}
      {pronta && leitura.fase === 'pronto' ? (
        <Corpo
          revisao={pronta}
          outra={leitura.outra}
          registro={contestacoes && Object.hasOwn(contestacoes, pronta.key) ? contestacoes[pronta.key] : undefined}
          controle={controle}
        />
      ) : null}
    </section>
  );
}
