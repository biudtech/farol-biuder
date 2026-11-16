'use client';

// As ações gerais do Radar: Checar agora, com o estado da checagem ao lado, e a revisão sob
// demanda pela URL de um PR. A URL é conferida aqui antes do POST: o que não é URL de PR do
// GitHub nem chega ao motor.
import { useId, useState, type FormEvent } from 'react';
import { CHECAR } from '@/radar/acoes';
import { chaveDaUrlDePr, nomeDoPr } from '@/radar/formato';
import { AcoesDoItem } from './AcoesDoItem';
import type { ControleDeAcoes } from './useAcoes';
import estilos from './Radar.module.css';

const ALVO = 'sob-demanda';

export function AcoesGerais({ checagem, controle }: { checagem: string; controle: ControleDeAcoes }) {
  const [url, setUrl] = useState('');
  const [formaErrada, setFormaErrada] = useState(false);
  const idDoCampo = useId();
  const idDoErro = useId();
  const enviando = controle.emCurso(ALVO) !== null;

  async function aoEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    const limpa = url.trim();
    const chave = chaveDaUrlDePr(limpa);
    setFormaErrada(chave === null);
    if (chave === null) return;
    const aceito = await controle.disparar({ tipo: 'revisar', url: limpa, alvo: ALVO, nome: nomeDoPr(chave) });
    if (aceito) setUrl('');
  }

  return (
    <section className={estilos.gerais} aria-label="Ações gerais">
      <div className={estilos.checagem}>
        <AcoesDoItem botoes={[{ acao: CHECAR }]} controle={controle} />
        <p className={estilos.meta}>{checagem}</p>
      </div>

      <form className={estilos.sobDemanda} onSubmit={(evento) => { void aoEnviar(evento); }} noValidate>
        <label htmlFor={idDoCampo} className={estilos.rotulo}>Revisar sob demanda: URL do PR</label>
        <div className={estilos.campoComBotao}>
          <input
            id={idDoCampo}
            className={estilos.entrada}
            type="url"
            inputMode="url"
            placeholder="https://github.com/dono/repo/pull/123"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={formaErrada}
            aria-describedby={formaErrada ? idDoErro : undefined}
          />
          <button type="submit" className={`${estilos.botao} ${estilos.primario}`} disabled={enviando}>
            {enviando ? 'Enviando…' : 'Revisar este PR'}
          </button>
        </div>
        {formaErrada ? (
          <p id={idDoErro} className={estilos.erroDoCampo} role="alert">
            Informe a URL de um PR do GitHub, como https://github.com/dono/repo/pull/123.
          </p>
        ) : null}
      </form>
    </section>
  );
}
