import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { answers, answersLine, feeds, flowHealth, holderLines, integrations, leftLine, mismatches, nameOf, queues, readFlow, report, spend, spendOf, spendPair, windows } from './health.mjs';

// Shapes and edge cases taken from OneClick Ads' answers in November 2026.
const row = (status, state, on, open, entered, left, p90 = 1, p50 = 0) => {
  return { status, state, on, open, open_days: open ? { p50: 1, p90 } : null, entered, left, left_days: left ? { p50, p90: p50 } : null };
};
const move = (from, to, count) => {
  return { from, to, count };
};
const key = (status, state, on = false) => {
  return { status, state, on };
};

const before = {
  states: [
    row('active', 'ready', false, 59, 280, 281),
    row('waiting', 'blocked:external', true, 60, 117, 84, 19.1),
    row('waiting', 'blocked:external', false, 14, 60, 52),
    row('calendar', 'waiting:scheduled', false, 46, 146, 124),
    row('blocked', 'blocked:dependency', false, 4, 5, 4),
    row('active', 'waiting:scheduled', false, 0, 2, 2),
    row('incubated', 'ready', false, 166, 88, 50),
  ],
  moves: [
    move(key('calendar', 'ready'), key('active', 'ready'), 20),
    move(key('waiting', 'blocked:external'), key('active', 'ready'), 2),
    move(key('waiting', 'blocked:external', true), key('active', 'ready'), 13),
    move(key('incubated', 'ready'), key('active', 'ready'), 30),
    move(key('incubated', 'ready'), { status: 'discarded' }, 9),
  ],
  completed: { count: 189, days: { p50: 0.2, p90: 13.1 } },
};
const thisWeek = {
  states: [
    row('active', 'ready', false, 10, 270, 319, 19, 0),
    row('waiting', 'blocked:external', true, 143, 219, 136, 11, 0.8),
    row('waiting', 'blocked:external', false, 8, 210, 216),
    row('calendar', 'waiting:scheduled', false, 65, 78, 59, 10, 3),
    row('blocked', 'blocked:dependency', false, 9, 32, 27, 6, 1.2),
    row('blocked', 'blocked:external', true, 1, 1, 0, 1.8),
    row('incubated', 'ready', false, 149, 120, 137),
  ],
  moves: [
    move(key('calendar', 'ready'), key('active', 'ready'), 6),
    move(key('calendar', 'waiting:scheduled'), key('active', 'ready'), 1),
    move(key('waiting', 'blocked:external'), key('active', 'ready'), 21),
    move(key('waiting', 'blocked:external', true), key('active', 'ready'), 11),
    move(key('incubated', 'ready'), key('active', 'ready'), 59),
    move(key('incubated', 'ready'), key('waiting', 'blocked:external'), 4),
    move(key('incubated', 'ready'), key('waiting', 'blocked:external', true), 23),
    move(key('incubated', 'ready'), key('incubated', 'blocked:dependency'), 6),
    move(key('incubated', 'ready'), { status: 'discarded' }, 42),
  ],
  completed: { count: 228, days: { p50: 2.9, p90: 23 } },
};
const bugBefore = {
  states: [row('waiting', 'blocked:external', true, 8, 28, 21), row('active', 'blocked:external', true, 0, 1, 1)],
  moves: [],
  completed: { count: 20, days: { p50: 4.4, p90: 14 } },
};
const bugThis = {
  states: [row('waiting', 'blocked:external', true, 22, 41, 27, 6.7, 1)],
  moves: [],
  completed: { count: 38, days: { p50: 7.2, p90: 21.9 } },
};

const digest = flowHealth({ thisWeek, weekBefore: before, bugThisWeek: bugThis, bugWeekBefore: bugBefore });

