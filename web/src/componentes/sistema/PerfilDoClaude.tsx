'use client';

// A seção Perfil do Claude: os perfis que o motor tem, o tipo de cada um, se a credencial está
// presente (só a presença: chave e login nunca saem do motor) e o teste do perfil. Só leitura:
// esta tela não cria perfil, não digita chave, não faz login e não tem teto de gasto. Nenhum
// POST /api/settings com `claudeProfiles` sai daqui.
//
// Decisão de 16/11/2026: o revisor não trava por gasto, e a tela não mostra nem edita teto. O
// gate de orçamento ainda existe no motor e sai dele em mudança própria; enquanto existir, o
// perfil que traz teto no arquivo ganha um aviso só de leitura.
import { useId } from 'react';
import { lerTesteDePerfil, type CampoDoTeste, type ConfigDoSistema, type PerfilDoClaude as Perfil, type PerfisDoClaude, type Saude, type TesteDePerfil, type UsoDoPlano } from '@/contratos/sistema';
import { dataHora } from '@/radar/formato';
import type { Cliente } from '@/transporte/cliente';
import comuns from '../radar/Radar.module.css';
import { Par } from './Formulario';
import { useChamada } from './useChamada';
import estilos from './Sistema.module.css';

export const ROTA_DO_TESTE_DE_PERFIL = '/api/claude/profile-test';

export const AVISO_DE_TETO = 'Aviso: este perfil tem teto de gasto configurado no arquivo do motor; ele ainda pode pausar revisões automáticas até o teto ser removido do motor.';

const TIPO: Record<string, string> = { dir: 'Assinatura', apikey: 'Chave de API' };
const NOME_DO_CAMPO: Record<string, string> = { tipoAuth: 'Tipo de autenticação', chave: 'Chave', login: 'Login', email: 'E-mail', plano: 'Plano' };
const ORIGEM: Record<string, string> = {
  informado: 'informado na configuração',
  validado: 'validado pelo Claude Code',
  detectado: 'lido dos arquivos da pasta',
  inferido: 'inferido',
  desconhecido: 'desconhecido',
};

const nomeDoPerfil = (perfil: Perfil): string => perfil.label || perfil.id;

function textoDaCredencial(perfil: Perfil, pronto: boolean | undefined): string {
  if (perfil.kind === 'apikey') {
    if (perfil.temChave === true) return 'Chave presente. O motor não informa se ela vale: conferir exigiria uma chamada paga à Anthropic.';
    return perfil.temChave === false ? 'Chave ausente.' : 'O motor não informou.';
  }
  if (pronto === true) return 'Login presente na pasta do perfil. Se ele ainda vale, quem diz é o teste abaixo ou a próxima sessão.';
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
  if (!teste.ok) return <p className={comuns.erroDoCampo}>Erro: o motor não testou o perfil{teste.motivo ? `: ${teste.motivo}` : teste.code ? ` (${teste.code})` : ' e não disse o motivo'}.</p>;
  return (
    <>
      <p className={comuns.nota}>O motor testou o perfil e não gravou nada.{teste.aviso ? ` Aviso: ${teste.aviso}.` : ''}</p>
      <dl className={estilos.campos}>
        {Object.entries(teste.campos).map(([nome, campo]) => <Par key={nome} nome={NOME_DO_CAMPO[nome] ?? nome}>{textoDoCampo(campo)}</Par>)}
      </dl>
    </>
  );
}

interface PropsDoPerfil {
  perfil: Perfil;
  cliente: Pick<Cliente, 'post'>;
  padrao: boolean;
  pronto: boolean | undefined;
  uso: UsoDoPlano | undefined;
}

