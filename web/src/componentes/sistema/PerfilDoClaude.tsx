'use client';

// Os perfis do Claude no assunto Claude: na ordem em que o motor os usa (src/sistema/perfis.ts),
// cada um fechado numa linha com a posição, o nome, o tipo e o estado, e aberto num clique com o
// uso do plano, a validade do login, qual é o padrão e as ações: Testar, Refazer login (só o de
// assinatura, pelo fluxo login-web do motor) e Subir na ordem. O perfil por chave de API não tem
// login: a chave entra e muda só pela API do motor, e a tela diz isso no lugar do botão.
//
// Decisão de 16/11/2026: o revisor não trava por gasto. O motor não tem teto, e a tela não
// mostra, não edita nem avisa teto. Esta tela não cria nem remove perfil, e não tem campo para
// a chave de API.
import { useId, useState } from 'react';
import { Botao, Chip, ui, type Tom } from '@/componentes/ui';
import { lerTesteDePerfil, type CampoDoTeste, type ConfigDoSistema, type PerfilDoClaude as Perfil, type PerfisDoClaude, type Saude, type TesteDePerfil, type UsoDoPlano } from '@/contratos/sistema';
import type { Acao } from '@/radar/acoes';
import { dataHora } from '@/radar/formato';
import { SO_PELA_API, entraPorLogin } from '@/sistema/login-web';
import { corpoDeSubir, idDoPadrao, impedimentoDaOrdem, nomeDoPerfil, ordemDeUso } from '@/sistema/perfis';
import type { Cliente } from '@/transporte/cliente';
import type { ControleDeAcoes } from '../radar/useAcoes';
import { AcaoComPergunta } from './AcaoComPergunta';
import { Par } from './Formulario';
import { LoginWeb } from './LoginWeb';
import { useChamada } from './useChamada';
import estilos from './Sistema.module.css';

export const ROTA_DO_TESTE_DE_PERFIL = '/api/claude/profile-test';
export const ALVO_DA_ORDEM = 'sistema:ordem-dos-perfis';

const TIPO: Record<string, string> = { dir: 'Assinatura', apikey: 'Chave de API' };
const NOME_DO_CAMPO: Record<string, string> = { tipoAuth: 'Tipo de autenticação', chave: 'Chave', login: 'Login', email: 'E-mail', plano: 'Plano' };
const ORIGEM: Record<string, string> = {
  informado: 'informado na configuração',
  validado: 'validado pelo Claude Code',
  detectado: 'lido dos arquivos da pasta',
  inferido: 'inferido',
  desconhecido: 'desconhecido',
};

function textoDaCredencial(perfil: Perfil, pronto: boolean | undefined): string {
  if (perfil.kind === 'apikey') {
    if (perfil.temChave === true) return 'Chave presente. O motor não informa se ela vale: conferir exigiria uma chamada paga à Anthropic.';
    return perfil.temChave === false ? 'Chave ausente.' : 'O motor não informou.';
  }
  if (pronto === true) return 'Login presente na pasta do perfil. Se ele ainda vale, quem diz é o Testar ou a próxima sessão.';
  return pronto === false ? 'Sem login: a sessão de revisão não abre com este perfil.' : 'O motor não informou.';
}

function textoDoLogin(uso: UsoDoPlano | undefined): string | null {
  if (!uso?.venceEm) return null;
  const quando = dataHora(uso.venceEm) || 'data não informada';
  if (uso.faixaDoLogin === 'vencido') return `Vencido em ${quando}: o login precisa ser refeito.`;
  return uso.faixaDoLogin ? `Vence em ${quando}: refaça o login antes disso.` : `Vale até ${quando}.`;
}

function textoDoCampo(campo: CampoDoTeste): string {
  const valor = campo.valor === true ? 'sim' : campo.valor === false ? 'não' : campo.valor ?? 'não informado';
  const origem = campo.origem ? ORIGEM[campo.origem] ?? campo.origem : 'origem não informada';
  return `${valor} (${origem}${campo.motivo ? `: ${campo.motivo}` : ''})`;
}

