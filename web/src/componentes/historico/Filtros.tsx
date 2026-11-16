'use client';

// A busca e os filtros do Histórico. Quem filtra é o motor: aqui só se escolhe. A busca espera
// um instante depois da última tecla antes de ir ao endereço (e dali ao motor); Enter manda na
// hora. Os filtros mandam ao trocar.
import { useEffect, useId, useState } from 'react';
import { TETO_DA_BUSCA, temFiltro, type Consulta } from '@/historico/consulta';
import { FILTROS_DE_DESFECHO } from '@/historico/rotulos';
import comuns from '../radar/Radar.module.css';
import estilos from './Historico.module.css';

// quanto a busca espera depois da última tecla
export const ESPERA_DA_BUSCA_MS = 300;

interface Props {
  consulta: Consulta;
  // os repositórios de todo o histórico, como o motor os listou
  repos: readonly string[];
  aoBuscar(q: string): void;
  aoFiltrar(filtro: { veredito?: string; repo?: string }): void;
  aoLimpar(): void;
}

export function Filtros({ consulta, repos, aoBuscar, aoFiltrar, aoLimpar }: Props) {
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
  const idDoDesfecho = useId();
  const idDoRepo = useId();
  const desfechoConhecido = consulta.veredito === '' || FILTROS_DE_DESFECHO.some(([valor]) => valor === consulta.veredito);
  const repoNaLista = consulta.repo === '' || repos.some((repo) => repo.toLowerCase() === consulta.repo.toLowerCase());
  const repoEscolhido = repos.find((repo) => repo.toLowerCase() === consulta.repo.toLowerCase()) ?? consulta.repo;

  return (
    <form
      className={estilos.filtros}
      role="search"
      aria-label="Busca e filtros do histórico"
      onSubmit={(evento) => {
        evento.preventDefault();
        if (texto === consulta.q) return;
        setMandado(texto);
        aoBuscar(texto);
      }}
    >
      <div className={estilos.campo}>
        <label className={comuns.rotulo} htmlFor={idDaBusca}>Buscar</label>
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
        <p id={idDaDica} className={comuns.meta}>Repositório, número, título, autor do PR ou card. Todos os termos têm de aparecer.</p>
      </div>

      <div className={estilos.campo}>
        <label className={comuns.rotulo} htmlFor={idDoDesfecho}>O que foi publicado</label>
        <select id={idDoDesfecho} className={comuns.entrada} value={consulta.veredito} onChange={(evento) => aoFiltrar({ veredito: evento.target.value })}>
          <option value="">Todos</option>
          {FILTROS_DE_DESFECHO.map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
          {desfechoConhecido ? null : <option value={consulta.veredito}>{consulta.veredito} (valor do endereço)</option>}
        </select>
      </div>

      <div className={estilos.campo}>
        <label className={comuns.rotulo} htmlFor={idDoRepo}>Repositório</label>
        <select id={idDoRepo} className={comuns.entrada} value={repoEscolhido} onChange={(evento) => aoFiltrar({ repo: evento.target.value })}>
          <option value="">Todos</option>
          {repos.map((repo) => <option key={repo} value={repo}>{repo}</option>)}
          {repoNaLista ? null : <option value={consulta.repo}>{consulta.repo}</option>}
        </select>
      </div>

      {temFiltro(consulta) ? (
        <button
          type="button"
          className={comuns.botao}
          onClick={() => {
            setTexto('');
            setMandado(null);
            aoLimpar();
          }}
        >
          Limpar busca e filtros
        </button>
      ) : null}
    </form>
  );
}
