'use client';

// A tela Sistema: a saúde do motor, a conta revisora e a política, a automação, os perfis do
// Claude com o teto de gasto, o Jira, as sessões pareadas e as chaves que só mudam por
// arquivo. É a tela que mais pode fazer estrago, então:
// - nenhum segredo passa por ela: a borda descarta o que tiver cara de segredo
//   (src/contratos/segredos.ts), e não há campo para digitar token, chave nem credencial;
// - cada salvar mexe numa seção só, manda só o que foi editado e confere o que o motor
//   respondeu (src/sistema/acoes.ts);
// - a mudança que amplia o que o motor publica sozinho no GitHub pergunta antes;
// - só se salva com o estado da conexão atual já chegado (`estadoEmDia`).
// A tela fatia e formata: quem mede, decide e grava é o motor.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConfigDoSistema } from '@/contratos/sistema';
import type { App } from '@/estado/app';
import { app as appDoNavegador, useApp } from '@/estado/instancia';
import { impedimentoDeSalvar } from '@/sistema/acoes';
import { RegiaoDeResultado } from '../radar/RegiaoDeResultado';
import { useAcoes, type ControleDeAcoes } from '../radar/useAcoes';
import comuns from '../radar/Radar.module.css';
import { Automacao } from './Automacao';
import { ClaudeETeto } from './ClaudeETeto';
import { ContaEPolitica } from './ContaEPolitica';
import { Par } from './Formulario';
import { Jira } from './Jira';
import { Saude } from './Saude';
import { Sessoes } from './Sessoes';
import estilos from './Sistema.module.css';

const SECOES: ReadonlyArray<[string, string]> = [
  ['saude', 'Saúde'],
  ['conta', 'Conta revisora e política'],
  ['automacao', 'Automação'],
  ['claude', 'Perfil do Claude e teto de gasto'],
  ['jira', 'Jira'],
  ['sessoes', 'Sessões pareadas'],
  ['rede', 'Rede e acesso'],
];

// Como a tela chama cada edição por salvar, no aviso do topo.
function nomeDaEdicao(chave: string): string {
  if (chave === 'conta') return 'conta e política';
  if (chave === 'automacao') return 'automação';
  return 'teto de gasto';
}

// As chaves que só mudam pelo arquivo de configuração do motor, com reinício. A tela mostra e
// não edita: é por uma dessas origens que ela fala com o motor, e tirar a própria origem a
// trancaria para fora. O motor também não as aceita em POST /api/settings.
function RedeEAcesso({ config }: { config: ConfigDoSistema | undefined }) {
  return (
    <section id="rede" className={estilos.secao} aria-labelledby="titulo-da-rede">
      <h2 id="titulo-da-rede" className={estilos.tituloDaSecao}>Rede e acesso</h2>
      <p className={comuns.meta}>
        Só leitura. Estas chaves mudam apenas pelo arquivo de configuração do motor (config.json), com reinício, e o motor não as aceita pela API. É de propósito: esta tela fala com o motor por uma das origens permitidas, e tirar a própria origem daqui a trancaria para fora.
      </p>
      <dl className={estilos.campos}>
        <Par nome="Endereço em que o motor escuta (bind)">{config?.bind ?? 'O motor não informou.'}</Par>
        <Par nome="Porta (port)">{config?.port ?? 'O motor não informou.'}</Par>
        <Par nome="Nome público (hostPublico)">{config?.hostPublico === undefined ? 'Não definido, ou o motor não informou.' : config.hostPublico || 'Não definido.'}</Par>
        <Par nome="Origens permitidas (origensPermitidas)">
          {config?.origensPermitidas === undefined ? 'Nenhuma, ou o motor não informou.' : config.origensPermitidas.join(', ') || 'Nenhuma.'}
        </Par>
        <Par nome="Autenticação pelo arquivo (localAuth)">{config?.localAuth ? config.localAuth : 'Não definida: o motor decide pela rede (nome público, origens e bind).'}</Par>
      </dl>
    </section>
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
  const [recargaDasSessoes, setRecargaDasSessoes] = useState(0);
  // as edições por salvar: "conta", "automacao" e "teto:<id do perfil>"
  const [porSalvar, setPorSalvar] = useState<readonly string[]>([]);

  const marcar = useCallback((chave: string, alterado: boolean) => {
    setPorSalvar((antes) => {
      if (antes.includes(chave) === alterado) return antes;
      return alterado ? [...antes, chave] : antes.filter((outra) => outra !== chave);
    });
  }, []);
  const aoMudarConta = useCallback((alterado: boolean) => marcar('conta', alterado), [marcar]);
  const aoMudarAutomacao = useCallback((alterado: boolean) => marcar('automacao', alterado), [marcar]);
  const aoMudarTeto = useCallback((perfil: string, alterado: boolean) => marcar(`teto:${perfil}`, alterado), [marcar]);

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
  // região do resultado. Revogar a sessão deste navegador leva ao pareamento de fato; revogar
  // outra pede a lista de novo.
  const controle = useMemo<ControleDeAcoes>(() => ({
    ...acoes,
    disparar: async (acao) => {
      if (acao.tipo === 'conta' || acao.tipo === 'automacao' || acao.tipo === 'teto') acoes.focarResultado();
      const aceito = await acoes.disparar(acao);
      if (aceito && acao.tipo === 'revogarSessao') {
        if (acao.atual) app.esquecerSessao('revogada');
        else setRecargaDasSessoes((n) => n + 1);
      }
      return aceito;
    },
  }), [acoes, app]);

  const impedimento = impedimentoDeSalvar({ conectado: conexao === 'conectado', emDia });
  const nomesPorSalvar = [...new Set(porSalvar.map(nomeDaEdicao))];

  return (
    <div className={estilos.sistema}>
      <h1 className={comuns.titulo}>Sistema</h1>

      <nav className={estilos.indice} aria-label="Seções do Sistema">
        <ul>
          {SECOES.map(([id, nome]) => <li key={id}><a href={`#${id}`}>{nome}</a></li>)}
        </ul>
      </nav>

      {!temEstado ? <p className={comuns.nota} role="status">Esperando o estado do motor: as seções aparecem preenchidas quando ele chegar.</p> : null}
      {haPorSalvar ? (
        <p className={comuns.nota} role="status">
          Aviso: há edição por salvar nesta tela ({nomesPorSalvar.join(', ')}). Trocar de aba do Farol a descarta sem perguntar.
        </p>
      ) : null}

      <Saude cliente={app.cliente} saude={saude} modelos={modelos} perfis={perfis} conta={contas?.[0]} versao={versao} />
      <ContaEPolitica conta={contas?.[0]} controle={controle} impedimento={impedimento} aoMudar={aoMudarConta} />
      <Automacao config={config} modelos={modelos} controle={controle} impedimento={impedimento} aoMudar={aoMudarAutomacao} />
      <ClaudeETeto cliente={app.cliente} config={config} perfis={perfis} saude={saude} controle={controle} impedimento={impedimento} aoMudar={aoMudarTeto} />
      <Jira cliente={app.cliente} sites={sites} />
      <Sessoes cliente={app.cliente} controle={controle} recarga={recargaDasSessoes} />
      <RedeEAcesso config={config} />

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
