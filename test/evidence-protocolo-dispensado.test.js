// O protocolo da revisão pode declarar o `pr-reviewer` como dispensado, desde que diga por quê
// (workspace-template/prompts/pr-review-auto.md). Sem o motivo, é lacuna de aprovação.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { approvalGaps } = await import('../lib/technical-review/evidence.js');

test('evidence: protocolo dispensado COM motivo não é lacuna; sem motivo é', () => {
  const lacuna = 'protocolo de revisão não comprovado';
  const com = approvalGaps({ analysisStatus: 'complete', protocolo: { prReviewer: 'dispensado', motivo: 'diff só de configuração' } });
  assert.ok(!com.includes(lacuna));
  const sem = approvalGaps({ analysisStatus: 'complete', protocolo: { prReviewer: 'dispensado', motivo: '  ' } });
  assert.ok(sem.includes(lacuna));
});
