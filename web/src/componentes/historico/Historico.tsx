'use client';

// A tela Histórico: as revisões que o motor já resolveu, uma página por vez, lidas de
// GET /api/decisions (não do snapshot, que só leva as 30 mais recentes). A busca e os filtros
// são do motor; a tela escolhe, pede e mostra. A consulta mora no endereço da página.
//
// A lista não se refaz a cada evento do fluxo: quando o snapshot passa a ter revisão resolvida
// que a página não viu, aparece um aviso com o botão Atualizar, e a pessoa decide quando.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Revisao } from '@/contratos/historico';
import type { App } from '@/estado/app';
import { app as appDoNavegador, useApp } from '@/estado/instancia';
import {
  CONSULTA_VAZIA, ehRecusaDeParametro, marcaDasResolvidas, mensagemDaFalha, temFiltro, textoDoResultado, textoDoVazio,
} from '@/historico/consulta';
import { RegiaoDeResultado } from '../radar/RegiaoDeResultado';
import { useAcoes } from '../radar/useAcoes';
import comuns from '../radar/Radar.module.css';
import { Detalhe } from './Detalhe';
import { Filtros } from './Filtros';
import { Lista, idDoBotao } from './Lista';
import { Paginacao } from './Paginacao';
import { useEndereco } from './useEndereco';
import { useDetalhe, usePagina } from './useHistorico';
import estilos from './Historico.module.css';

interface Props {
  // existe para o teste trocar a instância
  app?: App;
}

export function Historico({ app = appDoNavegador }: Props) {
  const { consulta, detalhe, ir } = useEndereco();
  const resolvidas = useApp((e) => e.snapshot?.decisions?.resolved, app);
  const contestacoes = useApp((e) => e.snapshot?.pushbacks, app);
  const recados = useApp((e) => e.recados, app);
  const marca = useMemo(() => marcaDasResolvidas(resolvidas), [resolvidas]);

  const [recarga, setRecarga] = useState(0);
  const [tentativaDoDetalhe, setTentativaDoDetalhe] = useState(0);
  const { carregando, pagina, falha, repos, haNovas } = usePagina(app.cliente, consulta, recarga, marca);
  const leitura = useDetalhe(app.cliente, detalhe, pagina?.items, !carregando, tentativaDoDetalhe);
  const { controle, resultado, dispensar, regiao } = useAcoes(app.cliente);

  const tituloDaLista = useRef<HTMLHeadingElement>(null);
  const idDaLista = useId();

  // Página além do fim (o histórico encolheu, ou o endereço pede uma que não existe): volta
  // para a última, trocando a entrada do endereço em vez de empilhar outra.
  const alemDoFim = !carregando && pagina !== null && pagina.items.length === 0 && pagina.pages > 0 && consulta.pagina > pagina.pages;
  useEffect(() => {
    if (alemDoFim && pagina) ir({ ...consulta, pagina: pagina.pages }, detalhe, 'trocar');
  }, [alemDoFim, pagina, consulta, detalhe, ir]);

  const aoBuscar = useCallback((q: string) => ir({ ...consulta, q, pagina: 1 }, null, 'trocar'), [consulta, ir]);
  const aoFiltrar = useCallback((filtro: { veredito?: string; repo?: string }) => ir({ ...consulta, ...filtro, pagina: 1 }, null, 'empilhar'), [consulta, ir]);
  const aoLimpar = useCallback(() => ir(CONSULTA_VAZIA, null, 'empilhar'), [ir]);
  const aoIrParaPagina = useCallback((para: number) => {
    ir({ ...consulta, pagina: para }, null, 'empilhar');
    // o foco vai ao título da lista: quem estava no pé da página volta ao começo dela
    tituloDaLista.current?.focus();
  }, [consulta, ir]);
  const aoAbrir = useCallback((revisao: Revisao) => ir(consulta, { id: revisao.id, chave: revisao.key }, 'empilhar'), [consulta, ir]);
  const aoFechar = useCallback(() => ir(consulta, null, 'empilhar'), [consulta, ir]);

  // Ao fechar o detalhe, o foco volta ao botão que o abriu (ou ao título da lista, se a linha
  // não está mais na página).
  const idAberto = detalhe?.id ?? null;
  const anterior = useRef<string | null>(idAberto);
  useEffect(() => {
    const fechado = anterior.current;
    anterior.current = idAberto;
    if (fechado === null || idAberto !== null) return;
    (document.getElementById(idDoBotao(fechado)) ?? tituloDaLista.current)?.focus();
  }, [idAberto]);

  const mostrada = alemDoFim ? null : pagina;
  const esperando = carregando || alemDoFim;
  let anuncio = '';
  if (mostrada && !esperando) anuncio = textoDoResultado(mostrada);
  else if (esperando && !mostrada) anuncio = 'Carregando as revisões.';

  return (
    <div className={estilos.historico}>
      <h1 className={comuns.titulo}>Histórico</h1>

      <div className={estilos.listagem} hidden={detalhe !== null}>
        <Filtros consulta={consulta} repos={repos} aoBuscar={aoBuscar} aoFiltrar={aoFiltrar} aoLimpar={aoLimpar} />

        {haNovas ? (
          <p className={estilos.novas} role="status">
            Há revisões novas desde a última carga desta lista.{' '}
            <button type="button" className={comuns.botao} onClick={() => setRecarga((n) => n + 1)}>Atualizar</button>
          </p>
        ) : null}

        <section className={comuns.bloco} aria-labelledby={idDaLista}>
          <h2 id={idDaLista} ref={tituloDaLista} className={comuns.tituloDoBloco} tabIndex={-1}>Revisões</h2>
          <p className={comuns.meta} role="status" aria-live="polite" aria-label="Resultado da consulta">{anuncio}</p>

          {falha ? (
            <div className={estilos.erro} role="alert">
              <p><strong>Erro:</strong> {mensagemDaFalha(falha) || 'A carga da lista foi interrompida.'}</p>
              {ehRecusaDeParametro(falha) ? (
                <button type="button" className={comuns.botao} onClick={aoLimpar}>Limpar busca e filtros</button>
              ) : (
                <button type="button" className={comuns.botao} onClick={() => setRecarga((n) => n + 1)}>Tentar de novo</button>
              )}
            </div>
          ) : null}

          {mostrada ? (
            <div className={estilos.pagina} aria-busy={esperando} data-esmaecida={esperando ? '' : undefined}>
              {mostrada.descartados ? (
                <p className={`${comuns.nota} ${comuns.bloqueio}`}>
                  Atenção: {mostrada.descartados} revisão(ões) desta página chegaram em formato que esta tela não lê e ficaram de fora.
                </p>
              ) : null}
              {mostrada.items.length ? <Lista itens={mostrada.items} aoAbrir={aoAbrir} /> : null}
              {mostrada.total === 0 ? (
                <p className={comuns.vazio}>{textoDoVazio(consulta)}</p>
              ) : (
                <Paginacao pagina={mostrada.page} paginas={mostrada.pages} total={mostrada.total} ocupado={esperando} aoIr={aoIrParaPagina} />
              )}
              {mostrada.total === 0 && temFiltro(consulta) ? (
                <div className={comuns.botoes}>
                  <button type="button" className={comuns.botao} onClick={aoLimpar}>Limpar busca e filtros</button>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      {detalhe && leitura ? (
        <Detalhe
          key={detalhe.id}
          aberto={detalhe}
          leitura={leitura}
          contestacoes={contestacoes}
          controle={controle}
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
