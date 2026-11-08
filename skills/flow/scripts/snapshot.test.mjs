import assert from 'node:assert/strict';
import { test } from 'node:test';

import { plan } from './plan.mjs';
import { build, DEFAULT_PARAMS, roundsOf, run } from './snapshot.mjs';

const now = '2026-11-02T12:00:00Z';
const row = (id, over = {}) => {
  return { id, status: 'active', priority: null, tags: [], readiness: { blocked_by: [] }, ...over };
};
const base = { now, candidates: [], slices: [], dueIds: new Set(), children: [], mine: new Set(), childTasks: {}, implementsOf: {} };

test('candidates keep get-next’s rank; a wait on someone holds; a passed external wait or a due slice is due, a calendar one a check', () => {
  const snap = build({
    ...base,
    candidates: [row('t_a'), row('t_b')],
    slices: [
      row('t_held', { status: 'waiting', readiness: { blocked_by: [{ via: 'wait', kind: 'external', on: 'user_x', until: null }] } }),
      row('t_late', { status: 'waiting', readiness: { blocked_by: [{ via: 'wait', kind: 'external', on: null, until: '2026-11-01T00:00:00Z' }] } }),
      row('t_cal', { status: 'calendar' }),
    ],
    dueIds: new Set(['t_cal']),
  });
  const by = Object.fromEntries(snap.tasks.map((t) => { return [t.id, t]; }));
  assert.deepEqual([by.t_a.rank, by.t_b.rank, by.t_held.rank], [0, 1, null]);
  assert.equal(by.t_a.candidate, true);
  assert.equal(by.t_held.heldByPerson, true);
  assert.deepEqual([by.t_late.due, by.t_late.dueKind], [true, 'other']);
  assert.deepEqual([by.t_cal.due, by.t_cal.dueKind], [true, 'check']);
  assert.deepEqual(snap.params, DEFAULT_PARAMS);
});

test('children: mine by the by=me read, handoff when every task it holds closed or waits; the runtime from extra', () => {
  const snap = build({
    ...base,
    children: [
      { id: 'arun_1', works_on: ['t1'], started_at: '2026-11-02T11:00:00Z' },
      { id: 'arun_2', works_on: ['t2'], started_at: '2026-11-02T11:00:00Z' },
    ],
    mine: new Set(['arun_1']),
    childTasks: { t1: { status: 'waiting' }, t2: { status: 'active' } },
    extra: { children: { arun_2: { runtime: 'working' } } },
  });
  assert.deepEqual(snap.children.map((c) => { return [c.run, c.byMe, c.handoff, c.runtime]; }), [['arun_1', true, true, null], ['arun_2', false, false, 'working']]);
});

test('needs lists each implements change the model has not given; extra fills judgments and changes; plan.mjs accepts it', () => {
  const snap = build({
    ...base,
    candidates: [row('t_new')],
    slices: [row('t_pr', { status: 'waiting' })],
    implementsOf: { t_pr: ['https://gh/pr/1'], t_done: ['https://gh/pr/2'] },
    extra: { params: { maxRuns: 1 }, tasks: { t_new: { brief: 'ready' }, t_done: { change: { url: 'https://gh/pr/2' } } } },
  });
  assert.deepEqual(snap.needs.changes, [{ task: 't_pr', url: 'https://gh/pr/1' }]);
  assert.equal(snap.params.maxRuns, 1);
  const acts = plan(snap);
  assert.deepEqual(acts.filter((a) => { return a.act === 'start_child'; }).map((a) => { return a.tasks ?? a.task; }).flat(), ['t_new']);
});

test('a repo’s repair task repairs it, even outside every slice: its own change is never held by the red it fixes', () => {
  const defaults = [{ repo: 'o/r', sha: 's', red: true, repairTask: 't_fix' }];
  const red = { url: 'https://github.com/o/r/pull/9', repo: 'o/r', draft: false, headSha: 'h', checks: 'red', redOnDefault: true, conflict: false, merged: false, closed: false };
  const ready = build({ ...base, repairRows: [row('t_fix', { tags: ['bug', 'repair'] }), row('t_other')], extra: { defaults } });
  assert.deepEqual(ready.tasks.map((t) => { return [t.id, t.repairs]; }), [['t_fix', 'o/r']]);
  const start = plan(ready).filter((a) => { return a.act === 'start_child'; });
  assert.deepEqual(start.map((a) => { return [a.kind, a.tasks]; }), [['repair', ['t_fix']]]);
  const round = build({ ...base, slices: [row('t_fix', { status: 'waiting' })], extra: { defaults, tasks: { t_fix: { change: red } } } });
  assert.deepEqual(plan(round).filter((a) => { return a.act === 'move_task'; }).map((a) => { return a.task; }), ['t_fix']);
});