function ResultadoDoTeste({ teste }: { teste: TesteDePerfil }) {
  if (!teste.ok) return <p className={ui.erro}>Erro: o motor não testou o perfil{teste.motivo ? `: ${teste.motivo}` : teste.code ? ` (${teste.code})` : ' e não disse o motivo'}.</p>;
  return (
    <>
      <p className={ui.mini}>O motor testou o perfil e não gravou nada.{teste.aviso ? ` Aviso: ${teste.aviso}.` : ''}</p>
      <dl className={estilos.pares}>
        {Object.entries(teste.campos).map(([nome, campo]) => <Par key={nome} nome={NOME_DO_CAMPO[nome] ?? nome}>{textoDoCampo(campo)}</Par>)}
      </dl>
    </>
  );
}

// O uso de uma janela do plano: o texto e uma barra decorativa (a largura é atributo do SVG,
// porque a CSP recusa estilo em linha).
function UsoDaJanela({ nome, usado, volta, desatualizado }: { nome: string; usado: number | undefined; volta?: string; desatualizado?: boolean }) {
  const pct = usado === undefined ? null : Math.max(0, Math.min(100, Math.round(usado * 100)));
  const texto = `${pct === null ? 'sem dado' : `${pct}% usado`}${volta ? `, volta ${volta}` : ''}${desatualizado ? ' (leitura desatualizada)' : ''}`;
  return (
    <div className={estilos.janela}>
      <div className={estilos.cabecaDaJanela}>
        <span className={estilos.nome}>Uso do plano: {nome}</span>
        <span className={ui.mini}>{texto}</span>
      </div>
      {pct !== null ? (
        <span className={estilos.barraDoUso} aria-hidden="true">
          <svg viewBox="0 0 100 8" preserveAspectRatio="none" focusable="false">
            <rect className={estilos.cheioDoUso} x={0} y={0} width={pct} height={8} />
          </svg>
        </span>
      ) : null}
    </div>
  );
}

function estadoDoPerfil(perfil: Perfil, pronto: boolean | undefined, uso: UsoDoPlano | undefined): { tom: Tom; texto: string } {
  if (perfil.kind === 'apikey') {
    if (perfil.temChave === true) return { tom: 'ok', texto: 'Chave presente' };
    return { tom: perfil.temChave === false ? 'ruim' : 'neutro', texto: perfil.temChave === false ? 'Sem chave' : 'Sem dado' };
  }
  if (uso?.faixaDoLogin === 'vencido') return { tom: 'ruim', texto: 'Login vencido' };
  if (pronto === true) return uso?.faixaDoLogin ? { tom: 'aviso', texto: 'Login perto de vencer' } : { tom: 'ok', texto: 'Pronto' };
  return { tom: pronto === false ? 'ruim' : 'neutro', texto: pronto === false ? 'Sem login' : 'Sem dado' };
}

interface PropsDoPerfil {
  perfil: Perfil;
  posicao: number;
  padrao: boolean;
  pronto: boolean | undefined;
  uso: UsoDoPlano | undefined;
  cliente: Pick<Cliente, 'post'>;
  controle: ControleDeAcoes;
  subir: Acao | null;
  impedimentoDaOrdem: string | null;
  impedimento: string | null;
  // o nome de outro perfil pelo id (o login aberto no motor pode ser de outro)
  nomeDoOutro(id: string): string;
}

