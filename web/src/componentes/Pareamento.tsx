'use client';

// A entrada do front: troca o código de `node tools/farol-parear.js` por um token, em
// POST /api/auth/pair. Ocupa a página inteira enquanto este navegador não tem token.
//
// Três estados: motor inalcançável, código recusado, pareado (a tela sai). A recusa do motor
// é uma só, sem motivo nem contagem, e a tela mostra uma mensagem só.
import { useId, useState, type FormEvent } from 'react';
import type { App } from '@/estado/app';
import { BASE_DO_MOTOR, app as appDoNavegador, useApp } from '@/estado/instancia';
import { Logo } from './Logo';
import estilos from './Pareamento.module.css';

const COMANDO = 'node tools/farol-parear.js';
const ROTULO_MAX = 60;

interface Props {
  // os dois existem para o teste trocar a instância
  app?: App;
  base?: string;
}

export function Pareamento({ app = appDoNavegador, base = BASE_DO_MOTOR }: Props) {
  const motor = useApp((e) => e.motor, app);
  const [codigo, setCodigo] = useState('');
  const [rotulo, setRotulo] = useState('');
  const [recusado, setRecusado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const idDoErro = useId();

  async function aoEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const limpo = codigo.trim();
    if (!limpo || enviando) return;
    setEnviando(true);
    setRecusado(false);
    const desfecho = await app.parear(limpo, rotulo.trim());
    setEnviando(false);
    setRecusado(desfecho === 'recusado');
  }

  const foraDoAr = motor === 'inalcancavel';

  return (
    <main className={estilos.pagina}>
      <div className={estilos.marca}>
        <Logo />
        <span className={estilos.nome}>Farol</span>
      </div>

      <form className={estilos.cartao} onSubmit={aoEnviar} noValidate>
        <h1 className={estilos.titulo}>Parear este navegador</h1>
        <p className={estilos.texto}>
          No terminal do motor, rode <code>{COMANDO}</code> e digite aqui o código que aparecer. Ele vale uma vez e dura 10 minutos.
        </p>

        <div className={estilos.campo}>
          <label htmlFor="codigo">Código</label>
          <input
            id="codigo"
            className={`${estilos.entrada} ${estilos.codigo}`}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            required
            aria-invalid={recusado}
            aria-describedby={recusado ? idDoErro : undefined}
          />
        </div>

        <div className={estilos.campo}>
          <label htmlFor="rotulo">Nome deste navegador (opcional)</label>
          <input
            id="rotulo"
            className={estilos.entrada}
            value={rotulo}
            onChange={(e) => setRotulo(e.target.value)}
            maxLength={ROTULO_MAX}
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        {recusado ? (
          <p className={estilos.erro} role="alert" id={idDoErro}>
            Código não confere. Confira o que digitou. Se ele passou dos 10 minutos, já foi usado ou teve cinco tentativas erradas, gere outro no terminal.
          </p>
        ) : null}

        {!recusado && foraDoAr ? (
          <div className={estilos.erro} role="alert">
            <p>
              Não deu para falar com o motor em <code>{base}</code>. Confira se ele está no ar e se a origem desta página está em <code>origensPermitidas</code>.
            </p>
            <button type="button" className={estilos.botao} onClick={() => { void app.verificarMotor(); }}>
              Tentar de novo
            </button>
          </div>
        ) : null}

        <div className={estilos.acoes}>
          <button type="submit" className={`${estilos.botao} ${estilos.primario}`} disabled={enviando}>
            Parear
          </button>
          <span className={estilos.dica}>Nenhum cookie é criado: o token fica guardado só neste navegador.</span>
        </div>
      </form>
    </main>
  );
}
