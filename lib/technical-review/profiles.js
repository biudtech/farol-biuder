// Cadastro privado por repositório, lido sem alterar o consumidor.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { HOME } from '../paths.js';
import io from '../io.js';

const PROFILE_FILE = path.join(HOME, 'technical-review', 'repositories.json');

function profileFor(repo, file = PROFILE_FILE) {
  const read = io.lerJsonTeimoso(file);
  if (!read.ok) return null;
  const profile = read.data?.repositories?.[repo];
  if (!profile || !profile.declaration) return null;
  return { ...profile, fingerprint: createHash('sha256').update(io.safeStringify(profile)).digest('hex') };
}

// O cadastro existe e não abre (17/10/2026): sem declaração vira ressalva, mas cadastro
// ilegível não pode virar "sem declaração", senão corromper o arquivo desligaria a avaliação
// de quem está declarado. Arquivo ausente é cadastro vazio, legível.
function cadastroIlegivel(file = PROFILE_FILE) {
  const read = io.lerJsonTeimoso(file);
  return !read.ok && read.motivo !== 'ausente';
}

// O cadastro como o diagnóstico o mostra: ausente (cadastro vazio, legível), ilegível, ou legível
// com a contagem dos repositórios que têm declaração, pelo mesmo critério do `profileFor`.
function resumoDoCadastro(file = PROFILE_FILE) {
  const read = io.lerJsonTeimoso(file);
  if (!read.ok) return { estado: read.motivo === 'ausente' ? 'ausente' : 'ilegivel', repositorios: 0 };
  const repositorios = read.data?.repositories;
  const declarados = repositorios && typeof repositorios === 'object' && !Array.isArray(repositorios)
    ? Object.values(repositorios).filter(profile => profile && profile.declaration).length : 0;
  return { estado: 'legivel', repositorios: declarados };
}

export { PROFILE_FILE, profileFor, cadastroIlegivel, resumoDoCadastro };
