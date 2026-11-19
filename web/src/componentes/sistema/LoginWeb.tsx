'use client';

// Refazer login de um perfil de assinatura, pelo fluxo do motor (src/sistema/login-web.ts). O
// código colado é credencial de uso único: o campo não é controlado pelo React (o valor não entra
// em estado nenhum), é lido só na hora do envio e limpo antes de o pedido sair, dê certo ou não.
// Depois do código o motor encerra o login de qualquer jeito: falhou, é começar de novo.
// Com outro login aberto no motor, a tela oferece cancelá-lo: o botão diz de qual perfil é, e
// pergunta antes, porque quem está no meio daquele login perde o que fez.
import { useEffect, useId, useRef, useState } from 'react';
import { Botao, ui } from '@/componentes/ui';
import { lerCancelamentoDoLogin, lerFimDoLogin, lerInicioDoLogin } from '@/contratos/sistema';
import { mensagemDaFalha } from '@/historico/consulta';
import { PASSOS_DO_LOGIN, ROTA_DO_CODIGO_DO_LOGIN, ROTA_DO_FIM_DO_LOGIN, ROTA_DO_INICIO_DO_LOGIN, fraseDaRecusaDoLogin } from '@/sistema/login-web';
import type { Cliente } from '@/transporte/cliente';
import estilos from './Sistema.module.css';

type Estado =
  | { fase: 'parado' }
  | { fase: 'abrindo' }
  | { fase: 'aberto'; loginId: string; url: string }
  | { fase: 'enviando'; loginId: string; url: string }
  | { fase: 'cancelando' };

interface Mensagem {
  tom: 'ok' | 'erro';
  texto: string;
  // o motor tem outro login aberto, deste perfil ou de outro: a tela oferece cancelá-lo
  perfilAberto?: string;
}

interface Props {
  cliente: Pick<Cliente, 'post'>;
  profileId: string;
  nome: string;
  impedimento: string | null;
  // como a tela chama o perfil de um id (o do login aberto pode ser de outro perfil)
  nomeDoPerfil?(id: string): string;
}

