// Auditoria das dependências do front, com as de desenvolvimento: nada sobe com vulnerabilidade
// conhecida. A única saída é uma exceção em auditoria-excecoes.json, com motivo e prazo, para
// advisory sem versão corrigida que fica fora do build. Exceção vencida volta a reprovar, e
// advisory nova reprova sempre.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ID_DO_ADVISORY = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i;

// As advisories do relatório do `npm audit --json`, uma vez cada, com o pacote e a severidade.
export function advisoriesDoRelatorio(relatorio) {
  const vistas = new Map();
  for (const vulnerabilidade of Object.values(relatorio?.vulnerabilities ?? {})) {
    for (const via of vulnerabilidade?.via ?? []) {
      if (!via || typeof via !== 'object') continue;
      const id = String(via.url ?? '').match(ID_DO_ADVISORY)?.[0]?.toUpperCase();
      const chave = id ?? `${via.name}:${via.title}`;
      if (!vistas.has(chave)) vistas.set(chave, { id, pacote: via.name, severidade: via.severity, titulo: via.title });
    }
  }
  return [...vistas.values()];
}

// hoje no formato AAAA-MM-DD; a exceção vale até o fim do dia `ate`.
export function avaliar(relatorio, excecoes, hoje) {
  const vigentes = new Map();
  const vencidas = new Map();
  for (const e of excecoes) {
    const id = String(e.advisory ?? '').toUpperCase();
    if (!id || !e.motivo || !/^\d{4}-\d{2}-\d{2}$/.test(String(e.ate ?? ''))) continue;
    (e.ate >= hoje ? vigentes : vencidas).set(id, e);
  }
  const reprovadas = [];
  const toleradas = [];
  for (const a of advisoriesDoRelatorio(relatorio)) {
    if (a.id && vigentes.has(a.id)) toleradas.push({ ...a, ate: vigentes.get(a.id).ate });
    else reprovadas.push({ ...a, vencida: Boolean(a.id && vencidas.has(a.id)) });
  }
  const presentes = new Set(toleradas.map((a) => a.id));
  const semUso = [...vigentes.keys()].filter((id) => !presentes.has(id));
  return { ok: reprovadas.length === 0, reprovadas, toleradas, semUso };
}

function rodarAudit() {
  try {
    return execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 });
  } catch (erro) {
    // O npm audit sai com código 1 quando há vulnerabilidade; o relatório vem no stdout.
    if (erro.stdout) return String(erro.stdout);
    throw erro;
  }
}

function principal() {
  const relatorio = JSON.parse(rodarAudit());
  const excecoes = JSON.parse(readFileSync(new URL('./auditoria-excecoes.json', import.meta.url), 'utf8'));
  const hoje = new Date().toISOString().slice(0, 10);
  const r = avaliar(relatorio, excecoes, hoje);
  for (const a of r.toleradas) console.log(`tolerada até ${a.ate}: ${a.id} (${a.pacote}, ${a.severidade})`);
  for (const id of r.semUso) console.log(`exceção sem uso, pode sair de auditoria-excecoes.json: ${id}`);
  for (const a of r.reprovadas) {
    console.error(`${a.vencida ? 'exceção vencida' : 'vulnerabilidade'}: ${a.id ?? a.titulo} (${a.pacote}, ${a.severidade})`);
  }
  if (!r.ok) process.exit(1);
  console.log('auditoria: nenhuma vulnerabilidade fora das exceções vigentes');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) principal();
