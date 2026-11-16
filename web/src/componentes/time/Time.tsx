'use client';

// A tela Time: quem o motor conhece, com o que ele guarda sobre cada pessoa. A lista vem
// inteira de GET /api/team, na ordem do motor; o papel e a competência vêm de `config.people`
// do snapshot, e as contestações, de `pushbacks`. A tela fatia e formata, e a busca por nome
// é feita aqui porque a rota não pagina nem filtra.
//
// É dado sobre colegas: nada disto vai a localStorage nem ao console, e do endereço só
// consta o login de quem está com o dossiê aberto. A busca digitada fica na memória da aba.
//
// A lista não se refaz a cada evento do fluxo: quando o motor resolve revisão nova aparece um
// aviso com o botão Atualizar. Depois de uma remoção aceita, a tela pede a lista de novo.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { App } from '@/estado/app';
import { app as appDoNavegador, useApp } from '@/estado/instancia';
import { marcaDasResolvidas, mensagemDaFalha } from '@/historico/consulta';
import { chaveDaPessoa, contestacoesDoAutor, filtrarPorNome, perfilDe, soComPerfil, textoDoResultado } from '@/time/time';
import { RegiaoDeResultado } from '../radar/RegiaoDeResultado';
import { useAcoes, type ControleDeAcoes } from '../radar/useAcoes';
import comuns from '../radar/Radar.module.css';
import { Dossie, type LeituraDoDossie } from './Dossie';
import { ListaDoTime, idDoBotao } from './ListaDoTime';
import { useEnderecoDoTime, useTime } from './useTime';
import estilos from './Time.module.css';

// o teto do campo de busca: um nome não passa disto
const TETO_DA_BUSCA = 100;

const CARREGANDO: LeituraDoDossie = Object.freeze({ fase: 'carregando' });
const AUSENTE: LeituraDoDossie = Object.freeze({ fase: 'ausente' });
const SEM_AUTORES = Object.freeze([]);

interface Props {
  // existe para o teste trocar a instância
  app?: App;
}

