'use client';

// "Revisar um PR", no topo do Radar: o botão abre o painel com o campo da URL e o Revisar.
// No mesmo painel ficam o Checar agora (secundário) e o estado da checagem. A URL é conferida
// aqui antes do POST: o que não é URL de PR do GitHub nem chega ao motor, e o que chega é a
// URL canônica do PR, não o que foi digitado. Aceito o pedido, o campo esvazia, o painel fecha
// e o foco volta ao botão "Revisar um PR" (o campo que tinha o foco sumiu com o painel); o
// resultado sai no próprio painel (a recusa, junto do campo) ou ao lado do botão ("Na fila"), e no
// anúncio da tela, um role="status" (AnuncioDaTela).
import { memo, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Botao, ui } from '@/componentes/ui';
import { CHECAR } from '@/radar/acoes';
import { nomeDoPr, prDaUrl } from '@/radar/formato';
import { AcoesDoItem } from './AcoesDoItem';
import { DURACAO_DO_RESULTADO_MS, type ControleDeAcoes, type ResultadoDaAcao } from './useAcoes';
import { ResultadoNoItem } from './ResultadoNoItem';
import estilos from './Radar.module.css';

const ALVO = 'sob-demanda';

export const RevisarUmPr = memo(function RevisarUmPr({ checagem, controle }: { checagem: string; controle: ControleDeAcoes }) {
  const [url, setUrl] = useState('');
  const [formaErrada, setFormaErrada] = useState(false);
  const gaveta = useRef<HTMLDetailsElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const botao = useRef<HTMLElement>(null);
  const idDoCampo = useId();
  const idDoErro = useId();
  const enviando = controle.emCurso(ALVO) !== null;
  // Nenhuma notificação eterna, mas nada invisível: a recusa do motor aparece no painel, junto do
  // campo, até a pessoa editar a URL ou o resultado sair sozinho (useAcoes); o aceite fecha o
  // painel e deixa "Na fila" ao lado do botão por DURACAO_DO_RESULTADO_MS.
  const resultado = controle.resultadoDe(ALVO);
  const [erroEditado, setErroEditado] = useState<ResultadoDaAcao | null>(null);
  const erroDoMotor = resultado?.tom === 'erro' && resultado !== erroEditado ? resultado : null;
  const [naFila, setNaFila] = useState(false);
  useEffect(() => {
    if (!naFila) return undefined;
    const id = setTimeout(() => setNaFila(false), DURACAO_DO_RESULTADO_MS);
    return () => clearTimeout(id);
  }, [naFila]);

  async function aoEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    const pr = prDaUrl(url);
    setFormaErrada(pr === null);
    if (pr === null) return;
    const aceito = await controle.disparar({ tipo: 'revisar', url: pr.url, alvo: ALVO, nome: nomeDoPr(pr.chave) });
    if (!aceito) return;
    setNaFila(true);
    setUrl('');
    if (gaveta.current) gaveta.current.open = false;
    botao.current?.focus();
  }

  return (
    <>
      {naFila ? <span className={estilos.confirmacaoNoBotao} data-visivel="sim" aria-hidden="true">Na fila</span> : null}
      <details
        ref={gaveta}
        className={ui.gaveta}
        onToggle={(evento) => { if (evento.currentTarget.open) campo.current?.focus(); }}
      >
        <summary ref={botao} className={ui.botao}>Revisar um PR</summary>
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
              onChange={(e) => { setUrl(e.target.value); setErroEditado(resultado); }}
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
            <ResultadoNoItem resultado={erroDoMotor} />
            <Botao type="submit" primario ocupado={enviando ? 'Lendo o PR…' : false}>Revisar</Botao>
          </form>
          <div className={estilos.checagemDoPainel}>
            <AcoesDoItem pequeno botoes={[{ acao: CHECAR, ocupado: 'Checando…' }]} controle={controle} />
            <p className={ui.mini}>{checagem}</p>
          </div>
        </div>
      </details>
    </>
  );
});
