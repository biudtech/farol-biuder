'use client';

// O período, os filtros e a busca do Consumo. Quem recorta é o motor: aqui só se escolhe. No
// desenho enxuto o topo tem só o seletor de período (7, 30 ou 90 dias, que terminam no hoje
// do motor); as datas De/Até, o tipo, o modelo e o repositório ficam atrás do botão Filtrar,
// e o que estiver escolhido aparece em chips, com Limpar filtros. A busca recorta só o
// diário e mora dentro da linha Execuções. As opções de tipo, modelo e repositório são as que
// o motor listou; valor do endereço que não está nelas continua escolhido, dizendo de onde
// veio. A busca espera um instante depois da última tecla.
import { useEffect, useId, useState } from 'react';
import type { OpcoesDeFiltro } from '@/contratos/consumo';
import {
  ANO_MINIMO, PERIODOS, TETO_DA_BUSCA, comPeriodo, dataAceita, dicaDoPeriodo, periodoPronto, temPeriodo, type Consulta,
} from '@/consumo/consulta';
import { diaPorExtenso, rotuloDoModelo, rotuloDoTipo } from '@/consumo/formato';
import { Chip, ui } from '../ui';
import estilos from './Consumo.module.css';

// quanto a busca espera depois da última tecla
export const ESPERA_DA_BUSCA_MS = 300;

type Ir = (consulta: Consulta, modo: 'empilhar' | 'trocar') => void;
type Periodo = { start: string; end: string };

// ---------- o seletor de período do topo ----------

const PERSONALIZADO = 'personalizado';

interface PropsDoSeletorDePeriodo {
  consulta: Consulta;
  periodo: Periodo | null;
  // o último dia do relatório mais recente; sem ele os períodos prontos esperam
  fim: string | null;
  aoMudar: Ir;
}

// Os períodos prontos gravam as duas datas e terminam no último dia do relatório na tela.
// Quando o endereço pede outro período, o seletor diz "Período personalizado".
export function SeletorDePeriodo({ consulta, periodo, fim, aoMudar }: PropsDoSeletorDePeriodo) {
  const id = useId();
  const pronto = periodo ? periodoPronto(consulta, periodo) : null;
  // antes da primeira resposta não se sabe qual é: o padrão do motor só aparece quando ele diz
  const valor = pronto === null ? (periodo ? PERSONALIZADO : '') : String(pronto);
  return (
    <>
      <label className={ui.soLeitor} htmlFor={id}>Período</label>
      <select
        id={id}
        className={`${ui.campo} ${estilos.periodo}`}
        value={valor}
        disabled={fim === null}
        onChange={(evento) => {
          const dias = Number(evento.target.value);
          if (fim !== null && PERIODOS.some((p) => p === dias)) aoMudar(comPeriodo(consulta, fim, dias), 'empilhar');
        }}
      >
        {valor === '' ? <option value="">Carregando o período…</option> : null}
        {PERIODOS.map((dias) => <option key={dias} value={String(dias)}>Últimos {dias} dias</option>)}
        {valor === PERSONALIZADO ? <option value={PERSONALIZADO} disabled>Período personalizado</option> : null}
      </select>
    </>
  );
}

// ---------- o painel do Filtrar ----------

interface PropsDoSeletor {
  nome: string;
  valor: string;
  opcoes: readonly string[];
  dica?: string;
  rotulo(valor: string): string;
  aoEscolher(valor: string): void;
}