test('windows are the 7 days ending now and the 7 before, adjacent', () => {
  assert.deepEqual(windows('2026-11-02T17:00:00Z'), {
    thisWeek: { since: '2026-10-26T17:00:00.000Z', until: '2026-11-02T17:00:00.000Z' },
    weekBefore: { since: '2026-10-19T17:00:00.000Z', until: '2026-10-26T17:00:00.000Z' },
  });
  assert.throws(() => { return windows('yesterday'); });
});

test('a row is named by its stage, then Flow’s own words, `on` included', () => {
  assert.equal(nameOf(key('waiting', 'blocked:external', true)), 'a person (waiting · blocked:external · on)');
  assert.equal(nameOf(key('waiting', 'blocked:external')), 'the gates (waiting · blocked:external)');
  assert.equal(nameOf(key('calendar', 'blocked:dependency', true)), 'a person (calendar · blocked:dependency · on)');
  assert.equal(nameOf(key('waiting', 'waiting:scheduled')), 'waiting · waiting:scheduled');
  assert.equal(nameOf({ status: 'discarded' }), 'discarded');
});

test('the person rows come first, most open first; other rows only when growing in both weeks; the rest counted', () => {
  assert.match(digest.lines[0], /^a person \(waiting · blocked:external · on\): 143 open · 219 in, 136 out \(117 in, 84 out the week before\) · growing · p90 11d · p50 left 0.8d$/);
  assert.match(digest.lines[1], /^a person \(blocked · blocked:external · on\): 1 open · 1 in, 0 out \(no row the week before\) · growing/);
  assert.match(digest.lines[2], /^the check \(calendar · waiting:scheduled\): 65 open/);
  assert.match(digest.lines[3], /^another task \(blocked · blocked:dependency\): 9 open/);
  // ready, the gates and active · waiting:scheduled (last week only) have no line; incubated is the Audit's.
  assert.equal(digest.lines[4], '3 other states have no line: none holds a person\'s answer or grew in both weeks');
});

test('a person row growing in both weeks raises the alert, which never calls it decisions', () => {
  assert.match(digest.alert, /^The person queue grew in both weeks: a person \(waiting · blocked:external · on\)\./);
  assert.match(digest.alert, /entered it more than it left/);
  assert.doesNotMatch(digest.alert, /decision|answered/);
});

test('no alert when no person row grew in both weeks', () => {
  const calm = flowHealth({ thisWeek: { ...thisWeek, states: thisWeek.states.filter((r) => { return !r.on; }) }, weekBefore: before, bugThisWeek: bugThis, bugWeekBefore: bugBefore });
  assert.equal(calm.alert, null);
});

test('back from the check counts every calendar row; back from a wait on nobody only `on` false', () => {
  assert.ok(digest.lines.includes('Delivery: 228 completed · p50 2.9d · p90 23d (189 completed · p50 0.2d · p90 13.1d the week before)'));
  assert.ok(digest.lines.includes('Back from the check, the check (calendar · ready) → ready: 6 (20 the week before)'));
  assert.ok(digest.lines.includes('Back from the check, the check (calendar · waiting:scheduled) → ready: 1 (0 the week before)'));
  const nobody = digest.lines.filter((l) => { return l.startsWith('Back from a wait on nobody'); });
  assert.deepEqual(nobody, ['Back from a wait on nobody (the gates in most projects, not counted as rework) → ready: 21 (2 the week before)']);
});

test('bugs: the person rows as queue lines, a row this week lacks says so, and completed against all', () => {
  assert.match(digest.lines.find((l) => { return l.startsWith('Bugs, a person (waiting'); }), /22 open · 41 in, 27 out \(28 in, 21 out the week before\) · growing/);
  assert.ok(digest.lines.includes('Bugs, a person (active · blocked:external · on): no row this week (1 in, 1 out the week before)'));
  assert.equal(digest.lines.at(-1), 'Bugs completed: 38 of 228 (20 of 189 the week before)');
});

test('adjacent windows copied verbatim leave no mismatch', () => {
  assert.deepEqual(digest.mismatches, []);
});

