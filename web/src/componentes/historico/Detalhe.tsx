'use client';

// O detalhe de uma revisão, aberto na própria página: o que foi publicado, os motivos, o
// resumo técnico, as rodadas, as etapas e o texto do parecer, desenhado de markdown. O foco
// vai ao título ao abrir, e Escape fecha. As ações são duas: revisar de novo e, quando o PR
// tem contestação registrada, o desfecho dela.
import { useEffect, useId, useRef } from 'react';
import type { Contestacao as Registro, Revisao } from '@/contratos/historico';
import { textoDaDuracao, type DetalheAberto } from '@/historico/consulta';
import { parecerQueDifere, textoDaAcao, textoDoStatus } from '@/historico/rotulos';
import { ROTULO_DO_MOTIVO, dataComAno, nomeDoPr, prDaUrl } from '@/radar/formato';
import type { Motivo } from '@/contratos/radar';
import { Markdown } from '../Markdown';
import { AcoesDoItem } from '../radar/AcoesDoItem';
import { ReferenciaDoPr } from '../radar/Bloco';
import type { ControleDeAcoes } from '../radar/useAcoes';
import comuns from '../radar/Radar.module.css';
import { Contestacao } from './Contestacao';
import { Campo } from './Lista';
import type { LeituraDoDetalhe } from './useHistorico';
import estilos from './Historico.module.css';

function Motivos({ titulo, motivos }: { titulo: string; motivos: readonly Motivo[] }) {
  const id = useId();
  if (!motivos.length) return null;
  return (
    <section className={estilos.secao} aria-labelledby={id}>
      <h3 id={id} className={estilos.tituloDaSecao}>{titulo}</h3>
      <ul className={comuns.motivos}>
        {motivos.map((m, i) => (
          <li key={i}><span className={comuns.tipoDoMotivo}>{ROTULO_DO_MOTIVO[m.kind]}:</span> {m.text}</li>
        ))}
      </ul>
    </section>
  );
}

const contagem = (valor: number | undefined): string => (valor !== undefined && Number.isInteger(valor) && valor >= 0 ? String(valor) : 'não informado');

function Rodadas({ rodadas }: { rodadas: NonNullable<Revisao['rounds']> }) {
  const id = useId();
  return (
    <section className={estilos.secao} aria-labelledby={id}>
      <h3 id={id} className={estilos.tituloDaSecao}>Rodadas</h3>
      <p>
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
    </section>
  );
}

function Etapas({ etapas }: { etapas: NonNullable<Revisao['stages']> }) {
  const id = useId();
  return (
    <section className={estilos.secao} aria-labelledby={id}>
      <h3 id={id} className={estilos.tituloDaSecao}>Etapas da sessão</h3>
      <dl className={estilos.campos}>
        {etapas.stages.map((etapa, i) => <Campo key={i} nome={etapa.label || etapa.id || `Etapa ${i + 1}`}>{textoDaDuracao(etapa.ms)}</Campo>)}
        {etapas.totalMs > 0 ? <Campo nome="Total">{textoDaDuracao(etapas.totalMs)}</Campo> : null}
      </dl>
    </section>
  );
}

