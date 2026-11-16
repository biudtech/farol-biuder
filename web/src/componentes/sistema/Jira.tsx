'use client';

// A seção Jira: os sites que o motor tem, se a credencial de cada um está presente (só a
// presença: e-mail e token do Atlassian nunca saem do motor) e o teste de conexão. Só leitura:
// esta tela não edita site nem credencial. O porquê está em "Lacunas do contrato", no README:
// o endereço do site é para onde o motor manda a credencial guardada, e POST /api/settings
// aceita trocar o endereço sem pedir a credencial de novo.
import { useId } from 'react';
import { lerTesteDoJira, type SiteDoJira, type TesteDoJira } from '@/contratos/sistema';
import type { Cliente } from '@/transporte/cliente';
import comuns from '../radar/Radar.module.css';
import { Par } from './Formulario';
import { useChamada } from './useChamada';
import estilos from './Sistema.module.css';

export const ROTA_DO_TESTE_DO_JIRA = '/api/jira/test';

function textoDaCredencial(tem: boolean | undefined): string {
  if (tem === true) return 'Presente. Se ela vale, quem diz é o teste abaixo.';
  return tem === false ? 'Ausente: o motor não lê card deste site.' : 'O motor não informou.';
}

function ResultadoDoTeste({ teste }: { teste: TesteDoJira }) {
  if (teste.ok) return <p className={comuns.nota}>A conexão funciona{teste.quem ? `: a credencial guardada no motor representa ${teste.quem}` : ', e o Jira não disse de quem é a credencial'}.</p>;
  return <p className={comuns.erroDoCampo}>Erro: o teste falhou{teste.motivo ? `: ${teste.motivo}` : ''}{teste.code ? ` (${teste.code})` : ''}.</p>;
}

function Site({ site, cliente }: { site: SiteDoJira; cliente: Pick<Cliente, 'post'> }) {
  const teste = useChamada<TesteDoJira>();
  const nome = site.label || site.id;
  return (
    <li className={estilos.item}>
      <h3 className={estilos.tituloDoItem}>{nome}</h3>
      <dl className={estilos.campos}>
        <Par nome="Endereço">{site.baseUrl ?? 'O motor não informou.'}</Par>
        <Par nome="Organizações do GitHub">{site.owners.length ? site.owners.join(', ') : 'Nenhuma: o site não é usado em PR nenhum.'}</Par>
        <Par nome="Projetos aceitos">{site.projectKeys.length ? site.projectKeys.join(', ') : 'Qualquer chave de card.'}</Par>
        <Par nome="Credencial">{textoDaCredencial(site.hasCredential)}</Par>
      </dl>
      <div className={comuns.botoes}>
        <button
          type="button"
          className={comuns.botao}
          disabled={teste.carregando}
          aria-label={teste.carregando ? `Testando a conexão com ${nome}` : `Testar a conexão com ${nome}`}
          onClick={() => { void teste.chamar((sinal) => cliente.post(ROTA_DO_TESTE_DO_JIRA, { siteId: site.id }, lerTesteDoJira, { sinal })); }}
        >
          {teste.carregando ? 'Testando…' : 'Testar a conexão'}
        </button>
      </div>
      <div role="status" aria-live="polite" aria-label={`Resultado do teste de ${nome}`}>
        {teste.carregando ? <p className={comuns.meta}>O motor está falando com o Jira.</p> : null}
        {!teste.carregando && teste.erro ? <p className={comuns.erroDoCampo}>Erro: {teste.erro}</p> : null}
        {!teste.carregando && !teste.erro && teste.dados ? <ResultadoDoTeste teste={teste.dados} /> : null}
      </div>
    </li>
  );
}

interface Props {
  cliente: Pick<Cliente, 'post'>;
  // `undefined`: o motor não mandou a lista
  sites: readonly SiteDoJira[] | undefined;
}

export function Jira({ cliente, sites }: Props) {
  const idDoTitulo = useId();
  return (
    <section id="jira" className={estilos.secao} aria-labelledby={idDoTitulo}>
      <h2 id={idDoTitulo} className={estilos.tituloDaSecao}>Jira</h2>
      <p className={comuns.meta}>
        O motor lê o card do PR no site do Jira ligado à organização do GitHub dona do PR. Testar a conexão faz o motor perguntar ao Jira de quem é a credencial guardada: prova o endereço e a credencial sem depender de card, não grava nada, e a credencial não vem para esta tela.
      </p>
      <p className={comuns.meta}>
        Esta seção é só leitura: site e credencial não mudam por aqui. A credencial do Jira nunca passa pela tela, e o endereço do site é para onde o motor a envia.
      </p>
      {!sites ? <p className={`${comuns.nota} ${comuns.bloqueio}`}>Atenção: o motor não mandou a lista de sites do Jira a esta tela.</p> : null}
      {sites && !sites.length ? (
        <p className={comuns.vazio}>O motor não tem site do Jira: o recurso está desligado, e a revisão segue sem ler card.</p>
      ) : null}
      {sites?.length ? (
        <ul className={estilos.itens} aria-label="Sites do Jira">
          {sites.map((site) => <Site key={site.id} site={site} cliente={cliente} />)}
        </ul>
      ) : null}
    </section>
  );
}
