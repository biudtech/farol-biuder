'use client';

// A seção Perfil do Claude e teto de gasto: os perfis que o motor tem, se a credencial de
// cada um está presente (só a presença: chave e login nunca saem do motor), o teste do perfil
// e o teto em dólar. Esta tela não cria perfil, não digita chave e não faz login: não tem
// campo para segredo. O que ela edita é o teto, que mora dentro do perfil: o salvar manda a
// lista inteira de perfis montada da crua (comTeto, src/sistema/teto.ts) e confere a resposta.
import { useEffect, useId } from 'react';
import { NOTA_DA_PAUSA } from '@/consumo/teto';
import { dolar } from '@/consumo/formato';
import { lerTesteDePerfil, type CampoDoTeste, type ConfigDoSistema, type PerfilDoClaude, type PerfisCrus, type PerfisDoClaude, type Saude, type TesteDePerfil, type UsoDoPlano } from '@/contratos/sistema';
import type { Acao } from '@/radar/acoes';
import { dataHora } from '@/radar/formato';
import { comTeto, lerRascunhoDoTeto, marcaDoRascunho, rascunhoDoTeto, tetoDoPerfil, textoDoTeto, type RascunhoDoTeto, type Teto } from '@/sistema/teto';
import type { Cliente } from '@/transporte/cliente';
import type { ControleDeAcoes } from '../radar/useAcoes';
import comuns from '../radar/Radar.module.css';
import { Par, PeDoFormulario } from './Formulario';
import { useChamada } from './useChamada';
import { useRascunho } from './useRascunho';
import estilos from './Sistema.module.css';

export const ROTA_DO_TESTE_DE_PERFIL = '/api/claude/profile-test';
export const alvoDoTeto = (id: string): string => `sistema:teto:${id}`;

const TIPO: Record<string, string> = { dir: 'Assinatura', apikey: 'Chave de API' };
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const NOME_DO_CAMPO: Record<string, string> = { tipoAuth: 'Tipo de autenticação', chave: 'Chave', login: 'Login', email: 'E-mail', plano: 'Plano' };
const ORIGEM: Record<string, string> = {
  informado: 'informado na configuração',
  validado: 'validado pelo Claude Code',
  detectado: 'lido dos arquivos da pasta',
  inferido: 'inferido',
  desconhecido: 'desconhecido',
};

const nomeDoPerfil = (perfil: PerfilDoClaude): string => perfil.label || perfil.id;