test('a window gap or a mistyped number shows as a mismatch', () => {
  const typo = { ...thisWeek, states: thisWeek.states.map((r) => { return r.on && r.status === 'waiting' ? { ...r, open: 144 } : r; }) };
  assert.deepEqual(mismatches({ now: typo, before }), ['a person (waiting · blocked:external · on)']);
});

test('spend: in tokens, a cost beside them only when every run carried one, and a missing group', () => {
  assert.equal(spendOf({ runs: 274, unpriced: 274, input_tokens: 4441646, output_tokens: 295500 }), '274 runs · 4,441,646 input, 295,500 output');
  assert.equal(spendOf({ runs: 3, unpriced: 0, cost_usd: 1.5, input_tokens: 10 }), '3 runs · 10 input · $1.50');
  assert.equal(spendOf({ runs: 12, unpriced: 10, cost_usd: 19.9987, input_tokens: 5 }), '12 runs · 5 input');
  assert.equal(spendOf({ runs: 2, unpriced: 2 }), '2 runs, no tokens reported');
  assert.equal(spendOf(undefined), 'no group');
});

test('spend: a week where no run carries a cost, by what became of the runs\' tasks in order, then every run, in tokens with no note', () => {
  const { lines } = spend({
    runsThisWeek: { totals: { runs: 783, unpriced: 783, input_tokens: 22112377, output_tokens: 1388000 }, groups: [{ key: 'dropped', totals: { runs: 2, unpriced: 2 } }, { key: null, totals: { runs: 232, unpriced: 232, input_tokens: 8490000, output_tokens: 550000 } }] },
    runsWeekBefore: { totals: { runs: 342, unpriced: 319, cost_usd: 159.869 }, groups: [{ key: 'dropped', totals: { runs: 12, unpriced: 10, cost_usd: 19.9987 } }] },
  });
  assert.equal(lines[0], 'Spend, dropped (tasks closed without completing): 2 runs, no tokens reported (12 runs, no tokens reported the week before)');
  assert.equal(lines[1], 'Spend, open (tasks still open): no group (no group the week before)');
  assert.match(lines[3], /^Spend, no task: 232 runs · 8,490,000 input, 550,000 output \(no group the week before\)/);
  assert.match(lines[4], /^Spend, every run: 783 runs · 22,112,377 input, 1,388,000 output \(342 runs · input not reported, output not reported the week before\)/);
  assert.equal(lines.length, 5);
  assert.doesNotMatch(lines.join('\n'), /\$|unpriced|at least|no cost/);
});

test('feeds: incubated rows and exits named with `on`, passes inside incubated left out, the inbox now only', () => {
  const { lines, mismatches: off } = feeds({
    thisWeek,
    weekBefore: before,
    inbox: { captures: [{ inbox_age_ms: 3947732332 }], total: 60 },
  });
  assert.ok(!lines.some((l) => { return l.startsWith('Spend'); }));
  assert.ok(lines.includes('Out of incubated (incubated · ready) → a person (waiting · blocked:external · on): 23 (0 the week before)'));
  assert.ok(lines.includes('Out of incubated (incubated · ready) → the gates (waiting · blocked:external): 4 (0 the week before)'));
  assert.ok(lines.includes('Out of incubated (incubated · ready) → discarded: 42 (9 the week before)'));
  assert.ok(!lines.some((l) => { return l.includes('→ incubated'); }));
  assert.equal(lines.at(-1), 'Untriaged inbox, now (the account\'s, across every project): 60 captures, the oldest 45.7d old');
  assert.deepEqual(off, []);
});