function CartaoDoPerfil({ perfil, cliente, padrao, pronto, uso }: PropsDoPerfil) {
  const teste = useChamada<TesteDePerfil>();
  const nome = nomeDoPerfil(perfil);
  const login = textoDoLogin(uso);
  const deChave = perfil.kind === 'apikey';

  return (
    <li className={estilos.item}>
      <h3 className={estilos.tituloDoItem}>
        <span>{nome}</span>
        <span className={comuns.selo}>{TIPO[perfil.kind ?? ''] ?? 'Tipo que esta tela não conhece'}</span>
        {padrao ? <span className={comuns.selo}>Perfil padrão</span> : null}
      </h3>
      <dl className={estilos.campos}>
        <Par nome="Credencial">{textoDaCredencial(perfil, pronto)}</Par>
        {login ? <Par nome="Validade do login">{login}</Par> : null}
        {perfil.baseUrl ? <Par nome="Endereço para onde a chave vai">{perfil.baseUrl}</Par> : null}
        {uso?.lido && uso.ok === false ? <Par nome="Uso do plano">O motor não conseguiu ler o uso do plano{uso.erro ? `: ${uso.erro}` : ''}.</Par> : null}
        {uso?.lido && uso.ok !== false ? uso.janelas.map((janela, i) => (
          <Par key={i} nome={`Uso do plano: ${janela.nome ?? 'janela'}`}>
            {janela.usado === undefined ? 'sem dado' : `${Math.round(janela.usado * 100)}% usado`}{janela.resetTexto ? `, volta ${janela.resetTexto}` : ''}{uso.desatualizado ? ' (leitura desatualizada)' : ''}
          </Par>
        )) : null}
      </dl>
      {perfil.temTeto ? <p className={comuns.nota}>{AVISO_DE_TETO}</p> : null}

      <p className={comuns.meta}>
        {deChave
          ? 'Testar confere só que o perfil existe e que tem chave preenchida. Não chama a Anthropic: não consome nada, e por isso não prova que a chave vale. Nada é gravado.'
          : 'Testar roda a verificação de login do Claude Code no motor, contra uma cópia da configuração do perfil: diz se há login e de quem. Não chama modelo, não consome o plano e não grava nada.'}
      </p>
      <div className={comuns.botoes}>
        <button
          type="button"
          className={comuns.botao}
          disabled={teste.carregando}
          aria-label={teste.carregando ? `Testando o perfil ${nome}` : `Testar o perfil ${nome}`}
          onClick={() => { void teste.chamar((sinal) => cliente.post(ROTA_DO_TESTE_DE_PERFIL, { profileId: perfil.id }, lerTesteDePerfil, { sinal })); }}
        >
          {teste.carregando ? 'Testando…' : 'Testar perfil'}
        </button>
      </div>
      <div role="status" aria-live="polite" aria-label={`Resultado do teste do perfil ${nome}`}>
        {teste.carregando ? <p className={comuns.meta}>O motor está testando o perfil.</p> : null}
        {!teste.carregando && teste.erro ? <p className={comuns.erroDoCampo}>Erro: {teste.erro}</p> : null}
        {!teste.carregando && !teste.erro && teste.dados ? <ResultadoDoTeste teste={teste.dados} /> : null}
      </div>
    </li>
  );
}

interface Props {
  cliente: Pick<Cliente, 'post'>;
  config: ConfigDoSistema | undefined;
  perfis: PerfisDoClaude | undefined;
  saude: Saude | null | undefined;
}

export function PerfilDoClaude({ cliente, config, perfis, saude }: Props) {
  const idDoTitulo = useId();
  const lista = config?.claudeProfiles;
  const segredos = config?.segredosDescartados ?? 0;

  return (
    <section id="claude" className={estilos.secao} aria-labelledby={idDoTitulo}>
      <h2 id={idDoTitulo} className={estilos.tituloDaSecao}>Perfil do Claude</h2>
      <p className={comuns.meta}>
        O motor roda as sessões de revisão com o perfil padrão, se ele estiver utilizável; senão, com o primeiro utilizável da lista. Esta seção é só leitura: criar ou tirar perfil, digitar chave de API e fazer o login da assinatura não se fazem por esta tela, que não tem campo para segredo.
      </p>
      {segredos > 0 ? (
        <p className={`${comuns.nota} ${comuns.bloqueio}`} role="alert">
          Atenção: o motor mandou {segredos} campo(s) com cara de segredo junto dos perfis. Esta tela os descartou sem guardar nem mostrar, mas isso é defeito do motor: avise quem o mantém.
        </p>
      ) : null}
      {!lista ? <p className={`${comuns.nota} ${comuns.bloqueio}`}>Atenção: o motor não mandou a lista de perfis do Claude a esta tela.</p> : null}
      {lista && !lista.length ? <p className={comuns.vazio}>O motor não tem perfil do Claude: nenhuma sessão de revisão abre até um perfil ser criado no motor.</p> : null}
      {lista?.length ? (
        <ul className={estilos.itens} aria-label="Perfis do Claude">
          {lista.map((perfil) => (
            <CartaoDoPerfil
              key={perfil.id}
              perfil={perfil}
              cliente={cliente}
              padrao={config?.claudeProfileId === perfil.id}
              pronto={saude?.claudeAuth.find((p) => p.id === perfil.id)?.ready}
              uso={perfis && Object.hasOwn(perfis.uso, perfil.id) ? perfis.uso[perfil.id] : undefined}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
