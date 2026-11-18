'use client';

// "Exportar CSV", no topo do Histórico: baixa o recorte aberto (a busca e os filtros do endereço,
// sem página) como o motor o exporta (GET /api/decisions?formato=csv). O pedido vai pelo cliente,
// que manda o Bearer: um link direto para a rota não levaria a credencial. O escape do CSV e a
// proteção contra fórmula são do motor (lib/engine/historico-csv.js); aqui o texto só vira arquivo.
import { useState } from 'react';
import { lerCsv } from '@/contratos/historico';
import { caminhoDoCsv, mensagemDaFalha, nomeDoCsv, type Consulta } from '@/historico/consulta';
import type { Cliente } from '@/transporte/cliente';
import { Botao, ui } from '../ui';

// Entrega o texto ao navegador como arquivo. A leitura do texto tira a marca de ordem de bytes que
// o motor põe no começo (para a planilha não trocar os acentos), e ela volta aqui. O endereço
// temporário do arquivo é solto depois do clique, quando o navegador já começou a baixar.
const BOM = '\uFEFF';

function conteudoDoArquivo(texto: string): string {
  return texto.startsWith(BOM) ? texto : BOM + texto;
}

function baixar(texto: string, nome: string): void {
  const url = URL.createObjectURL(new Blob([conteudoDoArquivo(texto)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ExportarCsv({ cliente, consulta }: { cliente: Pick<Cliente, 'get'>; consulta: Consulta }) {
  const [exportando, setExportando] = useState(false);
  const [erro, setErro] = useState('');

  async function exportar() {
    if (exportando) return;
    setExportando(true);
    setErro('');
    const agora = Date.now();
    const r = await cliente.get(caminhoDoCsv(consulta, agora), lerCsv, { texto: true });
    setExportando(false);
    if (r.ok) baixar(r.dados, nomeDoCsv(agora));
    else if (r.falha !== 'cancelado') setErro(mensagemDaFalha(r) || 'A exportação foi interrompida.');
  }

  return (
    <>
      <Botao ocupado={exportando ? 'Exportando…' : false} onClick={() => { void exportar(); }}>Exportar CSV</Botao>
      {erro ? <p className={ui.erro} role="alert"><span><strong>Erro:</strong> {erro}</span></p> : null}
    </>
  );
}
