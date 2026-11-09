import assert from 'node:assert/strict';
import { test } from 'node:test';

import { costliestFromFiles, report, withoutTicks } from './audit.mjs';

test('no total of its own (health.mjs gives it); spend by agent costliest first, the three costliest tasks, runs on no task and lingering runs', () => {
  const lines = report({
    agentsThis: { groups: [{ key: 'flow tick', totals: { runs: 3, unpriced: 3, input_tokens: 2000 } }, { key: 'flow child', totals: { runs: 1, unpriced: 1, input_tokens: 8000 } }] },
    agentsBefore: { groups: [{ key: 'flow child', totals: { runs: 2, unpriced: 2, input_tokens: 4000 } }] },
    tasksThis: { groups: [1, 2, 3, 4].map((n) => { return { key: `task_${n}`, totals: { runs: 1, unpriced: 1, input_tokens: n } }; }) },
    titles: { task_4: { title: 'Four', url: 'https://f/4' } },
    unlinkedThis: { totals: { runs: 1, unpriced: 1, input_tokens: 5 } },
    unlinkedBefore: { totals: { runs: 0, unpriced: 0 } },
    lingering: [{ agent: 'flow child', url: 'https://s/1' }],
  });
  assert.equal(lines[0], 'Spend, agent flow child: 1 run · 8,000 input (2 runs · 4,000 input the week before)');
  assert.equal(lines[1], 'Spend, agent flow tick: 3 runs · 2,000 input (no group the week before)');
  assert.deepEqual(lines.slice(2, 5).map((l) => { return l.split(':')[0] + l.slice(l.lastIndexOf(':')); }), [
    'Costliest task this week: 1 run · 4 input',
    'Costliest task this week: 1 run · 3 input',
    'Costliest task this week: 1 run · 2 input',
  ]);
  assert.ok(lines[2].includes('[Four](https://f/4)'));
  assert.match(lines[5], /^Runs that reached no task: 1 run · 5 input/);
  assert.equal(lines[6], 'Runs still open after every task they worked on closed: flow child https://s/1');
});


test('a task\'s spend leaves the tick out, since the tick takes every task it delegates, and ranks by every token, cache included', () => {
  const lines = report({
    agentsThis: { groups: [] },
    agentsBefore: { groups: [] },
    tasksThis: { groups: [
      { key: 'task_a', totals: { runs: 2, unpriced: 2, input_tokens: 100, cache_read_tokens: 1300 } },
      { key: 'task_b', totals: { runs: 2, unpriced: 2, input_tokens: 500 } },
      { key: 'task_t', totals: { runs: 1, unpriced: 1, input_tokens: 50 } },
    ] },
    ticksThis: { groups: [
      { key: 'task_a', totals: { runs: 1, unpriced: 1, input_tokens: 50, cache_read_tokens: 400 } },
      { key: 'task_b', totals: { runs: 1, unpriced: 1, input_tokens: 50 } },
      { key: 'task_t', totals: { runs: 1, unpriced: 1, input_tokens: 50 } },
    ] },
    titles: {},
    unlinkedThis: { totals: { runs: 0, unpriced: 0 } },
    unlinkedBefore: { totals: { runs: 0, unpriced: 0 } },
    lingering: [],
  });
  const costliest = lines.filter((l) => { return l.startsWith('Costliest'); });
  assert.equal(costliest.length, 2);
  assert.ok(costliest[0].includes('task_a') && costliest[0].endsWith('1 run · 50 input, 900 cache reads'));
  assert.ok(costliest[1].includes('task_b') && costliest[1].endsWith('1 run · 450 input'));
});

test('withoutTicks keeps a counter the tick did not report', () => {
  const { groups } = withoutTicks({
    tasks: { groups: [{ key: 'task_a', totals: { runs: 2, unpriced: 1, input_tokens: 100 } }] },
    ticks: { groups: [{ key: 'task_a', totals: { runs: 1, unpriced: 1 } }] },
  });
  assert.deepEqual(groups, [{ key: 'task_a', totals: { runs: 1, unpriced: 0, input_tokens: 100 } }]);
});

test('without the key, the same lines come from two saved answers', () => {
  const lines = costliestFromFiles({
    all: { groups: [{ key: 'task_a', totals: { runs: 2, unpriced: 2, input_tokens: 130 } }] },
    ticks: { groups: [{ key: 'task_a', totals: { runs: 1, unpriced: 1, input_tokens: 40 } }] },
  });
  assert.deepEqual(lines, ['Costliest task this week: [task_a](https://flow.ttoss.dev/app/tasks/task_a): 1 run · 90 input']);
});
