'use client';

// A contestação de um PR: o registro que o motor guarda quando o autor contesta uma revisão
// (lib/engine/pushback.js, na raiz). Só aparece quando o snapshot traz registro para o PR. O
// que está "pending" é suspeita do motor esperando confirmação; gravar um desfecho o confirma
// e o marca como manual, e "não houve contestação" apaga o registro. Nada disso publica no
// GitHub, mas o registro confirmado entra no prompt de revisões futuras: as duas ações
// perguntam antes (confirmacaoDa, src/radar/acoes.ts).
import { useId, useState } from 'react';
import type { Contestacao as Registro, Revisao } from '@/contratos/historico';
import { DESFECHOS_DA_CONTESTACAO, textoDoDesfecho } from '@/historico/rotulos';
import type { Acao, DesfechoDaContestacao } from '@/radar/acoes';
import { dataComAno, nomeDoPr } from '@/radar/formato';
import { AcoesDoItem } from '../radar/AcoesDoItem';
import type { ControleDeAcoes } from '../radar/useAcoes';
import { ui } from '../ui';
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
    <section className={`${ui.cartao} ${estilos.contestacao}`} aria-labelledby={idDoTitulo}>
      <h2 id={idDoTitulo} className={estilos.tituloDaContestacao}>Contestação do autor</h2>
      {suspeita ? (
        <p className={ui.texto}>
          O motor suspeita que o autor contestou a revisão deste PR{registro.note ? `: ${registro.note}` : ''}. Confirme o desfecho, ou diga que não houve contestação.
        </p>
      ) : (
        <p className={ui.texto}>
          Contestação registrada: {textoDoDesfecho(registro.outcome)} ({origem}{quando ? `, em ${quando}` : ''}).
          {registro.note ? ` Nota: ${registro.note}` : ''}
        </p>
      )}
      <p className={ui.mini}>
        O registro é do PR, não desta rodada. Confirmado, ele entra no prompt das próximas revisões dos PRs do autor; com o desfecho &quot;o autor tinha razão&quot; ou &quot;meio-termo&quot;, também no de revisões de outros autores neste repositório. Quem grava aqui marca o registro como feito à mão, e o motor deixa de procurar contestação neste PR sozinho. Gravar não publica nada no GitHub.
      </p>

      <div className={estilos.formulario}>
        <div className={ui.rotulo}>
          <label htmlFor={idDoDesfecho}>Desfecho</label>
          <select
            id={idDoDesfecho}
            className={ui.campo}
            value={desfecho}
            onChange={(evento) => setDesfecho(ehDesfecho(evento.target.value) ? evento.target.value : '')}
          >
            {DESFECHOS_DA_CONTESTACAO.map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
            <option value="">Não houve contestação (apaga o registro)</option>
          </select>
        </div>
        <div className={ui.rotulo}>
          <label htmlFor={idDaNota}>Nota curta (opcional)</label>
          <input
            id={idDaNota}
            className={ui.campo}
            type="text"
            value={nota}
            maxLength={TETO_DA_NOTA}
            disabled={desfecho === ''}
            autoComplete="off"
            onChange={(evento) => setNota(evento.target.value)}
          />
        </div>
      </div>

      {/* A chave é o desfecho escolhido: trocar o seletor com a pergunta aberta monta os botões
          de novo, e a pergunta fecha sem o aviso de que o motor mudou o item (não mudou). */}
      <AcoesDoItem key={desfecho} botoes={[{ acao, primario: suspeita }]} controle={controle} />
    </section>
  );
}
