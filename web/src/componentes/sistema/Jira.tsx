'use client';

// O assunto Jira: os sites que o motor tem, cada um com o endereço, as organizações do GitHub, os
// projetos aceitos, os últimos cards lidos (das decisões resolvidas do snapshot,
// src/sistema/jira.ts), se a credencial está presente (só a presença: e-mail e token nunca saem
// do motor), o Testar a conexão e o Trocar credencial (CredencialDoJira.tsx). O site em si
// (endereço, organizações, projetos) não muda por aqui: o endereço é para onde o motor manda a
// credencial guardada, e POST /api/settings aceita trocá-lo sem pedir a credencial de novo
// (lacuna no README).
import { Botao, Chip, ui } from '@/componentes/ui';
import { lerTesteDoJira, type SiteDoJira, type TesteDoJira } from '@/contratos/sistema';
import { dataHora } from '@/radar/formato';
import { ultimosCardsLidos } from '@/sistema/jira';
import type { Cliente } from '@/transporte/cliente';
import { CredencialDoJira } from './CredencialDoJira';
import { Par } from './Formulario';
import { useChamada } from './useChamada';
import estilos from './Sistema.module.css';

export const ROTA_DO_TESTE_DO_JIRA = '/api/jira/test';

function textoDaCredencial(tem: boolean | undefined): string {
  if (tem === true) return 'Presente. Se ela vale, quem diz é o teste abaixo.';
  return tem === false ? 'Ausente: o motor não lê card deste site.' : 'O motor não informou.';
}

function ResultadoDoTeste({ teste }: { teste: TesteDoJira }) {
  if (teste.ok) return <p className={ui.mini}>A conexão funciona{teste.quem ? `: a credencial guardada no motor representa ${teste.quem}` : ', e o Jira não disse de quem é a credencial'}.</p>;
  return <p className={ui.erro}>Erro: o teste falhou{teste.motivo ? `: ${teste.motivo}` : ''}{teste.code ? ` (${teste.code})` : ''}.</p>;
}

function Etiquetas({ itens, vazio }: { itens: readonly string[]; vazio: string }) {
  if (!itens.length) return <>{vazio}</>;
  return (
    <span className={estilos.etiquetas}>
      {itens.map((item) => <span key={item} className={estilos.etiqueta}>{item}</span>)}
    </span>
  );
}

interface PropsDoSite {
  site: SiteDoJira;
  cliente: Pick<Cliente, 'post'>;
  resolvidas: readonly unknown[] | undefined;
  impedimento: string | null;
}

function Site({ site, cliente, resolvidas, impedimento }: PropsDoSite) {
  const teste = useChamada<TesteDoJira>();
  const nome = site.label || site.id;
  const cards = ultimosCardsLidos(resolvidas, site);
  return (
    <li className={estilos.item}>
      <h3 className={estilos.tituloDoItem}>
        <span>{nome}</span>
        <span className={ui.empurra}>
          {site.hasCredential === true ? <Chip pequeno tom="ok">Com credencial</Chip> : site.hasCredential === false ? <Chip pequeno tom="aviso">Sem credencial</Chip> : <Chip pequeno>Sem dado</Chip>}
        </span>
      </h3>
      <dl className={estilos.pares}>
        <Par nome="Endereço">{site.baseUrl ?? 'O motor não informou.'}</Par>
        <Par nome="Organizações do GitHub"><Etiquetas itens={site.owners} vazio="Nenhuma: o site não é usado em PR nenhum." /></Par>
        <Par nome="Projetos aceitos"><Etiquetas itens={site.projectKeys} vazio="Qualquer chave de card." /></Par>
        <Par nome="Últimos cards lidos">
          {cards.length
            ? cards.map((c) => (c.em ? `${c.card} (${dataHora(c.em) || 'sem data'})` : c.card)).join(', ')
            : 'Nenhum entre as revisões recentes.'}
        </Par>
        <Par nome="Credencial">{textoDaCredencial(site.hasCredential)}</Par>
      </dl>
      <div className={ui.fila}>
        <Botao
          pequeno
          ocupado={teste.carregando ? 'Testando…' : false}
          aria-label={teste.carregando ? `Testando a conexão com ${nome}` : `Testar a conexão com ${nome}`}
          onClick={() => { void teste.chamar((sinal) => cliente.post(ROTA_DO_TESTE_DO_JIRA, { siteId: site.id }, lerTesteDoJira, { sinal })); }}
        >
          Testar a conexão
        </Botao>
      </div>
      <div role="status" aria-live="polite" aria-label={`Resultado do teste de ${nome}`}>
        {teste.carregando ? <p className={ui.mini}>O motor está falando com o Jira.</p> : null}
        {!teste.carregando && teste.erro ? <p className={ui.erro}>Erro: {teste.erro}</p> : null}
        {!teste.carregando && !teste.erro && teste.dados ? <ResultadoDoTeste teste={teste.dados} /> : null}
      </div>
      <CredencialDoJira cliente={cliente} siteId={site.id} nome={nome} impedimento={impedimento} />
    </li>
  );
}

interface Props {
  cliente: Pick<Cliente, 'post'>;
  // `undefined`: o motor não mandou a lista
  sites: readonly SiteDoJira[] | undefined;
  // as decisões resolvidas do snapshot, de onde saem os últimos cards lidos
  resolvidas: readonly unknown[] | undefined;
  impedimento: string | null;
}

export function Jira({ cliente, sites, resolvidas, impedimento }: Props) {
  return (
    <>
      <p className={ui.mini}>
        O site do Jira de um PR é o ligado à organização do GitHub dona dele. Testar a conexão faz o motor perguntar ao Jira de quem é a credencial guardada, sem gravar nada. Os últimos cards lidos saem das revisões recentes.
      </p>
      {!sites ? <p className={ui.nota}>Atenção: o motor não mandou a lista de sites do Jira a esta tela.</p> : null}
      {sites && !sites.length ? (
        <p className={ui.vazio}>O motor não tem site do Jira: o recurso está desligado, e a revisão segue sem ler card. Site novo entra pela API do motor ou pelo arquivo de configuração.</p>
      ) : null}
      {sites?.length ? (
        <ul className={estilos.itens} aria-label="Sites do Jira">
          {sites.map((site) => <Site key={site.id} site={site} cliente={cliente} resolvidas={resolvidas} impedimento={impedimento} />)}
        </ul>
      ) : null}
      <p className={ui.mini}>O endereço, as organizações e os projetos de um site não mudam por aqui: o endereço é para onde o motor manda a credencial, e trocá-lo sem pedir a credencial de novo não é seguro.</p>
    </>
  );
}
