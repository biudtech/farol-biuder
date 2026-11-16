'use client';

// A contestação de um PR: o registro que o motor guarda quando o autor contesta uma revisão
// (lib/engine/pushback.js, na raiz). Só aparece quando o snapshot traz registro para o PR. O
// que está "pending" é suspeita do motor esperando confirmação; gravar um desfecho o confirma,
// e "não houve contestação" apaga o registro. Nada disso publica no GitHub.
import { useId, useState } from 'react';
import type { Contestacao as Registro, Revisao } from '@/contratos/historico';
import { DESFECHOS_DA_CONTESTACAO, textoDoDesfecho } from '@/historico/rotulos';
import type { Acao, DesfechoDaContestacao } from '@/radar/acoes';
import { dataComAno, nomeDoPr } from '@/radar/formato';
import { AcoesDoItem } from '../radar/AcoesDoItem';
import type { ControleDeAcoes } from '../radar/useAcoes';
import comuns from '../radar/Radar.module.css';
import estilos from './Historico.module.css';

// o teto da nota no motor (recordPushback)
const TETO_DA_NOTA = 300;

function ehDesfecho(valor: string): valor is DesfechoDaContestacao {
  return DESFECHOS_DA_CONTESTACAO.some(([desfecho]) => desfecho === valor);
}

interface Props {
  revisao: Revisao;
  registro: Registro;
  controle: ControleDeAcoes;
}

export function Contestacao({ revisao, registro, controle }: Props) {
  const [desfecho, setDesfecho] = useState<DesfechoDaContestacao | ''>(ehDesfecho(registro.outcome) ? registro.outcome : '');
  const [nota, setNota] = useState(registro.note ?? '');
  const idDoTitulo = useId();
  const idDoDesfecho = useId();
  const idDaNota = useId();

  const nome = nomeDoPr(revisao.key);
  const suspeita = registro.status === 'pending';
  const quando = dataComAno(registro.at);
  const origem = registro.source === 'auto' ? 'detectada pelo motor' : 'registrada à mão';
  const acao: Acao = {
    tipo: 'contestacao',
    alvo: `contestacao:${revisao.key}`,
    nome,
    chave: revisao.key,
    autor: revisao.pr?.author ?? registro.author ?? '',
    desfecho,
    nota: nota.trim(),
  };

  return (
    <section className={estilos.secao} aria-labelledby={idDoTitulo}>
      <h3 id={idDoTitulo} className={estilos.tituloDaSecao}>Contestação do autor</h3>
      {suspeita ? (
        <p className={comuns.nota}>
          O motor suspeita que o autor contestou a revisão deste PR{registro.note ? `: ${registro.note}` : ''}. Confirme o desfecho, ou diga que não houve contestação.
        </p>
      ) : (
        <p>
          Contestação registrada: {textoDoDesfecho(registro.outcome)} ({origem}{quando ? `, em ${quando}` : ''}).
          {registro.note ? ` Nota: ${registro.note}` : ''}
        </p>
      )}
      <p className={comuns.meta}>
        O registro é do PR, não desta rodada, e calibra o tom das próximas revisões do autor. Gravar não publica nada no GitHub.
      </p>

      <div className={estilos.formulario}>
        <div className={estilos.campo}>
          <label className={comuns.rotulo} htmlFor={idDoDesfecho}>Desfecho</label>
          <select
            id={idDoDesfecho}
            className={comuns.entrada}
            value={desfecho}
            onChange={(evento) => setDesfecho(ehDesfecho(evento.target.value) ? evento.target.value : '')}
          >
            {DESFECHOS_DA_CONTESTACAO.map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
            <option value="">Não houve contestação (apaga o registro)</option>
          </select>
        </div>
        <div className={estilos.campo}>
          <label className={comuns.rotulo} htmlFor={idDaNota}>Nota curta (opcional)</label>
          <input
            id={idDaNota}
            className={comuns.entrada}
            type="text"
            value={nota}
            maxLength={TETO_DA_NOTA}
            disabled={desfecho === ''}
            autoComplete="off"
            onChange={(evento) => setNota(evento.target.value)}
          />
        </div>
      </div>

      <AcoesDoItem botoes={[{ acao, primario: suspeita }]} controle={controle} />
    </section>
  );
}
