/* Padrão de caminho no estilo do CODEOWNERS (gitignore), PURO.

   Sobrou só o casamento de padrão: o roteador de modelo (model-router.js) o usa para
   reconhecer caminho sensível. O resto do módulo (parse do arquivo, dono por caminho e
   autoridade) servia à co-assinatura, que saiu no corte da fase 1. */

// Padrão do CODEOWNERS (estilo gitignore) vira RegExp. Regras aplicadas:
//   `/x`    ancora na raiz            `x/`   tudo dentro do diretório
//   `*`     qualquer coisa menos `/`  `**`   qualquer coisa, inclusive `/`
//   sem barra nenhuma = casa o nome em QUALQUER nível (é o caso do `*`)
function patternToRegex(bruto) {
  let p = String(bruto || '').trim();
  if (!p) return null;
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.slice(0, -1);
  const anchored = p.startsWith('/');
  if (anchored) p = p.slice(1);
  // `**/x` tem que casar `x` na raiz também, então o prefixo é opcional
  let prefixo = '';
  if (p.startsWith('**/')) { prefixo = '(?:.*/)?'; p = p.slice(3); }
  else if (!anchored && !p.includes('/')) prefixo = '(?:.*/)?';
  let corpo = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') { corpo += '.*'; i++; }
    else if (c === '*') corpo += '[^/]*';
    else if (c === '?') corpo += '[^/]';
    else corpo += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${prefixo}${corpo}${dirOnly ? '/.*' : ''}$`);
}

const codeownersMod = { patternToRegex };
export default codeownersMod;
export { patternToRegex };