export function LoginWeb({ cliente, profileId, nome, impedimento, nomeDoPerfil }: Props) {
  const [estado, setEstado] = useState<Estado>({ fase: 'parado' });
  const [mensagem, setMensagem] = useState<Mensagem | null>(null);
  const [perguntando, setPerguntando] = useState(false);
  const codigo = useRef<HTMLInputElement>(null);
  const voltar = useRef<HTMLButtonElement>(null);
  const idDoCodigo = useId();
  const idDosPassos = useId();
  const idDaPergunta = useId();
  const idDoTextoDaPergunta = useId();
  // ao abrir a pergunta o foco vai ao Voltar sem cancelar; ao voltar, ao botão que a abriu
  const fila = useRef<HTMLDivElement>(null);
  const devolverFoco = useRef(false);
  useEffect(() => {
    if (perguntando) voltar.current?.focus();
    else if (devolverFoco.current) {
      devolverFoco.current = false;
      fila.current?.querySelector<HTMLButtonElement>('button[aria-label^="Cancelar o login aberto"]')?.focus();
    }
  }, [perguntando]);
  const fecharPergunta = (): void => {
    devolverFoco.current = true;
    setPerguntando(false);
  };

  async function abrir(): Promise<void> {
    setMensagem(null);
    setEstado({ fase: 'abrindo' });
    const r = await cliente.post(ROTA_DO_INICIO_DO_LOGIN, { profileId }, lerInicioDoLogin);
    if (!r.ok) {
      setEstado({ fase: 'parado' });
      if (r.falha !== 'cancelado') setMensagem({ tom: 'erro', texto: mensagemDaFalha(r) || 'O motor não respondeu.' });
      return;
    }
    if (!r.dados.ok) {
      setEstado({ fase: 'parado' });
      setMensagem({ tom: 'erro', texto: fraseDaRecusaDoLogin(r.dados.code, r.dados.motivo), perfilAberto: r.dados.code === 'login-em-curso' ? r.dados.perfilAberto ?? '' : undefined });
      return;
    }
    setEstado({ fase: 'aberto', loginId: r.dados.loginId, url: r.dados.url });
  }

  async function enviar(): Promise<void> {
    if (estado.fase !== 'aberto') return;
    const campo = codigo.current;
    const valor = campo?.value.trim() ?? '';
    if (!valor) {
      setMensagem({ tom: 'erro', texto: 'Cole o código que a página de login mostrou.' });
      campo?.focus();
      return;
    }
    // o código sai do campo antes do pedido: não fica na tela nem em estado nenhum
    if (campo) campo.value = '';
    setMensagem(null);
    setEstado({ ...estado, fase: 'enviando' });
    const r = await cliente.post(ROTA_DO_CODIGO_DO_LOGIN, { loginId: estado.loginId, code: valor }, lerFimDoLogin);
    setEstado({ fase: 'parado' });
    if (!r.ok) {
      if (r.falha !== 'cancelado') setMensagem({ tom: 'erro', texto: `${mensagemDaFalha(r) || 'O motor não respondeu.'} Não dá para saber se o login entrou: teste o perfil, e se preciso comece de novo.` });
      return;
    }
    if (!r.dados.ok) {
      setMensagem({ tom: 'erro', texto: fraseDaRecusaDoLogin(r.dados.code, r.dados.motivo) });
      return;
    }
    setMensagem({ tom: 'ok', texto: `Login feito no perfil ${nome}. O motor relê a validade e o uso do plano: a tela atualiza quando o estado chegar.` });
  }

  async function cancelar(corpo: { loginId: string } | { profileId: string }, deQuem?: string): Promise<void> {
    if (codigo.current) codigo.current.value = '';
    setPerguntando(false);
    setEstado({ fase: 'cancelando' });
    const r = await cliente.post(ROTA_DO_FIM_DO_LOGIN, corpo, lerCancelamentoDoLogin);
    setEstado({ fase: 'parado' });
    if (r.ok) setMensagem({ tom: 'ok', texto: `O motor encerrou o login aberto${deQuem ? ` do perfil ${deQuem}` : ''}. Dá para começar de novo.` });
    else if (r.falha !== 'cancelado') setMensagem({ tom: 'erro', texto: mensagemDaFalha(r) || 'O motor não respondeu ao cancelamento.' });
  }

  const aberto = estado.fase === 'aberto' || estado.fase === 'enviando';
  const outroLogin = mensagem?.perfilAberto;
  // o perfil do login aberto: o que o motor disse, ou este, quando ele não disse
  const idDoAberto = outroLogin || profileId;
  const nomeDoAberto = idDoAberto === profileId ? nome : nomeDoPerfil?.(idDoAberto) || idDoAberto;

  return (
    <div className={estilos.bloco}>
      {!aberto ? (
        <div ref={fila} className={ui.fila}>
          <Botao
            pequeno
            disabled={impedimento !== null || estado.fase === 'cancelando'}
            ocupado={estado.fase === 'abrindo' ? 'Abrindo o login…' : false}
            aria-label={`Refazer o login do perfil ${nome}`}
            onClick={() => { void abrir(); }}
          >
            Refazer login
          </Botao>
          {outroLogin !== undefined && !perguntando ? (
            <Botao
              pequeno
              fantasma
              ocupado={estado.fase === 'cancelando' ? 'Cancelando…' : false}
              aria-label={`Cancelar o login aberto do perfil ${nomeDoAberto}`}
              onClick={() => setPerguntando(true)}
            >
              Cancelar o login aberto de {nomeDoAberto}
            </Botao>
          ) : null}
        </div>
      ) : (
        <form
          className={estilos.formulario}
          aria-label={`Login do perfil ${nome}`}
          onSubmit={(evento) => { evento.preventDefault(); void enviar(); }}
        >
          <p id={idDosPassos} className={ui.mini}>{PASSOS_DO_LOGIN}</p>
          <p className={estilos.enderecoDoLogin}>
            <a href={estado.url} target="_blank" rel="noopener noreferrer">Abrir a página de login do Claude</a>
          </p>
          <div className={estilos.campo}>
            <label className={ui.rotulo} htmlFor={idDoCodigo}>Código da página de login</label>
            <input
              id={idDoCodigo}
              ref={codigo}
              className={ui.campo}
              type="password"
              autoComplete="one-time-code"
              spellCheck={false}
              aria-describedby={idDosPassos}
              disabled={estado.fase === 'enviando'}
            />
          </div>
          <div className={ui.fila}>
            <Botao pequeno fantasma disabled={estado.fase === 'enviando'} onClick={() => { void cancelar({ loginId: estado.loginId }); }}>Cancelar</Botao>
            <Botao pequeno primario type="submit" ocupado={estado.fase === 'enviando' ? 'Enviando o código…' : false}>Enviar o código</Botao>
          </div>
        </form>
      )}
      {!aberto && outroLogin !== undefined && perguntando ? (
        <div
          className={estilos.pergunta}
          role="group"
          aria-labelledby={idDaPergunta}
          aria-describedby={idDoTextoDaPergunta}
          onKeyDown={(evento) => {
            if (evento.key !== 'Escape') return;
            evento.stopPropagation();
            fecharPergunta();
          }}
        >
          <p id={idDaPergunta} className={estilos.tituloDaPergunta}>Cancelar o login aberto do perfil {nomeDoAberto}?</p>
          <p id={idDoTextoDaPergunta} className={ui.mini}>
            O motor encerra o login do Claude aberto no perfil {nomeDoAberto}. Se alguém estiver no meio desse login, o código que a página mostrar não vale mais e é preciso começar de novo. O login que já estava feito no perfil não muda.
          </p>
          <div className={estilos.botoesDaPergunta}>
            <button ref={voltar} type="button" className={`${ui.botao} ${ui.fantasma}`} onClick={fecharPergunta}>Voltar sem cancelar</button>
            <Botao primario onClick={() => { void cancelar({ profileId: idDoAberto }, nomeDoAberto); }}>Cancelar o login do perfil {nomeDoAberto}</Botao>
          </div>
        </div>
      ) : null}
      <div role="status" aria-live="polite" aria-label={`Resultado do login do perfil ${nome}`}>
        {mensagem ? <p className={mensagem.tom === 'ok' ? ui.mini : ui.erro}>{mensagem.tom === 'erro' ? 'Erro: ' : ''}{mensagem.texto}</p> : null}
      </div>
    </div>
  );
}
