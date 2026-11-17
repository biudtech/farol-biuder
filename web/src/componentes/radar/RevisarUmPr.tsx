'use client';

// "Revisar um PR", no topo do Radar: o botão abre o painel com o campo da URL e o Revisar.
// No mesmo painel ficam o Checar agora (secundário) e o estado da checagem. A URL é conferida
// aqui antes do POST: o que não é URL de PR do GitHub nem chega ao motor, e o que chega é a
// URL canônica do PR, não o que foi digitado. Aceito o pedido, o campo esvazia e o painel fecha.
import { memo, useId, useRef, useState, type FormEvent } from 'react';
import { Botao, ui } from '@/componentes/ui';
import { CHECAR } from '@/radar/acoes';
import { nomeDoPr, prDaUrl } from '@/radar/formato';
import { AcoesDoItem } from './AcoesDoItem';
import type { ControleDeAcoes } from './useAcoes';
import estilos from './Radar.module.css';

const ALVO = 'sob-demanda';

export const RevisarUmPr = memo(function RevisarUmPr({ checagem, controle }: { checagem: string; controle: ControleDeAcoes }) {
  const [url, setUrl] = useState('');
  const [formaErrada, setFormaErrada] = useState(false);
  const gaveta = useRef<HTMLDetailsElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const idDoCampo = useId();
  const idDoErro = useId();
  const enviando = controle.emCurso(ALVO) !== null;

  async function aoEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    const pr = prDaUrl(url);
    setFormaErrada(pr === null);
    if (pr === null) return;
    const aceito = await controle.disparar({ tipo: 'revisar', url: pr.url, alvo: ALVO, nome: nomeDoPr(pr.chave) });
    if (!aceito) return;
    setUrl('');
    if (gaveta.current) gaveta.current.open = false;
  }

  return (
    <details
      ref={gaveta}
      className={ui.gaveta}
      onToggle={(evento) => { if (evento.currentTarget.open) campo.current?.focus(); }}
    >
      <summary className={ui.botao}>Revisar um PR</summary>
      <div className={ui.painel}>
        <form className={estilos.formDoPainel} onSubmit={(evento) => { void aoEnviar(evento); }} noValidate>
          <label htmlFor={idDoCampo} className={ui.rotulo}>URL do PR</label>
          <input
            ref={campo}
            id={idDoCampo}
            className={ui.campo}
            type="url"
            inputMode="url"
            placeholder="https://github.com/dono/repo/pull/123"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={enviando}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={formaErrada}
            aria-describedby={formaErrada ? idDoErro : undefined}
          />
          {formaErrada ? (
            <p id={idDoErro} className={ui.erro} role="alert">
              Informe a URL de um PR do GitHub, como https://github.com/dono/repo/pull/123.
            </p>
          ) : null}
          <Botao type="submit" primario ocupado={enviando ? 'Lendo o PR…' : false}>Revisar</Botao>
        </form>
        <div className={estilos.checagemDoPainel}>
          <AcoesDoItem pequeno botoes={[{ acao: CHECAR, ocupado: 'Checando…' }]} controle={controle} />
          <p className={ui.mini}>{checagem}</p>
        </div>
      </div>
    </details>
  );
});