test('whom each task waits on reaches the planner, so a change a person validates counts in the release queue', () => {
  const waits = { blocked_by: [{ via: 'wait', kind: 'external', on: 'user_x', until: null }] };
  const merged = { url: 'https://gh/pr/1', repo: 'o/r', merged: true, closed: false, draft: false };
  const snap = build({
    ...base,
    candidates: [row('t_new')],
    slices: [row('t_v', { status: 'waiting', readiness: waits })],
    extra: { params: { releaseQueue: 1 }, tasks: { t_v: { change: merged } } },
  });
  assert.deepEqual(snap.tasks.find((t) => { return t.id === 't_v'; }).waitsOn, ['user_x']);
  const report = plan(snap).at(-1);
  assert.deepEqual(report.wip.releaseQueue, { now: 1, limit: 1 });
  assert.equal(report.freeReason, 'new work held upstream: release queue 1/1');
});

test('the handoff field is what integrating leaves, and its check carries the date the planner moves the task to', () => {
  const merged = { url: 'https://gh/pr/3', repo: 'o/r', merged: true, closed: false, draft: false, writtenSince: false };
  const check = { observe: 'the total matches', where: 'production', visible_at: '2026-11-06T15:00:00.000Z' };
  const snap = build({
    ...base,
    slices: [row('t_c', { status: 'waiting' }), row('t_old', { status: 'waiting' })],
    handoffs: { t_c: { leaves: 'check', check }, t_old: null },
    extra: { tasks: { t_c: { change: merged }, t_old: { change: { ...merged, url: 'https://gh/pr/4' } } } },
  });
  const by = Object.fromEntries(snap.tasks.map((t) => { return [t.id, t]; }));
  assert.deepEqual([by.t_c.leaves, by.t_c.check], ['check', check]);
  assert.equal(by.t_old.leaves, null);
  const acts = plan(snap);
  assert.deepEqual(acts.filter((a) => { return a.act === 'move_task'; }).map((a) => { return [a.task, a.status, a.until]; }), [['t_c', 'calendar', check.visible_at]]);
  assert.deepEqual(acts.filter((a) => { return a.act === 'judge'; }).map((a) => { return [a.task, a.about]; }), [['t_old', 'leaves']]);
});

test("the tick's own wait for what integrating leaves is told from a wait a person wrote", () => {
  const wait = (reason) => { return { readiness: { blocked_by: [{ via: 'wait', kind: 'external', on: 'user_x', until: null, reason }] }, status: 'waiting' }; };
  const snap = build({
    ...base,
    slices: [
      row('t_tick', wait("integrated, and the task does not say what integrating leaves, a choice the Closing evidence keeps for a person: write the task's after_integration and the next tick applies it")),
      row('t_old', wait('Integrated, but the body does not say what integrating leaves (close, release or check). Add after_integration, or close it.')),
      row('t_person', wait('waiting for the vendor to confirm the rollout')),
    ],
  });
  const by = Object.fromEntries(snap.tasks.map((t) => { return [t.id, t.leavesWait]; }));
  assert.deepEqual(by, { t_tick: true, t_old: true, t_person: false });
  assert.equal(snap.params.leavesByAgent, null);
});

test('rounds are the closed child runs that pushed to the change after it was opened', () => {
  const change = { url: 'https://gh/pr/5', createdAt: '2026-11-02T10:00:00Z' };
  const run = (started_at, over = {}) => { return { status: 'completed', started_at, produced: [change.url], ...over }; };
  assert.equal(roundsOf({
    change,
    runs: [
      run('2026-11-02T09:00:00Z'),
      run('2026-11-02T11:00:00Z'),
      run('2026-11-02T12:00:00Z', { produced: [] }),
      run('2026-11-02T13:00:00Z', { status: 'running' }),
      run('2026-11-02T14:00:00Z', { status: 'failed' }),
    ],
  }), 2);
  assert.equal(roundsOf({ change: { url: change.url, createdAt: null }, runs: [run('2026-11-02T11:00:00Z')] }), 0);
});

