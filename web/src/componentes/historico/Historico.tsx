'use client';

// A tela Histórico: as revisões que o motor já resolveu, uma página por vez, no cartão único do
// Radar (Lista.tsx), agrupadas por dia, com o detalhe aberto no próprio cartão. Lidas de
// GET /api/decisions (não do snapshot, que só leva as 30 mais recentes). A busca e os filtros
// são do motor; a tela escolhe, pede e mostra. A consulta mora no endereço da página.
//
// A lista não se refaz a cada evento do fluxo: quando o snapshot passa a ter revisão resolvida
// que a página não viu, aparece um aviso com o botão Atualizar, e a pessoa decide quando.
//
// As pendências da mesa (`decisions.pending` do snapshot) aparecem antes da lista, como "nada
// postado": o front não tem mais mesa, e elas não podem sumir em silêncio (Lista.tsx).
import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Revisao } from '@/contratos/historico';
import type { Pendencia } from '@/contratos/radar';
import type { App } from '@/estado/app';
import { app as appDoNavegador, useApp } from '@/estado/instancia';
import {
  CONSULTA_VAZIA, TEXTO_DO_INDISPONIVEL, ehHistoricoIndisponivel, ehRecusaDeParametro, marcaDasResolvidas, mensagemDaFalha, temFiltro,
  textoDosRecentes, textoDoResultado, textoDoVazio,
} from '@/historico/consulta';
import { ABA_INICIAL } from '@/navegacao/abas';
import { RegiaoDeResultado } from '../radar/RegiaoDeResultado';
import { useAcoes } from '../radar/useAcoes';
import { BarraDeCarga, Botao, Esqueleto, Pagina, ui } from '../ui';
import { Detalhe } from './Detalhe';
import { ExportarCsv } from './ExportarCsv';
import { Filtros } from './Filtros';
import { Lista, Pendencias, idDoBotao, idDoBotaoDaPendencia } from './Lista';
import { Paginacao } from './Paginacao';
import { useEndereco } from './useEndereco';
import { useDetalhe, usePagina } from './useHistorico';
import estilos from './Historico.module.css';

interface Props {
  // existe para o teste trocar a instância
  app?: App;
}

const SEM_PENDENCIAS: readonly Pendencia[] = Object.freeze([]);

