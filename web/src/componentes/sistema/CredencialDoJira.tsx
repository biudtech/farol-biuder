'use client';

// Trocar a credencial do Jira de um site (decisão 3 do redesenho de 19/11/2026). O token de API
// do Atlassian é segredo: o campo é mascarado e não é controlado pelo React (o valor não entra em
// estado nenhum), é lido só na hora do envio, vai só no corpo de POST /api/jira/credential e é
// apagado do campo antes de o pedido sair, dê certo ou não. A resposta é lida só no `ok` e na
// frase da recusa (lerGravacaoDaCredencial): nada do que o motor mandasse de volta chega à tela.
// O e-mail não é segredo e fica no campo quando o envio falha.
import { useId, useRef, useState } from 'react';
import { Botao, ui } from '@/componentes/ui';
import { lerGravacaoDaCredencial } from '@/contratos/sistema';
import { mensagemDaFalha } from '@/historico/consulta';
import { ROTA_DA_CREDENCIAL_DO_JIRA, corpoDaCredencial, erroDaCredencial } from '@/sistema/jira';
import type { Cliente } from '@/transporte/cliente';
import estilos from './Sistema.module.css';

interface Props {
  cliente: Pick<Cliente, 'post'>;
  siteId: string;
  nome: string;
  impedimento: string | null;
}

export function CredencialDoJira({ cliente, siteId, nome, impedimento }: Props) {
  const [aberta, setAberta] = useState(false);
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null);
  const token = useRef<HTMLInputElement>(null);
  const botao = useRef<HTMLDivElement>(null);
  const idDoEmail = useId();
  const idDoToken = useId();
  const idDaNota = useId();

  function fechar(): void {
    if (token.current) token.current.value = '';
    setAberta(false);
    setEmail('');
  }

  async function enviar(): Promise<void> {
    const campo = token.current;
    const valor = campo?.value.trim() ?? '';
    const erro = erroDaCredencial(email, valor !== '');
    if (erro) {
      setMensagem({ tom: 'erro', texto: erro });
      return;
    }
    // o token sai do campo antes do pedido: não fica na tela nem em estado nenhum
    if (campo) campo.value = '';
    setMensagem(null);
    setEnviando(true);
    const r = await cliente.post(ROTA_DA_CREDENCIAL_DO_JIRA, corpoDaCredencial(siteId, email, valor), lerGravacaoDaCredencial);
    setEnviando(false);
    if (r.ok && r.dados.ok) {
      setAberta(false);
      setEmail('');
      setMensagem({ tom: 'ok', texto: `O motor guardou a credencial nova de ${nome}. Use Testar a conexão para conferir que ela vale.` });
      botao.current?.querySelector('button')?.focus();
      return;
    }
    if (r.ok) setMensagem({ tom: 'erro', texto: `O motor recusou a credencial${r.dados.ok ? '' : r.dados.erro ? `: ${r.dados.erro}` : ''}. O token foi apagado deste campo: cole de novo para tentar.` });
    else if (r.falha !== 'cancelado') setMensagem({ tom: 'erro', texto: `${mensagemDaFalha(r) || 'O motor não respondeu.'} Não dá para saber se a credencial entrou: teste a conexão. O token foi apagado deste campo.` });
  }

  return (
    <div className={estilos.bloco}>
      {!aberta ? (
        <div ref={botao} className={ui.fila}>
          <Botao pequeno disabled={impedimento !== null} aria-label={`Trocar a credencial do Jira de ${nome}`} onClick={() => { setMensagem(null); setAberta(true); }}>
            Trocar credencial
          </Botao>
        </div>
      ) : (
        <form className={estilos.formulario} aria-label={`Credencial nova de ${nome}`} onSubmit={(evento) => { evento.preventDefault(); void enviar(); }}>
          <p id={idDaNota} className={ui.mini}>
            O token vai só para o motor, que o guarda fora da configuração e nunca o devolve: depois de enviado ele não aparece mais aqui. Gere o token em id.atlassian.com, na conta dona do e-mail.
          </p>
          <div className={estilos.gradeDaRegra}>
            <div className={estilos.campo}>
              <label className={ui.rotulo} htmlFor={idDoEmail}>E-mail da conta do Atlassian</label>
              <input id={idDoEmail} className={ui.campo} type="email" value={email} autoComplete="off" spellCheck={false} disabled={enviando} onChange={(evento) => setEmail(evento.target.value)} />
            </div>
            <div className={estilos.campo}>
              <label className={ui.rotulo} htmlFor={idDoToken}>Token de API do Atlassian</label>
              <input id={idDoToken} ref={token} className={ui.campo} type="password" autoComplete="new-password" spellCheck={false} aria-describedby={idDaNota} disabled={enviando} />
            </div>
          </div>
          <div className={ui.fila}>
            <Botao pequeno fantasma disabled={enviando} onClick={fechar}>Cancelar</Botao>
            <Botao pequeno primario type="submit" ocupado={enviando ? 'Enviando…' : false}>Guardar a credencial</Botao>
          </div>
        </form>
      )}
      <div role="status" aria-live="polite" aria-label={`Resultado da troca da credencial de ${nome}`}>
        {mensagem ? <p className={mensagem.tom === 'ok' ? ui.mini : ui.erro}>{mensagem.tom === 'erro' ? 'Erro: ' : ''}{mensagem.texto}</p> : null}
      </div>
    </div>
  );
}
