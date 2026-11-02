import assert from 'node:assert/strict';
import { test } from 'node:test';

import { report } from './audit.mjs';

test('spend by agent costliest first, the three costliest tasks, runs on no task and lingering runs', () => {
  const lines = report({
    thisWeek: { totals: { runs: 4, unpriced: 0, cost_usd: 10 } },
    weekBefore: { totals: { runs: 2, unpriced: 0, cost_usd: 4 } },
    agentsThis: { groups: [{ key: 'flow tick', totals: { runs: 3, unpriced: 0, cost_usd: 2 } }, { key: 'flow child', totals: { runs: 1, unpriced: 0, cost_usd: 8 } }] },
    agentsBefore: { groups: [{ key: 'flow child', totals: { runs: 2, unpriced: 0, cost_usd: 4 } }] },
    tasksThis: { groups: [1, 2, 3, 4].map((n) => { return { key: `task_${n}`, totals: { runs: 1, unpriced: 0, cost_usd: n } }; }) },
    titles: { task_4: { title: 'Four', url: 'https://f/4' } },
    unlinkedThis: { totals: { runs: 1, unpriced: 1, input_tokens: 5 } },
    unlinkedBefore: { totals: { runs: 0, unpriced: 0 } },
    lingering: [{ agent: 'flow child', url: 'https://s/1' }],
  });
  assert.equal(lines[0], 'Spend, every run: 4 runs · $10.00 (2 runs · $4.00 the week before)');
  assert.equal(lines[1], 'Spend, agent flow child: 1 run · $8.00 (2 runs · $4.00 the week before)');
  assert.match(lines[2], /^Spend, agent flow tick: 3 runs · \$2\.00 \(no group the week before\)/);
  assert.deepEqual(lines.slice(3, 6).map((l) => { return l.split(':')[0] + l.slice(l.lastIndexOf(':')); }), [
    'Costliest task this week: 1 run · $4.00',
    'Costliest task this week: 1 run · $3.00',
    'Costliest task this week: 1 run · $2.00',
  ]);
  assert.ok(lines[3].includes('[Four](https://f/4)'));
  assert.match(lines[6], /^Runs that reached no task: 1 run · 5 input/);
  assert.equal(lines[7], 'Runs still open after every task they worked on closed: flow child https://s/1');
});