test('the command line reads one file per answer and writes JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'health-'));
  const file = (name, value) => {
    const path = join(dir, `${name}.json`);
    writeFileSync(path, JSON.stringify(value));
    return path;
  };
  const script = join(dirname(fileURLToPath(import.meta.url)), 'health.mjs');
  const out = JSON.parse(execFileSync('node', [script, 'flow', '--this', file('t', thisWeek), '--before', file('b', before), '--bug-this', file('bt', bugThis), '--bug-before', file('bb', bugBefore)], { encoding: 'utf8' }));
  assert.deepEqual(out, digest);
  assert.deepEqual(JSON.parse(execFileSync('node', [script, 'windows', '2026-11-02T17:00:00Z'], { encoding: 'utf8' })), windows('2026-11-02T17:00:00Z'));
  assert.throws(() => { return execFileSync('node', [script, 'flow', '--this', file('t2', thisWeek)], { stdio: 'pipe' }); });
});

test('spend: both weeks in tokens, a cost only beside a week every run carried it in, and a count a week did not report is said', () => {
  assert.equal(
    spendPair({ now: { runs: 3, unpriced: 1, cost_usd: 4, input_tokens: 7 }, before: { runs: 2, unpriced: 0, cost_usd: 1, input_tokens: 3 } }),
    '3 runs · 7 input (2 runs · 3 input · $1.00 the week before)',
  );
  assert.equal(
    spendPair({ now: { runs: 5, unpriced: 5, input_tokens: 90000 }, before: { runs: 4, unpriced: 2, cost_usd: 20, input_tokens: 10, cache_read_tokens: 99 } }),
    '5 runs · 90,000 input, cache reads not reported (4 runs · 10 input, 99 cache reads the week before)',
  );
});

const fakeFlow = (answers) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), auth: init.headers.authorization });
    const u = new URL(url);
    const body = answers(u);
    return body === 404
      ? { ok: false, status: 404, json: async () => { return {}; } }
      : { ok: true, status: 200, json: async () => { return body; } };
  };
  return { calls, fetchImpl };
};

test('with a key, the flow health reads the four windows itself, GET only, and gives the same lines as from files', async () => {
  const { calls, fetchImpl } = fakeFlow((u) => {
    const tag = u.searchParams.get('tag');
    const recent = u.searchParams.get('until') === '2026-11-02T17:00:00.000Z';
    return tag ? (recent ? bugThis : bugBefore) : recent ? thisWeek : before;
  });
  const answers = await readFlow({ routine: 'flow', project: 'proj_1m5wbbbf1x', now: '2026-11-02T17:00:00Z', key: 'flow_k', base: 'https://flow.example', fetchImpl });
  assert.deepEqual(flowHealth(answers), digest);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((c) => { return c.auth === 'Bearer flow_k' && c.url.startsWith('https://flow.example/api/v1/projects/proj_1m5wbbbf1x/metrics?since='); }));
});

test('spend reads the two weeks of runs by outcome, and nothing else', async () => {
  const runsAnswer = { totals: { runs: 1, unpriced: 1, input_tokens: 100 }, groups: [] };
  const { calls, fetchImpl } = fakeFlow((u) => {
    assert.equal(u.pathname, '/api/v1/agent-runs');
    assert.equal(u.searchParams.get('group_by'), 'outcome');
    assert.equal(u.searchParams.get('limit'), '0');
    return runsAnswer;
  });
  const got = await readFlow({ routine: 'spend', project: 'proj_1m5wbbbf1x', now: '2026-11-02T17:00:00Z', key: 'flow_k', fetchImpl });
  assert.equal(calls.length, 2);
  assert.equal(spend(got).lines.at(-1).split(';')[0], 'Spend, every run: 1 run · 100 input (1 run · 100 input the week before)');
});

test('with a key restricted to projects, the inbox answers 404 and the Health says so instead of failing', async () => {
  const { calls, fetchImpl } = fakeFlow((u) => {
    if (u.pathname === '/api/v1/captures') {
      return 404;
    }
    return u.searchParams.get('until') === '2026-11-02T17:00:00.000Z' ? thisWeek : before;
  });
  const answers = await readFlow({ routine: 'feeds', project: 'proj_1m5wbbbf1x', now: '2026-11-02T17:00:00Z', key: 'flow_k', fetchImpl });
  assert.equal(calls.length, 3);
  assert.equal(feeds(answers).lines.at(-1), 'Untriaged inbox: not readable with this credential (a key restricted to projects is not given the inbox; pass the session\'s list-captures answer as --inbox)');
});

