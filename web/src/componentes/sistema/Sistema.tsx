'use client';

// A tela Sistema, no desenho enxuto: o título com quantos pontos pedem atenção e sete linhas
// (saúde, conta e política, automação, perfil do Claude, Jira, sessões pareadas, rede e
// acesso), cada uma com a bolinha de estado, o título e um resumo; o formulário ou o detalhe
// abre num clique. Não há teto de gasto (decisão de 16/11/2026) e o revisor nunca espera
// (desenho de 17/11/2026): a tela não oferece `wait` na política nem a espera do CI. É a tela
// que mais pode fazer estrago, então:
// - nenhum segredo passa por ela: a borda descarta o que tiver cara de segredo
//   (src/contratos/segredos.ts), e não há campo para digitar token, chave nem credencial;
// - cada salvar mexe numa seção só, manda só o que a pessoa alterou nesta edição e confere o
//   que o motor respondeu (src/sistema/acoes.ts);
// - a mudança que amplia o que o motor publica sozinho no GitHub pergunta antes;
// - só se salva com o estado da conexão atual já chegado (`estadoEmDia`).
// A tela fatia e formata: quem mede, decide e grava é o motor.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bolinha, Esqueleto, Linha, Pagina, ui } from '@/componentes/ui';
import { lerSessoes, type ConfigDoSistema, type SessoesPareadas } from '@/contratos/sistema';
import type { App } from '@/estado/app';
import { app as appDoNavegador, useApp } from '@/estado/instancia';
import { dataHora, horaCurta } from '@/radar/formato';
import { impedimentoDeSalvar } from '@/sistema/acoes';
import {
  ROTULO_DO_TOM, fraseDoTopo, linhaDaAutomacao, linhaDaConta, linhaDaRede, linhaDaSaude, linhaDasSessoes, linhaDoJira, linhaDoPerfil,
  type EstadoDaLinha,
} from '@/sistema/linhas';
import { todasAsVerificacoes } from '@/sistema/saude';
import { RegiaoDeResultado } from '../radar/RegiaoDeResultado';
import { useAcoes, type ControleDeAcoes } from '../radar/useAcoes';
import { Automacao } from './Automacao';
import { ContaEPolitica } from './ContaEPolitica';
import { Par, type UltimoSalvar } from './Formulario';
import { Jira } from './Jira';
import { PerfilDoClaude } from './PerfilDoClaude';
import { Saude } from './Saude';
import { ROTA_DAS_SESSOES, Sessoes } from './Sessoes';
import { useChamada } from './useChamada';
import estilos from './Sistema.module.css';

// Como a tela chama cada edição por salvar, no aviso do topo.
function nomeDaEdicao(chave: string): string {
  return chave === 'conta' ? 'conta e política' : 'automação';
}

// O resumo da linha fechada: a bolinha (com o estado escrito para o leitor), o título e o
// resumo à direita. Só texto: nada clicável dentro do <summary>.
function Resumo({ titulo, estado, porSalvar }: { titulo: string; estado: EstadoDaLinha; porSalvar?: boolean }) {
  return (
    <>
      <Bolinha tom={estado.tom} rotulo={`${ROTULO_DO_TOM[estado.tom]}:`} />
      <span className={`${ui.t} ${estilos.tituloDaLinha}`}>{titulo}</span>
      <span className={`${ui.r} ${estilos.resumoDaLinha}`}>{porSalvar ? `${estado.resumo}, alteração por salvar` : estado.resumo}</span>
    </>
  );
}

function SecaoEmLinha({ titulo, estado, porSalvar, children }: { titulo: string; estado: EstadoDaLinha; porSalvar?: boolean; children: ReactNode }) {
  return (
    <Linha rotulo={titulo} resumo={<Resumo titulo={titulo} estado={estado} porSalvar={porSalvar} />}>
      {children}
    </Linha>
  );
}

