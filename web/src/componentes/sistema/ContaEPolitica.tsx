'use client';

// A seção Conta revisora e política: quem é a conta, se o token do GitHub está presente (só
// a presença: o token nunca sai do motor), as organizações monitoradas e a política de
// aprovação. A política decide o que o motor PUBLICA sozinho no GitHub: o salvar manda a
// POST /api/accounts/edit só os campos que a pessoa alterou nesta edição (a diferença entre o
// rascunho e o valor que ela viu ao começar), e toda mudança que amplia a publicação
// automática pergunta antes, dizendo o efeito exato contra o valor atual do motor
// (confirmacaoDoSistema).
import { useEffect, useId, useRef, useState } from 'react';
import type { ContaRevisora } from '@/contratos/sistema';
import type { Acao } from '@/radar/acoes';
import { dataHora } from '@/radar/formato';
import {
  DOMINIO_DA_POLITICA, ROTULO_DO_DESFECHO, ampliacoesDaConta, camposAlterados, efeitoDaRevisaoAutomatica, efeitoDoDesfecho, marcaDaConta,
  notaDasRessalvasTravadas, organizacaoValida, rascunhoDaConta, refazerConta, rotuloDoValor, temOrganizacao, textoDoToken, textosDosConflitos,
  type Desfecho, type RascunhoDaConta,
} from '@/sistema/politica';
import type { ControleDeAcoes } from '../radar/useAcoes';
import comuns from '../radar/Radar.module.css';
import { Par, PeDoFormulario } from './Formulario';
import { useRascunho } from './useRascunho';
import estilos from './Sistema.module.css';

export const ALVO_DA_CONTA = 'sistema:conta';
const DESFECHOS: readonly Desfecho[] = ['onClean', 'onCaveats', 'onReject'];
const TETO_DA_ORGANIZACAO = 39;

interface PropsDoEditor {
  conta: ContaRevisora;
  controle: ControleDeAcoes;
  impedimento: string | null;
  aoMudar(alterado: boolean): void;
}