test('the inbox the session read is the line, and the key is never asked for it', async () => {
  const { calls, fetchImpl } = fakeFlow((u) => {
    assert.notEqual(u.pathname, '/api/v1/captures');
    return u.searchParams.get('until') === '2026-11-02T17:00:00.000Z' ? thisWeek : before;
  });
  const inbox = { captures: [{ inbox_age_ms: 2 * 86_400_000 }], total: 3 };
  const answers = await readFlow({ routine: 'feeds', project: 'proj_1m5wbbbf1x', now: '2026-11-02T17:00:00Z', key: 'flow_k', fetchImpl, inbox });
  assert.equal(calls.length, 2);
  assert.equal(feeds(answers).lines.at(-1), 'Untriaged inbox, now (the account\'s, across every project): 3 captures, the oldest 2.0d old');
});

test('a project the key cannot reach fails loudly, never as empty lines', async () => {
  const { fetchImpl } = fakeFlow(() => { return 404; });
  await assert.rejects(readFlow({ routine: 'flow', project: 'proj_xxxxxxxxxx', now: '2026-11-02T17:00:00Z', key: 'k', fetchImpl }), /answered 404: the key cannot reach it/);
});

test('--project without a key refuses rather than reading nothing', () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), 'health.mjs');
  assert.throws(() => {
    return execFileSync('node', [script, 'flow', '--project', 'proj_1m5wbbbf1x'], { stdio: 'pipe', env: { ...process.env, FLOW_API_KEY: '' } });
  }, /needs FLOW_API_KEY/);
});