function LinhaDoPerfil({ perfil, posicao, padrao, pronto, uso, cliente, controle, subir, impedimentoDaOrdem: semOrdem, impedimento, nomeDoOutro }: PropsDoPerfil) {
  const [aberto, setAberto] = useState(false);
  const teste = useChamada<TesteDePerfil>();
  const idDoDetalhe = useId();
  const nome = nomeDoPerfil(perfil);
  const login = textoDoLogin(uso);
  const deChave = perfil.kind === 'apikey';
  const estado = estadoDoPerfil(perfil, pronto, uso);

  return (
    <li className={estilos.perfil} data-padrao={padrao ? 'sim' : undefined}>
      <h3 className={estilos.cabecaDoPerfil}>
        <button type="button" className={estilos.abreOPerfil} aria-expanded={aberto} aria-controls={idDoDetalhe} onClick={() => setAberto((antes) => !antes)}>
          <span className={estilos.posicao} aria-hidden="true">{posicao}</span>
          <span className={estilos.nomeDoPerfil}>
            <span className={estilos.nome}>{nome}</span>
            <span className={ui.mini}>{TIPO[perfil.kind ?? ''] ?? 'Tipo que esta tela não conhece'}{padrao ? ' · perfil padrão' : ''}</span>
          </span>
          <Chip pequeno tom={estado.tom}>{estado.texto}</Chip>
          <svg className={estilos.seta} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      </h3>
      <div id={idDoDetalhe} className={estilos.detalheDoPerfil} hidden={!aberto}>
        {uso?.lido && uso.ok !== false ? uso.janelas.map((janela, i) => (
          <UsoDaJanela key={i} nome={janela.nome ?? 'janela'} usado={janela.usado} volta={janela.resetTexto} desatualizado={uso.desatualizado} />
        )) : null}
        <dl className={estilos.pares}>
          <Par nome="Na ordem de uso">{padrao ? `${posicao}º, o perfil padrão: a sessão começa por ele` : `${posicao}º: entra quando os de cima estão no limite do plano`}</Par>
          <Par nome="Credencial">{textoDaCredencial(perfil, pronto)}</Par>
          {login ? <Par nome="Validade do login">{login}</Par> : null}
          {!deChave && !login ? <Par nome="Validade do login">O motor ainda não leu a validade deste login.</Par> : null}
          {perfil.baseUrl ? <Par nome="Endereço para onde a chave vai">{perfil.baseUrl}</Par> : null}
          {uso?.lido && uso.ok === false ? <Par nome="Uso do plano">O motor não conseguiu ler o uso do plano{uso.erro ? `: ${uso.erro}` : ''}.</Par> : null}
          {!uso?.lido && !deChave ? <Par nome="Uso do plano">O motor ainda não leu o uso do plano deste perfil.</Par> : null}
        </dl>

        <p className={ui.mini}>
          {deChave
            ? 'Testar confere só que o perfil existe e que tem chave preenchida. Não chama a Anthropic: não consome nada, e por isso não prova que a chave vale. Nada é gravado.'
            : 'Testar roda a verificação de login do Claude Code no motor, contra uma cópia da configuração do perfil: diz se há login e de quem. Não chama modelo, não consome o plano e não grava nada.'}
        </p>
        <div className={ui.fila}>
          <Botao
            pequeno
            ocupado={teste.carregando ? 'Testando…' : false}
            aria-label={teste.carregando ? `Testando o perfil ${nome}` : `Testar o perfil ${nome}`}
            onClick={() => { void teste.chamar((sinal) => cliente.post(ROTA_DO_TESTE_DE_PERFIL, { profileId: perfil.id }, lerTesteDePerfil, { sinal })); }}
          >
            Testar
          </Botao>
          {subir && !semOrdem && !impedimento ? <AcaoComPergunta acao={subir} controle={controle} ocupado="Subindo…" pequeno /> : null}
        </div>
        {posicao > 1 && semOrdem ? <p className={ui.nota}>Subir na ordem fechado: {semOrdem}</p> : null}
        {posicao > 1 && !semOrdem && impedimento ? <p className={ui.nota}>Subir na ordem fechado: {impedimento}</p> : null}
        <div role="status" aria-live="polite" aria-label={`Resultado do teste do perfil ${nome}`}>
          {teste.carregando ? <p className={ui.mini}>O motor está testando o perfil.</p> : null}
          {!teste.carregando && teste.erro ? <p className={ui.erro}>Erro: {teste.erro}</p> : null}
          {!teste.carregando && !teste.erro && teste.dados ? <ResultadoDoTeste teste={teste.dados} /> : null}
        </div>

        {entraPorLogin(perfil.kind) ? (
          <LoginWeb cliente={cliente} profileId={perfil.id} nome={nome} impedimento={impedimento} nomeDoPerfil={nomeDoOutro} />
        ) : (
          <p className={ui.mini}>{SO_PELA_API}</p>
        )}
      </div>
    </li>
  );
}