function Seletor({ nome, valor, opcoes, dica, rotulo, aoEscolher }: PropsDoSeletor) {
  const id = useId();
  const idDaDica = useId();
  const naLista = valor === '' || opcoes.includes(valor);
  return (
    <div className={ui.rotulo}>
      <label htmlFor={id}>{nome}</label>
      <select id={id} className={ui.campo} value={valor} aria-describedby={dica ? idDaDica : undefined} onChange={(evento) => aoEscolher(evento.target.value)}>
        <option value="">Todos</option>
        {opcoes.map((opcao) => <option key={opcao} value={opcao}>{rotulo(opcao)}</option>)}
        {naLista ? null : <option value={valor}>{valor} (valor do endereço)</option>}
      </select>
      {dica ? <p id={idDaDica} className={ui.mini}>{dica}</p> : null}
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

// quantos filtros estão escolhidos: tipo, modelo, repositório, busca e o período fora dos prontos
function quantosAtivos(consulta: Consulta, periodo: Periodo | null): number {
  return filtrosAtivos(consulta, periodo).length;
}

interface PropsDoFiltrar {
  consulta: Consulta;
  opcoes: OpcoesDeFiltro;
  periodo: Periodo | null;
  aoMudar: Ir;
}

// O botão Filtrar e o painel que ele abre: o período personalizado e os três filtros que
// recortam o relatório inteiro.
export function Filtrar({ consulta, opcoes, periodo, aoMudar }: PropsDoFiltrar) {
  const n = quantosAtivos(consulta, periodo);
  return (
    <details className={ui.gaveta}>
      <summary className={`${ui.botao} ${estilos.botaoDeFiltrar}`}>
        Filtrar{n ? <span className={estilos.contagemDeFiltros}>({n})</span> : null}
      </summary>
      <form
        className={`${ui.painel} ${estilos.painelDeFiltros}`}
        role="search"
        aria-label="Período e filtros do consumo"
        onSubmit={(evento) => evento.preventDefault()}
      >
        <fieldset className={estilos.grupoDoPeriodo}>
          <legend className={`${ui.rotulo} ${estilos.legenda}`}>Período personalizado</legend>
          <div className={estilos.datas}>
            <CampoDeData nome="De" valor={consulta.inicio} aoMudar={(inicio) => aoMudar({ ...consulta, inicio, pagina: 1 }, 'trocar')} />
            <CampoDeData nome="Até" valor={consulta.fim} aoMudar={(ate) => aoMudar({ ...consulta, fim: ate, pagina: 1 }, 'trocar')} />
          </div>
          <p className={ui.mini} role="note" aria-label="Como o período é lido">{dicaDoPeriodo(consulta, periodo)}</p>
        </fieldset>
        <Seletor nome="Tipo" valor={consulta.tipo} opcoes={opcoes.kind} rotulo={rotuloDoTipo} aoEscolher={(tipo) => aoMudar({ ...consulta, tipo, pagina: 1 }, 'empilhar')} />
        <Seletor
          nome="Modelo"
          valor={consulta.modelo}
          opcoes={opcoes.model}
          rotulo={rotuloDoModelo}
          dica="Recorta pelo modelo principal de cada execução. A quebra Por modelo ainda pode trazer outros, que são partes das mesmas execuções."
          aoEscolher={(modelo) => aoMudar({ ...consulta, modelo, pagina: 1 }, 'empilhar')}
        />
        <Seletor nome="Repositório" valor={consulta.repo} opcoes={opcoes.repo} rotulo={(repo) => repo} aoEscolher={(repo) => aoMudar({ ...consulta, repo, pagina: 1 }, 'empilhar')} />
      </form>
    </details>
  );
}

// ---------- os chips dos filtros ativos ----------

interface Ativo {
  chave: string;
  texto: string;
  sem: Consulta;
}

// O que está escolhido, um por chip, com a consulta sem ele. O período só vira chip quando não
// é um dos prontos: esse já está escrito no seletor do topo.
export function filtrosAtivos(consulta: Consulta, periodo: Periodo | null): Ativo[] {
  const ativos: Ativo[] = [];
  const pronto = periodo ? periodoPronto(consulta, periodo) : null;
  if (temPeriodo(consulta) && pronto === null) {
    const de = consulta.inicio ? diaPorExtenso(consulta.inicio) : 'o começo padrão';
    const ate = consulta.fim ? diaPorExtenso(consulta.fim) : 'o hoje do motor';
    ativos.push({ chave: 'periodo', texto: `Período: de ${de} até ${ate}`, sem: { ...consulta, inicio: '', fim: '', pagina: 1 } });
  }
  if (consulta.tipo) ativos.push({ chave: 'tipo', texto: `Tipo: ${rotuloDoTipo(consulta.tipo)}`, sem: { ...consulta, tipo: '', pagina: 1 } });
  if (consulta.modelo) ativos.push({ chave: 'modelo', texto: `Modelo: ${rotuloDoModelo(consulta.modelo)}`, sem: { ...consulta, modelo: '', pagina: 1 } });
  if (consulta.repo) ativos.push({ chave: 'repo', texto: `Repositório: ${consulta.repo}`, sem: { ...consulta, repo: '', pagina: 1 } });
  if (consulta.q) ativos.push({ chave: 'q', texto: `Busca: ${consulta.q}`, sem: { ...consulta, q: '', pagina: 1 } });
  return ativos;
}

interface PropsDosAtivos {
  consulta: Consulta;
  periodo: Periodo | null;
  aoMudar: Ir;
  aoLimpar(): void;
}

export function FiltrosAtivos({ consulta, periodo, aoMudar, aoLimpar }: PropsDosAtivos) {
  const ativos = filtrosAtivos(consulta, periodo);
  if (!ativos.length) return null;
  return (
    <div className={estilos.ativos} role="group" aria-label="Filtros ativos">
      {ativos.map((ativo) => (
        <button key={ativo.chave} type="button" className={estilos.tirar} aria-label={`Tirar o filtro ${ativo.texto}`} onClick={() => aoMudar(ativo.sem, 'empilhar')}>
          <Chip tom="marca">{ativo.texto}<span aria-hidden="true">✕</span></Chip>
        </button>
      ))}
      <button type="button" className={`${ui.botao} ${ui.fantasma} ${ui.pequeno}`} onClick={aoLimpar}>Limpar filtros</button>
    </div>
  );
}

// ---------- a busca do diário ----------

interface PropsDaBusca {
  q: string;
  aoBuscar(q: string): void;
}

export function BuscaDoDiario({ q, aoBuscar }: PropsDaBusca) {
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
    <form
      className={estilos.busca}
      role="search"
      aria-label="Busca nas execuções"
      onSubmit={(evento) => {
        evento.preventDefault();
        if (texto === q) return;
        setMandado(texto);
        aoBuscar(texto);
      }}
    >
      <label className={ui.rotulo} htmlFor={id}>Buscar nas execuções</label>
      <input
        id={id}
        className={ui.campo}
        type="search"
        value={texto}
        maxLength={TETO_DA_BUSCA}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={idDaDica}
        onChange={(evento) => setTexto(evento.target.value)}
      />
      <p id={idDaDica} className={ui.mini}>Parte da referência (dono/repo#n) ou do nome do modelo. Recorta só esta lista; tipo, modelo e repositório (em Filtrar) recortam também o custo, o gráfico e as quebras.</p>
    </form>
  );
}