test('a line per holder and row, named, nobody last; a holder only the week before keeps its line', () => {
  const rowOn = (open, entered, left) => { return row('waiting', 'blocked:external', true, open, entered, left); };
  const lines = holderLines({
    thisWeek: { groups: [
      { key: 'user_b', states: [rowOn(2, 2, 0)] },
      { key: null, states: [row('waiting', 'blocked:external', false, 1, 1, 0)] },
    ] },
    weekBefore: { groups: [{ key: 'user_a', states: [rowOn(0, 0, 3)] }] },
    nameOfHolder: (key) => { return { user_a: 'ana@x', user_b: 'bruno@x' }[key]; },
  });
  assert.deepEqual(lines.map((l) => { return l.split(':')[0]; }), [
    'Waiting on ana@x, a person (waiting · blocked',
    'Waiting on bruno@x, a person (waiting · blocked',
    'Waiting on nobody, the gates (waiting · blocked',
  ]);
  assert.match(lines[1], /2 open · 2 in, 0 out \(no row the week before\)/);
  assert.match(lines[0], /no row this week \(0 in, 3 out the week before\)/);
  assert.deepEqual(holderLines({ thisWeek, weekBefore: before }), []);
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

test('report: the flow\'s lines, then what feeds and drains the graph, then the answers line, with the answers as data', async () => {
  const now = '2026-11-02T17:00:00Z';
  const decision = { id: 'task_d', url: 'https://f/task_d', title: 'd', status: 'completed', outcome: 'yes', updated_at: '2026-11-01T00:00:00Z', changes: [{ at: '2026-11-01T00:00:00Z', status: { from: 'waiting', to: 'completed' } }] };
  const get = async (path, query = {}) => {
    if (path === '/projects/proj_1m5wbbbf1x') {
      return { members: [], teams: [] };
    }
    if (path === '/projects/proj_1m5wbbbf1x/metrics') {
      const recent = query.until === windows(now).thisWeek.until;
      return query.tag ? (recent ? bugThis : bugBefore) : recent ? thisWeek : before;
    }
    if (path === '/tasks') {
      return { tasks: [{ id: 'task_d', updated_at: decision.updated_at }] };
    }
    if (path === '/tasks/task_d') {
      return { task: decision };
    }
    throw new Error(`unexpected read ${path}`);
  };
  const inbox = { captures: [], total: 0 };
  const out = await report({ client: { get }, project: 'proj_1m5wbbbf1x', now, inbox });
  const fed = feeds({ thisWeek, weekBefore: before, inbox });
  assert.equal(out.alert, digest.alert);
  assert.deepEqual(out.lines, [...digest.lines, ...fed.lines, 'Decisions a person answered: 1 this week (0 the week before), 1 over the last 4 weeks']);
  assert.deepEqual(out.answers.map((a) => { return [a.id, a.outcome]; }), [['task_d', 'yes']]);
  assert.ok(!out.lines.some((l) => { return l.startsWith('Spend'); }));
});

const queued = (id, over = {}) => {
  const { change: changeOver = {}, ...rest } = over;
  return {
    id,
    priority: null,
    tags: [],
    waitsOn: [],
    ...rest,
    change: { url: `https://github.com/o/r/pull/${id}`, title: `change ${id}`, draft: false, merged: false, closed: false, conflict: false, checks: 'green', verdict: null, createdAt: '2026-11-01T00:00:00Z', mergedAt: null, ...changeOver },
  };
};

test('queues: the oldest item in each queue a person drains, with its age, what is left and who acts', () => {
  const now = '2026-11-07T00:00:00Z';
  const out = queues({
    now,
    limit: 20,
    tasks: [
      queued('task_a'),
      queued('task_b', { waitsOn: ['user_ana'], change: { merged: true, createdAt: '2026-10-01T00:00:00Z', mergedAt: '2026-10-28T00:00:00Z' } }),
      queued('task_draft', { change: { draft: true, createdAt: '2026-09-01T00:00:00Z' } }),
    ],
    decisions: [
      { id: 'task_d1', url: 'https://f/task_d1', title: 'pick a provider', updated_at: '2026-10-17T00:00:00Z', readiness: { blocked_by: [{ via: 'wait', on: 'user_ana' }] } },
      { id: 'task_d2', url: 'https://f/task_d2', title: 'no holder', updated_at: '2026-09-01T00:00:00Z', readiness: { blocked_by: [{ via: 'wait', on: null }] } },
    ],
    who: (ids) => { return ids.map((id) => { return `${id}@x`; }).join(', '); },
  });
  assert.deepEqual(out.lines, [
    'Oldest in the release queue (2, limit 20): [change task_b](https://github.com/o/r/pull/task_b), 10.0d since integrated, integrated; waits to be seen in effect, user_ana@x',
    'Oldest in the decision queue (1): [pick a provider](https://f/task_d1), untouched 21.0d, user_ana@x',
  ]);
  assert.deepEqual(out.drain, []);
});

test('queues: at its limit, the bottom of the tick\'s order is proposed to drain, enough to bring it below the limit; age never ranks', () => {
  const now = '2026-11-07T00:00:00Z';
  const tasks = [
    queued('task_old', { change: { createdAt: '2026-08-01T00:00:00Z', conflict: true } }),
    queued('task_hi', { priority: 'high', change: { createdAt: '2026-11-06T00:00:00Z' } }),
    queued('task_vh', { priority: 'very_high', change: { createdAt: '2026-11-06T00:00:00Z' } }),
    queued('task_low', { priority: 'low', change: { checks: 'red' } }),
  ];
  const atLimit = queues({ now, limit: 4, tasks });
  assert.deepEqual(atLimit.drain.map((d) => { return [d.task, d.age, d.left]; }), [['task_old', '98.0d', 'a conflict to resolve']]);
  assert.equal(atLimit.lines.at(-1), "The release queue is at its limit: 1 change at the bottom of the tick's order proposed to drain");
  const over = queues({ now, limit: 3, tasks });
  assert.deepEqual(over.drain.map((d) => { return d.task; }), ['task_old', 'task_low']);
  assert.equal(queues({ now, limit: 5, tasks }).lines.length, 2);
});

test('report: with the tick\'s snapshot, the queue lines follow the flow\'s and the proposal is data', async () => {
  const now = '2026-11-02T17:00:00Z';
  const get = async (path) => {
    if (path === '/projects/proj_1m5wbbbf1x') {
      return { members: [{ user_id: 'user_ana', email: 'ana@x', role: 'admin' }], teams: [] };
    }
    if (path === '/projects/proj_1m5wbbbf1x/metrics') {
      return thisWeek;
    }
    if (path === '/tasks') {
      return { tasks: [] };
    }
    if (path === '/next') {
      return { tasks: [] };
    }
    throw new Error(`unexpected read ${path}`);
  };
  const snapshot = { params: { releaseQueue: 1 }, tasks: [queued('task_a', { change: { createdAt: '2026-11-01T17:00:00Z' } })], needs: { changes: [] } };
  const out = await report({ client: { get }, project: 'proj_1m5wbbbf1x', now, inbox: { captures: [], total: 0 }, snapshot });
  const at = out.lines.findIndex((l) => { return l.startsWith('Oldest in the release queue'); });
  assert.ok(at > 0);
  assert.equal(out.lines[at], 'Oldest in the release queue (1, limit 1): [change task_a](https://github.com/o/r/pull/task_a), 1.0d since opened, a review, the agents');
  assert.deepEqual(out.drain.map((d) => { return d.task; }), ['task_a']);
  assert.deepEqual(out.needs, { changes: [] });
});

const delivered = (id, over = {}) => {
  const { waits = [], ...task } = over;
  return { task: { id, url: `https://f/${id}`, title: `task ${id}`, status: 'waiting', closed_at: null, ...task }, cleared_waits: waits };
};
const handed = (url, cleared_at, over = {}) => {
  return { kind: 'external', on: 'user_ana', reason: `ready for a person to integrate ${url}`, until: null, cleared_at, ...over };
};

test('integrations: each change the tick handed to a person that they cleared within four weeks, newest first, by the change the wait names', () => {
  const now = '2026-11-07T00:00:00Z';
  const out = integrations({ now, tasks: [
    delivered('task_a', { waits: [handed('https://github.com/o/r/pull/1', '2026-11-01T00:00:00Z')] }),
    delivered('task_b', { waits: [handed('https://github.com/o/r/pull/2', '2026-11-05T00:00:00Z', { reason: 'ready for a person to integrate https://github.com/o/r/pull/2: the code host does not require the review (flow/review) on its default branch' })] }),
    delivered('task_old', { waits: [handed('https://github.com/o/r/pull/3', '2026-09-01T00:00:00Z')] }),
    delivered('task_open', { waits: [handed('https://github.com/o/r/pull/4', null)] }),
    delivered('task_other', { waits: [handed('x', '2026-11-05T00:00:00Z', { reason: 'the brief is short of the Ready brief' })] }),
    delivered('task_nobody', { waits: [handed('https://github.com/o/r/pull/5', '2026-11-05T00:00:00Z', { on: null })] }),
  ] });
  assert.deepEqual(out, [
    { task: 'task_b', url: 'https://f/task_b', title: 'task task_b', change: 'https://github.com/o/r/pull/2', on: 'user_ana', at: '2026-11-05T00:00:00Z' },
    { task: 'task_a', url: 'https://f/task_a', title: 'task task_a', change: 'https://github.com/o/r/pull/1', on: 'user_ana', at: '2026-11-01T00:00:00Z' },
  ]);
});

test('leftLine: the tasks with a change that closed in each week, beside the limit, never divided by it', () => {
  const now = '2026-11-07T00:00:00Z';
  const tasks = [
    delivered('task_a', { status: 'completed', closed_at: '2026-11-06T00:00:00.000Z' }),
    delivered('task_b', { status: 'cancelled', closed_at: '2026-11-01T00:00:00.000Z' }),
    delivered('task_c', { status: 'completed', closed_at: '2026-10-28T00:00:00.000Z' }),
    delivered('task_d', { status: 'completed', closed_at: '2026-10-01T00:00:00.000Z' }),
    delivered('task_open'),
  ];
  assert.equal(leftLine({ tasks, limit: 10, now }), 'Left the release queue (a task with a change closed): 2 this week (1 the week before); its limit is 10');
});

test('report: the changes a person integrated are data beside the answers, and what left the queue follows its lines', async () => {
  const now = '2026-11-02T17:00:00Z';
  const whole = {
    task_m: delivered('task_m', { status: 'completed', closed_at: '2026-11-01T00:00:00.000Z', waits: [handed('https://github.com/o/r/pull/9', '2026-10-31T00:00:00Z')] }),
  };
  const reads = [];
  const get = async (path, query = {}) => {
    reads.push([path, query.ref_role ?? null]);
    if (path === '/projects/proj_1m5wbbbf1x') {
      return { members: [{ user_id: 'user_ana', email: 'ana@x', role: 'admin' }], teams: [] };
    }
    if (path === '/projects/proj_1m5wbbbf1x/metrics') {
      return thisWeek;
    }
    if (path === '/tasks') {
      return query.ref_role
        ? { tasks: [{ id: 'task_m', updated_at: '2026-11-01T00:00:00Z' }, { id: 'task_stale', updated_at: '2026-09-01T00:00:00Z' }], next_cursor: 'more' }
        : { tasks: [] };
    }
    if (path === '/next') {
      return { tasks: [] };
    }
    if (whole[path.slice('/tasks/'.length)]) {
      return whole[path.slice('/tasks/'.length)];
    }
    throw new Error(`unexpected read ${path}`);
  };
  const snapshot = { params: { releaseQueue: 7 }, tasks: [], needs: { changes: [] } };
  const out = await report({ client: { get }, project: 'proj_1m5wbbbf1x', now, inbox: { captures: [], total: 0 }, snapshot });
  assert.deepEqual(out.integrations, [{ task: 'task_m', url: 'https://f/task_m', title: 'task task_m', change: 'https://github.com/o/r/pull/9', on: 'ana@x', at: '2026-10-31T00:00:00Z' }]);
  assert.ok(out.lines.includes('Left the release queue (a task with a change closed): 1 this week (0 the week before); its limit is 7'));
  // A page holding a task older than the window is the last one read.
  assert.equal(reads.filter(([path, role]) => { return path === '/tasks' && role; }).length, 1);
  // Without the snapshot the limit is not known, so the line is left out.
  const bare = await report({ client: { get }, project: 'proj_1m5wbbbf1x', now, inbox: { captures: [], total: 0 } });
  assert.ok(!bare.lines.some((l) => { return l.startsWith('Left the release queue'); }));
  assert.equal(bare.integrations.length, 1);
});

test('queues by hand: the saved snapshot and waiting rows give the same lines as the function', () => {
  const dir = mkdtempSync(join(tmpdir(), 'health-'));
  const file = (name, value) => {
    const path = join(dir, `${name}.json`);
    writeFileSync(path, JSON.stringify(value));
    return path;
  };
  const now = '2026-11-07T00:00:00Z';
  const tasks = [queued('task_a')];
  const script = join(dirname(fileURLToPath(import.meta.url)), 'health.mjs');
  const out = JSON.parse(execFileSync('node', [script, 'queues', '--snapshot', file('s', { params: { releaseQueue: 1 }, tasks }), '--decisions', file('d', { tasks: [] }), '--now', now], { encoding: 'utf8' }));
  assert.deepEqual(out, queues({ tasks, decisions: [], limit: 1, now }));
});
