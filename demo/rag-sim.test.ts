import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RagPipeline, detectInjection, redactPII, groundedness } from './rag-sim.ts';
import { SUGGESTIONS } from './rag-corpus.ts';

for (const lang of ['en', 'pt'] as const) {
  const [expense, revenue, month, salary, injection] = SUGGESTIONS[lang];

  test(`[${lang}] retrieval finds the right chunk`, () => {
    const p = new RagPipeline(lang);
    assert.equal(p.run(expense, 'employee', false).hits[0].chunk.id, 'te1');
    assert.equal(p.run(month, 'employee', false).hits[0].chunk.id, 'q33');
    assert.ok(['q31', 'q32'].includes(p.run(revenue, 'employee', false).hits[0].chunk.id));
  });

  test(`[${lang}] ACL: payroll is never a candidate for an employee`, () => {
    const p = new RagPipeline(lang);
    const r = p.run(salary, 'employee', false);
    assert.ok(r.notFound);
    assert.ok(r.hits.every((h) => h.chunk.doc !== 'pay'));
  });

  test(`[${lang}] HR gets the answer, with CPFs redacted and never present in the HTML`, () => {
    const p = new RagPipeline(lang);
    const r = p.run(salary, 'hr', false);
    assert.equal(r.decision, 'redacted');
    assert.ok(!r.answer!.html.includes('123.456.789-09'));
  });

  test(`[${lang}] prompt injection is blocked before retrieval`, () => {
    const p = new RagPipeline(lang);
    const r = p.run(injection, 'hr', false);
    assert.equal(r.blocked, 'injection');
    assert.equal(r.hits.length, 0);
  });

  test(`[${lang}] a changed number is caught by the grounding check`, () => {
    const p = new RagPipeline(lang);
    assert.equal(p.run(expense, 'employee', true).decision, 'flagged');
  });

  test(`[${lang}] the rate limit kicks in after the bucket empties`, () => {
    const p = new RagPipeline(lang);
    const decisions = Array.from({ length: 8 }, (_, i) => p.run(`${expense} ${i}`, 'employee', false).decision);
    assert.equal(decisions.filter((d) => d === 'throttled').length, 2);
  });
}

test('corporate addresses are allowlisted, personal ones are redacted', () => {
  assert.equal(redactPII('write to security@orbe.example').found.length, 0);
  assert.deepEqual(redactPII('juliana.prado@mail.example, (11) 98765-4321').found.map((f) => f.kind), ['EMAIL', 'PHONE']);
});

test('benign questions are not flagged as injection', () => {
  assert.equal(detectInjection('How do I ignore spam emails?'), null);
  assert.equal(detectInjection('Quais são as instruções para reembolso?'), null);
});

test('grounding rejects a sentence whose number is not in the sources', () => {
  const [g] = groundedness(['Reports are due within 45 days.'], ['Reports are due within 30 days.']);
  assert.equal(g.supported, false);
  assert.deepEqual(g.badNums, ['45']);
});