test('every task whose change is out is read, past the slices’ limit; a row Flow listed without the reference stays out, named', async () => {
  const waiting = (id) => { return row(id, { status: 'waiting' }); };
  const tasks = {
    t_slice: { task: { status: 'waiting' }, references: [] },
    t_pr: { task: { status: 'waiting' }, references: [{ url: 'https://gh/pr/7', role: 'implements' }] },
    t_retracted: { task: { status: 'waiting' }, references: [{ url: 'https://gh/pr/8', role: 'implements', retracted_at: now }] },
  };
  const asked = [];
  const get = async (path, query = {}) => {
    asked.push([path, query]);
    if (path === '/next') {
      return { tasks: query.slice === 'waiting' ? [waiting('t_slice')] : [], counts: {} };
    }
    if (path === '/agent-runs') {
      return { runs: [] };
    }
    return tasks[path.replace('/tasks/', '')];
  };
  // The slice is full and holds neither: only the ref_role read finds them.
  const all = async (path, query, field) => {
    asked.push([path, query, field]);
    return [waiting('t_pr'), waiting('t_retracted')];
  };
  const snap = await run({ client: { get, all }, project: 'proj_x', now });
  const listing = asked.find(([path]) => { return path === '/tasks'; });
  assert.deepEqual(listing[1], { project: 'proj_x', status: ['active', 'waiting', 'calendar', 'blocked'], ref_role: 'implements', limit: 100 });
  assert.deepEqual(snap.tasks.map((t) => { return t.id; }).sort(), ['t_pr', 't_slice']);
  assert.deepEqual(snap.needs.changes, [{ task: 't_pr', url: 'https://gh/pr/7' }]);
  assert.deepEqual(snap.needs.unread, [{ task: 't_retracted', error: 'listed by ref_role=implements without a live implements reference' }]);
});

test('the priority a row inherits from what it blocks reaches the planner, which works the blocker of a very_high first', () => {
  const snap = build({
    ...base,
    candidates: [row('t_high', { priority: 'high' }), row('t_blocker', { inherited_priority: { priority: 'very_high', from: 't_release' } })],
  });
  const by = Object.fromEntries(snap.tasks.map((t) => { return [t.id, t]; }));
  assert.deepEqual([by.t_blocker.priority, by.t_blocker.inherited, by.t_high.inherited], [null, 'very_high', null]);
  const params = { ...snap.params, maxRuns: 2, releaseQueue: 0 };
  const started = plan({ ...snap, params, tasks: snap.tasks.map((t) => { return { ...t, brief: 'ready' }; }) })
    .filter((a) => { return a.act === 'start_child'; }).map((a) => { return a.tasks[0]; });
  assert.deepEqual(started, ['t_blocker']);
});

test('a listed row answers what get-task would; the Chase reads one call per change, skips a repo it cannot read from the start, and keeps a task’s readable change', async () => {
  const asked = [];
  const get = async (path, query = {}) => {
    asked.push(path);
    if (path === '/next') {
      return { tasks: [], counts: {} };
    }
    if (path === '/agent-runs') {
      return { runs: [] };
    }
    throw new Error(`unexpected ${path}`);
  };
  const listed = (id, urls) => {
    return { ...row(id, { status: 'waiting' }), role_refs: urls.map((url) => { return { role: 'implements', url }; }), after_integration: null, updated_at: now };
  };
  const all = async () => {
    return [
      listed('t_both', ['https://github.com/o/open/pull/1', 'https://github.com/o/secret/pull/1']),
      listed('t_blind', ['https://github.com/o/secret/pull/2']),
      listed('t_blind2', ['https://github.com/o/secret/pull/3']),
    ];
  };
  const calls = [];
  const gh = async (path) => {
    calls.push(path);
    if (path.startsWith('repos/o/secret')) {
      throw Object.assign(new Error('gh failed'), { stderr: 'gh: Not Found (HTTP 404)' });
    }
    return { title: 'x', body: '', draft: false, merged: false, state: 'open', created_at: now };
  };
  const lines = [];
  const snap = await run({ client: { get, all }, project: 'proj_x', now, repos: ['o/open'], gh, host: 'state', progress: (l) => { lines.push(l); } });
  // No get-task, no read of the default branch, no runs per task.
  assert.deepEqual([...new Set(asked)].sort(), ['/agent-runs', '/next']);
  assert.equal(asked.filter((p) => { return p === '/agent-runs'; }).length, 3);
  assert.deepEqual(snap.tasks.find((x) => { return x.id === 't_both'; }).change.url, 'https://github.com/o/open/pull/1');
  assert.equal(snap.tasks.find((x) => { return x.id === 't_blind'; }).change, null);
  // The unreadable repo is asked once, before any of its changes.
  assert.deepEqual(calls.filter((c) => { return c.startsWith('repos/o/secret'); }), ['repos/o/secret']);
  assert.deepEqual(snap.needs.host.map((e) => { return [e.task ?? null, e.repo]; }).sort(), [[null, 'o/secret'], ['t_blind', 'o/secret'], ['t_blind2', 'o/secret'], ['t_both', 'o/secret']]);
  assert.ok(lines.includes('flow: 3 tasks with a change out') && lines.includes('host: 4/4 changes'));
  assert.ok(lines.includes('host: not readable by this session: o/secret'));
  assert.equal(snap.rows.t_both.role_refs.length, 2);
  assert.ok(!('rows' in JSON.parse(JSON.stringify(snap))));
});
