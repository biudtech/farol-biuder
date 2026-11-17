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
// aviso com o botão Atualizar. Depois de uma remoção aceita, o dossiê fecha, a tela pede a
// lista de novo e, até a carga nova chegar, quem foi removido não aparece.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PessoasCruas, Time as Lista } from '@/contratos/time';
import type { App } from '@/estado/app';
import { app as appDoNavegador, useApp } from '@/estado/instancia';
import { marcaDasResolvidas, mensagemDaFalha } from '@/historico/consulta';
import { chaveDaPessoa, contestacoesDoAutor, filtrarPorNome, perfilDe, quantasPessoas, soComPerfil, textoDoResultado } from '@/time/time';
import { RegiaoDeResultado } from '../radar/RegiaoDeResultado';
import { useAcoes, type ControleDeAcoes } from '../radar/useAcoes';
import { BarraDeCarga, Botao, Esqueleto, Pagina, ui } from '../ui';
import { AdicionarPessoa } from './AdicionarPessoa';
import { Dossie, type LeituraDoDossie } from './Dossie';
import { ListaDoTime, idDoBotao } from './ListaDoTime';
import { useEnderecoDoTime, useTime } from './useTime';
import estilos from './Time.module.css';

// o teto do campo de busca: um nome não passa disto
const TETO_DA_BUSCA = 100;

const CARREGANDO: LeituraDoDossie = Object.freeze({ fase: 'carregando' });
const AUSENTE: LeituraDoDossie = Object.freeze({ fase: 'ausente' });
const SEM_LISTA: LeituraDoDossie = Object.freeze({ fase: 'semLista' });

// Uma remoção que o motor aceitou nesta aba, com a lista e os perfis que a tela tinha na
// hora. Enquanto a tela ainda mostra aquela lista (a recarga não chegou, ou falhou), a pessoa
// não aparece nela; o mesmo vale para o perfil, até o estado do motor chegar. Carga ou estado
// novo voltam a valer como vieram.
interface Removida {
  chave: string;
  lista: Lista | null;
  cru: PessoasCruas | undefined;
}

interface Props {
  // existe para o teste trocar a instância
  app?: App;
}