// As chaves que só mudam pelo arquivo de configuração do motor, com reinício. A tela mostra e
// não edita: é por uma dessas origens que ela fala com o motor, e tirar a própria origem a
// trancaria para fora. O motor também não as aceita em POST /api/settings.
function RedeEAcesso({ config }: { config: ConfigDoSistema | undefined }) {
  return (
    <>
      <dl className={estilos.pares}>
        <Par nome="Endereço em que o motor escuta (bind)">{config?.bind ?? 'O motor não informou.'}</Par>
        <Par nome="Porta (port)">{config?.port ?? 'O motor não informou.'}</Par>
        <Par nome="Nome público (hostPublico)">{config?.hostPublico === undefined ? 'Não definido, ou o motor não informou.' : config.hostPublico || 'Não definido.'}</Par>
        <Par nome="Origens permitidas (origensPermitidas)">
          {config?.origensPermitidas === undefined ? 'Nenhuma, ou o motor não informou.' : config.origensPermitidas.join(', ') || 'Nenhuma.'}
        </Par>
        <Par nome="Autenticação pelo arquivo (localAuth)">{config?.localAuth ? config.localAuth : 'Não definida: o motor decide pela rede (nome público, origens e bind).'}</Par>
      </dl>
      <p className={ui.mini}>
        Só leitura. Estas chaves mudam apenas pelo arquivo de configuração do motor (config.json), com reinício, e o motor não as aceita pela API. É de propósito: esta tela fala com o motor por uma das origens permitidas, e tirar a própria origem daqui a trancaria para fora.
      </p>
    </>
  );
}

interface Props {
  // existe para o teste trocar a instância
  app?: App;
}

