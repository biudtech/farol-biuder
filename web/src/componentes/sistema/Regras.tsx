'use client';

// O assunto Regras por organização e autor: as exceções à conta revisora, uma por linha, com a
// frase do que cada uma faz, e a criação, a troca de modo e a remoção de uma regra por vez
// (src/sistema/regras.ts). Cada mudança é uma operação pontual no motor
// (`POST /api/accounts/edit`, `tipo: "regra-review"`): mexer numa regra nunca regrava as outras.
// A regra que revisa sozinho e a remoção perguntam antes. O que foi digitado na regra nova só
// sai do formulário quando o motor aceita.
import { useId, useMemo, useState } from 'react';
import { Chip, ui } from '@/componentes/ui';
import type { ContaRevisora, ModoDaRegra, RegraDeReview } from '@/contratos/sistema';
import type { Acao } from '@/radar/acoes';
import {
  EFEITO_DO_MODO, ROTULO_DO_MODO, TETO_DO_IDENTIFICADOR, alvoDaRegra, erroDaRegra, fraseDaRegra, nomeDoAlvoDaRegra, regraDoAlvo, regrasOrdenadas,
} from '@/sistema/regras';
import type { ControleDeAcoes } from '../radar/useAcoes';
import { AcaoComPergunta } from './AcaoComPergunta';
import estilos from './Sistema.module.css';

const OUTRO: Record<ModoDaRegra, ModoDaRegra> = { auto: 'manual', manual: 'auto' };

function acaoDaRegra(user: string, organizacao: string, autor: string | undefined, modo: ModoDaRegra | 'inherit'): Acao {
  return { tipo: 'regra', alvo: alvoDaRegra(organizacao, autor), nome: nomeDoAlvoDaRegra(organizacao, autor), user, organizacao, autor, modo };
}

function LinhaDaRegra({ regra, user, controle, impedimento }: { regra: RegraDeReview; user: string; controle: ControleDeAcoes; impedimento: string | null }) {
  const alvo = regra.autor ? `@${regra.autor} em ${regra.organizacao}` : regra.organizacao;
  const outro = OUTRO[regra.modo];
  return (
    <li className={estilos.regra}>
      <div className={estilos.textoDaRegra}>
        <h3 className={estilos.tituloDoItem}>
          <span>{alvo}</span>
          <Chip pequeno tom={regra.modo === 'auto' ? 'ok' : 'aviso'}>{ROTULO_DO_MODO[regra.modo]}</Chip>
        </h3>
        <p className={ui.mini}>{fraseDaRegra(regra)}</p>
      </div>
      {impedimento ? null : (
        <div className={ui.fila}>
          <AcaoComPergunta acao={acaoDaRegra(user, regra.organizacao, regra.autor, outro)} controle={controle} ocupado="Salvando…" pequeno rotulo={`Mudar para ${ROTULO_DO_MODO[outro].toLowerCase()}`} />
          <AcaoComPergunta acao={acaoDaRegra(user, regra.organizacao, regra.autor, 'inherit')} controle={controle} ocupado="Removendo…" pequeno />
        </div>
      )}
    </li>
  );
}

