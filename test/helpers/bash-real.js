import { execFileSync } from 'node:child_process';

let bashDoTeste = null;
try {
  execFileSync('bash', ['--version'], { stdio: 'ignore', timeout: 5000 });
  bashDoTeste = 'bash';
} catch { /* ausência do shell é reportada como teste não executado */ }
export { bashDoTeste };
