'use client';

// A tela Sistema, no redesenho de 19/11/2026 (meta 8, decisões 3 e 4): à esquerda o menu dos
// assuntos, cada um com a bolinha e um resumo do estado; à direita o assunto aberto. A rota guarda
// o assunto (`/sistema/<assunto>`, src/sistema/assuntos.ts), para o link funcionar; `/sistema`
// abre o primeiro. No celular o menu vira a lista, e o assunto abre em seguida, com o Voltar aos
// assuntos. São os sete assuntos do desenho aprovado: a saúde do motor e a rede saíram da tela
// por decisão do dono, e o diagnóstico continua no motor, pela API (GET /api/doctor e
// GET /api/diagnostics).
//
// Todos os assuntos ficam montados e só o aberto aparece: trocar de assunto não perde o que foi
// digitado em outro. É a tela que mais pode fazer estrago, então:
// - segredo não volta do motor: a borda descarta o que tiver cara de segredo
//   (src/contratos/segredos.ts). Os dois segredos que a tela recebe digitados (o token do Jira e
//   o código do login da assinatura) ficam em campo mascarado fora do estado do React, vão só no
//   corpo do POST e são apagados do campo antes do envio;
// - cada salvar mexe numa coisa só, manda só o que a pessoa alterou e confere o que o motor
//   respondeu (src/sistema/acoes.ts);
// - a mudança que amplia o que o motor publica sozinho no GitHub pergunta antes;
// - só se salva com o estado da conexão atual já chegado (`estadoEmDia`).
// A tela fatia e formata: quem mede, decide e grava é o motor.
import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Bolinha, Esqueleto, Pagina, ui } from '@/componentes/ui';
import { lerSessoes, type SessoesPareadas } from '@/contratos/sistema';
import type { App } from '@/estado/app';
import { app as appDoNavegador, useApp } from '@/estado/instancia';
import type { Acao, DesfechoAceito } from '@/radar/acoes';
import { horaCurta } from '@/radar/formato';
import { impedimentoDeSalvar } from '@/sistema/acoes';
import { ASSUNTOS, ROTA_DO_SISTEMA, assuntoDoCaminho, nomeDoAssunto, rotaDoAssunto, type IdDoAssunto } from '@/sistema/assuntos';
import {
  ROTULO_DO_TOM, linhaDaConta, linhaDasRegras, linhaDasSessoes, linhaDoJira, linhaDoPerfil, linhaDoRitmo, linhaDosPadroes,
  type EstadoDaLinha,
} from '@/sistema/linhas';
import { AnuncioDaTela } from '../radar/AnuncioDaTela';
import { useAcoes, type ControleDeAcoes } from '../radar/useAcoes';
import { Automacao } from './Automacao';
import { ContaEPolitica } from './ContaEPolitica';
import type { UltimoSalvar } from './Formulario';
import { Jira } from './Jira';
import { Padroes } from './Padroes';
import { PerfilDoClaude } from './PerfilDoClaude';
import { Regras } from './Regras';
import { Ritmo } from './Ritmo';
import { ROTA_DAS_SESSOES, Sessoes } from './Sessoes';
import { useChamada } from './useChamada';
import estilos from './Sistema.module.css';

// As edições por salvar, por formulário, e o assunto onde cada um mora.
const EDICOES = {
  conta: { nome: 'conta e política', assunto: 'conta' },
  padroes: { nome: 'padrões do time', assunto: 'padroes' },
  automacao: { nome: 'modelo e sessões', assunto: 'claude' },
  ritmo: { nome: 'ritmo da revisão', assunto: 'ritmo' },
} as const satisfies Record<string, { nome: string; assunto: IdDoAssunto }>;
type Edicao = keyof typeof EDICOES;
const SALVA_FORMULARIO: readonly string[] = Object.keys(EDICOES);