export function Time({ app = appDoNavegador }: Props) {
  const { autor: aberto, ir } = useEnderecoDoTime();
  const resolvidas = useApp((e) => e.snapshot?.decisions?.resolved, app);
  const pessoas = useApp((e) => e.snapshot?.config?.people, app);
  const cru = useApp((e) => e.snapshot?.config?.peopleCru, app);
  const ilegiveis = useApp((e) => e.snapshot?.config?.peopleIlegiveis ?? 0, app);
  const registros = useApp((e) => e.snapshot?.pushbacks, app);
  const conexao = useApp((e) => e.conexao, app);
  const emDia = useApp((e) => e.estadoEmDia, app);
  const recados = useApp((e) => e.recados, app);
  const marca = useMemo(() => marcaDasResolvidas(resolvidas), [resolvidas]);

  const [recarga, setRecarga] = useState(0);
  const [busca, setBusca] = useState('');
  const [removidas, setRemovidas] = useState<readonly Removida[]>([]);
  const [adicionando, setAdicionando] = useState(false);
  const { carregando, time, falha, haNovas } = useTime(app.cliente, recarga, marca);
  const { controle: acoes, resultado, dispensar, regiao } = useAcoes(app.cliente);

  // o que a tela tem agora, para a ação que termina depois do desenho
  const agora = useRef({ aberto, time, cru });
  useEffect(() => { agora.current = { aberto, time, cru }; });
  // o dossiê fechou por causa de uma remoção: o foco fica na região do resultado
  const focoNoResultado = useRef(false);

  // O salvar de perfil tira o próprio botão da tela quando o estado novo chega: o foco vai
  // antes à região do resultado. A remoção aceita fecha o dossiê (trocando a entrada do
  // endereço, para o voltar do navegador não o reabrir), tira a pessoa do que está na tela e
  // pede a lista de novo: quem refaz a lista é o motor.
  const controle = useMemo<ControleDeAcoes>(() => ({
    ...acoes,
    disparar: async (acao) => {
      if (acao.tipo === 'perfil') acoes.focarResultado();
      const aceito = await acoes.disparar(acao);
      if (aceito && acao.tipo === 'removerAutor') {
        const chave = chaveDaPessoa(acao.login);
        const { aberto: noEndereco, time: lista, cru: perfis } = agora.current;
        setRemovidas((antes) => [...antes, { chave, lista, cru: perfis }]);
        setRecarga((n) => n + 1);
        if (noEndereco !== null && chaveDaPessoa(noEndereco) === chave) {
          focoNoResultado.current = true;
          ir(null, 'trocar');
        }
      }
      return aceito;
    },
  }), [acoes, ir]);

  const idDoTitulo = useId();
  const idDaBusca = useId();
  const idDaDica = useId();

  // quem saiu da lista que está na tela, e de quem o perfil que está na tela já não vale
  const semDossieDe = useMemo(() => new Set(removidas.filter((r) => r.lista === time).map((r) => r.chave)), [removidas, time]);
  const semPerfilDe = useMemo(() => new Set(removidas.filter((r) => r.cru === cru).map((r) => r.chave)), [removidas, cru]);

  const autores = useMemo(() => (time?.autores ?? []).filter((a) => !semDossieDe.has(chaveDaPessoa(a.login))), [time, semDossieDe]);
  const semDossie = useMemo(
    () => soComPerfil(pessoas, autores).filter((login) => !semPerfilDe.has(chaveDaPessoa(login))).map((login) => ({ login })),
    [pessoas, autores, semPerfilDe],
  );
  const autoresMostrados = useMemo(() => filtrarPorNome(autores, busca), [autores, busca]);
  const semDossieMostrados = useMemo(() => filtrarPorNome(semDossie, busca).map((p) => p.login), [semDossie, busca]);
  const total = autores.length + semDossie.length;
  const mostradas = autoresMostrados.length + semDossieMostrados.length;

  const aoAbrir = useCallback((login: string) => ir(login), [ir]);
  const aoFechar = useCallback(() => ir(null), [ir]);
  const aoRecarregar = useCallback(() => setRecarga((n) => n + 1), []);

  // Ao fechar o dossiê, o foco volta ao botão que o abriu (ou ao título da lista, se a pessoa
  // não está mais nela). Depois de uma remoção ele fica onde está: na região do resultado.
  const anterior = useRef<string | null>(aberto);
  useEffect(() => {
    const fechado = anterior.current;
    anterior.current = aberto;
    if (fechado === null || aberto !== null) return;
    if (focoNoResultado.current) {
      focoNoResultado.current = false;
      return;
    }
    (document.getElementById(idDoBotao(fechado)) ?? document.getElementById(idDoTitulo))?.focus();
  }, [aberto, idDoTitulo]);

  // O dossiê aberto: a pessoa da lista com este login (sem diferenciar caixa, como o motor
  // faz com o perfil), ou só o perfil de quem não tem dossiê.
  const leitura = useMemo<LeituraDoDossie | null>(() => {
    if (aberto === null) return null;
    if (!time) return falha ? SEM_LISTA : CARREGANDO;
    const alvo = chaveDaPessoa(aberto);
    const autor = autores.find((a) => a.login === aberto) ?? autores.find((a) => chaveDaPessoa(a.login) === alvo);
    const perfil = semPerfilDe.has(alvo) ? undefined : perfilDe(pessoas, aberto);
    return autor || perfil ? { fase: 'pronto', autor, perfil } : AUSENTE;
  }, [aberto, time, falha, autores, pessoas, semPerfilDe]);
  const contestacoes = useMemo(() => (aberto === null ? [] : contestacoesDoAutor(registros, aberto)), [registros, aberto]);

  let anuncio = '';
  if (time && !carregando) anuncio = textoDoResultado(total, mostradas, busca);

  // O erro da carga e o aviso de lista velha valem com a lista ou com o dossiê na tela.
  const avisos = (
    <>
      {falha ? (
        <div className={ui.erro} role="alert">
          <span><strong>Erro:</strong> {mensagemDaFalha(falha) || 'A carga do Time foi interrompida.'}{time ? ' O que está na tela é da última carga que deu certo.' : ''}</span>
          <Botao onClick={aoRecarregar}>Tentar de novo</Botao>
        </div>
      ) : null}
      {haNovas ? (
        <div className={`${ui.nota} ${estilos.novas}`} role="status">
          <span>O motor resolveu revisão depois da última carga do Time: a memória de alguém pode ter mudado.</span>
          <Botao pequeno onClick={aoRecarregar}>Atualizar</Botao>
        </div>
      ) : null}
    </>
  );

  return (
    <div className={estilos.time}>
      <div className={estilos.listagem} hidden={aberto !== null}>
        <Pagina
          titulo="Time"
          idDoTitulo={idDoTitulo}
          sub={time ? quantasPessoas(total) : undefined}
          acoes={adicionando ? undefined : <Botao onClick={() => setAdicionando(true)}>Adicionar pessoa</Botao>}
        >
          {aberto === null ? avisos : null}

          {adicionando ? (
            <AdicionarPessoa
              cru={cru}
              conhecidos={[...autores.map((a) => a.login), ...semDossie.map((p) => p.login)]}
              conexao={conexao}
              emDia={emDia}
              controle={controle}
              aoFechar={() => setAdicionando(false)}
            />
          ) : null}

          <div className={estilos.busca} role="search" aria-label="Busca no Time">
            <label className={ui.soLeitor} htmlFor={idDaBusca}>Buscar por nome ou login</label>
            <input
              id={idDaBusca}
              className={ui.campo}
              type="search"
              placeholder="Buscar pessoa"
              value={busca}
              maxLength={TETO_DA_BUSCA}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={idDaDica}
              onChange={(evento) => setBusca(evento.target.value)}
            />
            <p id={idDaDica} className={ui.soLeitor}>A busca é feita nesta página, sobre a lista que o motor mandou inteira, e não vai para o endereço.</p>
          </div>

          <p className={ui.soLeitor} role="status" aria-live="polite" aria-label="Resultado da lista">{anuncio}</p>

          {!time && carregando ? <Esqueleto texto="Carregando o Time." linhas={5} /> : null}

          {time ? (
            <div className={estilos.carga} aria-busy={carregando}>
              {carregando ? <BarraDeCarga rotulo="Atualizando o Time" /> : null}
              <div className={`${estilos.carga}${carregando ? ` ${ui.apagada}` : ''}`}>
                {time.descartados ? (
                  <p className={ui.nota}>
                    Atenção: {time.descartados} pessoa(s) chegaram do motor em formato que esta tela não lê e ficaram de fora.
                  </p>
                ) : null}
                {mostradas ? <ListaDoTime autores={autoresMostrados} soComPerfil={semDossieMostrados} pessoas={pessoas} aoAbrir={aoAbrir} /> : null}
                {total === 0 ? (
                  <div className={`${ui.cartao} ${estilos.vazioDoTime}`}>
                    <h2 className={estilos.tituloDoVazio}>Ninguém no Time ainda</h2>
                    <p className={ui.mini}>Uma pessoa aparece aqui quando a primeira revisão de um PR dela é resolvida: é aí que o motor abre o dossiê.</p>
                  </div>
                ) : null}
                {total > 0 && mostradas === 0 ? (
                  <div className={estilos.semResultado}>
                    <p className={ui.vazio}>Ninguém do Time passa pela busca.</p>
                    <Botao pequeno onClick={() => setBusca('')}>Limpar a busca</Botao>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </Pagina>
      </div>

      {aberto !== null && leitura ? (
        <Dossie
          key={chaveDaPessoa(aberto)}
          login={aberto}
          leitura={leitura}
          cru={cru}
          ilegiveis={ilegiveis}
          conexao={conexao}
          emDia={emDia}
          contestacoes={contestacoes}
          controle={controle}
          ocupado={carregando && time !== null}
          avisos={avisos}
          aoFechar={aoFechar}
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
