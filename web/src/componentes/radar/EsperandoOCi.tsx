'use client';

// O bloco "Esperando o CI": as pendências que o motor resolve sozinho. Com `esperaCi`, a
// aprovação sai quando os checks obrigatórios fecharem; com `esperaProva`, o motor retoma a
// análise. O bloco diz desde quando e o que falta; a única ação é tirar da mesa (Pular), que
// pergunta antes: pular aqui descarta o que o motor faria sozinho.
import { memo } from 'react';
import type { Pendencia } from '@/contratos/radar';
import { dataHora, nomeDoPr } from '@/radar/formato';
import { AcoesDoItem } from './AcoesDoItem';
import { Bloco, ReferenciaDoPr } from './Bloco';
import type { ControleDeAcoes } from './useAcoes';
import estilos from './Radar.module.css';

function EsperaDoCi({ espera, nome }: { espera: NonNullable<Pendencia['esperaCi']>; nome: string }) {
  const desde = dataHora(espera.desde);
  return (
    <>
      <p className={estilos.meta}>{desde ? `Esperando o CI desde ${desde}.` : 'Esperando o CI.'}</p>
      {espera.checks.length ? (
        <ul className={estilos.motivos} aria-label={`Checks que faltam em ${nome}`}>
          {espera.checks.map((c, i) => (
            <li key={i}>{c.nome || 'check sem nome'}{c.estado ? `: ${c.estado}` : ''}</li>
          ))}
        </ul>
      ) : (
        <p className={estilos.meta}>O motor não listou quais checks faltam.</p>
      )}
    </>
  );
}

function EsperaDaProva({ espera }: { espera: NonNullable<Pendencia['esperaProva']> }) {
  const desde = dataHora(espera.desde);
  const proxima = dataHora(espera.proximaEm);
  return (
    <>
      <p className={estilos.meta}>
        {`O motor está recuperando a análise${desde ? ` desde ${desde}` : ''}, com ${espera.tentativas} tentativa(s) concluída(s).`}
        {espera.aguardandoCi ? ' Aguarda o CI antes de retomar.' : ''}
        {proxima ? ` Próxima tentativa a partir de ${proxima}.` : ''}
      </p>
      {espera.impedimento ? <p className={estilos.nota}>{espera.impedimento}</p> : null}
    </>
  );
}

function Cartao({ pendencia: p, controle }: { pendencia: Pendencia; controle: ControleDeAcoes }) {
  const nome = nomeDoPr(p.key);
  return (
    <li className={estilos.cartao}>
      <h3 className={estilos.tituloDoCartao}><ReferenciaDoPr chave={p.key} url={p.pr?.url} /></h3>
      {p.pr?.title ? <p className={estilos.tituloDoPr}>{p.pr.title}</p> : null}
      {p.esperaCi ? <EsperaDoCi espera={p.esperaCi} nome={nome} /> : null}
      {!p.esperaCi && p.esperaProva ? <EsperaDaProva espera={p.esperaProva} /> : null}
      <AcoesDoItem botoes={[{ acao: { tipo: 'decidir', id: p.id, decisao: 'skip', alvo: p.key, nome, espera: p.esperaCi ? 'ci' : 'prova' } }]} controle={controle} />
    </li>
  );
}

export const EsperandoOCi = memo(function EsperandoOCi({ pendencias, controle }: { pendencias: readonly Pendencia[]; controle: ControleDeAcoes }) {
  return (
    <Bloco titulo="Esperando o CI" quantidade={pendencias.length} vazio="Nenhuma revisão esperando o CI.">
      <ul className={estilos.lista}>
        {pendencias.map((p) => <Cartao key={p.id} pendencia={p} controle={controle} />)}
      </ul>
    </Bloco>
  );
});
