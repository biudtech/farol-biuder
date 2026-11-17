'use client';

// A entrada do front: troca o código de `node tools/farol-parear.js` por um token, em
// POST /api/auth/pair. Ocupa a página inteira enquanto este navegador não tem token.
//
// Quatro estados: motor inalcançável, código de forma errada (nem vai ao motor), código
// recusado, pareado (a tela sai). A recusa do motor é uma só, sem motivo nem contagem, e a
// tela mostra uma mensagem só.
//
// Quando a tela aparece porque a sessão caiu (401, ou o token saiu por outra aba), ela diz
// por quê numa linha e leva o foco ao campo do código. Depois do Sair, ela diz o que aconteceu
// com a sessão no motor: revogada, ou só esquecida neste navegador (textoDaSaida).
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { TAMANHO_DO_CODIGO, codigoBemFormado, normalizarCodigo } from '@/contratos/auth';
import type { App, MotivoDoPareamento } from '@/estado/app';
import { BASE_DO_MOTOR, app as appDoNavegador, useApp } from '@/estado/instancia';
import { textoDaSaida } from '@/sistema/sessoes';
import { Logo } from './Logo';
import { Spinner } from './ui';
import estilos from './Pareamento.module.css';

const COMANDO = 'node tools/farol-parear.js';
const ROTULO_MAX = 60;

const AVISOS: Partial<Record<MotivoDoPareamento, string>> = {
  'nao-autenticado': 'A sessão deste navegador não vale mais no motor. Pareie de novo.',
  'outra-aba': 'A sessão foi encerrada em outra aba deste navegador. Pareie de novo.',
};

type Erro = 'nenhum' | 'forma' | 'recusado';

interface Props {
  // os dois existem para o teste trocar a instância
  app?: App;
  base?: string;
}

export function Pareamento({ app = appDoNavegador, base = BASE_DO_MOTOR }: Props) {
  const motor = useApp((e) => e.motor, app);
  const [codigo, setCodigo] = useState('');
  const [rotulo, setRotulo] = useState('');
  const motivo = useApp((e) => e.motivo, app);
  const [erro, setErro] = useState<Erro>('nenhum');
  const [enviando, setEnviando] = useState(false);
  const idDoErro = useId();
  const idDoAviso = useId();
  const campoDoCodigo = useRef<HTMLInputElement>(null);
  const saida = useApp((e) => e.saida, app);
  const aviso = saida ? textoDaSaida(saida) : AVISOS[motivo];

  // Quem caiu aqui vindo da casca (401, outra aba, o próprio Sair) perdeu o elemento que
  // tinha o foco. Na carga da página, sem token, o foco fica onde o navegador pôs.
  useEffect(() => {
    if (motivo !== 'nenhum') campoDoCodigo.current?.focus();
  }, [motivo]);

  async function aoEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    // A mesma normalização do motor, e a conferência da forma antes do POST: tentativa errada
    // conta contra o código pendente, e o que nem tem a forma de um código não deve gastá-la.
    const limpo = normalizarCodigo(codigo);
    if (!codigoBemFormado(limpo)) {
      setErro('forma');
      campoDoCodigo.current?.focus();
      return;
    }
    setEnviando(true);
    setErro('nenhum');
    const desfecho = await app.parear(limpo, rotulo.trim());
    setEnviando(false);
    setErro(desfecho === 'recusado' ? 'recusado' : 'nenhum');
  }

  const comErro = erro !== 'nenhum';
  const foraDoAr = motor === 'inalcancavel';
  const descricao = [comErro ? idDoErro : '', aviso ? idDoAviso : ''].filter(Boolean).join(' ') || undefined;

  return (
    <main className={estilos.pagina}>
      <div className={estilos.marca}>
        <Logo />
        <i className={estilos.divisor} aria-hidden="true" />
        <span className={estilos.nome}>Farol</span>
      </div>

      <form className={estilos.cartao} onSubmit={aoEnviar} noValidate>
        <h1 className={estilos.titulo}>Parear este navegador</h1>
        {aviso ? <p className={estilos.aviso} role="status" id={idDoAviso}>{aviso}</p> : null}
        <p className={estilos.texto}>
          No terminal do motor, rode <code>{COMANDO}</code> e digite aqui o código que aparecer. Ele vale uma vez e dura 10 minutos.
        </p>

        <div className={estilos.campo}>
          <label htmlFor="codigo">Código</label>
          <input
            id="codigo"
            ref={campoDoCodigo}
            className={`${estilos.entrada} ${estilos.codigo}`}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            required
            aria-invalid={comErro}
            aria-describedby={descricao}
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

        {erro === 'forma' ? (
          <p className={estilos.erro} role="alert" id={idDoErro}>
            O código tem {TAMANHO_DO_CODIGO} caracteres, só letras de A a Z e números de 2 a 7. Confira o que digitou.
          </p>
        ) : null}

        {erro === 'recusado' ? (
          <p className={estilos.erro} role="alert" id={idDoErro}>
            Código não confere. Confira o que digitou. Se ele passou dos 10 minutos, já foi usado ou teve cinco tentativas erradas, gere outro no terminal.
          </p>
        ) : null}

        {!comErro && foraDoAr ? (
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
            {enviando ? <><Spinner tamanho="p" />Pareando…</> : 'Parear'}
          </button>
          <span className={estilos.dica}>Nenhum cookie é criado: o token fica guardado só neste navegador.</span>
        </div>
      </form>
    </main>
  );
}
