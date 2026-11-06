import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { items, load, resolve } from './params.mjs';

const FILE = `# Flow

- **Flow project id**: \`proj_1m5wbbbf1x\`.
- **Standing-decision task id**: \`task_8gzt6adhhp\`.
- **Repos**: \`acme/api\`, \`acme/web\`.
- **Runtime**: \`ops/runtime.md\` (children,
  run records, max runs 3, models by exact id).
- **Merge rule**: \`docs/merge.md\`, one automatic round for FINDINGS.
- **Routines**: the Tick hourly; the Chase on weekdays; the Audit on Fridays.
`;

test('items: one per top-level item, continuation lines joined', () => {
  const got = items(FILE);
  assert.equal(got['Flow project id'], '`proj_1m5wbbbf1x`.');
  assert.equal(got.Runtime, '`ops/runtime.md` (children, run records, max runs 3, models by exact id).');
});

test('each value from its own item, else the prose that states it, else the default, and says which', () => {
  const r = resolve({ file: 'f', main: items(FILE), runtime: { 'Stale after': '6 hours.' } });
  assert.deepEqual([r.projectId, r.standingDecision, r.repos], ['proj_1m5wbbbf1x', 'task_8gzt6adhhp', ['acme/api', 'acme/web']]);
  assert.deepEqual(r.params, { maxRuns: 3, staleAfterHours: 6, autoRounds: 1, reviewByAgent: false, reviewRequired: null, reviewGraceMinutes: 30, agentsMayIntegrate: true, focus: null, releaseQueue: null });
  assert.equal(r.sources.maxRuns, 'Runtime: "max runs N"');
  assert.equal(r.sources.staleAfterHours, 'Runtime file: Stale after');
  assert.equal(r.sources.reviewByAgent, 'default');
  const own = resolve({ file: 'f', main: { ...items(FILE), 'Max runs': '4', 'Review child': 'yes', 'Agents integrate': 'no', 'Stale after': '90 minutes' } });
  assert.deepEqual([own.params.maxRuns, own.params.reviewByAgent, own.params.agentsMayIntegrate, own.params.staleAfterHours], [4, true, false, 1.5]);
  const wip = resolve({ file: 'f', main: {}, runtime: { 'Release queue': '6 changes.' } });
  assert.deepEqual([wip.params.releaseQueue, wip.sources.releaseQueue], [6, 'Runtime file: Release queue']);
  const legacy = resolve({ file: 'f', main: { 'Review queue': '10.' }, runtime: {} });
  assert.deepEqual([legacy.params.releaseQueue, legacy.sources.releaseQueue], [10, 'Review queue']);
});

test('load: the file by precedence, a section of AGENTS.md, and a refusal naming what is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'params-'));
  writeFileSync(join(root, 'AGENTS.md'), `# Repo\n\n## Flow parameters\n\n${FILE.split('\n').slice(2).join('\n')}\n## Other\n- **Max runs**: 9\n`);
  assert.equal(load(root).file, 'AGENTS.md § Flow parameters');
  assert.equal(load(root).params.maxRuns, 3);
  mkdirSync(join(root, '.claude'));
  writeFileSync(join(root, '.claude/flow.md'), '# Flow\n\n- **Flow project id**: `proj_1m5wbbbf1x`.\n');
  assert.throws(() => { return load(root); }, /names no standing-decision task id/);
  assert.throws(() => { return load(mkdtempSync(join(tmpdir(), 'none-'))); }, /no parameters/);
});

test('Review fails closed: none is no review, a reviewer named is one, unstated is null; a review child implies one', () => {
  const review = (main) => { return resolve({ file: 'f', main }).params.reviewRequired; };
  assert.equal(review({ Review: 'none.' }), false);
  assert.equal(review({ Review: '`none`: the gates are the checks.' }), false);
  assert.equal(review({ Review: 'an agent reviewer, asked by CI (`docs/agents/review.md`).' }), true);
  assert.equal(review({}), null);
  assert.equal(review({ 'Review child': 'yes' }), true);
  const r = resolve({ file: 'f', main: { 'Review grace': '10 minutes', Reviewer: '`acme-reviewer[bot]`, `ana`' } });
  assert.deepEqual([r.params.reviewGraceMinutes, r.reviewers], [10, ['acme-reviewer[bot]', 'ana']]);
});
