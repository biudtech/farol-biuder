'use client';

// A seção Saúde: o que o diagnóstico do motor mediu, uma verificação por linha, com o estado
// dito em texto num chip (a cor só acompanha). É só o miolo: a linha que abre é do Sistema.tsx,
// que também monta as verificações (todasAsVerificacoes). A tela não mede nada: as linhas saem
// da chave `doctor` do snapshot, da versão do Claude Code em `modelos`, dos problemas de perfil
// em `claudePerfis` e da conta em `accounts`. "Rodar o diagnóstico de novo" chama GET
// /api/doctor (enquanto ele roda, as linhas do diagnóstico dizem "Conferindo"), e o relatório é
// o markdown que o próprio motor monta em GET /api/diagnostics.
import { useId } from 'react';
import { Botao, Chip, Spinner, ui, type Tom } from '@/componentes/ui';
import { lerDiagnostico, lerSaudeDaRota, type Diagnostico, type Saude as Medida } from '@/contratos/sistema';
import { dataHora } from '@/radar/formato';
import { ROTULO_DO_ESTADO, ehGrave, resumoDaSaude, type Verificacao } from '@/sistema/saude';
import type { Cliente } from '@/transporte/cliente';
import { Markdown } from '../Markdown';
import { useChamada } from './useChamada';
import estilos from './Sistema.module.css';

export const ROTA_DO_DOCTOR = '/api/doctor';
export const ROTA_DO_DIAGNOSTICO = '/api/diagnostics';

// As linhas que o GET /api/doctor refaz: as do diagnóstico, não as que vêm de outro lugar.
const DE_FORA_DO_DOCTOR = new Set(['Versão do Claude Code', 'Monitoramento da conta']);

function tomDe(v: Verificacao): Tom {
  if (v.estado === 'ok') return 'ok';
  if (v.estado === 'sem-dado') return 'neutro';
  return ehGrave(v) ? 'ruim' : 'aviso';
}

interface Props {
  cliente: Pick<Cliente, 'get'>;
  // `undefined`: o motor não mandou a chave. `null`: o diagnóstico ainda não rodou.
  saude: Medida | null | undefined;
  verificacoes: readonly Verificacao[];
  // a versão do motor (`app.version`)
  versao: string;
}

export function Saude({ cliente, saude, verificacoes, versao }: Props) {
  const idDoRelatorio = useId();
  const doctor = useChamada<Medida>();
  const relatorio = useChamada<Diagnostico>();
  const conferido = saude?.checkedAt ? dataHora(saude.checkedAt) : '';

  return (
    <>
      {saude === undefined ? <p className={ui.nota}>Atenção: o motor não mandou o diagnóstico a esta tela.</p> : null}
      {saude === null ? <p className={ui.nota}>O diagnóstico do ambiente ainda não rodou nesta execução do motor. Rode-o abaixo.</p> : null}

      <p className={ui.soLeitor} role="status" aria-live="polite" aria-label="Resumo da saúde">{resumoDaSaude(verificacoes)}</p>
      <ul className={estilos.linhas} aria-label="Verificações do diagnóstico">
        {verificacoes.map((v, i) => {
          const conferindo = doctor.carregando && !DE_FORA_DO_DOCTOR.has(v.nome);
          return (
            <li key={`${i}:${v.nome}`} className={estilos.verificacao}>
              <span className={estilos.texto}><span className={estilos.nome}>{v.nome}:</span> <span className={ui.mini}>{v.detalhe}</span></span>
              {conferindo ? <Chip pequeno><Spinner tamanho="p" />Conferindo</Chip> : <Chip tom={tomDe(v)} pequeno>{ROTULO_DO_ESTADO[v.estado]}</Chip>}
            </li>
          );
        })}
      </ul>
      <p className={ui.mini}>
        Motor {versao || 'sem versão informada'}, diagnóstico {conferido ? `feito em ${conferido}` : saude === null ? 'ainda não rodou nesta execução do motor' : 'sem hora informada'}. O estado de cada linha é o que o motor informou: esta tela não testa nada por conta própria.
      </p>

      <p className={ui.mini}>
        Rodar de novo faz o motor conferir outra vez a versão do gh e do Claude Code, o token do gh e a versão publicada do Claude Code (uma consulta ao registro do npm). Não abre sessão de IA e não consome o plano nem a chave.
      </p>
      <div className={ui.fila}>
        <Botao
          ocupado={doctor.carregando ? 'Rodando o diagnóstico…' : false}
          onClick={() => { void doctor.chamar((sinal) => cliente.get(ROTA_DO_DOCTOR, lerSaudeDaRota, { sinal })); }}
        >
          Rodar o diagnóstico de novo
        </Botao>
        <Botao
          ocupado={relatorio.carregando ? 'Carregando o relatório…' : false}
          onClick={() => { void relatorio.chamar((sinal) => cliente.get(ROTA_DO_DIAGNOSTICO, lerDiagnostico, { sinal })); }}
        >
          {relatorio.dados ? 'Carregar o relatório de novo' : 'Carregar o relatório'}
        </Botao>
      </div>
      <div role="status" aria-live="polite" aria-label="Resultado do diagnóstico">
        {doctor.carregando ? <p className={ui.mini}>O motor está refazendo o diagnóstico.</p> : null}
        {!doctor.carregando && doctor.erro ? <p className={ui.erro}>Erro: {doctor.erro} O que está acima é do diagnóstico anterior.</p> : null}
        {!doctor.carregando && !doctor.erro && doctor.dados ? (
          <p className={ui.mini}>
            O motor refez o diagnóstico{doctor.dados.checkedAt ? ` em ${dataHora(doctor.dados.checkedAt)}` : ''}. As linhas acima mostram o estado que ele empurra para esta tela.
          </p>
        ) : null}
      </div>

      {relatorio.erro ? <p className={ui.erro} role="alert">Erro: {relatorio.erro}</p> : null}
      {relatorio.dados ? (
        <>
          <h3 id={idDoRelatorio} className={estilos.subtitulo}>Relatório do motor</h3>
          <p className={ui.mini}>
            O texto de diagnóstico que o próprio motor monta: ambiente, configuração em números, mudanças recentes de política, falhas registradas e o resumo do log. Quem mascara os segredos desse texto é o motor, antes de ele sair de lá.
          </p>
          <p className={ui.mini} role="status">
            {relatorio.dados.falhas === 0 ? 'O motor não tem falha registrada.' : `O motor tem ${relatorio.dados.falhas} ${relatorio.dados.falhas === 1 ? 'falha registrada' : 'falhas registradas'} no relatório.`}
          </p>
          <div className={`${estilos.relatorio} ${relatorio.carregando ? ui.apagada : ''}`} role="region" aria-labelledby={idDoRelatorio} tabIndex={0} aria-busy={relatorio.carregando}>
            <Markdown texto={relatorio.dados.markdown} nivelBase={4} />
          </div>
        </>
      ) : null}
    </>
  );
}
