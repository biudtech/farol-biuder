'use client';

// O período, os filtros e a busca do Consumo (redesenho, lote 5). Quem recorta é o motor: aqui
// só se escolhe. No topo, os períodos prontos (Hoje, 7, 30 e 90 dias, que terminam no hoje do
// motor). Embaixo, a barra de filtros: a busca, o repositório, o autor, o modelo e o perfil, e
// "Outro período" com De e Até. O que estiver escolhido vira pílula, com o botão que a tira, e
// Limpar filtros. As opções são as que o motor listou; valor do endereço que não está nelas
// continua escolhido, dizendo de onde veio. A busca espera um instante depois da última tecla.
import { useEffect, useId, useState } from 'react';
import type { OpcoesDeFiltro } from '@/contratos/consumo';
import {
  ANO_MINIMO, PERIODOS, TETO_DA_BUSCA, comPeriodo, dataAceita, dicaDoPeriodo, filtrosAtivos, periodoPronto, rotuloDoPeriodoPronto, temPeriodo, type Consulta,
} from '@/consumo/consulta';
import { rotuloDoModelo } from '@/consumo/formato';
import { ui } from '../ui';
import estilos from './Consumo.module.css';

// quanto a busca espera depois da última tecla
export const ESPERA_DA_BUSCA_MS = 300;

type Ir = (consulta: Consulta, modo: 'empilhar' | 'trocar') => void;
type Periodo = { start: string; end: string };

// ---------- os períodos prontos do topo ----------

interface PropsDosPeriodos {
  consulta: Consulta;
  // o período do relatório na tela (sem o dia clicado)
  periodo: Periodo | null;
  // o último dia do relatório mais recente; sem ele os períodos prontos esperam
  fim: string | null;
  aoMudar: Ir;
}

// Gravam as duas datas e terminam no último dia do relatório na tela. O que está escolhido fica
// marcado (aria-pressed); período fora dos prontos não marca nenhum e vira pílula.
export function Periodos({ consulta, periodo, fim, aoMudar }: PropsDosPeriodos) {
  const pronto = periodo ? periodoPronto(consulta, periodo) : null;
  return (
    <div className={estilos.periodos} role="group" aria-label="Período">
      {PERIODOS.map((dias) => (
        <button
          key={dias}
          type="button"
          className={estilos.periodo}
          aria-pressed={pronto === dias}
          disabled={fim === null}
          onClick={() => { if (fim !== null) aoMudar(comPeriodo(consulta, fim, dias), 'empilhar'); }}
        >
          {rotuloDoPeriodoPronto(dias)}
        </button>
      ))}
    </div>
  );
}

// ---------- a barra de filtros ----------

interface PropsDoSeletor {
  nome: string;
  valor: string;
  opcoes: readonly string[];
  rotulo(valor: string): string;
  aoEscolher(valor: string): void;
}

function Seletor({ nome, valor, opcoes, rotulo, aoEscolher }: PropsDoSeletor) {
  const id = useId();
  // o motor compara o autor sem caixa: "Ana" no endereço é a opção "ana"
  const naLista = valor === '' || opcoes.includes(valor);
  return (
    <div className={estilos.campoDoFiltro}>
      <label className={ui.rotulo} htmlFor={id}>{nome}</label>
      <select id={id} className={ui.campo} value={valor} onChange={(evento) => aoEscolher(evento.target.value)}>
        <option value="">Todos</option>
        {opcoes.map((opcao) => <option key={opcao} value={opcao}>{rotulo(opcao)}</option>)}
        {naLista ? null : <option value={valor}>{valor} (valor do endereço)</option>}
      </select>
    </div>
  );
}

interface PropsDaData {
  nome: string;
  // a data do endereço
  valor: string;
  aoMudar(dia: string): void;
}

// Um campo de data. O que se digita fica no campo; só vira endereço (e pedido ao motor) quando
// é um dia que existe, de 1970 em diante, ou quando o campo é esvaziado. Enquanto se digita o
// ano, o navegador entrega 0002, 0020, 0202: nada disso vai ao motor.
function CampoDeData({ nome, valor, aoMudar }: PropsDaData) {
  const id = useId();
  const idDoErro = useId();
  const [texto, setTexto] = useState(valor);
  // o valor do endereço que o campo já refletiu: quando ele muda por fora, o campo acompanha
  const [visto, setVisto] = useState(valor);
  if (valor !== visto) {
    setVisto(valor);
    setTexto(valor);
  }
  // o que veio do endereço não é julgado aqui: quem responde por ele é o motor
  const invalida = texto !== '' && texto !== valor && !dataAceita(texto);
  return (
    <div className={ui.rotulo}>
      <label htmlFor={id}>{nome}</label>
      <input
        id={id}
        className={ui.campo}
        type="date"
        value={texto}
        min={`${ANO_MINIMO}-01-01`}
        aria-invalid={invalida}
        aria-describedby={invalida ? idDoErro : undefined}
        onChange={(evento) => {
          const novo = evento.target.value;
          setTexto(novo);
          if (novo === '' || dataAceita(novo)) aoMudar(novo);
        }}
      />
      {invalida ? <p id={idDoErro} className={estilos.erroDoCampo} role="alert">Data inválida: use um dia de {ANO_MINIMO} em diante. Nada foi pedido ao motor.</p> : null}
    </div>
  );
}

interface PropsDaBusca {
  q: string;
  aoBuscar(q: string): void;
}

