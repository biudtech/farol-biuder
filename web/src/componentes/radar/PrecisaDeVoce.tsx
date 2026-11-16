'use client';

// O bloco "Precisa de você": as pendências que esperam um clique. Os botões de cada uma são
// os que o motor permite (acoesDaPendencia), e o motivo de um bloqueio aparece como o motor
// escreveu. O texto mostrado é o do PARECER da revisão; o que cada botão publica é o texto
// que o motor guardou para aquela ação, e a pergunta de confirmação diz qual dos dois sai.
import { memo } from 'react';
import type { Pendencia } from '@/contratos/radar';
import type { Acao, Decisao } from '@/radar/acoes';
import { acoesDaPendencia } from '@/radar/fatias';
import { ROTULO_DO_MOTIVO, dataHora, nomeDoPr, textoDaRetentativa, textoDoParecer } from '@/radar/formato';
import { Markdown } from '../Markdown';
import { AcoesDoItem, type BotaoDoItem } from './AcoesDoItem';
import { Bloco, ReferenciaDoPr } from './Bloco';
import type { ControleDeAcoes } from './useAcoes';
import estilos from './Radar.module.css';

function botoesDa(p: Pendencia): BotaoDoItem[] {
  const pode = acoesDaPendencia(p);
  const base = { alvo: p.key, nome: nomeDoPr(p.key) };
  const decidir = (decisao: Decisao): Acao => ({ ...base, tipo: 'decidir', id: p.id, decisao, parecer: p.verdict });
  const botoes: BotaoDoItem[] = [];
  if (pode.revisar && p.pr?.url) botoes.push({ acao: { ...base, tipo: 'revisar', url: p.pr.url }, primario: true });
  if (pode.aprovar) botoes.push({ acao: decidir('approve'), primario: true });
  if (pode.pedirMudancas) botoes.push({ acao: decidir('request_changes') });
  if (pode.comentar) botoes.push({ acao: decidir('comment') });
  if (pode.pular) botoes.push({ acao: decidir('skip') });
  return botoes;
}

function Cartao({ pendencia: p, controle }: { pendencia: Pendencia; controle: ControleDeAcoes }) {
  const nome = nomeDoPr(p.key);
  const parecer = textoDoParecer(p.verdict);
  const criada = dataHora(p.createdAt);
  const motivos = [...p.reasons, ...p.attention];
  return (
    <li className={estilos.cartao}>
      <h3 className={estilos.tituloDoCartao}><ReferenciaDoPr chave={p.key} url={p.pr?.url} /></h3>
      {p.pr?.title ? <p className={estilos.tituloDoPr}>{p.pr.title}</p> : null}
      <p className={estilos.meta}>
        {[p.pr?.author ? `PR de ${p.pr.author}` : '', parecer, p.card ? `Card ${p.card}` : '', criada ? `Na mesa desde ${criada}` : ''].filter(Boolean).join(' · ')}
      </p>

      {p.prProprio ? (
        <p className={estilos.nota}>PR da própria conta revisora: o GitHub não aceita aprovação nem pedido de mudanças do autor.</p>
      ) : null}
      {p.blockedReason ? <p className={`${estilos.nota} ${estilos.bloqueio}`}>Bloqueado: {p.blockedReason}</p> : null}
      {p.postRetry ? <p className={`${estilos.nota} ${estilos.bloqueio}`}>{textoDaRetentativa(p.postRetry)}</p> : null}
      {p.esperaProva?.impedimento ? <p className={estilos.nota}>Recuperação da análise pausada: {p.esperaProva.impedimento}</p> : null}
      {p.technical ? <p className={estilos.meta}>Avaliação técnica: {p.technical.message}</p> : null}

      {motivos.length ? (
        <ul className={estilos.motivos} aria-label={`Motivos de ${nome}`}>
          {motivos.map((m, i) => (
            <li key={i}><span className={estilos.tipoDoMotivo}>{ROTULO_DO_MOTIVO[m.kind]}:</span> {m.text}</li>
          ))}
        </ul>
      ) : null}

      {p.reportMarkdown ? (
        <details className={estilos.review}>
          <summary>Ver o texto do parecer da revisão de {nome}</summary>
          <div className={estilos.textoDoReview}><Markdown texto={p.reportMarkdown} /></div>
        </details>
      ) : null}

      <AcoesDoItem botoes={botoesDa(p)} controle={controle} />
    </li>
  );
}

interface Props {
  pendencias: readonly Pendencia[];
  // pendências que o motor mandou sem id ou sem chave, que a tela não consegue mostrar
  ilegiveis?: number;
  controle: ControleDeAcoes;
}

export const PrecisaDeVoce = memo(function PrecisaDeVoce({ pendencias, ilegiveis = 0, controle }: Props) {
  return (
    <Bloco titulo="Precisa de você" quantidade={pendencias.length} ilegiveis={ilegiveis} vazio="Nenhuma revisão esperando a sua decisão.">
      <ul className={estilos.lista}>
        {pendencias.map((p) => <Cartao key={p.id} pendencia={p} controle={controle} />)}
      </ul>
    </Bloco>
  );
});