function RegraNova({ conta, controle, impedimento }: { conta: ContaRevisora; controle: ControleDeAcoes; impedimento: string | null }) {
  const [organizacao, setOrganizacao] = useState('');
  const [autor, setAutor] = useState('');
  const [modo, setModo] = useState<ModoDaRegra>('manual');
  const idDaOrg = useId();
  const idDoAutor = useId();
  const idDoModo = useId();
  const idDoErro = useId();
  const digitou = organizacao.trim() !== '' || autor.trim() !== '';
  const erro = digitou ? erroDaRegra(organizacao, autor) : null;
  const existente = !erro && digitou ? regraDoAlvo(conta.regras, organizacao, autor) : undefined;
  const acao = !erro && organizacao.trim() ? acaoDaRegra(conta.user, organizacao, autor.trim() || undefined, modo) : null;

  // O formulário só se limpa quando o motor aceita: na recusa ou na falha, o digitado fica.
  const controleDaNova = useMemo<ControleDeAcoes>(() => ({
    ...controle,
    disparar: async (a) => {
      const aceito = await controle.disparar(a);
      if (aceito) {
        setOrganizacao('');
        setAutor('');
        setModo('manual');
      }
      return aceito;
    },
  }), [controle]);

  return (
    <form className={estilos.formulario} aria-label="Regra nova" onSubmit={(evento) => evento.preventDefault()}>
      <h3 className={estilos.subtitulo}>Regra nova</h3>
      <div className={estilos.gradeDaRegra}>
        <div className={estilos.campo}>
          <label className={ui.rotulo} htmlFor={idDaOrg}>Organização do GitHub</label>
          <input id={idDaOrg} className={ui.campo} value={organizacao} maxLength={TETO_DO_IDENTIFICADOR} autoComplete="off" spellCheck={false} aria-invalid={erro ? true : undefined} aria-describedby={erro ? idDoErro : undefined} onChange={(evento) => setOrganizacao(evento.target.value)} />
        </div>
        <div className={estilos.campo}>
          <label className={ui.rotulo} htmlFor={idDoAutor}>Autor (opcional)</label>
          <input id={idDoAutor} className={ui.campo} value={autor} maxLength={TETO_DO_IDENTIFICADOR + 1} autoComplete="off" spellCheck={false} aria-invalid={erro ? true : undefined} aria-describedby={erro ? idDoErro : undefined} onChange={(evento) => setAutor(evento.target.value)} />
        </div>
        <div className={estilos.campo}>
          <label className={ui.rotulo} htmlFor={idDoModo}>O que o motor faz</label>
          <select id={idDoModo} className={ui.campo} value={modo} aria-describedby={`${idDoModo}-efeito`} onChange={(evento) => setModo(evento.target.value === 'auto' ? 'auto' : 'manual')}>
            <option value="manual">{ROTULO_DO_MODO.manual}</option>
            <option value="auto">{ROTULO_DO_MODO.auto}</option>
          </select>
        </div>
      </div>
      <p id={`${idDoModo}-efeito`} className={ui.mini}>{EFEITO_DO_MODO[modo]} Sem autor, a regra vale para a organização inteira; com autor, só para os PRs dele ali, e vence a da organização.</p>
      {erro ? <p id={idDoErro} className={ui.erro} role="alert">Erro: {erro}</p> : null}
      {existente ? <p className={ui.nota}>Aviso: já existe regra para este alvo ({ROTULO_DO_MODO[existente.modo].toLowerCase()}). Salvar troca o modo dela.</p> : null}
      {impedimento ? <p className={ui.nota}>Bloqueado: {impedimento}</p> : null}
      {acao && !impedimento ? <AcaoComPergunta acao={acao} controle={controleDaNova} ocupado="Salvando…" primario rotulo="Criar regra" /> : null}
    </form>
  );
}

interface Props {
  conta: ContaRevisora | undefined;
  controle: ControleDeAcoes;
  impedimento: string | null;
}

export function Regras({ conta, controle, impedimento }: Props) {
  if (!conta) return <p className={ui.nota}>Atenção: o motor não mandou a conta revisora a esta tela, e as regras moram nela.</p>;
  if (!conta.user) return <p className={ui.vazio}>Sem conta revisora não há regra a editar: as regras moram na conta.</p>;
  const regras = regrasOrdenadas(conta.regras);
  return (
    <>
      <p className={ui.mini}>
        Exceções à conta revisora: quem é revisado sozinho e quem só no clique. A regra do autor vence a da organização, e a da organização vence a revisão automática da conta. O motor não tem regra por repositório.
      </p>
      {conta.regrasIlegiveis ? <p className={ui.nota}>Atenção: {conta.regrasIlegiveis} regra(s) chegaram do motor em formato que esta tela não lê e ficaram de fora da lista. Elas continuam valendo no motor.</p> : null}
      {regras.length ? (
        <ul className={estilos.itens} aria-label="Regras por organização e autor">
          {regras.map((regra) => <LinhaDaRegra key={`${regra.organizacao}:${regra.autor ?? ''}`} regra={regra} user={conta.user} controle={controle} impedimento={impedimento} />)}
        </ul>
      ) : (
        <p className={ui.vazio}>Nenhuma exceção: todo PR pedido à conta segue a revisão automática dela.</p>
      )}
      <RegraNova conta={conta} controle={controle} impedimento={impedimento} />
    </>
  );
}
