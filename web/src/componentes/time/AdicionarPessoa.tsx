'use client';

// Pôr uma pessoa no Time antes da primeira revisão de um PR dela: o login do GitHub (obrigatório)
// e o papel (opcional). Vai pelo mesmo caminho do salvar de perfil, `people` em POST
// /api/settings, que troca o mapa inteiro: o corpo sai do mapa cru do motor com a pessoa nova a
// mais (comPessoaNova), e por isso só se oferece com o estado desta conexão já chegado. Quem já
// está no mapa não entra de novo: o perfil dela se edita no dossiê.
import { useId, useState } from 'react';
import type { PessoasCruas } from '@/contratos/time';
import { idDa, type Acao } from '@/radar/acoes';
import { PAPEIS } from '@/time/taxonomia';
import { chaveDaPessoa, comPessoaNova, loginDigitado, loginValido, motivoQueImpedeSalvar } from '@/time/time';
import type { Conexao } from '@/transporte/cliente';
import type { ControleDeAcoes } from '../radar/useAcoes';
import { Botao, ui } from '../ui';
import estilos from './Time.module.css';

// o alvo da ação: um só, para dois envios seguidos não correrem juntos
export const ALVO_DA_PESSOA_NOVA = 'time:nova';

interface Props {
  cru: PessoasCruas | undefined;
  // os logins que a lista mostra (dossiê ou perfil), para dizer que a pessoa já está no Time
  conhecidos: readonly string[];
  conexao: Conexao;
  emDia: boolean;
  controle: ControleDeAcoes;
  aoFechar(): void;
}

function problemaDoLogin(login: string, cru: PessoasCruas | undefined, conhecidos: readonly string[]): string | null {
  if (!login) return 'Digite o login do GitHub.';
  if (!loginValido(login)) return 'Login do GitHub tem só letras, dígitos e hífen (sem hífen na ponta nem dois seguidos), até 39.';
  const chave = chaveDaPessoa(login);
  if (conhecidos.some((outro) => chaveDaPessoa(outro) === chave) || Object.keys(cru ?? {}).some((outro) => chaveDaPessoa(outro) === chave)) {
    return `@${login} já está no Time: o papel dela se edita no dossiê.`;
  }
  return null;
}

export function AdicionarPessoa({ cru, conhecidos, conexao, emDia, controle, aoFechar }: Props) {
  const [texto, setTexto] = useState('');
  const [papel, setPapel] = useState('');
  const [tentou, setTentou] = useState(false);
  const idDoLogin = useId();
  const idDoPapel = useId();
  const idDoProblema = useId();

  const login = loginDigitado(texto);
  const problema = problemaDoLogin(login, cru, conhecidos);
  const impedimento = motivoQueImpedeSalvar({ cru, conexao, emDia });
  const enviando = controle.emCurso(ALVO_DA_PESSOA_NOVA);
  const pessoas = cru && !problema ? comPessoaNova(cru, login, papel) : null;
  const acao: Acao | null = pessoas ? { tipo: 'perfil', alvo: ALVO_DA_PESSOA_NOVA, nome: `@${login}`, login, pessoas, nova: true } : null;
  const mostrarProblema = tentou && problema !== null;

  return (
    <form
      className={`${ui.cartao} ${estilos.novaPessoa}`}
      aria-label="Adicionar pessoa ao Time"
      onSubmit={(evento) => {
        evento.preventDefault();
        setTentou(true);
        if (!acao || impedimento || enviando !== null) return;
        void controle.disparar(acao).then((aceito) => { if (aceito) aoFechar(); });
      }}
    >
      <h2 className={ui.grupo}>Adicionar pessoa</h2>
      <p className={ui.mini}>
        A pessoa entra no Time com o papel escolhido, ou sem papel. O dossiê dela começa quando a primeira revisão de um PR dela for resolvida.
      </p>
      <div className={estilos.seletores}>
        <div className={estilos.seletor}>
          <label className={ui.rotulo} htmlFor={idDoLogin}>Login do GitHub</label>
          <input
            id={idDoLogin}
            className={ui.campo}
            type="text"
            value={texto}
            maxLength={40}
            aria-required="true"
            autoComplete="off"
            spellCheck={false}
            placeholder="login"
            aria-invalid={mostrarProblema}
            aria-describedby={mostrarProblema ? idDoProblema : undefined}
            onChange={(evento) => setTexto(evento.target.value)}
          />
        </div>
        <div className={estilos.seletor}>
          <label className={ui.rotulo} htmlFor={idDoPapel}>Papel (opcional)</label>
          <select id={idDoPapel} className={ui.campo} value={papel} onChange={(evento) => setPapel(evento.target.value)}>
            <option value="">Sem papel</option>
            {PAPEIS.map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
          </select>
        </div>
      </div>
      {mostrarProblema ? <p id={idDoProblema} className={ui.erro}>{problema}</p> : null}
      {impedimento ? <p className={ui.erro}>Bloqueado: {impedimento}</p> : null}
      <p className={ui.mini}>
        O motor guarda as pessoas numa lista só, e o envio a substitui inteira: vai a lista que esta aba tem agora, como o motor a mandou, com a pessoa nova a mais.
      </p>
      <div className={ui.fila}>
        <Botao type="submit" primario ocupado={acao && enviando === idDa(acao) ? 'Adicionando…' : false} disabled={impedimento !== null || enviando !== null}>
          Adicionar ao Time
        </Botao>
        <Botao fantasma onClick={aoFechar}>Cancelar</Botao>
      </div>
    </form>
  );
}
