'use client';

// O papel e a competência de uma pessoa. Quem guarda é o motor, em `config.people`, e o
// POST /api/settings troca o mapa inteiro pelo que chega: o salvar manda a lista de perfis
// que esta aba tem no momento do clique, montada do mapa cru do motor e só com esta pessoa
// alterada (comPerfil). Por isso a tela só oferece o salvar com a lista presente e com o
// estado desta conexão já chegado (motivoQueImpedeSalvar), e avisa quando o perfil mudou no
// motor com a edição aberta.
import { useEffect, useId, useRef, useState } from 'react';
import type { Pessoa, PessoasCruas } from '@/contratos/time';
import { idDa, type Acao } from '@/radar/acoes';
import { DOMINIOS, NIVEIS, PAPEIS, ehConhecido, type Opcao } from '@/time/taxonomia';
import { avisoDeIlegiveis, chaveDaPessoa, comPerfil, marcaDoPerfil, motivoQueImpedeSalvar, type RelerPessoas } from '@/time/time';
import type { Conexao } from '@/transporte/cliente';
import type { ControleDeAcoes } from '../radar/useAcoes';
import { Botao, ui } from '../ui';
import estilos from './Time.module.css';

interface Rascunho {
  // a marca do perfil do motor de onde este rascunho partiu
  base: string;
  papel: string;
  dominios: Record<string, string>;
}

function rascunhoDo(perfil: Pessoa | undefined): Rascunho {
  return { base: marcaDoPerfil(perfil), papel: perfil?.papel ?? '', dominios: { ...(perfil?.dominios ?? {}) } };
}

// As opções de um seletor: as do motor e, se o valor gravado não está entre elas, ele mesmo,
// dito como desconhecido (some ao trocar, porque o motor não o aceitaria de volta).
function opcoesCom(opcoes: readonly Opcao[], valor: string): readonly Opcao[] {
  return valor === '' || ehConhecido(opcoes, valor) ? opcoes : [...opcoes, [valor, `${valor} (valor que esta tela não conhece)`]];
}

// O alvo das ações de uma pessoa do Time. Salvar e remover usam o mesmo: enquanto uma está
// no ar, a outra fica desabilitada (useAcoes trava por alvo).
export function alvoDaPessoa(login: string): string {
  return `time:${chaveDaPessoa(login)}`;
}

interface Props {
  login: string;
  // o perfil lido, para mostrar
  perfil: Pessoa | undefined;
  // `config.people` do snapshot como o motor mandou: é dele que sai o corpo do salvar
  cru: PessoasCruas | undefined;
  // quantas pessoas a tela não leu inteiras
  ilegiveis: number;
  conexao: Conexao;
  // o primeiro estado da conexão atual do fluxo já chegou
  emDia: boolean;
  controle: ControleDeAcoes;
  // relê `people` no motor logo antes de gravar: o corpo sai dele, com só esta pessoa mudando
  relerPessoas: RelerPessoas;
  // avisa quem está em volta se há edição por salvar
  aoMudar(alterado: boolean): void;
  // o seletor do papel pega o foco ao montar (o Editar papel do cartão do Time)
  focar?: boolean;
}