// A frase curta de cada assunto, abaixo do título dele.
const DESCRICAO: Record<IdDoAssunto, string> = {
  conta: 'É por ela que o Farol publica no GitHub: o que ela revisa sozinha, onde e o que faz em cada desfecho.',
  regras: 'Exceções à conta: quem é revisado sozinho e quem só no clique.',
  padroes: 'O que o Farol confere em todo PR além das regras do repositório.',
  claude: 'Os perfis que rodam as revisões, na ordem de uso, e como cada sessão roda.',
  jira: 'De onde o Farol lê o card de cada PR, por organização do GitHub.',
  ritmo: 'Com que frequência ele olha o GitHub e como lida com o que muda no meio.',
  acesso: 'Os navegadores com acesso a esta tela.',
};

// A largura em que o menu vira a lista (a mesma do @media de Sistema.module.css). No celular,
// `/sistema` sem assunto mostra só a lista: nenhum item é a página atual. Sem `matchMedia` (no
// servidor e no teste sem janela) a tela é a larga.
const CELULAR = '(max-width: 760px)';

function assinarCelular(avisar: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const consulta = window.matchMedia(CELULAR);
  consulta.addEventListener('change', avisar);
  return () => consulta.removeEventListener('change', avisar);
}

function ehCelular(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(CELULAR).matches;
}

function useCelular(): boolean {
  return useSyncExternalStore(assinarCelular, ehCelular, () => false);
}

function ModeloESessoes({ children }: { children: ReactNode }) {
  const id = useId();
  return (
    <section className={estilos.subbloco} aria-labelledby={id}>
      <h3 id={id} className={estilos.subtitulo}>Modelo e sessões</h3>
      {children}
    </section>
  );
}

interface PropsDoAssunto {
  id: IdDoAssunto;
  aberto: boolean;
  // o id do título, que recebe o foco quando o assunto abre por um clique no menu
  idDoTitulo: string;
  children: ReactNode;
}

function Assunto({ id, aberto, idDoTitulo, children }: PropsDoAssunto) {
  return (
    <section className={estilos.assunto} aria-labelledby={idDoTitulo} hidden={!aberto}>
      <div className={estilos.cabecaDoAssunto}>
        <h2 id={idDoTitulo} tabIndex={-1} className={estilos.tituloDoAssunto}>{nomeDoAssunto(id)}</h2>
        <p className={ui.mini}>{DESCRICAO[id]}</p>
      </div>
      {children}
    </section>
  );
}

interface Props {
  // existe para o teste trocar a instância
  app?: App;
  // o caminho da página (`usePathname`), de onde sai o assunto aberto
  caminho?: string;
}