interface Props {
  cliente: Pick<Cliente, 'post'>;
  config: ConfigDoSistema | undefined;
  perfis: PerfisDoClaude | undefined;
  saude: Saude | null | undefined;
  controle: ControleDeAcoes;
  impedimento: string | null;
}

export function PerfilDoClaude({ cliente, config, perfis, saude, controle, impedimento }: Props) {
  const lista = config?.claudeProfiles;
  const segredos = config?.segredosDescartados ?? 0;
  const ordem = ordemDeUso(config);
  const padrao = idDoPadrao(config);
  const semOrdem = impedimentoDaOrdem(config);

  const nomeDoOutro = (id: string): string => {
    const outro = lista?.find((p) => p.id === id);
    return outro ? nomeDoPerfil(outro) : id;
  };

  const acaoDeSubir = (perfil: Perfil): Acao | null => {
    const corpo = corpoDeSubir(config, perfil.id);
    return corpo ? { tipo: 'ordemDosPerfis', alvo: ALVO_DA_ORDEM, nome: nomeDoPerfil(perfil), perfil: perfil.id, corpo } : null;
  };

  return (
    <>
      <p className={ui.mini}>
        O motor começa pelo primeiro perfil da lista que não está no limite do plano e, no limite, passa sozinho para o próximo. Clique num perfil para ver o uso do plano, a validade do login e as ações.
      </p>
      {segredos > 0 ? (
        <p className={ui.erro} role="alert">
          Atenção: o motor mandou {segredos} campo(s) com cara de segredo junto dos perfis. Esta tela os descartou sem guardar nem mostrar, mas isso é defeito do motor: avise quem o mantém.
        </p>
      ) : null}
      {!lista ? <p className={ui.nota}>Atenção: o motor não mandou a lista de perfis do Claude a esta tela.</p> : null}
      {lista && !lista.length ? <p className={ui.vazio}>O motor não tem perfil do Claude: nenhuma sessão de revisão abre até um perfil ser criado no motor, pela API.</p> : null}
      {lista?.length && !padrao ? <p className={ui.nota}>Aviso: nenhum perfil está marcado como padrão no motor: a sessão começa pelo primeiro utilizável da lista.</p> : null}
      {ordem.length ? (
        <ol className={estilos.perfis} aria-label="Perfis do Claude, na ordem de uso">
          {ordem.map((perfil, i) => (
            <LinhaDoPerfil
              key={perfil.id}
              perfil={perfil}
              posicao={i + 1}
              padrao={padrao === perfil.id}
              pronto={saude?.claudeAuth.find((p) => p.id === perfil.id)?.ready}
              uso={perfis && Object.hasOwn(perfis.uso, perfil.id) ? perfis.uso[perfil.id] : undefined}
              cliente={cliente}
              controle={controle}
              subir={i > 0 ? acaoDeSubir(perfil) : null}
              impedimentoDaOrdem={semOrdem}
              impedimento={impedimento}
              nomeDoOutro={nomeDoOutro}
            />
          ))}
        </ol>
      ) : null}
      <p className={ui.mini}>Criar ou remover perfil e trocar a chave de API são só pela API do motor: esta tela não tem campo para a chave.</p>
    </>
  );
}