export function EditorDoPerfil({ login, perfil, cru, ilegiveis, conexao, emDia, controle, relerPessoas, aoMudar, focar }: Props) {
  const papel = useRef<HTMLSelectElement>(null);
  useEffect(() => { if (focar) papel.current?.focus(); }, [focar]);
  const [rascunho, setRascunho] = useState(() => rascunhoDo(perfil));
  const [relendo, setRelendo] = useState(false);
  const [falhaDaReleitura, setFalhaDaReleitura] = useState('');
  const idDoPapel = useId();
  const idDosDominios = useId();

  const noMotor = marcaDoPerfil(perfil);
  const editado = marcaDoPerfil({ papel: rascunho.papel, dominios: rascunho.dominios });
  // O perfil mudou no motor depois que este rascunho começou. Se nada foi editado aqui, ou se
  // o motor ficou igual ao rascunho (o salvar daqui chegou), o rascunho acompanha. Senão a
  // edição fica, e a tela avisa. Ajuste de estado no desenho, como o React prevê.
  let mudouNoMotor = false;
  if (rascunho.base !== noMotor) {
    if (editado === rascunho.base || editado === noMotor) setRascunho(rascunhoDo(perfil));
    else mudouNoMotor = true;
  }
  const alterado = editado !== noMotor;
  useEffect(() => { aoMudar(alterado); }, [alterado, aoMudar]);

  const impedimento = motivoQueImpedeSalvar({ cru, conexao, emDia });
  const aviso = avisoDeIlegiveis(ilegiveis);

  // os domínios do motor e, depois, os que o perfil traz e a tela não conhece
  const dominios: readonly Opcao[] = [
    ...DOMINIOS,
    ...Object.keys(rascunho.dominios).filter((d) => !ehConhecido(DOMINIOS, d)).map((d): Opcao => [d, `${d} (domínio que esta tela não conhece)`]),
  ];
  const enviando = controle.emCurso(alvoDaPessoa(login));
  const acao: Acao | null = cru && alterado
    ? { tipo: 'perfil', alvo: alvoDaPessoa(login), nome: `@${login}`, login, pessoas: comPerfil(cru, login, { papel: rascunho.papel, dominios: rascunho.dominios }) }
    : null;

  return (
    <>
      <p className={ui.mini}>
        O papel e a competência entram no prompt das revisões dos PRs desta pessoa, no bloco &quot;Perfil do autor&quot;: o papel dá o tom do texto, e a competência por domínio calibra a postura na área em que o PR mexe. Não mudam a decisão: os gates e a política da conta não leem esses campos.
      </p>
      <fieldset className={estilos.perfil}>
        <legend className={ui.soLeitor}>Papel e competência de @{login}</legend>
        <div className={estilos.seletores}>
          <div className={estilos.seletor}>
            <label className={ui.rotulo} htmlFor={idDoPapel}>Papel</label>
            <select ref={papel} id={idDoPapel} className={ui.campo} value={rascunho.papel} onChange={(evento) => setRascunho({ ...rascunho, papel: evento.target.value })}>
              <option value="">Sem papel</option>
              {opcoesCom(PAPEIS, rascunho.papel).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
            </select>
          </div>
          {dominios.map(([dominio, rotulo], i) => {
            const nivel = rascunho.dominios[dominio] ?? '';
            return (
              <div key={dominio} className={estilos.seletor}>
                <label className={ui.rotulo} htmlFor={`${idDosDominios}-${i}`}>Competência em {rotulo}</label>
                <select
                  id={`${idDosDominios}-${i}`}
                  className={ui.campo}
                  value={nivel}
                  onChange={(evento) => setRascunho({ ...rascunho, dominios: { ...rascunho.dominios, [dominio]: evento.target.value } })}
                >
                  <option value="">Sem informação</option>
                  {opcoesCom(NIVEIS, nivel).map(([valor, nome]) => <option key={valor} value={valor}>{nome}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      </fieldset>

      {mudouNoMotor ? (
        <div className={`${ui.nota} ${estilos.pergunta}`} role="status">
          <p>
            Aviso: o perfil de @{login} mudou no motor enquanto você editava (outra aba, ou outra pessoa). Salvar grava o que está neste formulário por cima do que o motor tem agora.
          </p>
          <div className={ui.fila}>
            <Botao fantasma onClick={() => setRascunho(rascunhoDo(perfil))}>Descartar a edição e usar o perfil do motor</Botao>
          </div>
        </div>
      ) : null}

      {aviso ? <p className={ui.nota}>Aviso: {aviso}</p> : null}
      {impedimento ? <p className={ui.erro}>Bloqueado: {impedimento}</p> : null}
      {!impedimento && acao ? (
        <>
          <p className={ui.mini}>
            O motor guarda os perfis numa lista só, e o salvar a substitui inteira: antes de enviar, a tela relê a lista no motor e manda ela como está lá, com só @{login} alterada. O perfil gravado por outra aba fica; o de @{login} vale o que está neste formulário.
          </p>
          <div className={ui.fila}>
            <Botao
              primario
              ocupado={relendo || enviando === idDa(acao) ? 'Salvando…' : false}
              disabled={enviando !== null || relendo}
              onClick={() => {
                setRelendo(true);
                setFalhaDaReleitura('');
                void relerPessoas().then((lido) => {
                  setRelendo(false);
                  if (!lido.ok) { setFalhaDaReleitura(lido.texto); return; }
                  void controle.disparar({ ...acao, pessoas: comPerfil(lido.pessoas, login, { papel: rascunho.papel, dominios: rascunho.dominios }) });
                });
              }}
            >
              Salvar <span className={ui.soLeitor}>papel e competência de @{login}</span>
            </Botao>
          </div>
        </>
      ) : null}
      {falhaDaReleitura ? <p className={ui.erro} role="alert">{falhaDaReleitura}</p> : null}
      {!impedimento && !acao ? <p className={ui.mini}>Sem alteração por salvar.</p> : null}
    </>
  );
}
