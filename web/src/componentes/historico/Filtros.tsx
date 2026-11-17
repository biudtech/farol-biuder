'use client';

// A busca e os filtros do Histórico. Quem filtra é o motor: aqui só se escolhe. A busca fica
// sempre à vista e espera um instante depois da última tecla antes de ir ao endereço (e dali
// ao motor); Enter manda na hora. Os filtros (repositório, o que foi publicado e o período,
// que GET /api/decisions aceita) ficam atrás do botão Filtrar e mandam ao trocar; os que estão
// valendo aparecem embaixo como chips, cada um com o seu X.
import { useEffect, useId, useRef, useState } from 'react';
import { PERIODOS, TETO_DA_BUSCA, rotuloDoPeriodo, type Consulta } from '@/historico/consulta';
import { FILTROS_DE_DESFECHO } from '@/historico/rotulos';
import { Chip, ui } from '../ui';
import estilos from './Historico.module.css';

// quanto a busca espera depois da última tecla
export const ESPERA_DA_BUSCA_MS = 300;

interface Props {
  consulta: Consulta;
  // os repositórios de todo o histórico, como o motor os listou
  repos: readonly string[];
  aoBuscar(q: string): void;
  aoFiltrar(filtro: { veredito?: string; repo?: string; periodo?: string }): void;
}

function rotuloDoDesfecho(valor: string): string {
  return FILTROS_DE_DESFECHO.find(([v]) => v === valor)?.[1] ?? `${valor} (valor do endereço)`;
}

export function Filtros({ consulta, repos, aoBuscar, aoFiltrar }: Props) {
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
  // O X do chip e o Limpar filtros somem com o clique: o foco vai ao Filtrar, que fica.
  const filtrar = useRef<HTMLElement>(null);
  const tirar = (mudanca: Parameters<typeof aoFiltrar>[0]) => {
    filtrar.current?.focus();
    aoFiltrar(mudanca);
  };
  const idDaDica = useId();
  const idDoDesfecho = useId();
  const idDoRepo = useId();
  const idDoPeriodo = useId();
  const desfechoConhecido = consulta.veredito === '' || FILTROS_DE_DESFECHO.some(([valor]) => valor === consulta.veredito);
  const repoNaLista = consulta.repo === '' || repos.some((repo) => repo.toLowerCase() === consulta.repo.toLowerCase());
  const repoEscolhido = repos.find((repo) => repo.toLowerCase() === consulta.repo.toLowerCase()) ?? consulta.repo;
  const ativos = (consulta.repo ? 1 : 0) + (consulta.veredito ? 1 : 0) + (consulta.periodo ? 1 : 0);

  return (
    <div className={estilos.consulta}>
      <form
        className={estilos.busca}
        role="search"
        aria-label="Busca e filtros do histórico"
        onSubmit={(evento) => {
          evento.preventDefault();
          if (texto === consulta.q) return;
          setMandado(texto);
          aoBuscar(texto);
        }}
      >
        <label className={ui.soLeitor} htmlFor={idDaBusca}>Buscar</label>
        <input
          id={idDaBusca}
          className={`${ui.campo} ${estilos.campoDeBusca}`}
          type="search"
          value={texto}
          maxLength={TETO_DA_BUSCA}
          placeholder="Buscar por repositório, PR, título ou autor"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={idDaDica}
          onChange={(evento) => setTexto(evento.target.value)}
        />
        <p id={idDaDica} className={ui.soLeitor}>Repositório, número, título, autor do PR ou card. Todos os termos têm de aparecer.</p>

        <details className={ui.gaveta}>
          <summary ref={filtrar} className={ui.botao} aria-label={ativos ? `Filtrar, ${ativos} filtro(s) valendo` : 'Filtrar'}>
            Filtrar{ativos ? ` (${ativos})` : ''}
          </summary>
          <div className={ui.painel}>
            <div className={ui.rotulo}>
              <label htmlFor={idDoRepo}>Repositório</label>
              <select id={idDoRepo} className={ui.campo} value={repoEscolhido} onChange={(evento) => aoFiltrar({ repo: evento.target.value })}>
                <option value="">Todos</option>
                {repos.map((repo) => <option key={repo} value={repo}>{repo}</option>)}
                {repoNaLista ? null : <option value={consulta.repo}>{consulta.repo}</option>}
              </select>
            </div>
            <div className={ui.rotulo}>
              <label htmlFor={idDoDesfecho}>O que foi publicado</label>
              <select id={idDoDesfecho} className={ui.campo} value={consulta.veredito} onChange={(evento) => aoFiltrar({ veredito: evento.target.value })}>
                <option value="">Todos</option>
                {FILTROS_DE_DESFECHO.map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
                {desfechoConhecido ? null : <option value={consulta.veredito}>{consulta.veredito} (valor do endereço)</option>}
              </select>
            </div>
            <div className={ui.rotulo}>
              <label htmlFor={idDoPeriodo}>Período</label>
              <select id={idDoPeriodo} className={ui.campo} value={consulta.periodo} onChange={(evento) => aoFiltrar({ periodo: evento.target.value })}>
                <option value="">Todo o histórico</option>
                {PERIODOS.map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
              </select>
            </div>
            <p className={ui.mini}>O período conta a hora em que a revisão foi resolvida, com hoje incluído.</p>
          </div>
        </details>
      </form>

      {ativos ? (
        <div className={ui.fila} role="group" aria-label="Filtros valendo">
          {consulta.repo ? (
            <button type="button" className={estilos.chipQueSai} aria-label={`Tirar o filtro Repositório: ${repoEscolhido}`} onClick={() => tirar({ repo: '' })}>
              <Chip tom="marca">Repositório: {repoEscolhido} <span aria-hidden="true">✕</span></Chip>
            </button>
          ) : null}
          {consulta.veredito ? (
            <button
              type="button"
              className={estilos.chipQueSai}
              aria-label={`Tirar o filtro O que foi publicado: ${rotuloDoDesfecho(consulta.veredito)}`}
              onClick={() => tirar({ veredito: '' })}
            >
              <Chip tom="marca">Publicado: {rotuloDoDesfecho(consulta.veredito)} <span aria-hidden="true">✕</span></Chip>
            </button>
          ) : null}
          {consulta.periodo ? (
            <button type="button" className={estilos.chipQueSai} aria-label={`Tirar o filtro Período: ${rotuloDoPeriodo(consulta.periodo)}`} onClick={() => tirar({ periodo: '' })}>
              <Chip tom="marca">Período: {rotuloDoPeriodo(consulta.periodo)} <span aria-hidden="true">✕</span></Chip>
            </button>
          ) : null}
          <button type="button" className={`${ui.botao} ${ui.fantasma} ${ui.pequeno}`} onClick={() => tirar({ repo: '', veredito: '', periodo: '' })}>
            Limpar filtros
          </button>
        </div>
      ) : null}
    </div>
  );
}
