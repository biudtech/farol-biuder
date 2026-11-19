// O plano de cada perfil do Claude, como o Consumo o mostra: o que o snapshot já traz sobre
// perfis (`config.claudeProfiles` e `config.claudeProfileId`), o uso do plano lido pelo motor
// (`claudePerfis.uso`, usoParaTela em lib/engine/uso-do-plano.js), os problemas
// (`claudePerfis.problemas`) e as sessões em curso (`activeSessions[].perfilId`). Sem React. A
// tela não calcula limite: mostra a fração que o motor leu de cada janela.
import type { PerfisDoClaude } from '@/contratos/sistema';
import type { ConfigDoMotor } from '@/contratos/time';
import type { Tom } from '@/componentes/ui';
import { fracao } from './formato';

export interface JanelaNaTela {
  nome: string;
  texto: string;
  fracao: number;
}

export interface PerfilNoPlano {
  id: string;
  nome: string;
  selo: { texto: string; tom: Tom };
  janelas: JanelaNaTela[];
  aviso?: string;
}

const PORCENTO = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

export function perfisDoPlano(config: ConfigDoMotor | undefined, perfis: PerfisDoClaude | undefined, emUso: readonly string[]): PerfilNoPlano[] {
  const uso = perfis?.uso ?? {};
  const lista = config?.claudeProfiles ?? Object.keys(uso).map((id) => ({ id, label: undefined, kind: undefined }));
  return lista.map((perfil) => {
    const problema = perfis?.problemas.find((p) => p.profileId === perfil.id);
    // sem problema, sem sessão e sem ser o padrão: o motor não diz o papel do perfil, e o selo
    // não deduz um
    let selo: PerfilNoPlano['selo'] = { texto: 'Sem uso agora', tom: 'neutro' };
    if (problema) selo = { texto: `Com problema: ${problema.code}`, tom: 'ruim' };
    else if (emUso.includes(perfil.id)) selo = { texto: 'Em uso agora', tom: 'marca' };
    else if (config?.claudeProfileId === perfil.id) selo = { texto: 'Perfil padrão', tom: 'ok' };

    const lido = Object.hasOwn(uso, perfil.id) ? uso[perfil.id] : undefined;
    const janelas: JanelaNaTela[] = lido?.lido && lido.ok !== false
      ? lido.janelas.map((j) => {
        const nome = j.nome ?? 'Janela';
        if (j.usado === undefined || !Number.isFinite(j.usado) || j.usado < 0) return { nome, texto: 'sem dado', fracao: 0 };
        const texto = `${PORCENTO.format(j.usado * 100)}% usado${j.resetTexto ? `, volta ${j.resetTexto}` : ''}`;
        return { nome, texto, fracao: fracao(j.usado, 1) };
      })
      : [];

    let aviso: string | undefined;
    if (perfil.kind === 'apikey' && !janelas.length) aviso = 'Perfil de chave de API: não tem janela de plano.';
    else if (lido?.lido && lido.ok === false) aviso = `O motor não conseguiu ler o uso do plano${lido.erro ? `: ${lido.erro}` : ''}.`;
    else if (!lido?.lido) aviso = 'O motor ainda não leu o uso do plano deste perfil.';
    else if (lido.desatualizado) aviso = 'Leitura desatualizada: o motor não conseguiu reler o uso agora.';

    return { id: perfil.id, nome: perfil.label || perfil.id, selo, janelas, ...(aviso ? { aviso } : {}) };
  });
}
