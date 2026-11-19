'use client';

// "Cada sessão" (redesenho, lote 5): uma página de GET /api/usage, uma linha por operação, que
// abre com os tokens por tipo, o tempo por etapa, as tentativas, os arquivos lidos e o card. Quem
// busca, filtra e pagina é o motor. A linha mostra a tentativa mais recente da operação (os campos
// de topo que o motor manda); a operação com retomada diz quantas tentativas teve e, aberta,
// mostra cada uma com o custo e os tokens dela: nada é somado entre tentativas. "Baixar CSV" pede
// o mesmo recorte em `formato=csv`, pelo cliente (que leva o Bearer, ou passa pelo portão).
import Link from 'next/link';
import { memo, useId, useState, type ReactNode, type RefObject } from 'react';
import { CABECALHOS_DO_CSV, lerCsvDoConsumo, type Operacao, type PaginaDoDiario } from '@/contratos/consumo';
import { caminhoDoCsv, mensagemDaFalha, nomeDoCsv, type Consulta } from '@/consumo/consulta';
import { duracao, inteiro, rotuloDoDesfecho, rotuloDoGatilho, rotuloDoModelo, rotuloDoTipo, textoDoCusto, tokensCurtos, urlDoPr } from '@/consumo/formato';
import { barrasDasEtapas, partesDosTokens, somaDosTokens, textoDasTentativas } from '@/consumo/sessao';
import { dataComAno } from '@/radar/formato';
import type { Cliente } from '@/transporte/cliente';
import { ReferenciaDoPr } from '../radar/Bloco';
import { Botao, Chip, ui, type Tom } from '../ui';
import { BarraHorizontal } from './Quebras';
import estilos from './Consumo.module.css';

const BOM = '﻿';

