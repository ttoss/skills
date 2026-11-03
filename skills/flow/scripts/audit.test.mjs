import assert from 'node:assert/strict';
import { test } from 'node:test';

import { answers, answersLine, report } from './audit.mjs';

test('no total of its own (health.mjs gives it); spend by agent costliest first, the three costliest tasks, runs on no task and lingering runs', () => {
  const lines = report({
    agentsThis: { groups: [{ key: 'flow tick', totals: { runs: 3, unpriced: 0, cost_usd: 2 } }, { key: 'flow child', totals: { runs: 1, unpriced: 0, cost_usd: 8 } }] },
    agentsBefore: { groups: [{ key: 'flow child', totals: { runs: 2, unpriced: 0, cost_usd: 4 } }] },
    tasksThis: { groups: [1, 2, 3, 4].map((n) => { return { key: `task_${n}`, totals: { runs: 1, unpriced: 0, cost_usd: n } }; }) },
    titles: { task_4: { title: 'Four', url: 'https://f/4' } },
    unlinkedThis: { totals: { runs: 1, unpriced: 1, input_tokens: 5 } },
    unlinkedBefore: { totals: { runs: 0, unpriced: 0 } },
    lingering: [{ agent: 'flow child', url: 'https://s/1' }],
  });
  assert.equal(lines[0], 'Spend, agent flow child: 1 run · $8.00 (2 runs · $4.00 the week before)');
  assert.match(lines[1], /^Spend, agent flow tick: 3 runs · \$2\.00 \(no group the week before\)/);
  assert.deepEqual(lines.slice(2, 5).map((l) => { return l.split(':')[0] + l.slice(l.lastIndexOf(':')); }), [
    'Costliest task this week: 1 run · $4.00',
    'Costliest task this week: 1 run · $3.00',
    'Costliest task this week: 1 run · $2.00',
  ]);
  assert.ok(lines[2].includes('[Four](https://f/4)'));
  assert.match(lines[5], /^Runs that reached no task: 1 run · 5 input/);
  assert.equal(lines[6], 'Runs still open after every task they worked on closed: flow child https://s/1');
});

test('answers: closed decisions of the last four weeks with their outcome, newest first, dated by the closing change', () => {
  const now = '2026-11-03T12:00:00Z';
  const decision = (id, closedAt, over = {}) => { return {
    id, url: `https://f/${id}`, title: id, status: 'completed', outcome: `answer ${id}`, updated_at: '2026-11-03T00:00:00Z',
    changes: [{ at: '2026-10-01T00:00:00Z', status: { from: null, to: 'waiting' } }, { at: closedAt, status: { from: 'waiting', to: 'completed' } }],
    ...over,
  }; };
  const list = answers({ now, decisions: [
    decision('task_old', '2026-09-01T00:00:00Z'),
    decision('task_a', '2026-10-20T00:00:00Z'),
    decision('task_b', '2026-11-01T00:00:00Z'),
    decision('task_c', '2026-10-30T00:00:00Z', { outcome: undefined, changes: [] }),
  ] });
  assert.deepEqual(list.map((a) => { return [a.id, a.at, a.outcome]; }), [
    ['task_c', '2026-11-03T00:00:00Z', null],
    ['task_b', '2026-11-01T00:00:00Z', 'answer task_b'],
    ['task_a', '2026-10-20T00:00:00Z', 'answer task_a'],
  ]);
  assert.equal(answersLine({ answers: list, now }), 'Decisions a person answered: 2 this week (0 the week before), 3 over the last 4 weeks');
});
