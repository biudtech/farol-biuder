// Limites comuns ao leitor e à configuração de saída do Codex.
import { sourcePath, isSourceTemplate } from '../review-source/contract.js';
const SOURCE_PAGE_LINES = 60;
const SOURCE_PAGE_CHARS = 2048;
const SOURCE_OUTPUT_TOKENS = 32768;
const SOURCE_REPLY_BYTES = SOURCE_OUTPUT_TOKENS - SOURCE_PAGE_CHARS;
const SOURCE_RPC_ID_CHARS = 64;

function materialPath(value) {
  sourcePath(value, true);
  if (!isSourceTemplate(value)) sourcePath(value);
}

export { SOURCE_PAGE_LINES, SOURCE_PAGE_CHARS, SOURCE_OUTPUT_TOKENS, SOURCE_REPLY_BYTES, SOURCE_RPC_ID_CHARS, materialPath };