export function Historico({ app = appDoNavegador }: Props) {
  const { consulta, detalhe, ir } = useEndereco();
  const resolvidas = useApp((e) => e.snapshot?.decisions?.resolved, app);
  const pendencias = useApp((e) => e.snapshot?.decisions?.pending, app) ?? SEM_PENDENCIAS;
  const ilegiveis = useApp((e) => e.snapshot?.decisions?.ilegiveis, app) ?? 0;
  const contestacoes = useApp((e) => e.snapshot?.pushbacks, app);
  const recados = useApp((e) => e.recados, app);
  const perfis = useApp((e) => e.snapshot?.config?.claudeProfiles, app);
  const marca = useMemo(() => marcaDasResolvidas(resolvidas), [resolvidas]);

  const [recarga, setRecarga] = useState(0);
  const [tentativaDoDetalhe, setTentativaDoDetalhe] = useState(0);
  const { carregando, pagina, lidaEm, falha, repos, haNovas } = usePagina(app.cliente, consulta, recarga, marca);
  const leitura = useDetalhe(app.cliente, detalhe, pagina?.items, !carregando, tentativaDoDetalhe);
  const { controle, resultado, dispensar, regiao } = useAcoes(app.cliente);

  const tituloDaLista = useRef<HTMLHeadingElement>(null);
  const idDaLista = useId();

  // Página além do fim (o histórico encolheu, ou o endereço pede uma que não existe): volta
  // para a última, trocando a entrada do endereço em vez de empilhar outra.
  const alemDoFim = !carregando && !falha && pagina !== null && pagina.items.length === 0 && pagina.pages > 0 && consulta.pagina > pagina.pages;
  useEffect(() => {
    if (alemDoFim && pagina) ir({ ...consulta, pagina: pagina.pages }, detalhe, 'trocar');
  }, [alemDoFim, pagina, consulta, detalhe, ir]);

  // o id do botão que abriu o detalhe: é para ele que o foco volta
  const abertoPor = useRef<string | null>(null);
  const aoBuscar = useCallback((q: string) => ir({ ...consulta, q, pagina: 1 }, null, 'trocar'), [consulta, ir]);
  const aoFiltrar = useCallback((filtro: { veredito?: string; repo?: string; periodo?: string }) => ir({ ...consulta, ...filtro, pagina: 1 }, null, 'empilhar'), [consulta, ir]);
  const aoLimpar = useCallback(() => ir(CONSULTA_VAZIA, null, 'empilhar'), [ir]);
  const aoIrParaPagina = useCallback((para: number) => {
    ir({ ...consulta, pagina: para }, null, 'empilhar');
    // o foco vai ao título da lista: quem estava no pé da página volta ao começo dela
    tituloDaLista.current?.focus();
  }, [consulta, ir]);
  // a seta do cartão abre o detalhe nele, ou fecha o que está aberto
  const aoAlternar = useCallback((revisao: Revisao) => {
    if (detalhe?.id === revisao.id) {
      ir(consulta, null, 'empilhar');
      return;
    }
    abertoPor.current = idDoBotao(revisao.id);
    ir(consulta, { id: revisao.id, chave: revisao.key }, 'empilhar');
  }, [consulta, detalhe, ir]);
  const aoAbrirPendencia = useCallback((pendencia: Pendencia) => {
    abertoPor.current = idDoBotaoDaPendencia(pendencia.id);
    ir(consulta, { id: pendencia.id, chave: pendencia.key }, 'empilhar');
  }, [consulta, ir]);
  const aoFechar = useCallback(() => ir(consulta, null, 'empilhar'), [consulta, ir]);

  // Ao fechar o detalhe, o foco volta ao botão que o abriu (ou ao título da lista, se a linha
  // não está mais na tela, ou se o detalhe veio aberto do endereço).
  const idAberto = detalhe?.id ?? null;
  const anterior = useRef<string | null>(idAberto);
  useEffect(() => {
    const fechado = anterior.current;
    anterior.current = idAberto;
    if (fechado === null || idAberto !== null) return;
    const origem = abertoPor.current ?? idDoBotao(fechado);
    abertoPor.current = null;
    (document.getElementById(origem) ?? tituloDaLista.current)?.focus();
  }, [idAberto]);

  const mostrada = alemDoFim ? null : pagina;
  // A revisão aberta está na página mostrada: o detalhe abre no próprio cartão; fora dela (endereço
  // colado, pendência da mesa), no lugar da lista
  const noCartao = detalhe !== null && mostrada !== null && mostrada.items.some((item) => item.id === detalhe.id);

  // Escape fecha o cartão aberto de qualquer lugar da página, menos de dentro de um campo de texto
  // ou de um seletor (ali Escape é do campo). A pergunta de confirmação de uma ação trata o próprio
  // Escape e não deixa o evento chegar aqui. O detalhe de fora da página trata o dele.
  useEffect(() => {
    if (!noCartao) return undefined;
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape' || evento.defaultPrevented) return;
      const alvo = evento.target;
      if (alvo instanceof HTMLElement && (alvo.isContentEditable || alvo.matches('input, textarea, select'))) return;
      aoFechar();
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [noCartao, aoFechar]);
  const esperando = carregando || alemDoFim;
  const anuncio = mostrada && !esperando ? textoDoResultado(mostrada) : '';
  // a contagem dos últimos 7 dias é do motor e não depende dos filtros; a da última carga fica
  // até chegar a próxima
  const recentes = pagina?.recentes7Dias;
  let textoDoErro = '';
  if (falha) {
    textoDoErro = ehHistoricoIndisponivel(falha) ? TEXTO_DO_INDISPONIVEL : mensagemDaFalha(falha) || 'A carga da lista foi interrompida.';
    if (mostrada) textoDoErro += ' O que está na tela é da última carga que deu certo.';
  }

  return (
    <div className={estilos.historico}>
      <div className={estilos.listagem} hidden={detalhe !== null && !noCartao}>
        <Pagina
          titulo="Histórico"
          sub={(
            <>
              {recentes !== undefined ? <span>{textoDosRecentes(recentes)}{anuncio ? ' · ' : ''}</span> : null}
              <span role="status" aria-live="polite" aria-label="Resultado da consulta">{anuncio}</span>
            </>
          )}
          acoes={<ExportarCsv cliente={app.cliente} consulta={consulta} />}
        >
          <Filtros consulta={consulta} repos={repos} aoBuscar={aoBuscar} aoFiltrar={aoFiltrar} />

          {haNovas ? (
            <p className={`${ui.nota} ${estilos.novas}`} role="status">
              Há revisões novas desde a última carga desta lista.
              <Botao pequeno onClick={() => setRecarga((n) => n + 1)}>Atualizar</Botao>
            </p>
          ) : null}

          <Pendencias pendencias={pendencias} ilegiveis={ilegiveis} aoAbrir={aoAbrirPendencia} controle={controle} />

          <section className={estilos.revisoes} aria-labelledby={idDaLista}>
            <h2 id={idDaLista} ref={tituloDaLista} className={ui.soLeitor} tabIndex={-1}>Revisões</h2>

            {esperando && mostrada ? <BarraDeCarga rotulo="Carregando as revisões pedidas" /> : null}

            {falha ? (
              <div className={ui.erro} role="alert">
                <span><strong>Erro:</strong> {textoDoErro}</span>
                {ehRecusaDeParametro(falha) ? (
                  <Botao onClick={aoLimpar}>Limpar busca e filtros</Botao>
                ) : (
                  <Botao onClick={() => setRecarga((n) => n + 1)}>Tentar de novo</Botao>
                )}
              </div>
            ) : null}

            {!mostrada && esperando ? <Esqueleto texto="Carregando as revisões." /> : null}

            {mostrada ? (
              <div className={esperando ? `${estilos.pagina} ${ui.apagada}` : estilos.pagina} aria-busy={esperando}>
                {mostrada.descartados ? (
                  <p className={ui.nota}>
                    Atenção: {mostrada.descartados} revisão(ões) desta página chegaram em formato que esta tela não lê e ficaram de fora.
                  </p>
                ) : null}
                {mostrada.items.length ? (
                  <Lista
                    itens={mostrada.items}
                    agora={lidaEm}
                    variasPaginas={mostrada.pages > 1}
                    abertoId={noCartao ? detalhe.id : null}
                    leitura={noCartao ? leitura : null}
                    contestacoes={contestacoes}
                    perfis={perfis}
                    aoAlternar={aoAlternar}
                    controle={controle}
                  />
                ) : null}
                {mostrada.total === 0 && !temFiltro(consulta) ? (
                  <div className={ui.cartao}>
                    <h3 className={estilos.tituloDoVazio}>Nenhuma revisão ainda</h3>
                    <p className={ui.mini}>{textoDoVazio(consulta)}</p>
                    <Link className={ui.link} href={ABA_INICIAL}>Ir para o Radar</Link>
                  </div>
                ) : null}
                {mostrada.total === 0 && temFiltro(consulta) ? (
                  <>
                    <p className={ui.vazio}>{textoDoVazio(consulta)}</p>
                    <div className={ui.fila}><Botao onClick={aoLimpar}>Limpar busca e filtros</Botao></div>
                  </>
                ) : null}
                {mostrada.total > 0 ? (
                  <Paginacao pagina={mostrada.page} paginas={mostrada.pages} total={mostrada.total} ocupado={esperando} aoIr={aoIrParaPagina} />
                ) : null}
              </div>
            ) : null}

          </section>
        </Pagina>
      </div>

      {detalhe && leitura && !noCartao ? (
        <Detalhe
          key={detalhe.id}
          aberto={detalhe}
          leitura={leitura}
          contestacoes={contestacoes}
          controle={controle}
          perfis={perfis}
          aoFechar={aoFechar}
          aoTentarDeNovo={() => setTentativaDoDetalhe((n) => n + 1)}
        />
      ) : null}

      <RegiaoDeResultado
        regiao={regiao}
        resultado={resultado}
        recados={recados}
        aoDispensar={() => {
          dispensar();
          app.dispensarRecados();
        }}
      />
    </div>
  );
}
