import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyProcesses, cpuTime, posixProcesses } from '../lib/review-source/processos.js';

test('árvore de processos separa Farol e CLIs, ignora PID reciclado e não traz comandos', () => {
  const rows = [{ pid: 1, parent: 0, born: 10, rss: 100, cpuMs: 2 }, { pid: 2, parent: 1, born: 20, rss: 200, cpuMs: 3 },
    { pid: 3, parent: 2, born: 30, rss: 300, cpuMs: 4 }, { pid: 4, parent: 1, born: 40, rss: 400, cpuMs: 5 }, { pid: 9, parent: 0, born: 50, rss: 500, cpuMs: 6 }];
  const groups = classifyProcesses(rows, 1, [{ id: 'a', pid: 2, startedAt: 20 }, { id: 'bad', pid: 9, startedAt: 50 }]);
  assert.deepEqual(groups.farol.map(r => r.pid), [1, 4]); assert.deepEqual(groups.clis.map(r => r.pid), [2, 3]); assert.deepEqual(groups.missing, ['bad']);
  assert.equal(classifyProcesses(rows, 1, [{ id: 'recycled', pid: 2, startedAt: 10000 }]).clis.length, 0);
  assert.equal(cpuTime('1-02:03:04'), ((26 * 3600) + 184) * 1000);
  assert.equal(posixProcesses('1 0 100 00:01:00 Fri Oct 23 12:00:00 2026')[0].rss, 102400);
});
