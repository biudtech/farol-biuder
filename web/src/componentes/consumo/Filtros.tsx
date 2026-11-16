'use client';

// O período e os filtros do Consumo. Quem recorta é o motor: aqui só se escolhe. As opções de
// tipo, modelo e repositório são as que o motor listou; valor do endereço que não está nelas
// continua escolhido, dizendo de onde veio. A busca espera um instante depois da última tecla.
import { useEffect, useId, useState } from 'react';
import type { OpcoesDeFiltro } from '@/contratos/consumo';
import {
  ANO_MINIMO, PERIODOS, TETO_DA_BUSCA, comPeriodo, dataAceita, dicaDoPeriodo, periodoPronto, temFiltro, temPeriodo, type Consulta,
} from '@/consumo/consulta';
import { rotuloDoModelo, rotuloDoTipo } from '@/consumo/formato';
import comuns from '../radar/Radar.module.css';
import estilos from './Consumo.module.css';

// quanto a busca espera depois da última tecla
export const ESPERA_DA_BUSCA_MS = 300;

interface Props {
  consulta: Consulta;
  opcoes: OpcoesDeFiltro;
  // o período do relatório na tela, quando há um
  periodo: { start: string; end: string } | null;
  // o último dia do relatório mais recente; sem ele os períodos prontos esperam
  fim: string | null;
  aoBuscar(q: string): void;
  aoMudar(consulta: Consulta, modo: 'empilhar' | 'trocar'): void;
  aoLimpar(): void;
}

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
    <div className={estilos.campo}>
      <label className={comuns.rotulo} htmlFor={id}>{nome}</label>
      <select id={id} className={comuns.entrada} value={valor} aria-describedby={dica ? idDaDica : undefined} onChange={(evento) => aoEscolher(evento.target.value)}>
        <option value="">Todos</option>
        {opcoes.map((opcao) => <option key={opcao} value={opcao}>{rotulo(opcao)}</option>)}
        {naLista ? null : <option value={valor}>{valor} (valor do endereço)</option>}
      </select>
      {dica ? <p id={idDaDica} className={comuns.meta}>{dica}</p> : null}
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
    <div className={estilos.campo}>
      <label className={comuns.rotulo} htmlFor={id}>{nome}</label>
      <input
        id={id}
        className={comuns.entrada}
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
      {invalida ? <p id={idDoErro} className={comuns.erroDoCampo} role="alert">Data inválida: use um dia de {ANO_MINIMO} em diante. Nada foi pedido ao motor.</p> : null}
    </div>
  );
}

export function Filtros({ consulta, opcoes, periodo, fim, aoBuscar, aoMudar, aoLimpar }: Props) {
  const [texto, setTexto] = useState(consulta.q);
  // O `q` do endereço que este campo já refletiu, e o que ele mandou e ainda não viu voltar.
  // Quando o endereço muda por fora (voltar do navegador, Limpar), o campo acompanha; quando
  // muda porque o campo mandou, o que a pessoa digitou depois disso não é desfeito.
  const [visto, setVisto] = useState(consulta.q);
  const [mandado, setMandado] = useState<string | null>(null);
  if (consulta.q !== visto) {
    setVisto(consulta.q);
    if (consulta.q === mandado) setMandado(null);
    else setTexto(consulta.q);
  }

  useEffect(() => {
    if (texto === consulta.q) return undefined;
    const relogio = setTimeout(() => {
      setMandado(texto);
      aoBuscar(texto);
    }, ESPERA_DA_BUSCA_MS);
    return () => clearTimeout(relogio);
  }, [texto, consulta.q, aoBuscar]);

  const idDaBusca = useId();
  const idDaDica = useId();
  const pronto = periodo ? periodoPronto(consulta, periodo) : null;

  return (
    <form
      className={estilos.filtros}
      role="search"
      aria-label="Período e filtros do consumo"
      onSubmit={(evento) => {
        evento.preventDefault();
        if (texto === consulta.q) return;
        setMandado(texto);
        aoBuscar(texto);
      }}
    >
      <fieldset className={estilos.periodo}>
        <legend className={comuns.rotulo}>Período</legend>
        <div className={comuns.botoes}>
          {PERIODOS.map((dias) => (
            <button
              key={dias}
              type="button"
              className={comuns.botao}
              aria-pressed={pronto === dias}
              disabled={fim === null}
              onClick={() => { if (fim !== null) aoMudar(comPeriodo(consulta, fim, dias), 'empilhar'); }}
            >
              {dias} dias
            </button>
          ))}
        </div>
        <div className={estilos.datas}>
          <CampoDeData nome="De" valor={consulta.inicio} aoMudar={(inicio) => aoMudar({ ...consulta, inicio, pagina: 1 }, 'trocar')} />
          <CampoDeData nome="Até" valor={consulta.fim} aoMudar={(ate) => aoMudar({ ...consulta, fim: ate, pagina: 1 }, 'trocar')} />
        </div>
        <p className={comuns.meta} role="note" aria-label="Como o período é lido">{dicaDoPeriodo(consulta, periodo)}</p>
        <p className={comuns.meta}>Os períodos prontos gravam as duas datas e terminam no último dia do relatório na tela. Limpar volta ao hoje do motor.</p>
      </fieldset>

      <div className={estilos.seletores}>
        <Seletor nome="Tipo" valor={consulta.tipo} opcoes={opcoes.kind} rotulo={rotuloDoTipo} aoEscolher={(tipo) => aoMudar({ ...consulta, tipo, pagina: 1 }, 'empilhar')} />
        <Seletor
          nome="Modelo"
          valor={consulta.modelo}
          opcoes={opcoes.model}
          rotulo={rotuloDoModelo}
          dica="Recorta pelo modelo principal de cada execução. A tabela Por modelo ainda pode trazer outros, que são partes das mesmas execuções."
          aoEscolher={(modelo) => aoMudar({ ...consulta, modelo, pagina: 1 }, 'empilhar')}
        />
        <Seletor nome="Repositório" valor={consulta.repo} opcoes={opcoes.repo} rotulo={(repo) => repo} aoEscolher={(repo) => aoMudar({ ...consulta, repo, pagina: 1 }, 'empilhar')} />
        <div className={estilos.campo}>
          <label className={comuns.rotulo} htmlFor={idDaBusca}>Buscar no diário</label>
          <input
            id={idDaBusca}
            className={comuns.entrada}
            type="search"
            value={texto}
            maxLength={TETO_DA_BUSCA}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={idDaDica}
            onChange={(evento) => setTexto(evento.target.value)}
          />
          <p id={idDaDica} className={comuns.meta}>Parte da referência (dono/repo#n) ou do nome do modelo. A busca recorta só o diário; tipo, modelo e repositório recortam também as somas, o gráfico e as quebras.</p>
        </div>
      </div>

      {temFiltro(consulta) || temPeriodo(consulta) ? (
        <button
          type="button"
          className={comuns.botao}
          onClick={() => {
            setTexto('');
            setMandado(null);
            aoLimpar();
          }}
        >
          Limpar período e filtros
        </button>
      ) : null}
    </form>
  );
}
