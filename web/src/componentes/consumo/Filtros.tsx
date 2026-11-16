'use client';

// O período e os filtros do Consumo. Quem recorta é o motor: aqui só se escolhe. As opções de
// tipo, modelo e repositório são as que o motor listou; valor do endereço que não está nelas
// continua escolhido, dizendo de onde veio. A busca espera um instante depois da última tecla.
import { useEffect, useId, useState } from 'react';
import type { OpcoesDeFiltro } from '@/contratos/consumo';
import { PERIODOS, TETO_DA_BUSCA, comPeriodo, periodoPronto, temFiltro, temPeriodo, type Consulta } from '@/consumo/consulta';
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
  rotulo(valor: string): string;
  aoEscolher(valor: string): void;
}

function Seletor({ nome, valor, opcoes, rotulo, aoEscolher }: PropsDoSeletor) {
  const id = useId();
  const naLista = valor === '' || opcoes.includes(valor);
  return (
    <div className={estilos.campo}>
      <label className={comuns.rotulo} htmlFor={id}>{nome}</label>
      <select id={id} className={comuns.entrada} value={valor} onChange={(evento) => aoEscolher(evento.target.value)}>
        <option value="">Todos</option>
        {opcoes.map((opcao) => <option key={opcao} value={opcao}>{rotulo(opcao)}</option>)}
        {naLista ? null : <option value={valor}>{valor} (valor do endereço)</option>}
      </select>
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

  const idDoInicio = useId();
  const idDoFim = useId();
  const idDaBusca = useId();
  const idDaDica = useId();
  const pronto = periodo ? periodoPronto(periodo) : null;

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
          <div className={estilos.campo}>
            <label className={comuns.rotulo} htmlFor={idDoInicio}>De</label>
            <input id={idDoInicio} className={comuns.entrada} type="date" value={consulta.inicio} onChange={(evento) => aoMudar({ ...consulta, inicio: evento.target.value, pagina: 1 }, 'trocar')} />
          </div>
          <div className={estilos.campo}>
            <label className={comuns.rotulo} htmlFor={idDoFim}>Até</label>
            <input id={idDoFim} className={comuns.entrada} type="date" value={consulta.fim} onChange={(evento) => aoMudar({ ...consulta, fim: evento.target.value, pagina: 1 }, 'trocar')} />
          </div>
        </div>
        <p className={comuns.meta}>Sem datas, o motor mostra os 30 dias que terminam hoje. Os períodos prontos terminam no último dia do relatório na tela.</p>
      </fieldset>

      <div className={estilos.seletores}>
        <Seletor nome="Tipo" valor={consulta.tipo} opcoes={opcoes.kind} rotulo={rotuloDoTipo} aoEscolher={(tipo) => aoMudar({ ...consulta, tipo, pagina: 1 }, 'empilhar')} />
        <Seletor nome="Modelo" valor={consulta.modelo} opcoes={opcoes.model} rotulo={rotuloDoModelo} aoEscolher={(modelo) => aoMudar({ ...consulta, modelo, pagina: 1 }, 'empilhar')} />
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
          <p id={idDaDica} className={comuns.meta}>Parte da referência (dono/repo#n) ou do nome do modelo. A busca recorta só o diário; tipo, modelo e repositório recortam o relatório inteiro.</p>
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
