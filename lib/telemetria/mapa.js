// De registro (o objeto que o JSON guardava) para linha de tabela e de volta, sem perder nada.
//
// Cada campo conhecido tem coluna, e a coluna só recebe o valor do tipo esperado: texto bem formado
// (sem surrogate solto, que o SQLite trocaria por U+FFFD), número finito, ou objeto (guardado em
// JSON). Qualquer outra coisa (o nulo, o tipo trocado) e todo campo desconhecido vão para `extra`,
// em JSON, que guarda o valor como o arquivo guardava. Coluna nula quer dizer "procure em extra";
// campo `undefined` some, como o JSON.stringify fazia. A volta põe os campos na ordem da lista e
// depois os de `extra`, na ordem em que entraram.
import { parseJson, safeStringify } from '../io.js';

function objeto(v) { return !!v && typeof v === 'object'; }

function cabeNaColuna(tipo, v) {
  if (tipo === 'texto') return typeof v === 'string' && v.isWellFormed();
  if (tipo === 'numero') return typeof v === 'number' && Number.isFinite(v);
  return objeto(v);
}

// Devolve { colunas: { coluna: valor | null }, extra: texto JSON | null }.
function paraLinha(campos, registro) {
  const colunas = {};
  const conhecidos = new Set();
  for (const [campo, coluna, tipo] of campos) {
    conhecidos.add(campo);
    const v = registro[campo];
    if (!cabeNaColuna(tipo, v)) { colunas[coluna] = null; continue; }
    colunas[coluna] = tipo === 'json' ? safeStringify(v) : v;
  }
  const resto = {};
  let algum = false;
  for (const [campo, v] of Object.entries(registro)) {
    if (v === undefined) continue;
    if (conhecidos.has(campo) && colunas[colunaDe(campos, campo)] !== null) continue;
    resto[campo] = v;
    algum = true;
  }
  return { colunas, extra: algum ? safeStringify(resto) : null };
}

function colunaDe(campos, campo) { return campos.find((c) => c[0] === campo)[1]; }

function deLinha(campos, linha) {
  const extra = linha.extra ? parseJson(linha.extra, {}) : {};
  const registro = {};
  for (const [campo, coluna, tipo] of campos) {
    const v = linha[coluna];
    if (v !== null && v !== undefined) registro[campo] = tipo === 'json' ? parseJson(v, null) : v;
    else if (Object.hasOwn(extra, campo)) registro[campo] = extra[campo];
  }
  for (const [campo, v] of Object.entries(extra)) { if (!Object.hasOwn(registro, campo)) registro[campo] = v; }
  return registro;
}

// "INSERT INTO t (a, b) VALUES (:a, :b)" montado só com os nomes de coluna desta pasta, nunca
// com dado: os valores vão sempre por parâmetro.
function sqlDeInsercao(tabela, campos, outras = []) {
  const nomes = [...campos.map((c) => c[1]), ...outras, 'extra'];
  return `INSERT INTO ${tabela} (${nomes.join(', ')}) VALUES (${nomes.map((n) => `:${n}`).join(', ')})`;
}

export { paraLinha, deLinha, sqlDeInsercao };