function Busca({ q, aoBuscar }: PropsDaBusca) {
  const [texto, setTexto] = useState(q);
  // O `q` do endereço que este campo já refletiu, e o que ele mandou e ainda não viu voltar.
  // Quando o endereço muda por fora (voltar do navegador, Limpar), o campo acompanha; quando
  // muda porque o campo mandou, o que a pessoa digitou depois disso não é desfeito.
  const [visto, setVisto] = useState(q);
  const [mandado, setMandado] = useState<string | null>(null);
  if (q !== visto) {
    setVisto(q);
    if (q === mandado) setMandado(null);
    else setTexto(q);
  }

  useEffect(() => {
    if (texto === q) return undefined;
    const relogio = setTimeout(() => {
      setMandado(texto);
      aoBuscar(texto);
    }, ESPERA_DA_BUSCA_MS);
    return () => clearTimeout(relogio);
  }, [texto, q, aoBuscar]);

  const id = useId();
  const idDaDica = useId();
  return (
    <div className={estilos.campoDaBusca}>
      <label className={ui.rotulo} htmlFor={id}>Buscar sessão</label>
      <input
        id={id}
        className={ui.campo}
        type="search"
        value={texto}
        maxLength={TETO_DA_BUSCA}
        autoComplete="off"
        spellCheck={false}
        placeholder="dono/repo#12 ou modelo"
        aria-describedby={idDaDica}
        onChange={(evento) => setTexto(evento.target.value)}
        onKeyDown={(evento) => {
          if (evento.key !== 'Enter' || texto === q) return;
          evento.preventDefault();
          setMandado(texto);
          aoBuscar(texto);
        }}
      />
      <p id={idDaDica} className={ui.mini}>Parte do PR (dono/repo#n), do tipo ou do modelo. Recorta só a tabela de sessões; os outros filtros recortam também os números e os gráficos.</p>
    </div>
  );
}

interface PropsDosFiltros {
  consulta: Consulta;
  opcoes: OpcoesDeFiltro;
  periodo: Periodo | null;
  rotuloDoPerfil(id: string): string;
  aoMudar: Ir;
  aoBuscar(q: string): void;
}

export function BarraDeFiltros({ consulta, opcoes, periodo, rotuloDoPerfil, aoMudar, aoBuscar }: PropsDosFiltros) {
  const escolher = (campo: 'repo' | 'autor' | 'modelo' | 'perfil') => (valor: string) => aoMudar({ ...consulta, [campo]: valor, pagina: 1 }, 'empilhar');
  return (
    <form className={estilos.filtros} role="search" aria-label="Busca e filtros do consumo" onSubmit={(evento) => evento.preventDefault()}>
      <Busca q={consulta.q} aoBuscar={aoBuscar} />
      <Seletor nome="Repositório" valor={consulta.repo} opcoes={opcoes.repo} rotulo={(r) => r} aoEscolher={escolher('repo')} />
      <Seletor nome="Autor do PR" valor={consulta.autor} opcoes={opcoes.author} rotulo={(a) => a} aoEscolher={escolher('autor')} />
      <Seletor nome="Modelo" valor={consulta.modelo} opcoes={opcoes.model} rotulo={rotuloDoModelo} aoEscolher={escolher('modelo')} />
      <Seletor nome="Perfil do Claude" valor={consulta.perfil} opcoes={opcoes.profile} rotulo={rotuloDoPerfil} aoEscolher={escolher('perfil')} />
      <details className={estilos.outroPeriodo} open={temPeriodo(consulta) && (periodo === null || periodoPronto(consulta, periodo) === null) ? true : undefined}>
        <summary>Outro período</summary>
        <div className={estilos.datas}>
          <CampoDeData nome="De" valor={consulta.inicio} aoMudar={(inicio) => aoMudar({ ...consulta, inicio, pagina: 1 }, 'trocar')} />
          <CampoDeData nome="Até" valor={consulta.fim} aoMudar={(ate) => aoMudar({ ...consulta, fim: ate, pagina: 1 }, 'trocar')} />
        </div>
        <p className={ui.mini} role="note" aria-label="Como o período é lido">{dicaDoPeriodo(consulta, periodo)}</p>
      </details>
    </form>
  );
}

// ---------- as pílulas dos filtros ativos ----------

interface PropsDasPilulas {
  consulta: Consulta;
  periodo: Periodo | null;
  rotuloDoPerfil(id: string): string;
  aoMudar: Ir;
  aoLimpar(): void;
  // a pílula e o Limpar somem com o clique: quem chama leva o foco a um lugar que fica
  aoSair?(): void;
}

export function Pilulas({ consulta, periodo, rotuloDoPerfil, aoMudar, aoLimpar, aoSair }: PropsDasPilulas) {
  const ativos = filtrosAtivos(consulta, periodo, rotuloDoPerfil);
  if (!ativos.length) return null;
  const sair = () => { aoSair?.(); };
  return (
    <div className={estilos.ativos} role="group" aria-label="Filtros ativos">
      <span className={estilos.filtrando} aria-hidden="true">Filtrando:</span>
      {ativos.map((ativo) => (
        <button key={ativo.chave} type="button" className={estilos.tirar} aria-label={`Tirar o filtro ${ativo.texto}`} onClick={() => { sair(); aoMudar(ativo.sem, 'empilhar'); }}>
          {ativo.texto}<span aria-hidden="true">✕</span>
        </button>
      ))}
      <button type="button" className={`${ui.botao} ${ui.fantasma} ${ui.pequeno}`} onClick={() => { sair(); aoLimpar(); }}>Limpar filtros</button>
    </div>
  );
}