function EditorDaConta({ conta, controle, impedimento, aoMudar }: PropsDoEditor) {
  const { valor: rascunho, partida, alterado, mudouNoMotor, conflitos, editar, descartar } = useRascunho<ContaRevisora, RascunhoDaConta>(conta, rascunhoDaConta, marcaDaConta, refazerConta);
  const [nova, setNova] = useState('');
  const [erroDaNova, setErroDaNova] = useState('');
  const campoDaNova = useRef<HTMLInputElement>(null);
  const idDaNova = useId();
  const idDoErroDaNova = useId();
  const idDaRevisao = useId();
  const idDosDesfechos = useId();
  useEffect(() => {
    aoMudar(alterado);
    return () => aoMudar(false);
  }, [alterado, aoMudar]);

  const campos = camposAlterados(partida, rascunho, conta);
  const temCampo = Object.keys(campos).length > 0;
  const acao: Acao | null = temCampo
    ? { tipo: 'conta', alvo: ALVO_DA_CONTA, nome: `@${conta.user}`, user: conta.user, campos, ampliacoes: ampliacoesDaConta(conta, campos) }
    : null;
  const limpoEspera = rascunho.onClean === 'wait';

  function adicionar(): void {
    const org = nova.trim();
    if (!organizacaoValida(org)) {
      setErroDaNova('Use o nome da organização como aparece no GitHub: letras, dígitos e hífen, sem hífen nas pontas.');
      return;
    }
    if (temOrganizacao(rascunho.owners, org)) {
      setErroDaNova(`${org} já está na lista.`);
      return;
    }
    editar({ ...rascunho, owners: [...rascunho.owners, org] });
    setNova('');
    setErroDaNova('');
  }

  function tirar(org: string): void {
    editar({ ...rascunho, owners: rascunho.owners.filter((outra) => outra !== org) });
    // o botão clicado sai da tela: o foco vai ao campo de acrescentar, que fica sempre
    campoDaNova.current?.focus();
  }

  return (
    <>
      <h3 className={estilos.subtitulo}>Organizações monitoradas</h3>
      <p className={comuns.meta}>
        O motor busca os PRs pedidos à conta só nestas organizações do GitHub. O motor guarda a lista inteira: o salvar manda a lista que ele tem agora, com o que você acrescentou e sem o que você tirou, e ele confere a fila na hora.
      </p>
      {rascunho.owners.length ? (
        <ul className={estilos.orgs} aria-label="Organizações monitoradas">
          {rascunho.owners.map((org) => (
            <li key={org} className={estilos.org}>
              <span>{org}</span>
              <button type="button" className={comuns.botao} aria-label={`Tirar ${org} das organizações monitoradas`} onClick={() => tirar(org)}>
                Tirar
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={`${comuns.nota} ${comuns.bloqueio}`}>Atenção: sem organização monitorada o motor não faz busca nenhuma, e a fila fica vazia sem erro.</p>
      )}
      <div className={estilos.novaOrg}>
        <div className={estilos.campo}>
          <label className={comuns.rotulo} htmlFor={idDaNova}>Organização a adicionar</label>
          <input
            id={idDaNova}
            ref={campoDaNova}
            className={comuns.entrada}
            value={nova}
            maxLength={TETO_DA_ORGANIZACAO}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={erroDaNova ? true : undefined}
            aria-describedby={erroDaNova ? idDoErroDaNova : undefined}
            onChange={(evento) => { setNova(evento.target.value); setErroDaNova(''); }}
            onKeyDown={(evento) => {
              if (evento.key !== 'Enter') return;
              evento.preventDefault();
              adicionar();
            }}
          />
        </div>
        <button type="button" className={comuns.botao} onClick={adicionar}>Adicionar à lista</button>
      </div>
      {erroDaNova ? <p id={idDoErroDaNova} className={comuns.erroDoCampo} role="alert">Erro: {erroDaNova}</p> : null}

      <h3 className={estilos.subtitulo}>Política de aprovação</h3>
      <p className={comuns.meta}>
        O que o motor faz sozinho com cada PR pedido à conta. Toda publicação passa antes pelos gates do motor; aqui se escolhe o que acontece com o que passou. Quem diz se a revisão saiu limpa, com ressalvas ou reprovada é o motor.
      </p>
      <div className={estilos.opcao}>
        <input
          id={idDaRevisao}
          type="checkbox"
          checked={rascunho.autoReview === true}
          aria-describedby={`${idDaRevisao}-efeito`}
          onChange={(evento) => editar({ ...rascunho, autoReview: evento.target.checked })}
        />
        <div>
          <label htmlFor={idDaRevisao}>Revisão automática</label>
          <p id={`${idDaRevisao}-efeito`} className={comuns.meta}>{efeitoDaRevisaoAutomatica(rascunho.autoReview)}</p>
        </div>
      </div>
      {DESFECHOS.map((campo, i) => {
        const dominio: readonly string[] = DOMINIO_DA_POLITICA[campo];
        // Com o limpo em espera o com ressalvas é MOSTRADO em espera, sem mexer no rascunho:
        // voltar o limpo para publicar devolve o campo ao valor que estava.
        const travado = campo === 'onCaveats' && limpoEspera;
        const mostrado = travado ? 'wait' : rascunho[campo];
        const idDoCampo = `${idDosDesfechos}-${i}`;
        let efeito = mostrado === '' ? 'O motor não mandou este campo.' : efeitoDoDesfecho(campo, mostrado);
        if (travado) efeito = notaDasRessalvasTravadas(rascunho);
        return (
          <div key={campo} className={estilos.campo}>
            <label className={comuns.rotulo} htmlFor={idDoCampo}>{ROTULO_DO_DESFECHO[campo]}</label>
            <select
              id={idDoCampo}
              className={comuns.entrada}
              value={mostrado}
              disabled={travado}
              aria-describedby={`${idDoCampo}-efeito`}
              onChange={(evento) => editar({ ...rascunho, [campo]: evento.target.value })}
            >
              {mostrado === '' ? <option value="">O motor não mandou este campo</option> : null}
              {dominio.map((opcao) => <option key={opcao} value={opcao}>{rotuloDoValor(campo, opcao)}</option>)}
              {mostrado !== '' && !dominio.includes(mostrado) ? <option value={mostrado}>{rotuloDoValor(campo, mostrado)}</option> : null}
            </select>
            <p id={`${idDoCampo}-efeito`} className={comuns.meta}>{efeito}</p>
          </div>
        );
      })}

      <PeDoFormulario
        oQue="a conta e a política"
        alterado={alterado}
        mudouNoMotor={mudouNoMotor}
        conflitos={textosDosConflitos(conflitos, conta, rascunho)}
        aoDescartar={() => { descartar(); setNova(''); setErroDaNova(''); }}
        impedimento={impedimento}
        erro={alterado && !temCampo ? 'Não há mudança neste formulário que o motor aceite.' : null}
        acao={acao}
        controle={controle}
        nota="O salvar manda só os campos que você alterou nesta edição, e o motor aplica sobre a conta que ele tem agora: o que outra pessoa mudou nos outros campos não é desfeito. Das organizações vai a lista que o motor tem agora, com o que você acrescentou e sem o que você tirou."
      />
    </>
  );
}

interface Props {
  // `undefined`: o motor não mandou a conta
  conta: ContaRevisora | undefined;
  controle: ControleDeAcoes;
  impedimento: string | null;
  aoMudar(alterado: boolean): void;
}

export function ContaEPolitica({ conta, controle, impedimento, aoMudar }: Props) {
  const idDoTitulo = useId();
  return (
    <section id="conta" className={estilos.secao} aria-labelledby={idDoTitulo}>
      <h2 id={idDoTitulo} className={estilos.tituloDaSecao}>Conta revisora e política</h2>
      {!conta ? <p className={`${comuns.nota} ${comuns.bloqueio}`}>Atenção: o motor não mandou a conta revisora a esta tela.</p> : null}
      {conta ? (
        <>
          <dl className={estilos.campos}>
            <Par nome="Conta revisora">{conta.user ? `@${conta.user}` : 'O motor ainda não tem conta revisora.'}</Par>
            <Par nome="Token do GitHub">{textoDoToken(conta.tokenOk)}</Par>
            {conta.limiteGhAte ? <Par nome="Limite do GitHub">As buscas estão paradas até {dataHora(conta.limiteGhAte) || 'hora não informada'}.</Par> : null}
            {conta.limitePlanoAte ? <Par nome="Limite do plano do Claude">A assinatura está no limite até {dataHora(conta.limitePlanoAte) || 'hora não informada'}.</Par> : null}
          </dl>
          <p className={comuns.meta}>
            O login da conta e o token do GitHub não mudam por esta tela: o login vem do arquivo de configuração ou do gh, e o token fica só no motor. Do token o motor informa a presença, não a validade: se ele vale, quem diz é o GitHub na próxima busca (veja Saúde).
          </p>
          {conta.regrasDeReview > 0 ? (
            <p className={comuns.nota}>
              Aviso: a conta tem regra de review própria para {conta.regrasDeReview} {conta.regrasDeReview === 1 ? 'organização' : 'organizações'} (automático ou manual, por organização ou autor). Essas regras decidem quem é revisado sozinho antes da revisão automática abaixo, e esta tela não as mostra nem edita.
            </p>
          ) : null}
          {conta.user ? (
            <EditorDaConta conta={conta} controle={controle} impedimento={impedimento} aoMudar={aoMudar} />
          ) : (
            <p className={comuns.vazio}>
              Sem conta revisora não há política a editar: o motor recusa a edição. A conta nasce quando o motor detecta o login do gh, ou do arquivo de configuração.
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