export function Time({ app = appDoNavegador }: Props) {
  const { autor: aberto, ir } = useEnderecoDoTime();
  const resolvidas = useApp((e) => e.snapshot?.decisions?.resolved, app);
  const pessoas = useApp((e) => e.snapshot?.config?.people, app);
  const ilegiveis = useApp((e) => e.snapshot?.config?.peopleIlegiveis ?? 0, app);
  const registros = useApp((e) => e.snapshot?.pushbacks, app);
  const conexao = useApp((e) => e.conexao, app);
  const recados = useApp((e) => e.recados, app);
  const marca = useMemo(() => marcaDasResolvidas(resolvidas), [resolvidas]);

  const [recarga, setRecarga] = useState(0);
  const [busca, setBusca] = useState('');
  const { carregando, time, falha, haNovas } = useTime(app.cliente, recarga, marca);
  const { controle: acoes, resultado, dispensar, regiao } = useAcoes(app.cliente);

  // O salvar de perfil tira o próprio botão da tela quando o estado novo chega: o foco vai
  // antes à região do resultado. A remoção aceita muda a lista, que só o motor sabe refazer.
  const controle = useMemo<ControleDeAcoes>(() => ({
    ...acoes,
    disparar: async (acao) => {
      if (acao.tipo === 'perfil') acoes.focarResultado();
      const aceito = await acoes.disparar(acao);
      if (aceito && acao.tipo === 'removerAutor') setRecarga((n) => n + 1);
      return aceito;
    },
  }), [acoes]);

  const tituloDaLista = useRef<HTMLHeadingElement>(null);
  const idDaLista = useId();
  const idDaBusca = useId();
  const idDaDica = useId();

  const autores = time?.autores ?? SEM_AUTORES;
  const semDossie = useMemo(() => soComPerfil(pessoas, autores).map((login) => ({ login })), [pessoas, autores]);
  const autoresMostrados = useMemo(() => filtrarPorNome(autores, busca), [autores, busca]);
  const semDossieMostrados = useMemo(() => filtrarPorNome(semDossie, busca).map((p) => p.login), [semDossie, busca]);
  const total = autores.length + semDossie.length;
  const mostradas = autoresMostrados.length + semDossieMostrados.length;

  const aoAbrir = useCallback((login: string) => ir(login), [ir]);
  const aoFechar = useCallback(() => ir(null), [ir]);
  const aoRecarregar = useCallback(() => setRecarga((n) => n + 1), []);

  // Ao fechar o dossiê, o foco volta ao botão que o abriu (ou ao título da lista, se a pessoa
  // não está mais nela).
  const anterior = useRef<string | null>(aberto);
  useEffect(() => {
    const fechado = anterior.current;
    anterior.current = aberto;
    if (fechado === null || aberto !== null) return;
    (document.getElementById(idDoBotao(fechado)) ?? tituloDaLista.current)?.focus();
  }, [aberto]);

  // O dossiê aberto: a pessoa da lista com este login (sem diferenciar caixa, como o motor
  // faz com o perfil), ou só o perfil de quem não tem dossiê.
  const leitura = useMemo<LeituraDoDossie | null>(() => {
    if (aberto === null) return null;
    if (!time) {
      if (falha) return { fase: 'erro', texto: mensagemDaFalha(falha) || 'A carga do Time foi interrompida.' };
      return CARREGANDO;
    }
    const alvo = chaveDaPessoa(aberto);
    const autor = time.autores.find((a) => a.login === aberto) ?? time.autores.find((a) => chaveDaPessoa(a.login) === alvo);
    const perfil = perfilDe(pessoas, aberto);
    return autor || perfil ? { fase: 'pronto', autor, perfil } : AUSENTE;
  }, [aberto, time, falha, pessoas]);
  const contestacoes = useMemo(() => (aberto === null ? [] : contestacoesDoAutor(registros, aberto)), [registros, aberto]);

  let anuncio = '';
  if (time && !carregando) anuncio = textoDoResultado(total, mostradas, busca);
  else if (carregando && !time) anuncio = 'Carregando o Time.';

  return (
    <div className={estilos.time}>
      <h1 className={comuns.titulo}>Time</h1>

      <div className={estilos.listagem} hidden={aberto !== null}>
        <p className={comuns.meta}>
          O que o motor guarda sobre cada pessoa que teve PR revisado: o dossiê com a memória das revisões, e o papel e a competência que moldam o tom das próximas. São anotações sobre colegas: ficam no motor, e esta tela não as guarda no navegador.
        </p>

        <div className={estilos.busca} role="search" aria-label="Busca no Time">
          <label className={comuns.rotulo} htmlFor={idDaBusca}>Buscar por nome ou login</label>
          <input
            id={idDaBusca}
            className={comuns.entrada}
            type="search"
            value={busca}
            maxLength={TETO_DA_BUSCA}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={idDaDica}
            onChange={(evento) => setBusca(evento.target.value)}
          />
          <p id={idDaDica} className={comuns.meta}>A busca é feita nesta página, sobre a lista que o motor mandou inteira, e não vai para o endereço.</p>
        </div>

        {haNovas ? (
          <p className={estilos.novas} role="status">
            O motor resolveu revisão depois da última carga desta lista: a memória de alguém pode ter mudado.{' '}
            <button type="button" className={comuns.botao} onClick={aoRecarregar}>Atualizar</button>
          </p>
        ) : null}

        <section className={comuns.bloco} aria-labelledby={idDaLista}>
          <h2 id={idDaLista} ref={tituloDaLista} className={comuns.tituloDoBloco} tabIndex={-1}>Pessoas</h2>
          <p className={comuns.meta} role="status" aria-live="polite" aria-label="Resultado da lista">{anuncio}</p>

          {falha ? (
            <div className={estilos.erro} role="alert">
              <p><strong>Erro:</strong> {mensagemDaFalha(falha) || 'A carga do Time foi interrompida.'}{time ? ' A lista abaixo é a da última carga que deu certo.' : ''}</p>
              <button type="button" className={comuns.botao} onClick={aoRecarregar}>Tentar de novo</button>
            </div>
          ) : null}

          {time ? (
            <div className={estilos.carga} aria-busy={carregando} data-esmaecida={carregando ? '' : undefined}>
              {time.descartados ? (
                <p className={`${comuns.nota} ${comuns.bloqueio}`}>
                  Atenção: {time.descartados} pessoa(s) chegaram do motor em formato que esta tela não lê e ficaram de fora.
                </p>
              ) : null}
              {mostradas ? <ListaDoTime autores={autoresMostrados} soComPerfil={semDossieMostrados} pessoas={pessoas} aoAbrir={aoAbrir} /> : null}
              {total === 0 ? (
                <p className={comuns.vazio}>
                  O motor ainda não tem ninguém no Time: o dossiê de uma pessoa nasce quando a primeira revisão de um PR dela é resolvida.
                </p>
              ) : null}
              {total > 0 && mostradas === 0 ? (
                <>
                  <p className={comuns.vazio}>Ninguém do Time passa pela busca.</p>
                  <div className={comuns.botoes}>
                    <button type="button" className={comuns.botao} onClick={() => setBusca('')}>Limpar a busca</button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      {aberto !== null && leitura ? (
        <Dossie
          key={chaveDaPessoa(aberto)}
          login={aberto}
          leitura={leitura}
          pessoas={pessoas}
          ilegiveis={ilegiveis}
          conexao={conexao}
          contestacoes={contestacoes}
          controle={controle}
          ocupado={carregando && time !== null}
          aoFechar={aoFechar}
          aoTentarDeNovo={aoRecarregar}
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