// Entrega o texto ao navegador como arquivo. A leitura do texto tira a marca de ordem de bytes que
// o motor põe no começo (para a planilha não trocar os acentos), e ela volta aqui.
function baixar(texto: string, nome: string): void {
  const url = URL.createObjectURL(new Blob([texto.startsWith(BOM) ? texto : BOM + texto], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// `esperando`: a tela carrega um pedido novo, e o recorte na tela ainda não é o do endereço. O
// botão espera junto, para o arquivo não sair de um recorte que a pessoa não está vendo.
export function BaixarCsv({ cliente, consulta, esperando = false }: { cliente: Pick<Cliente, 'get'>; consulta: Consulta; esperando?: boolean }) {
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState('');
  async function pedir() {
    if (baixando) return;
    setBaixando(true);
    setErro('');
    const r = await cliente.get(caminhoDoCsv(consulta), lerCsvDoConsumo, { texto: true, cabecalhos: CABECALHOS_DO_CSV });
    setBaixando(false);
    // O nome é o do Content-Disposition do motor. nomeDoCsv é só a reserva para quando o cabeçalho
    // não chega: o motor em outra origem não o expõe (o CORS dele não tem Expose-Headers), e aí o
    // navegador o esconde. Pelo portão, na mesma origem, ele chega.
    if (r.ok) {
      const lido = r.dados;
      if (lido.ok) baixar(lido.csv, lido.nome ?? nomeDoCsv());
      else setErro(`o motor não entregou o arquivo. O que ele disse: ${lido.motivo}`);
    } else if (r.falha !== 'cancelado') setErro(mensagemDaFalha(r) || 'O arquivo não foi baixado.');
  }
  return (
    <>
      <Botao ocupado={baixando ? 'Baixando…' : false} disabled={esperando} aria-label="Baixar CSV deste recorte" onClick={() => { void pedir(); }}>Baixar CSV</Botao>
      {erro ? <p className={ui.erro} role="alert"><span><strong>Erro:</strong> {erro}</span></p> : null}
    </>
  );
}

// o desfecho como pílula, com o tom
function tomDoDesfecho(status: string | undefined): Tom {
  if (status === 'ok') return 'ok';
  if (status === 'erro' || status === 'interrompida' || status === 'parcial') return 'ruim';
  if (status === 'cancelada' || status === 'descartada') return 'aviso';
  return 'neutro';
}

// O desfecho curto da pílula; a frase inteira (rotuloDoDesfecho) fica no nome dela e na linha aberta.
const DESFECHO_CURTO: Record<string, string> = { parcial: 'Parcial', interrompida: 'Interrompida', descartada: 'Descartada' };

function desfechoCurto(status: string | undefined): string {
  return status !== undefined && Object.hasOwn(DESFECHO_CURTO, status) ? DESFECHO_CURTO[status] as string : rotuloDoDesfecho(status);
}

function tipoDa(op: Operacao): string {
  return op.gatilho !== undefined ? rotuloDoGatilho(op.gatilho) : rotuloDoTipo(op.kind);
}

function modeloEPerfil(op: Operacao, rotuloDoPerfil: (id: string) => string): string {
  return op.profile ? `${rotuloDoModelo(op.model)} · ${rotuloDoPerfil(op.profile)}` : rotuloDoModelo(op.model);
}

function Seta() {
  return (
    <svg className={estilos.seta} aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

const COLUNAS = 8;

// O que a linha aberta mostra.
function DetalheDaSessao({ op, id }: { op: Operacao; id: string }) {
  const partes = partesDosTokens(op);
  const etapas = op.etapas ? barrasDasEtapas(op.etapas) : [];
  // onde cada faixa começa: a soma das fatias anteriores da mesma tentativa
  const faixas: Array<{ chave: string; x: number; largura: number }> = [];
  for (const p of partes) faixas.push({ chave: p.chave, x: (faixas.at(-1)?.x ?? 0) + (faixas.at(-1)?.largura ?? 0), largura: p.fracao });
  const ref = op.pr ?? op.ref;
  const url = urlDoPr(op.pr) ?? urlDoPr(op.ref);
  return (
    <tr className={estilos.detalheDaSessao} id={id}>
      <td colSpan={COLUNAS}>
        <div className={estilos.blocosDaSessao}>
          <div className={estilos.blocoDaSessao}>
            <h3 className={estilos.tituloDoBlocoDaSessao}>Para onde foram os tokens{op.attempts.length > 1 ? ' (última tentativa)' : ''}</h3>
            {partes.length ? (
              <>
                <span className={estilos.faixas} aria-hidden="true">
                  <svg viewBox="0 0 100 10" preserveAspectRatio="none" focusable="false">
                    {faixas.map((f) => (f.largura > 0 ? <rect key={f.chave} className={estilos.faixa} data-tipo={f.chave} x={f.x} y={0} width={f.largura} height={10} /> : null))}
                  </svg>
                </span>
                <ul className={estilos.partes}>
                  {partes.map((p) => (
                    <li key={p.chave} className={estilos.parte}>
                      <span className={estilos.marca} data-tipo={p.chave} aria-hidden="true" />
                      <span>{p.nome}</span>
                      <b>{inteiro(p.valor)}</b>
                    </li>
                  ))}
                </ul>
                <p className={ui.mini}>O motor não tem preço por tipo de token: o custo é o da sessão inteira, {textoDoCusto(op)}.</p>
              </>
            ) : <p className={ui.mini}>O motor não mandou os tokens desta sessão.</p>}
          </div>
          <div className={estilos.blocoDaSessao}>
            <h3 className={estilos.tituloDoBlocoDaSessao}>Tempo em cada etapa</h3>
            {etapas.length ? etapas.map((e) => (
              <div key={e.id} className={estilos.etapa}>
                <span>{e.nome}</span>
                <BarraHorizontal fracao={e.fracao} />
                <span>{e.tempo}</span>
              </div>
            )) : <p className={ui.mini}>Sem etapas: a rodada ainda não decidiu, ou a sessão não é de revisão.</p>}
          </div>
          <div className={estilos.blocoDaSessao}>
            <h3 className={estilos.tituloDoBlocoDaSessao}>A sessão</h3>
            <span><b>Tentativas:</b> {textoDasTentativas(op.attempts)}</span>
            <span><b>Arquivos lidos:</b> {op.arquivosLidos === undefined ? 'o motor não informou' : inteiro(op.arquivosLidos)}</span>
            <span><b>Card:</b> {op.card ?? 'nenhum card lido'}</span>
            <span><b>Autor do PR:</b> {op.author ?? 'não informado'}</span>
            <span><b>Duração:</b> {duracao(op.duracaoMs)}</span>
            {op.attempts.length > 1 ? (
              <ul className={ui.mini}>
                {op.attempts.map((t, i) => (
                  <li key={`${t.at}-${i}`}>
                    Tentativa {i + 1}: {dataComAno(t.at) || 'sem data'}, {rotuloDoDesfecho(t.status)}, {textoDoCusto(t)}, {tokensCurtos(somaDosTokens(t))} tokens
                  </li>
                ))}
              </ul>
            ) : null}
            <div className={estilos.links}>
              {ref ? <Link className={`${ui.botao} ${ui.pequeno}`} href={`/historico?q=${encodeURIComponent(ref)}`}>Ver no Histórico</Link> : null}
              {url ? <a className={`${ui.botao} ${ui.pequeno}`} href={url} target="_blank" rel="noopener noreferrer">Abrir o PR</a> : null}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

interface Props {
  diario: PaginaDoDiario;
  // a frase do vazio (com ou sem filtro)
  vazio: string;
  // uma carga está no ar: os botões esperam
  ocupado: boolean;
  aoIr(pagina: number): void;
  // o título da seção, que recebe o foco quando a página muda
  refDoTitulo: RefObject<HTMLHeadingElement | null>;
  // o botão de baixar, montado por quem tem o cliente
  baixar: ReactNode;
  // o nome do perfil do Claude pelo id
  rotuloDoPerfil(id: string): string;
}

export const Sessoes = memo(function Sessoes({ diario, vazio, ocupado, aoIr, refDoTitulo, baixar: botaoDeBaixar, rotuloDoPerfil }: Props) {
  const [aberta, setAberta] = useState<string | null>(null);
  const prefixo = useId();
  // no motor a página começa em zero; na tela e no endereço, em um
  const pagina = diario.page + 1;
  const ir = (para: number) => {
    aoIr(para);
    // quem estava no pé da tabela volta ao começo dela
    refDoTitulo.current?.focus();
  };
  return (
    <section className={estilos.painel} aria-labelledby="consumo-sessoes">
      <div className={estilos.topoDasSessoes}>
        <h2 id="consumo-sessoes" ref={refDoTitulo} tabIndex={-1} className={estilos.tituloDoPainel}>Cada sessão</h2>
        {botaoDeBaixar}
      </div>
      {diario.descartados ? (
        <p className={ui.nota}>Atenção: {diario.descartados} operação(ões) desta página chegaram em formato que esta tela não lê e ficaram de fora.</p>
      ) : null}
      {diario.total === 0 ? <p className={ui.vazio}>{vazio}</p> : null}
      {diario.rows.length ? (
        <div className={estilos.rolagem} role="region" aria-label="Tabela das sessões" tabIndex={0}>
          <table className={estilos.tabela}>
            <caption>Sessões do período, a mais recente primeiro. A hora é a do fim da última tentativa, no fuso deste navegador. Abra uma linha para ver os tokens, as etapas e as tentativas.</caption>
            <thead>
              <tr>
                <th scope="col">Quando</th>
                <th scope="col" className={estilos.esquerda}>PR</th>
                <th scope="col" className={estilos.esquerda}>Tipo</th>
                <th scope="col" className={estilos.esquerda}>Modelo e perfil</th>
                <th scope="col">Duração</th>
                <th scope="col">Tokens</th>
                <th scope="col">Custo</th>
                <th scope="col" className={estilos.esquerda}>Desfecho</th>
              </tr>
            </thead>
            <tbody>
              {diario.rows.flatMap((op) => {
                const aberto = aberta === op.key;
                const idDoDetalhe = `${prefixo}-${op.key}`;
                const ref = op.ref ?? op.pr;
                const linha = (
                  <tr key={op.key} className={aberto ? estilos.linhaAberta : undefined}>
                    <th scope="row">
                      <button
                        type="button"
                        className={estilos.abrir}
                        aria-expanded={aberto}
                        aria-controls={aberto ? idDoDetalhe : undefined}
                        aria-label={`${aberto ? 'Fechar' : 'Abrir'} a sessão de ${ref ?? 'trabalho sem referência'}, ${dataComAno(op.at) || 'sem data'}`}
                        onClick={() => setAberta(aberto ? null : op.key)}
                      >
                        <Seta />
                        {dataComAno(op.at) || 'Sem data registrada'}
                      </button>
                      {op.attempts.length > 1 ? <span className={estilos.observacao}> (última de {op.attempts.length} tentativas)</span> : null}
                    </th>
                    <td className={estilos.esquerda}>{ref ? <ReferenciaDoPr chave={ref} url={urlDoPr(op.pr) ?? urlDoPr(op.ref)} /> : 'Sem referência'}</td>
                    <td className={estilos.esquerda}>{tipoDa(op)}</td>
                    <td className={estilos.esquerda}>{modeloEPerfil(op, rotuloDoPerfil)}</td>
                    <td>{duracao(op.duracaoMs)}</td>
                    <td>{tokensCurtos(somaDosTokens(op))}</td>
                    <td>{textoDoCusto(op)}</td>
                    <td className={estilos.esquerda} title={rotuloDoDesfecho(op.status)}><Chip pequeno tom={tomDoDesfecho(op.status)}>{desfechoCurto(op.status)}</Chip></td>
                  </tr>
                );
                return aberto ? [linha, <DetalheDaSessao key={`${op.key}|detalhe`} op={op} id={idDoDetalhe} />] : [linha];
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {diario.total > 0 ? (
        <nav className={estilos.paginacao} aria-label="Páginas das sessões">
          <span>{inteiro(diario.total)} {diario.total === 1 ? 'operação' : 'operações'} · página {pagina} de {diario.pages}</span>
          <span className={estilos.botoesDaPagina}>
            <Botao pequeno disabled={ocupado || pagina <= 1} aria-label="Página anterior das sessões" onClick={() => ir(pagina - 1)}>Anterior</Botao>
            <Botao pequeno disabled={ocupado || pagina >= diario.pages} aria-label="Próxima página das sessões" onClick={() => ir(pagina + 1)}>Próxima</Botao>
          </span>
        </nav>
      ) : null}
    </section>
  );
});
