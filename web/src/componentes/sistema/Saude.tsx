'use client';

// A seção Saúde: o que o diagnóstico do motor mediu, uma verificação por linha, com o estado
// dito em texto (a cor só acompanha). A tela não mede nada: as linhas saem da chave `doctor`
// do snapshot, da versão do Claude Code em `modelos`, dos problemas de perfil em
// `claudePerfis` e da conta em `accounts`. "Rodar o diagnóstico de novo" chama GET /api/doctor,
// e o relatório é o markdown que o próprio motor monta em GET /api/diagnostics.
import { useId } from 'react';
import { lerDiagnostico, lerSaudeDaRota, type ContaRevisora, type Diagnostico, type Modelos, type PerfisDoClaude, type Saude as Medida } from '@/contratos/sistema';
import { dataHora } from '@/radar/formato';
import { ROTULO_DO_ESTADO, resumoDaSaude, verificacaoDaConta, verificacaoDoCli, verificacoesDaSaude, verificacoesDosPerfis } from '@/sistema/saude';
import type { Cliente } from '@/transporte/cliente';
import { Markdown } from '../Markdown';
import comuns from '../radar/Radar.module.css';
import { Par } from './Formulario';
import { useChamada } from './useChamada';
import estilos from './Sistema.module.css';

export const ROTA_DO_DOCTOR = '/api/doctor';
export const ROTA_DO_DIAGNOSTICO = '/api/diagnostics';

interface Props {
  cliente: Pick<Cliente, 'get'>;
  // `undefined`: o motor não mandou a chave. `null`: o diagnóstico ainda não rodou.
  saude: Medida | null | undefined;
  modelos: Modelos | undefined;
  perfis: PerfisDoClaude | undefined;
  conta: ContaRevisora | undefined;
  // a versão do motor (`app.version`)
  versao: string;
}

export function Saude({ cliente, saude, modelos, perfis, conta, versao }: Props) {
  const idDoTitulo = useId();
  const idDoRelatorio = useId();
  const doctor = useChamada<Medida>();
  const relatorio = useChamada<Diagnostico>();

  const verificacoes = [
    ...(saude ? verificacoesDaSaude(saude) : []),
    ...[verificacaoDoCli(modelos?.cli)].filter((v) => v !== null),
    ...verificacoesDosPerfis(perfis),
    verificacaoDaConta(conta, (ms) => dataHora(ms) || 'hora não informada'),
  ];
  const conferido = saude?.checkedAt ? dataHora(saude.checkedAt) : '';

  return (
    <section id="saude" className={estilos.secao} aria-labelledby={idDoTitulo}>
      <h2 id={idDoTitulo} className={estilos.tituloDaSecao}>Saúde</h2>
      <p className={comuns.meta}>
        O que o diagnóstico do motor mediu no ambiente dele. O estado de cada linha é o que o motor informou: esta tela não testa nada por conta própria.
      </p>

      <dl className={estilos.campos}>
        <Par nome="Versão do motor">{versao || 'O motor não informou.'}</Par>
        <Par nome="Diagnóstico feito em">{conferido || (saude === null ? 'Ainda não rodou nesta execução do motor.' : 'O motor não informou.')}</Par>
      </dl>

      {saude === undefined ? <p className={`${comuns.nota} ${comuns.bloqueio}`}>Atenção: o motor não mandou o diagnóstico a esta tela.</p> : null}
      {saude === null ? <p className={comuns.nota}>O diagnóstico do ambiente ainda não rodou nesta execução do motor. Rode-o abaixo.</p> : null}

      <p className={comuns.meta} role="status" aria-live="polite" aria-label="Resumo da saúde">{resumoDaSaude(verificacoes)}</p>
      <ul className={estilos.verificacoes} aria-label="Verificações do diagnóstico">
        {verificacoes.map((v, i) => (
          <li key={`${i}:${v.nome}`} className={estilos.verificacao}>
            <span className={estilos.estado} data-estado={v.estado}>{ROTULO_DO_ESTADO[v.estado]}</span>
            <span><span className={estilos.nomeDaVerificacao}>{v.nome}:</span> {v.detalhe}</span>
          </li>
        ))}
      </ul>

      <p className={comuns.meta}>
        Rodar de novo faz o motor conferir outra vez a versão do gh e do Claude Code, o token do gh e a versão publicada do Claude Code (uma consulta ao registro do npm). Não abre sessão de IA e não consome o plano nem a chave.
      </p>
      <div className={comuns.botoes}>
        <button
          type="button"
          className={comuns.botao}
          disabled={doctor.carregando}
          onClick={() => { void doctor.chamar((sinal) => cliente.get(ROTA_DO_DOCTOR, lerSaudeDaRota, { sinal })); }}
        >
          {doctor.carregando ? 'Rodando o diagnóstico…' : 'Rodar o diagnóstico de novo'}
        </button>
      </div>
      <div role="status" aria-live="polite" aria-label="Resultado do diagnóstico">
        {doctor.carregando ? <p className={comuns.meta}>O motor está refazendo o diagnóstico.</p> : null}
        {!doctor.carregando && doctor.erro ? <p className={comuns.erroDoCampo}>Erro: {doctor.erro} O que está acima é do diagnóstico anterior.</p> : null}
        {!doctor.carregando && !doctor.erro && doctor.dados ? (
          <p className={comuns.nota}>
            O motor refez o diagnóstico{doctor.dados.checkedAt ? ` em ${dataHora(doctor.dados.checkedAt)}` : ''}. As linhas acima mostram o estado que ele empurra para esta tela.
          </p>
        ) : null}
      </div>

      <h3 id={idDoRelatorio} className={estilos.subtitulo}>Relatório do motor</h3>
      <p className={comuns.meta}>
        O texto de diagnóstico que o próprio motor monta: ambiente, configuração em números, mudanças recentes de política, falhas registradas e o resumo do log. Quem mascara os segredos desse texto é o motor, antes de ele sair de lá.
      </p>
      <div className={comuns.botoes}>
        <button
          type="button"
          className={comuns.botao}
          disabled={relatorio.carregando}
          onClick={() => { void relatorio.chamar((sinal) => cliente.get(ROTA_DO_DIAGNOSTICO, lerDiagnostico, { sinal })); }}
        >
          {relatorio.carregando ? 'Carregando o relatório…' : relatorio.dados ? 'Carregar o relatório de novo' : 'Carregar o relatório'}
        </button>
      </div>
      {relatorio.erro ? <p className={comuns.erroDoCampo} role="alert">Erro: {relatorio.erro}</p> : null}
      {relatorio.dados ? (
        <>
          <p className={comuns.meta} role="status">
            {relatorio.dados.falhas === 0 ? 'O motor não tem falha registrada.' : `O motor tem ${relatorio.dados.falhas} ${relatorio.dados.falhas === 1 ? 'falha registrada' : 'falhas registradas'} no relatório.`}
          </p>
          <div className={`${estilos.relatorio} ${estilos.carga}`} role="region" aria-labelledby={idDoRelatorio} tabIndex={0} aria-busy={relatorio.carregando} data-esmaecida={relatorio.carregando ? '' : undefined}>
            <Markdown texto={relatorio.dados.markdown} nivelBase={4} />
          </div>
        </>
      ) : null}
    </section>
  );
}