function textoDaCredencial(perfil: PerfilDoClaude, pronto: boolean | undefined): string {
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

interface PropsDoTeto {
  perfil: PerfilDoClaude;
  cru: PerfisCrus;
  controle: ControleDeAcoes;
  impedimento: string | null;
  // o id do perfil e se há edição de teto por salvar nele
  aoMudar(perfil: string, alterado: boolean): void;
}

const partir = (teto: Teto): RascunhoDoTeto => rascunhoDoTeto(teto);

function EditorDoTeto({ perfil, cru, controle, impedimento, aoMudar }: PropsDoTeto) {
  const noMotor = tetoDoPerfil(perfil);
  const { valor: rascunho, alterado, mudouNoMotor, editar, descartar } = useRascunho<Teto, RascunhoDoTeto>(noMotor, partir, marcaDoRascunho);
  const id = useId();
  const idDoPerfil = perfil.id;
  // o perfil que sai da lista leva a edição dele junto
  useEffect(() => {
    aoMudar(idDoPerfil, alterado);
    return () => aoMudar(idDoPerfil, false);
  }, [idDoPerfil, alterado, aoMudar]);

  const nome = nomeDoPerfil(perfil);
  const lido = lerRascunhoDoTeto(rascunho);
  const perfis = lido.teto ? comTeto(cru, perfil.id, lido.teto) : null;
  const acao: Acao | null = lido.teto && perfis
    ? { tipo: 'teto', alvo: alvoDoTeto(perfil.id), nome, perfil: perfil.id, perfis, antes: noMotor, teto: lido.teto }
    : null;
  let erro: string | null = null;
  if (lido.erros) erro = 'Há campo do teto com valor que não dá para mandar. Corrija o que está marcado.';
  else if (!perfis) erro = 'O perfil não está uma vez só na lista que o motor mandou: não dá para montar o salvar sem arriscar outro perfil.';

  const campos: Array<{ chave: keyof RascunhoDoTeto; rotulo: string; dica: string; erro: string | undefined }> = [
    { chave: 'diario', rotulo: 'Teto do dia, em dólar', dica: 'Vazio é sem teto do dia. Zero pausa as revisões automáticas deste perfil na hora.', erro: lido.erros?.diario },
    { chave: 'total', rotulo: 'Teto total, em dólar', dica: 'Conta o gasto desde a data de corte. Vazio é sem teto total.', erro: lido.erros?.total },
    { chave: 'desde', rotulo: 'Data de corte do teto total (AAAA-MM-DD)', dica: 'Vazio conta todo o gasto que o motor registrou.', erro: lido.erros?.desde },
  ];

  return (
    <fieldset className={estilos.grupo}>
      <legend>Teto de gasto de {nome}</legend>
      <p className={comuns.meta}>Teto no motor agora: {textoDoTeto(noMotor)}.</p>
      {campos.map((campo, i) => (
        <div key={campo.chave} className={estilos.campo}>
          <label className={comuns.rotulo} htmlFor={`${id}-${i}`}>{campo.rotulo}</label>
          <input
            id={`${id}-${i}`}
            className={comuns.entrada}
            value={rascunho[campo.chave]}
            inputMode={campo.chave === 'desde' ? 'numeric' : 'decimal'}
            maxLength={12}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={campo.erro ? true : undefined}
            aria-describedby={`${id}-${i}-dica`}
            onChange={(evento) => editar({ ...rascunho, [campo.chave]: evento.target.value })}
          />
          <p id={`${id}-${i}-dica`} className={campo.erro ? comuns.erroDoCampo : comuns.meta}>{campo.erro ? `Erro: ${campo.erro}` : campo.dica}</p>
        </div>
      ))}
      <PeDoFormulario
        oQue={`o teto de ${nome}`}
        alterado={alterado}
        mudouNoMotor={mudouNoMotor}
        aoDescartar={descartar}
        impedimento={impedimento}
        erro={erro}
        acao={acao}
        controle={controle}
        nota="O teto mora dentro do perfil, e o motor troca a lista inteira de perfis pelo que chega: o salvar manda a lista que esta aba tem agora, como o motor a mandou, só com o teto deste perfil alterado. Chave e login não vão: o motor mantém os que ele guarda. Perfil alterado em outra aba que ainda não chegou aqui é sobrescrito."
      />
    </fieldset>
  );
}

interface PropsDoPerfil extends PropsDoTeto {
  cliente: Pick<Cliente, 'post'>;
  padrao: boolean;
  pronto: boolean | undefined;
  uso: UsoDoPlano | undefined;
}

function Perfil({ perfil, cru, cliente, padrao, pronto, uso, controle, impedimento, aoMudar }: PropsDoPerfil) {
  const teste = useChamada<TesteDePerfil>();
  const nome = nomeDoPerfil(perfil);
  const login = textoDoLogin(uso);
  const porDia = Object.entries(perfil.budgetByWeekday ?? {});
  const porData = Object.entries(perfil.budgetDates ?? {});
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

      {porDia.length || porData.length ? (
        <p className={comuns.nota}>
          Aviso: este perfil tem teto do dia próprio para{' '}
          {[
            ...porDia.map(([dia, valor]) => `${DIAS[Number(dia)] ?? `dia ${dia}`} (${dolar(valor)})`),
            ...porData.map(([data, valor]) => `${data} (${dolar(valor)})`),
          ].join(', ')}
          . Nesses dias vale esse valor, não o teto do dia abaixo: a data vence o dia da semana, que vence o teto do dia. Esta tela não edita esses tetos, e o salvar os mantém.
        </p>
      ) : null}
      <EditorDoTeto perfil={perfil} cru={cru} controle={controle} impedimento={impedimento} aoMudar={aoMudar} />
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
  aoMudar(perfil: string, alterado: boolean): void;
}

export function ClaudeETeto({ cliente, config, perfis, saude, controle, impedimento, aoMudar }: Props) {
  const idDoTitulo = useId();
  const lista = config?.claudeProfiles;
  const cru = config?.claudeProfilesCru;
  const ilegiveis = config?.claudeProfilesIlegiveis ?? 0;
  const segredos = config?.segredosDescartados ?? 0;
  // Com campo descartado por cara de segredo, a lista que a tela guardou não é mais a do
  // motor: mandá-la de volta poderia apagar o que saiu (um rótulo, um endereço). O teto não
  // se salva daqui enquanto isso durar.
  const impedimentoDoTeto = segredos > 0
    ? 'O motor mandou campo com cara de segredo junto dos perfis, e esta tela o descartou: a lista de perfis que ela guardou não é mais a que o motor tem, e o salvar a mandaria de volta sem esse campo. O teto não se salva daqui enquanto o motor mandar esse campo.'
    : impedimento;

  return (
    <section id="claude" className={estilos.secao} aria-labelledby={idDoTitulo}>
      <h2 id={idDoTitulo} className={estilos.tituloDaSecao}>Perfil do Claude e teto de gasto</h2>
      <p className={comuns.meta}>
        O motor roda as sessões de revisão com o perfil padrão, se ele estiver utilizável; senão, com o primeiro utilizável da lista. Criar ou tirar perfil, digitar chave de API e fazer o login da assinatura não se fazem por esta tela: ela não tem campo para segredo.
      </p>
      <p className={comuns.meta}>
        Sobre o teto: {NOTA_DA_PAUSA} Baixar ou zerar um teto pode pausar as revisões automáticas na hora. O gasto de cada perfil contra o teto está na aba Consumo.
      </p>
      {segredos > 0 ? (
        <p className={`${comuns.nota} ${comuns.bloqueio}`} role="alert">
          Atenção: o motor mandou {segredos} campo(s) com cara de segredo junto dos perfis. Esta tela os descartou sem guardar nem mostrar, mas isso é defeito do motor: avise quem o mantém.
        </p>
      ) : null}
      {ilegiveis > 0 ? (
        <p className={comuns.nota}>
          Aviso: {ilegiveis} perfil(is) chegaram do motor com campo ou formato que esta tela não lê: ela mostra o que conseguiu ler. Salvar um teto reenvia esses como vieram.
        </p>
      ) : null}
      {!lista || !cru ? <p className={`${comuns.nota} ${comuns.bloqueio}`}>Atenção: o motor não mandou a lista de perfis do Claude a esta tela.</p> : null}
      {lista && cru && !lista.length ? <p className={comuns.vazio}>O motor não tem perfil do Claude: nenhuma sessão de revisão abre até um perfil ser criado no motor.</p> : null}
      {lista && cru && lista.length ? (
        <ul className={estilos.itens} aria-label="Perfis do Claude">
          {lista.map((perfil) => (
            <Perfil
              key={perfil.id}
              perfil={perfil}
              cru={cru}
              cliente={cliente}
              padrao={config?.claudeProfileId === perfil.id}
              pronto={saude?.claudeAuth.find((p) => p.id === perfil.id)?.ready}
              uso={perfis && Object.hasOwn(perfis.uso, perfil.id) ? perfis.uso[perfil.id] : undefined}
              controle={controle}
              impedimento={impedimentoDoTeto}
              aoMudar={aoMudar}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