function Corpo({ revisao: r, outra, registro, controle }: { revisao: Revisao; outra: boolean; registro: Registro | undefined; controle: ControleDeAcoes }) {
  const idDoTexto = useId();
  const idDasAcoes = useId();
  const nome = nomeDoPr(r.key);
  const parecer = parecerQueDifere(r);
  const resolvida = dataComAno(r.resolvedAt);
  const criada = dataComAno(r.createdAt);
  const conferencia = r.verificationCheckpoint;
  // a URL canônica do PR: é ela que vai ao motor, não a que veio no item
  const pr = prDaUrl(r.pr?.url ?? '');

  return (
    <>
      {outra ? (
        <p className={comuns.nota}>
          O endereço pedia outra revisão deste PR, que não está na página carregada. O motor só entrega por chave a revisão mais recente do PR, que é a mostrada aqui.
        </p>
      ) : null}

      <p className={comuns.tituloDoCartao}><ReferenciaDoPr chave={r.key} url={r.pr?.url} /></p>
      {r.pr?.title ? <p className={comuns.tituloDoPr}>{r.pr.title}</p> : null}
      <dl className={estilos.campos}>
        {r.pr?.author ? <Campo nome="Autor">{r.pr.author}</Campo> : null}
        {r.card ? <Campo nome="Card">{r.card}</Campo> : null}
        <Campo nome="Publicado">{textoDaAcao(r.action)}</Campo>
        {parecer ? <Campo nome="Parecer da revisão">{parecer}</Campo> : null}
        <Campo nome="Situação">{textoDoStatus(r.status)}</Campo>
        {resolvida ? <Campo nome="Resolvida em">{resolvida}</Campo> : null}
        {criada ? <Campo nome="Análise concluída em">{criada}</Campo> : null}
        {r.technical ? <Campo nome="Avaliação técnica">{r.technical.message}</Campo> : null}
        {conferencia && conferencia.total > 0 ? (
          <Campo nome="Verificação de afirmações">
            {`${conferencia.confirmedCount} confirmada(s) de ${conferencia.total}${conferencia.conflictCount ? `, com ${conferencia.conflictCount} divergência(s) entre passadas` : ''}`}
          </Campo>
        ) : null}
      </dl>

      {r.prProprio ? <p className={comuns.nota}>PR da própria conta revisora: o GitHub não aceita aprovação nem pedido de mudanças do autor.</p> : null}
      {r.blockedReason ? <p className={`${comuns.nota} ${comuns.bloqueio}`}>Bloqueado: {r.blockedReason}</p> : null}

      <Motivos titulo="Motivos" motivos={r.reasons} />
      <Motivos titulo="Pontos de atenção" motivos={r.attention} />
      {r.rounds ? <Rodadas rodadas={r.rounds} /> : null}
      {r.stages ? <Etapas etapas={r.stages} /> : null}

      <section className={estilos.secao} aria-labelledby={idDoTexto}>
        <h3 id={idDoTexto} className={estilos.tituloDaSecao}>Texto do parecer</h3>
        {r.reportMarkdown ? (
          <div className={estilos.parecer}><Markdown texto={r.reportMarkdown} /></div>
        ) : (
          <p className={comuns.vazio}>Esta revisão ficou sem texto gravado.</p>
        )}
      </section>

      <section className={estilos.secao} aria-labelledby={idDasAcoes}>
        <h3 id={idDasAcoes} className={estilos.tituloDaSecao}>Revisar de novo</h3>
        {pr ? (
          <>
            <p className={comuns.meta}>
              Abre uma análise nova deste PR no motor. O clique não publica nada: quando a análise termina, o motor publica sozinho ou deixa a revisão em Precisa de você, no Radar, conforme a política da conta.
            </p>
            <AcoesDoItem botoes={[{ acao: { tipo: 'revisar', alvo: r.key, nome, url: pr.url, deNovo: true } }]} controle={controle} />
          </>
        ) : (
          <p className={comuns.meta}>Esta revisão não traz o endereço do PR no GitHub: não dá para pedir revisão nova daqui.</p>
        )}
      </section>

      {registro ? <Contestacao key={`${registro.outcome}|${registro.status ?? ''}|${registro.at ?? ''}`} revisao={r} registro={registro} controle={controle} /> : null}
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
  const idDoTitulo = useId();
  const chave = leitura.fase === 'pronto' ? leitura.revisao.key : aberto.chave;

  useEffect(() => { titulo.current?.focus(); }, []);

  // Escape fecha de qualquer lugar da página. A pergunta de confirmação de uma ação trata o
  // próprio Escape e não deixa o evento chegar aqui.
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (evento.key === 'Escape' && !evento.defaultPrevented) aoFechar();
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [aoFechar]);

  return (
    <section className={estilos.detalhe} aria-labelledby={idDoTitulo}>
      <div className={estilos.topoDoDetalhe}>
        <h2 id={idDoTitulo} ref={titulo} className={estilos.tituloDoDetalhe} tabIndex={-1}>
          {chave ? `Revisão de ${nomeDoPr(chave)}` : 'Revisão'}
        </h2>
        <button type="button" className={comuns.botao} onClick={aoFechar}>Voltar à lista</button>
      </div>

      {leitura.fase === 'carregando' ? <p className={comuns.vazio} role="status">Carregando a revisão.</p> : null}
      {leitura.fase === 'ausente' ? (
        <p className={comuns.nota} role="status">
          {aberto.chave
            ? 'Esta revisão não está na página carregada, e o motor não tem revisão deste PR para mostrar.'
            : 'Esta revisão não está na página carregada, e o endereço não diz de qual PR ela é.'}{' '}
          Volte à lista e abra pela linha dela.
        </p>
      ) : null}
      {leitura.fase === 'erro' ? (
        <div className={estilos.erro} role="alert">
          <p><strong>Erro:</strong> {leitura.texto}</p>
          <button type="button" className={comuns.botao} onClick={aoTentarDeNovo}>Tentar de novo</button>
        </div>
      ) : null}
      {leitura.fase === 'pronto' ? (
        <Corpo
          revisao={leitura.revisao}
          outra={leitura.outra}
          registro={contestacoes && Object.hasOwn(contestacoes, leitura.revisao.key) ? contestacoes[leitura.revisao.key] : undefined}
          controle={controle}
        />
      ) : null}
    </section>
  );
}
