import assert from 'node:assert/strict';
import { test } from 'node:test';

import { plan } from './plan.mjs';
import { build, DEFAULT_PARAMS } from './snapshot.mjs';

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

test('whom each task waits on, its holder and open decisions reach the planner’s person queue', () => {
  const snap = build({
    ...base,
    candidates: [row('t_new')],
    slices: [row('t_w', { status: 'waiting', readiness: { blocked_by: [{ via: 'wait', kind: 'external', on: 'user_x', until: null }] } })],
    decisions: [1, 2, 3].map((i) => { return row(`t_d${i}`, { kind: 'decision', assignee: 'user_x' }); }),
  });
  const by = Object.fromEntries(snap.tasks.map((t) => { return [t.id, t]; }));
  assert.deepEqual([by.t_w.waitsOn, by.t_d1.kind, by.t_d1.assignee, by.t_d1.candidate], [['user_x'], 'decision', 'user_x', false]);
  const report = plan(snap).at(-1);
  assert.deepEqual(report.wip.personQueue, { holder: 'user_x', now: 4, limit: 4 });
  assert.equal(report.freeReason, "new work held upstream: user_x's queue 4/4");
});
