'use client';

// A seção Sessões pareadas: os navegadores com token válido no motor, com a sessão atual
// marcada, e o Revogar de cada uma. A lista vem de POST /api/auth/sessions e não está no
// snapshot: a tela a pede ao abrir, depois de cada revogação e pelo botão Atualizar. Do token
// nada vem: o `id` de cada sessão é um pedaço do hash dele.
import { useEffect, useId } from 'react';
import { lerSessoes, type SessaoPareada, type SessoesPareadas } from '@/contratos/sistema';
import type { Acao } from '@/radar/acoes';
import { dataComAno } from '@/radar/formato';
import { nomeDaSessao, textoDaLista } from '@/sistema/sessoes';
import type { Cliente } from '@/transporte/cliente';
import { AcoesDoItem } from '../radar/AcoesDoItem';
import type { ControleDeAcoes } from '../radar/useAcoes';
import comuns from '../radar/Radar.module.css';
import { Par } from './Formulario';
import { useChamada } from './useChamada';
import estilos from './Sistema.module.css';

export const ROTA_DAS_SESSOES = '/api/auth/sessions';
export const alvoDaSessao = (id: string): string => `sistema:sessao:${id}`;

function acaoDeRevogar(sessao: SessaoPareada): Acao {
  return { tipo: 'revogarSessao', alvo: alvoDaSessao(sessao.id), nome: nomeDaSessao(sessao), id: sessao.id, rotulo: sessao.rotulo, atual: sessao.atual };
}

interface Props {
  cliente: Pick<Cliente, 'post'>;
  controle: ControleDeAcoes;
  // muda quando a lista precisa ser pedida de novo (uma revogação aceita)
  recarga: number;
}

export function Sessoes({ cliente, controle, recarga }: Props) {
  const idDoTitulo = useId();
  const { carregando, dados, erro, chamar } = useChamada<SessoesPareadas>();

  useEffect(() => {
    void chamar((sinal) => cliente.post(ROTA_DAS_SESSOES, {}, lerSessoes, { sinal }));
  }, [chamar, cliente, recarga]);

  let anuncio = '';
  if (carregando && !dados) anuncio = 'Carregando as sessões pareadas.';
  else if (dados && !carregando) anuncio = textoDaLista(dados.sessoes.length);

  return (
    <section id="sessoes" className={estilos.secao} aria-labelledby={idDoTitulo}>
      <h2 id={idDoTitulo} className={estilos.tituloDaSecao}>Sessões pareadas</h2>
      <p className={comuns.meta}>
        Cada navegador pareado tem uma sessão no motor. Revogar faz o token dela deixar de valer na hora. O Sair do topo desta página revoga a sessão deste navegador antes de apagar o token daqui.
      </p>
      <div className={comuns.botoes}>
        <button type="button" className={comuns.botao} disabled={carregando} onClick={() => { void chamar((sinal) => cliente.post(ROTA_DAS_SESSOES, {}, lerSessoes, { sinal })); }}>
          {carregando ? 'Carregando…' : 'Atualizar a lista'}
        </button>
      </div>
      <p className={comuns.meta} role="status" aria-live="polite" aria-label="Resultado da lista de sessões">{anuncio}</p>
      {erro ? (
        <p className={estilos.erro} role="alert">
          <span><strong>Erro:</strong> {erro}{dados ? ' A lista abaixo é da última carga que deu certo.' : ''}</span>
        </p>
      ) : null}
      {dados ? (
        <div className={estilos.carga} aria-busy={carregando} data-esmaecida={carregando ? '' : undefined}>
          {dados.descartadas ? <p className={`${comuns.nota} ${comuns.bloqueio}`}>Atenção: {dados.descartadas} sessão(ões) chegaram do motor em formato que esta tela não lê e ficaram de fora.</p> : null}
          {!dados.sessoes.length ? (
            <p className={comuns.vazio}>O motor não listou sessão pareada. Se a autenticação não é exigida nesta instância, não há sessão a revogar.</p>
          ) : null}
          {dados.sessoes.length && !dados.sessoes.some((s) => s.atual) ? (
            <p className={comuns.nota}>Aviso: o motor não marcou nenhuma sessão como a deste navegador.</p>
          ) : null}
          {dados.sessoes.length ? (
            <ul className={estilos.itens} aria-label="Sessões pareadas">
              {dados.sessoes.map((sessao) => (
                <li key={sessao.id} className={estilos.item}>
                  <h3 className={estilos.tituloDoItem}>
                    <span>Sessão {sessao.rotulo.trim() ? `"${sessao.rotulo.trim()}"` : 'sem nome'}</span>
                    {sessao.atual ? <span className={comuns.selo}>Este navegador</span> : null}
                  </h3>
                  <dl className={estilos.campos}>
                    <Par nome="Criada em">{dataComAno(sessao.criadoEm) || 'O motor não informou.'}</Par>
                    <Par nome="Usada pela última vez em">{dataComAno(sessao.ultimoUsoEm) || 'O motor não informou.'}</Par>
                    <Par nome="Identificador">{sessao.id}</Par>
                  </dl>
                  <AcoesDoItem botoes={[{ acao: acaoDeRevogar(sessao) }]} controle={controle} />
                </li>
              ))}
            </ul>
          ) : null}
          <p className={comuns.meta}>O motor anota o último uso de tempos em tempos, não a cada chamada. As datas estão no fuso deste navegador.</p>
        </div>
      ) : null}
    </section>
  );
}
