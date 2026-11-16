'use client';

// O papel e a competência de uma pessoa. Quem guarda é o motor, em `config.people`, e o
// POST /api/settings troca o mapa inteiro pelo que chega: o salvar manda a lista de perfis
// que esta aba tem no momento do clique, com esta pessoa alterada (comPerfil). Por isso a
// tela só oferece o salvar com a lista inteira e em dia (motivoQueImpedeSalvar), e avisa
// quando o perfil mudou no motor com a edição aberta.
import { useId, useState } from 'react';
import type { Pessoa, Pessoas } from '@/contratos/time';
import type { Acao } from '@/radar/acoes';
import { DOMINIOS, NIVEIS, PAPEIS, ehConhecido, type Opcao } from '@/time/taxonomia';
import { chaveDaPessoa, comPerfil, marcaDoPerfil, motivoQueImpedeSalvar } from '@/time/time';
import type { Conexao } from '@/transporte/cliente';
import { AcoesDoItem } from '../radar/AcoesDoItem';
import type { ControleDeAcoes } from '../radar/useAcoes';
import comuns from '../radar/Radar.module.css';
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

interface Props {
  login: string;
  perfil: Pessoa | undefined;
  // `config.people` do snapshot, inteiro
  pessoas: Pessoas | undefined;
  ilegiveis: number;
  conexao: Conexao;
  controle: ControleDeAcoes;
}

export function EditorDoPerfil({ login, perfil, pessoas, ilegiveis, conexao, controle }: Props) {
  const [rascunho, setRascunho] = useState(() => rascunhoDo(perfil));
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
  const impedimento = motivoQueImpedeSalvar({ pessoas, ilegiveis, conexao });

  // os domínios do motor e, depois, os que o perfil traz e a tela não conhece
  const dominios: readonly Opcao[] = [
    ...DOMINIOS,
    ...Object.keys(rascunho.dominios).filter((d) => !ehConhecido(DOMINIOS, d)).map((d): Opcao => [d, `${d} (domínio que esta tela não conhece)`]),
  ];
  const acao: Acao | null = pessoas && alterado
    ? { tipo: 'perfil', alvo: `perfil:${chaveDaPessoa(login)}`, nome: `@${login}`, login, pessoas: comPerfil(pessoas, login, { papel: rascunho.papel, dominios: rascunho.dominios }) }
    : null;

  return (
    <>
      <p className={comuns.meta}>
        O papel e a competência entram no prompt das revisões dos PRs desta pessoa, no bloco &quot;Perfil do autor&quot;: o papel dá o tom do texto, e a competência por domínio calibra a postura na área em que o PR mexe. Não mudam a decisão: os gates e a política da conta não leem esses campos.
      </p>
      <fieldset className={estilos.perfil}>
        <legend>Papel e competência de @{login}</legend>
        <div className={estilos.seletores}>
          <div className={estilos.seletor}>
            <label className={comuns.rotulo} htmlFor={idDoPapel}>Papel</label>
            <select id={idDoPapel} className={comuns.entrada} value={rascunho.papel} onChange={(evento) => setRascunho({ ...rascunho, papel: evento.target.value })}>
              <option value="">Sem papel</option>
              {opcoesCom(PAPEIS, rascunho.papel).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
            </select>
          </div>
          {dominios.map(([dominio, rotulo], i) => {
            const nivel = rascunho.dominios[dominio] ?? '';
            return (
              <div key={dominio} className={estilos.seletor}>
                <label className={comuns.rotulo} htmlFor={`${idDosDominios}-${i}`}>Competência em {rotulo}</label>
                <select
                  id={`${idDosDominios}-${i}`}
                  className={comuns.entrada}
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
        <div className={comuns.nota} role="status">
          <p>
            Aviso: o perfil de @{login} mudou no motor enquanto você editava (outra aba, ou outra pessoa). Salvar grava o que está neste formulário por cima do que o motor tem agora.
          </p>
          <div className={comuns.botoes}>
            <button type="button" className={comuns.botao} onClick={() => setRascunho(rascunhoDo(perfil))}>Descartar a edição e usar o perfil do motor</button>
          </div>
        </div>
      ) : null}

      {impedimento ? <p className={`${comuns.nota} ${comuns.bloqueio}`}>Bloqueado: {impedimento}</p> : null}
      {!impedimento && acao ? (
        <>
          <p className={comuns.meta}>
            O motor guarda os perfis numa lista só, e o salvar a substitui inteira: vai a lista que esta aba tem agora, com @{login} alterada. Alteração de perfil feita em outra aba que ainda não chegou aqui é sobrescrita.
          </p>
          <AcoesDoItem botoes={[{ acao, primario: true }]} controle={controle} />
        </>
      ) : null}
      {!impedimento && !acao ? <p className={comuns.meta}>Sem alteração por salvar.</p> : null}
    </>
  );
}
