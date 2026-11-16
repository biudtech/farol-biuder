// Mantém os mesmos testes e limites; a máquina pode reduzir o paralelismo.
import path from 'node:path';
import { assertExternalNodeRuntime } from '../lib/node-runtime.js';
import { spawnSync } from 'node:child_process';
import { testConcurrency, semAsVariaveis } from '../lib/env.js';
import { escolheuArquivo, padroesDeDescoberta } from './descoberta-de-testes.js';

assertExternalNodeRuntime();
const concorrencia = Number(testConcurrency() || 4);
if (!Number.isInteger(concorrencia) || concorrencia < 1 || concorrencia > 4) {
  throw new Error('FAROL_TEST_CONCORRENCIA deve ser um inteiro entre 1 e 4');
}

// Uma chamada explícita da suíte não herda o contexto de um teste hospedeiro.
// O próprio Node define o contexto correto para os arquivos que vai executar.
const env = semAsVariaveis(['NODE_TEST_CONTEXT']);
const raiz = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
// Sem arquivo escolhido, a descoberta é a do motor: a árvore inteira menos o front
// (tools/descoberta-de-testes.js).
const alvos = escolheuArquivo(args) ? [] : padroesDeDescoberta(raiz);
const resultado = spawnSync(process.execPath, [
  '--test', `--test-concurrency=${concorrencia}`, '--test-timeout=120000',
  ...args, ...alvos,
], { cwd: raiz, stdio: 'inherit', env });
if (resultado.error) console.error(resultado.error.message);
if (resultado.signal) console.error(`A suíte terminou pelo sinal ${resultado.signal}`);
process.exitCode = resultado.status ?? 1;