export function Sistema({ app = appDoNavegador }: Props) {
  const saude = useApp((e) => e.snapshot?.doctor, app);
  const modelos = useApp((e) => e.snapshot?.modelos, app);
  const perfis = useApp((e) => e.snapshot?.claudePerfis, app);
  const contas = useApp((e) => e.snapshot?.accounts, app);
  const config = useApp((e) => e.snapshot?.config, app);
  const sites = useApp((e) => e.snapshot?.jiraSites, app);
  const versao = useApp((e) => e.snapshot?.app?.version ?? '', app);
  const temEstado = useApp((e) => e.snapshot !== null, app);
  const conexao = useApp((e) => e.conexao, app);
  const emDia = useApp((e) => e.estadoEmDia, app);
  const recados = useApp((e) => e.recados, app);

  const { controle: acoes, resultado, dispensar, regiao } = useAcoes(app.cliente);
  const sessoes = useChamada<SessoesPareadas>();
  const { chamar: chamarSessoes } = sessoes;
  // as edições por salvar: "conta" e "automacao"
  const [porSalvar, setPorSalvar] = useState<readonly string[]>([]);
  // o desfecho do último salvar de cada seção, para o pé dizer "Salvo às" ou o erro
  const [salvos, setSalvos] = useState<Readonly<Record<string, UltimoSalvar>>>({});

  // A lista de sessões não está no snapshot: é pedida ao abrir, depois de cada encerramento
  // aceito e pelo botão Atualizar. Fica aqui porque o resumo da linha depende dela.
  const pedirSessoes = useCallback(() => {
    void chamarSessoes((sinal) => app.cliente.post(ROTA_DAS_SESSOES, {}, lerSessoes, { sinal }));
  }, [chamarSessoes, app]);
  useEffect(() => { pedirSessoes(); }, [pedirSessoes]);

  const marcar = useCallback((chave: string, alterado: boolean) => {
    setPorSalvar((antes) => {
      if (antes.includes(chave) === alterado) return antes;
      return alterado ? [...antes, chave] : antes.filter((outra) => outra !== chave);
    });
  }, []);
  const aoMudarConta = useCallback((alterado: boolean) => marcar('conta', alterado), [marcar]);
  const aoMudarAutomacao = useCallback((alterado: boolean) => marcar('automacao', alterado), [marcar]);

  // Fechar ou recarregar a página com edição por salvar pergunta antes (o navegador é quem
  // escreve a pergunta). Trocar de aba do Farol não passa por aqui: a tela avisa no topo.
  const haPorSalvar = porSalvar.length > 0;
  useEffect(() => {
    if (!haPorSalvar) return undefined;
    const segurar = (evento: BeforeUnloadEvent): void => { evento.preventDefault(); };
    window.addEventListener('beforeunload', segurar);
    return () => window.removeEventListener('beforeunload', segurar);
  }, [haPorSalvar]);

  // O salvar tira o próprio botão da tela quando o estado novo chega: o foco vai antes à
  // região do resultado. Encerrar a sessão deste navegador leva ao pareamento de fato;
  // encerrar outra pede a lista de novo.
  const controle = useMemo<ControleDeAcoes>(() => ({
    ...acoes,
    disparar: async (acao) => {
      const salvar = acao.tipo === 'conta' || acao.tipo === 'automacao';
      if (salvar) acoes.focarResultado();
      const aceito = await acoes.disparar(acao);
      if (salvar) setSalvos((antes) => ({ ...antes, [acao.tipo]: { ok: aceito, hora: horaCurta(Date.now()) } }));
      if (aceito && acao.tipo === 'revogarSessao') {
        if (acao.atual) app.esquecerSessao('revogada');
        else pedirSessoes();
      }
      return aceito;
    },
  }), [acoes, app, pedirSessoes]);

  const impedimento = impedimentoDeSalvar({ conectado: conexao === 'conectado', emDia });
  const nomesPorSalvar = [...new Set(porSalvar.map(nomeDaEdicao))];
  const conta = contas?.[0];
  const verificacoes = todasAsVerificacoes(saude, modelos?.cli, perfis, conta, (ms) => dataHora(ms) || 'hora não informada');

  const estados = {
    saude: linhaDaSaude(saude, verificacoes),
    conta: linhaDaConta(conta),
    automacao: linhaDaAutomacao(config, modelos),
    claude: linhaDoPerfil(config, perfis, saude),
    jira: linhaDoJira(sites),
    sessoes: linhaDasSessoes(sessoes),
    rede: linhaDaRede(config),
  };

  return (
    <Pagina titulo="Sistema" sub={temEstado ? fraseDoTopo(Object.values(estados)) : 'Esperando o estado do motor'} estreita>
      {haPorSalvar ? (
        <p className={ui.nota} role="status">
          Aviso: há edição por salvar nesta tela ({nomesPorSalvar.join(', ')}). Trocar de aba do Farol a descarta sem perguntar.
        </p>
      ) : null}

      {!temEstado ? (
        <Esqueleto texto="Esperando o estado do motor: as seções aparecem preenchidas quando ele chegar." linhas={7} />
      ) : (
        <div className={ui.lista}>
          <SecaoEmLinha titulo="Saúde" estado={estados.saude}>
            <Saude cliente={app.cliente} saude={saude} verificacoes={verificacoes} versao={versao} />
          </SecaoEmLinha>
          <SecaoEmLinha titulo="Conta revisora e política" estado={estados.conta} porSalvar={porSalvar.includes('conta')}>
            <ContaEPolitica conta={conta} controle={controle} impedimento={impedimento} aoMudar={aoMudarConta} ultimo={salvos.conta ?? null} />
          </SecaoEmLinha>
          <SecaoEmLinha titulo="Automação" estado={estados.automacao} porSalvar={porSalvar.includes('automacao')}>
            <Automacao config={config} modelos={modelos} controle={controle} impedimento={impedimento} aoMudar={aoMudarAutomacao} ultimo={salvos.automacao ?? null} />
          </SecaoEmLinha>
          <SecaoEmLinha titulo="Perfil do Claude" estado={estados.claude}>
            <PerfilDoClaude cliente={app.cliente} config={config} perfis={perfis} saude={saude} />
          </SecaoEmLinha>
          <SecaoEmLinha titulo="Jira" estado={estados.jira}>
            <Jira cliente={app.cliente} sites={sites} />
          </SecaoEmLinha>
          <SecaoEmLinha titulo="Sessões pareadas" estado={estados.sessoes}>
            <Sessoes controle={controle} lista={sessoes} aoAtualizar={pedirSessoes} />
          </SecaoEmLinha>
          <SecaoEmLinha titulo="Rede e acesso" estado={estados.rede}>
            <RedeEAcesso config={config} />
          </SecaoEmLinha>
        </div>
      )}

      <RegiaoDeResultado
        regiao={regiao}
        resultado={resultado}
        recados={recados}
        aoDispensar={() => {
          dispensar();
          app.dispensarRecados();
        }}
      />
    </Pagina>
  );
}
