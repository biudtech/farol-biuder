// Perfil de review por pessoa: o papel e a matriz por domínio. Extraído do ui/pure.js na Fase 1a
// da reorganização.
//
// Perfil de review por pessoa: molda o TOM e a POSTURA da revisão automática, nunca a
// decisão. As três tabelas (PAPEL_OPTS, DOMAIN_DEFS, DOMLEVEL_OPTS) DUPLICAM as chaves de
// lib/taxonomy.js, e a duplicação é estrutural: o servidor estático só serve UI_DIR, então
// o navegador não importa lib/. O que impede a duplicação de virar divergência é
// test/taxonomy-ui.test.js, que compara os CONJUNTOS DE CHAVES com o engine. Os rótulos
// ficam livres de propósito, mais curtos para caber no <select>.
import { esc } from './comum.js';

export const PAPEL_OPTS = [['', 'papel'], ['estagio', 'Estágio'], ['junior', 'Júnior'], ['pleno', 'Pleno'], ['senior', 'Sênior'], ['techlead', 'Tech Lead'], ['arquiteto', 'Arquiteto'], ['especialista', 'Especialista']];

export const DOMAIN_DEFS = [['backend', 'Backend'], ['frontend', 'Frontend'], ['dados', 'Dados'], ['infra', 'Infra']];

export const DOMLEVEL_OPTS = [['', 'sem info'], ['basico', 'Básico'], ['intermediario', 'Interm.'], ['avancado', 'Avançado'], ['autoridade', 'Autoridade']];

export function personOf(login, people) { return (people || {})[String(login || '').toLowerCase()] || {}; }

export function papelOf(login, people) { return personOf(login, people).papel || ''; }

export function domLevelOf(login, d, people) { return (personOf(login, people).dominios || {})[d] || ''; }

// papel (compacto): usado nos cards do PR e no cabeçalho do card do time
export function papelPicker(login, people) {
  return `<select class="papel-level" data-login="${esc(login)}" title="Papel de @${esc(login)}: molda o tom da revisão automática, nunca a decisão">
    ${PAPEL_OPTS.map(([v, t]) => `<option value="${v}"${papelOf(login, people) === v ? ' selected' : ''}>${t}</option>`).join('')}
  </select>`;
}

// matriz por domínio (só na aba Time): competência por área calibra a postura
export function domainMatrix(login, people) {
  return `<div class="dom-matrix">${DOMAIN_DEFS.map(([d, label]) => `
    <label class="dom-cell"><span class="dom-name">${label}</span>
      <select class="dom-level" data-login="${esc(login)}" data-domain="${d}" title="Competência de @${esc(login)} em ${label}">
        ${DOMLEVEL_OPTS.map(([v, t]) => `<option value="${v}"${domLevelOf(login, d, people) === v ? ' selected' : ''}>${t}</option>`).join('')}
      </select></label>`).join('')}</div>`;
}
