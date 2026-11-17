'use client';

// A seção Sessões pareadas: os navegadores com token válido no motor, com a sessão atual
// marcada, e o Encerrar de cada uma (que revoga o token no motor). É só o miolo: a linha que
// abre e a carga da lista são do Sistema.tsx, porque o resumo da linha depende dela. A lista
// vem de POST /api/auth/sessions e não está no snapshot: a tela a pede ao abrir, depois de cada
// encerramento e pelo botão Atualizar. Do token nada vem: o `id` de cada sessão é um pedaço do
// hash dele.
import { Botao, Chip, Spinner, ui } from '@/componentes/ui';
import type { SessaoPareada, SessoesPareadas } from '@/contratos/sistema';
import type { Acao } from '@/radar/acoes';
import { dataComAno } from '@/radar/formato';
import { nomeDaSessao, textoDaLista } from '@/sistema/sessoes';
import type { ControleDeAcoes } from '../radar/useAcoes';
import { AcaoComPergunta } from './AcaoComPergunta';
import type { Chamada } from './useChamada';
import estilos from './Sistema.module.css';

export const ROTA_DAS_SESSOES = '/api/auth/sessions';
export const alvoDaSessao = (id: string): string => `sistema:sessao:${id}`;

function acaoDeEncerrar(sessao: SessaoPareada): Acao {
  return { tipo: 'revogarSessao', alvo: alvoDaSessao(sessao.id), nome: nomeDaSessao(sessao), id: sessao.id, rotulo: sessao.rotulo, atual: sessao.atual };
}

interface Props {
  controle: ControleDeAcoes;
  lista: Pick<Chamada<SessoesPareadas>, 'carregando' | 'dados' | 'erro'>;
  aoAtualizar(): void;
}

export function Sessoes({ controle, lista, aoAtualizar }: Props) {
  const { carregando, dados, erro } = lista;

  let anuncio = '';
  if (carregando && !dados) anuncio = 'Carregando as sessões pareadas.';
  else if (dados && !carregando) anuncio = textoDaLista(dados.sessoes.length);

  return (
    <>
      <p className={ui.mini}>
        Cada navegador pareado tem uma sessão no motor. Encerrar faz o token dela deixar de valer na hora. O Sair do topo desta página encerra a sessão deste navegador antes de apagar o token daqui.
      </p>
      <div className={ui.fila}>
        <Botao pequeno ocupado={carregando ? 'Carregando…' : false} onClick={aoAtualizar}>Atualizar a lista</Botao>
      </div>
      <p className={`${ui.mini} ${estilos.anuncio}`} role="status" aria-live="polite" aria-label="Resultado da lista de sessões">
        {carregando && !dados ? <Spinner tamanho="p" /> : null}
        {anuncio}
      </p>
      {erro ? (
        <p className={ui.erro} role="alert">
          <span><strong>Erro:</strong> {erro}{dados ? ' A lista abaixo é da última carga que deu certo.' : ''}</span>
        </p>
      ) : null}
      {dados ? (
        <div className={carregando ? ui.apagada : undefined} aria-busy={carregando}>
          {dados.descartadas ? <p className={ui.nota}>Atenção: {dados.descartadas} sessão(ões) chegaram do motor em formato que esta tela não lê e ficaram de fora.</p> : null}
          {!dados.sessoes.length ? (
            <p className={ui.vazio}>O motor não listou sessão pareada. Se a autenticação não é exigida nesta instância, não há sessão a encerrar.</p>
          ) : null}
          {dados.sessoes.length && !dados.sessoes.some((s) => s.atual) ? (
            <p className={ui.nota}>Aviso: o motor não marcou nenhuma sessão como a deste navegador.</p>
          ) : null}
          {dados.sessoes.length ? (
            <ul className={estilos.linhas} aria-label="Sessões pareadas">
              {dados.sessoes.map((sessao) => (
                <li key={sessao.id} className={estilos.sessao}>
                  <div className={estilos.texto}>
                    <h3 className={estilos.tituloDoItem}>
                      <span>Sessão {sessao.rotulo.trim() ? `"${sessao.rotulo.trim()}"` : 'sem nome'}</span>
                      {sessao.atual ? <Chip pequeno tom="ok">Este navegador</Chip> : null}
                    </h3>
                    <p className={ui.mini}>
                      Criada em {dataComAno(sessao.criadoEm) || 'data não informada'}, usada pela última vez em {dataComAno(sessao.ultimoUsoEm) || 'data não informada'}. Identificador {sessao.id}.
                    </p>
                  </div>
                  <AcaoComPergunta acao={acaoDeEncerrar(sessao)} controle={controle} ocupado="Encerrando…" pequeno />
                </li>
              ))}
            </ul>
          ) : null}
          <p className={ui.mini}>O motor anota o último uso de tempos em tempos, não a cada chamada. As datas estão no fuso deste navegador.</p>
        </div>
      ) : null}
    </>
  );
}