export function Sistema({ app = appDoNavegador, caminho = ROTA_DO_SISTEMA }: Props) {
  const saude = useApp((e) => e.snapshot?.doctor, app);
  const modelos = useApp((e) => e.snapshot?.modelos, app);
  const perfis = useApp((e) => e.snapshot?.claudePerfis, app);
  const contas = useApp((e) => e.snapshot?.accounts, app);
  const config = useApp((e) => e.snapshot?.config, app);
  const sites = useApp((e) => e.snapshot?.jiraSites, app);
  const resolvidas = useApp((e) => e.snapshot?.decisions?.resolved, app);
  const temEstado = useApp((e) => e.snapshot !== null, app);
  const conexao = useApp((e) => e.conexao, app);
  const emDia = useApp((e) => e.estadoEmDia, app);
  const recados = useApp((e) => e.recados, app);

  const aberto = assuntoDoCaminho(caminho) ?? { id: ASSUNTOS[0].id, explicito: false };
  // no celular, sem assunto no endereço, a tela é a lista: nenhum assunto está aberto
  const celular = useCelular();
  const atualNoMenu: IdDoAssunto | null = celular && !aberto.explicito ? null : aberto.id;
  // O foco vai ao título do assunto quando ele muda depois da carga (o clique no menu): o leitor
  // de tela e o teclado seguem para o conteúdo novo, e no celular a tela mostra o assunto.
  const baseDosTitulos = useId();
  const idDoTitulo = (id: IdDoAssunto): string => `${baseDosTitulos}-${id}`;
  const anterior = useRef(aberto.id);
  useEffect(() => {
    if (anterior.current === aberto.id) return;
    anterior.current = aberto.id;
    document.getElementById(`${baseDosTitulos}-${aberto.id}`)?.focus();
  }, [aberto.id, baseDosTitulos]);

  const sessoes = useChamada<SessoesPareadas>();
  const { chamar: chamarSessoes } = sessoes;
  const [porSalvar, setPorSalvar] = useState<readonly Edicao[]>([]);
  // o desfecho do último salvar de cada formulário, para o pé dizer "Salvo às" ou o erro
  const [salvos, setSalvos] = useState<Readonly<Partial<Record<Edicao, UltimoSalvar>>>>({});

  // A lista de sessões não está no snapshot: é pedida ao abrir, depois de cada revogação aceita
  // e pelo botão Atualizar. Fica aqui porque o resumo do menu depende dela.
  const pedirSessoes = useCallback(() => {
    void chamarSessoes((sinal) => app.cliente.post(ROTA_DAS_SESSOES, {}, lerSessoes, { sinal }));
  }, [chamarSessoes, app]);
  useEffect(() => { pedirSessoes(); }, [pedirSessoes]);

  // Depois da revogação aceita, quem diz se a sessão era a deste navegador é a resposta do motor
  // (`eraAtual`), não a lista que a tela tinha: sendo, a tela esquece a sessão e vai ao
  // pareamento, como a frase diz; não sendo, pede a lista de novo.
  const aoAceitar = useCallback((acao: Acao, desfecho: DesfechoAceito) => {
    if (acao.tipo !== 'revogarSessao') return;
    if (desfecho.encerrouEstaSessao) app.esquecerSessao('revogada');
    else pedirSessoes();
  }, [app, pedirSessoes]);
  const { controle: acoes, resultado, regiao } = useAcoes(app.cliente, aoAceitar);

  const marcar = useCallback((chave: Edicao, alterado: boolean) => {
    setPorSalvar((antes) => {
      if (antes.includes(chave) === alterado) return antes;
      return alterado ? [...antes, chave] : antes.filter((outra) => outra !== chave);
    });
  }, []);
  const aoMudarConta = useCallback((alterado: boolean) => marcar('conta', alterado), [marcar]);
  const aoMudarPadroes = useCallback((alterado: boolean) => marcar('padroes', alterado), [marcar]);
  const aoMudarAutomacao = useCallback((alterado: boolean) => marcar('automacao', alterado), [marcar]);
  const aoMudarRitmo = useCallback((alterado: boolean) => marcar('ritmo', alterado), [marcar]);

  // Fechar ou recarregar a página com edição por salvar pergunta antes (o navegador é quem
  // escreve a pergunta). Trocar de assunto não perde nada: todos ficam montados.
  const haPorSalvar = porSalvar.length > 0;
  useEffect(() => {
    if (!haPorSalvar) return undefined;
    const segurar = (evento: BeforeUnloadEvent): void => { evento.preventDefault(); };
    window.addEventListener('beforeunload', segurar);
    return () => window.removeEventListener('beforeunload', segurar);
  }, [haPorSalvar]);

  // O salvar tira o próprio botão da tela quando o estado novo chega: o foco vai antes à região
  // do resultado.
  const controle = useMemo<ControleDeAcoes>(() => ({
    ...acoes,
    disparar: async (acao) => {
      const formulario = SALVA_FORMULARIO.includes(acao.tipo) ? (acao.tipo as Edicao) : null;
      if (formulario) acoes.focarResultado();
      const aceito = await acoes.disparar(acao);
      if (formulario) setSalvos((antes) => ({ ...antes, [formulario]: { ok: aceito, hora: horaCurta(Date.now()) } }));
      return aceito;
    },
  }), [acoes]);

  const impedimento = impedimentoDeSalvar({ conectado: conexao === 'conectado', emDia });
  const conta = contas?.[0];

  const estados: Record<IdDoAssunto, EstadoDaLinha> = {
    conta: linhaDaConta(conta),
    regras: linhaDasRegras(conta),
    padroes: linhaDosPadroes(conta),
    claude: linhaDoPerfil(config, perfis, saude),
    jira: linhaDoJira(sites),
    ritmo: linhaDoRitmo(config),
    acesso: linhaDasSessoes(sessoes),
  };
  const assuntosPorSalvar = new Set<IdDoAssunto>(porSalvar.map((e) => EDICOES[e].assunto));
  const nomesPorSalvar = porSalvar.map((e) => EDICOES[e].nome);

  return (
    <Pagina titulo="Sistema" sub={temEstado ? 'Cada ajuste do Farol, por assunto. Escolha um no menu e abra o que quiser detalhar.' : 'Esperando o estado do motor'}>
      {haPorSalvar ? (
        <p className={ui.nota} role="status">
          Aviso: há edição por salvar nesta tela ({nomesPorSalvar.join(', ')}). Trocar de assunto não a perde; trocar de aba do Farol a descarta sem perguntar.
        </p>
      ) : null}

      {!temEstado ? (
        <Esqueleto texto="Esperando o estado do motor: os assuntos aparecem preenchidos quando ele chegar." linhas={7} />
      ) : (
        <div className={`${estilos.sistema} ${aberto.explicito ? estilos.comAssunto : estilos.semAssunto}`}>
          <nav className={estilos.menu} aria-label="Assuntos do Sistema">
            <ul className={estilos.listaDoMenu}>
              {ASSUNTOS.map(({ id, nome }) => {
                const estado = estados[id];
                const atual = id === atualNoMenu;
                return (
                  <li key={id}>
                    <Link href={rotaDoAssunto(id)} className={estilos.itemDoMenu} aria-current={atual ? 'page' : undefined} data-tom={estado.tom}>
                      <span className={estilos.nomeDoMenu}>
                        <Bolinha tom={estado.tom} rotulo={`${ROTULO_DO_TOM[estado.tom]}:`} />
                        <span>{nome}</span>
                      </span>
                      <span className={estilos.resumoDoMenu}>{assuntosPorSalvar.has(id) ? `${estado.resumo}, alteração por salvar` : estado.resumo}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className={estilos.paineis}>
            <Link href={ROTA_DO_SISTEMA} className={estilos.voltar}>Voltar aos assuntos</Link>
            <Assunto id="conta" aberto={aberto.id === 'conta'} idDoTitulo={idDoTitulo('conta')}>
              <ContaEPolitica conta={conta} controle={controle} impedimento={impedimento} aoMudar={aoMudarConta} ultimo={salvos.conta ?? null} />
            </Assunto>
            <Assunto id="regras" aberto={aberto.id === 'regras'} idDoTitulo={idDoTitulo('regras')}>
              <Regras conta={conta} controle={controle} impedimento={impedimento} />
            </Assunto>
            <Assunto id="padroes" aberto={aberto.id === 'padroes'} idDoTitulo={idDoTitulo('padroes')}>
              <Padroes conta={conta} controle={controle} impedimento={impedimento} aoMudar={aoMudarPadroes} ultimo={salvos.padroes ?? null} />
            </Assunto>
            <Assunto id="claude" aberto={aberto.id === 'claude'} idDoTitulo={idDoTitulo('claude')}>
              <PerfilDoClaude cliente={app.cliente} config={config} perfis={perfis} saude={saude} controle={controle} impedimento={impedimento} />
              <ModeloESessoes>
                <Automacao config={config} modelos={modelos} controle={controle} impedimento={impedimento} aoMudar={aoMudarAutomacao} ultimo={salvos.automacao ?? null} />
              </ModeloESessoes>
            </Assunto>
            <Assunto id="jira" aberto={aberto.id === 'jira'} idDoTitulo={idDoTitulo('jira')}>
              <Jira cliente={app.cliente} sites={sites} resolvidas={resolvidas} impedimento={impedimento} />
            </Assunto>
            <Assunto id="ritmo" aberto={aberto.id === 'ritmo'} idDoTitulo={idDoTitulo('ritmo')}>
              <Ritmo config={config} controle={controle} impedimento={impedimento} aoMudar={aoMudarRitmo} ultimo={salvos.ritmo ?? null} />
            </Assunto>
            <Assunto id="acesso" aberto={aberto.id === 'acesso'} idDoTitulo={idDoTitulo('acesso')}>
              <Sessoes controle={controle} lista={sessoes} aoAtualizar={pedirSessoes} />
            </Assunto>
          </div>
        </div>
      )}

      <AnuncioDaTela regiao={regiao} resultado={resultado} recados={recados} />
    </Pagina>
  );
}
