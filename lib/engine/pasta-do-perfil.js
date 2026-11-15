// A pasta de configuração de um perfil de assinatura do Claude (15/11/2026).
//
// O motor roda num container, e nele só o HOME do Farol (`~/.farol`) é volume persistente:
// login gravado em qualquer outro lugar some no próximo deploy. Por isso a pasta do perfil
// mora SEMPRE dentro do HOME do Farol:
//   - sem pasta informada, é `~/.farol/claude/<id do perfil>` (uma por perfil);
//   - pasta informada só vale se for absoluta e ficar dentro do HOME do Farol.
// E nunca dentro do workspace, que é o cwd de toda sessão de IA.
//
// Perfil que não cumpre isso não resolve (`authFromProfile` devolve null) e aparece como
// perfil inválido na tela e no Diagnóstico, em vez de rodar com login que não persiste.
import fs from 'node:fs';
import path from 'node:path';
import { HOME, WORKSPACE, CLAUDE_PERFIS_DIR } from '../paths.js';

// O id de perfil que pode virar nome de pasta: sem separador, ponto nem espaço.
const ID_DE_PASTA = /^[A-Za-z0-9_-]{1,64}$/;

function dentroDe(raiz, alvo) {
  const r = path.resolve(raiz);
  return alvo !== r && alvo.startsWith(r + path.sep);
}

/** A pasta do perfil de assinatura, ou '' quando o perfil não tem pasta utilizável. PURA. */
function pastaDoPerfil(perfil) {
  if (!perfil || perfil.kind !== 'dir') return '';
  const informada = typeof perfil.dir === 'string' ? perfil.dir.trim() : '';
  if (!informada) return ID_DE_PASTA.test(String(perfil.id || '')) ? path.join(CLAUDE_PERFIS_DIR, perfil.id) : '';
  if (!path.isAbsolute(informada)) return '';
  const alvo = path.resolve(informada);
  return dentroDe(HOME, alvo) && !dentroDe(WORKSPACE, alvo) && alvo !== path.resolve(WORKSPACE) ? alvo : '';
}

// Cria a pasta do perfil (só o dono lê: ela guarda a credencial do login). Chamada pelo login
// pela tela, que é quem grava nela pela primeira vez.
function garantirPasta(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

// A pasta informada só vale pelo arquivo de configuração, nunca pela tela: o que chega por
// POST /api/settings perde o `dir` de todo perfil de assinatura. A tela manda a lista inteira,
// então o perfil que já existe mantém a pasta que tem na configuração (a do arquivo), e o novo
// nasce sem pasta, na do próprio perfil. Devolve um patch novo; não muta o que recebeu.
function semPastaDaTela(patch, config) {
  if (!patch || !Array.isArray(patch.claudeProfiles)) return patch;
  const atuais = Array.isArray(config && config.claudeProfiles) ? config.claudeProfiles : [];
  const pastaAtual = (id) => { const p = atuais.find((x) => x && x.kind === 'dir' && x.id === id); return (p && p.dir) || ''; };
  const claudeProfiles = patch.claudeProfiles.map((p) => (p && p.kind === 'dir' ? { ...p, dir: pastaAtual(String(p.id || '').trim()) } : p));
  return { ...patch, claudeProfiles };
}

export { pastaDoPerfil, garantirPasta, semPastaDaTela, ID_DE_PASTA };
