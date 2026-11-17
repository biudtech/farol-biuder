'use client';

// A tela Histórico: as revisões que o motor já resolveu, uma página por vez, lidas de
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
  textoDoResultado, textoDoVazio,
} from '@/historico/consulta';
import { LEGENDA_DAS_CORES } from '@/historico/rotulos';
import { ABA_INICIAL } from '@/navegacao/abas';
import { RegiaoDeResultado } from '../radar/RegiaoDeResultado';
import { useAcoes } from '../radar/useAcoes';
import { BarraDeCarga, Bolinha, Botao, Esqueleto, Pagina, ui } from '../ui';
import { Detalhe } from './Detalhe';
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
  const aoAbrir = useCallback((revisao: Revisao) => {
    abertoPor.current = idDoBotao(revisao.id);
    ir(consulta, { id: revisao.id, chave: revisao.key }, 'empilhar');
  }, [consulta, ir]);
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
  const esperando = carregando || alemDoFim;
  const anuncio = mostrada && !esperando ? textoDoResultado(mostrada) : '';
  let textoDoErro = '';
  if (falha) {
    textoDoErro = ehHistoricoIndisponivel(falha) ? TEXTO_DO_INDISPONIVEL : mensagemDaFalha(falha) || 'A carga da lista foi interrompida.';
    if (mostrada) textoDoErro += ' O que está na tela é da última carga que deu certo.';
  }

  return (
    <div className={estilos.historico}>
      <div className={estilos.listagem} hidden={detalhe !== null}>
        <Pagina
          titulo="Histórico"
          sub={<span role="status" aria-live="polite" aria-label="Resultado da consulta">{anuncio}</span>}
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
                {mostrada.items.length ? <Lista itens={mostrada.items} agora={lidaEm} aoAbrir={aoAbrir} controle={controle} /> : null}
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

            {mostrada?.items.length || pendencias.length ? (
              <ul className={estilos.legenda} aria-label="Legenda das cores">
                {LEGENDA_DAS_CORES.map(([tom, rotulo]) => (
                  <li key={tom} className={ui.mini}><Bolinha tom={tom} />{rotulo}</li>
                ))}
              </ul>
            ) : null}
          </section>
        </Pagina>
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
