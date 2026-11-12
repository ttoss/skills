import assert from 'node:assert/strict';
import { test } from 'node:test';

import { plan } from './plan.mjs';
import { build, DEFAULT_PARAMS, focusOf, reposOf, roundsOf, run } from './snapshot.mjs';

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
  assert.equal(report.freeReason, 'new work held upstream: release queue 1/1, person-free lane 0/1');
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

test('rounds are the closed child runs that pushed to one of the task’s changes after it was opened, each run once', () => {
  const change = { url: 'https://gh/pr/5', createdAt: '2026-11-02T10:00:00Z' };
  const other = { url: 'https://gh/pr/6', createdAt: '2026-11-02T13:30:00Z' };
  const run = (started_at, over = {}) => { return { status: 'completed', started_at, produced: [change.url], ...over }; };
  assert.equal(roundsOf({
    changes: [change, other],
    runs: [
      run('2026-11-02T09:00:00Z'),
      run('2026-11-02T11:00:00Z'),
      run('2026-11-02T12:00:00Z', { produced: [] }),
      run('2026-11-02T13:00:00Z', { status: 'running' }),
      run('2026-11-02T14:00:00Z', { status: 'failed' }),
      run('2026-11-02T15:00:00Z', { produced: [change.url, other.url] }),
      run('2026-11-02T13:00:00Z', { status: 'completed', produced: [other.url] }),
    ],
  }), 3);
  assert.equal(roundsOf({ changes: [{ url: change.url, createdAt: null }], runs: [run('2026-11-02T11:00:00Z')] }), 0);
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
  assert.deepEqual(listing[1], { project: 'proj_x', status: ['active', 'waiting', 'calendar'], ref_role: 'implements', limit: 100 });
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
  assert.deepEqual(snap.tasks.find((x) => { return x.id === 't_both'; }).changes.map((c) => { return c.url; }), ['https://github.com/o/open/pull/1']);
  assert.deepEqual(snap.tasks.find((x) => { return x.id === 't_blind'; }).changes, []);
  // The unreadable repo is asked once, before any of its changes.
  assert.deepEqual(calls.filter((c) => { return c.startsWith('repos/o/secret'); }), ['repos/o/secret']);
  assert.deepEqual(snap.needs.host.map((e) => { return [e.task ?? null, e.repo]; }).sort(), [[null, 'o/secret'], ['t_blind', 'o/secret'], ['t_blind2', 'o/secret'], ['t_both', 'o/secret']]);
  assert.ok(lines.includes('flow: 3 tasks with a change out') && lines.includes('host: 4/4 changes'));
  assert.ok(lines.includes('host: not readable by this session: o/secret'));
  assert.equal(snap.rows.t_both.role_refs.length, 2);
  assert.ok(!('rows' in JSON.parse(JSON.stringify(snap))));
});

test('a task a blocks edge holds carries its sources, and one held only by an integrated, open source reaches the planner as a finding', async () => {
  const held = row('t_tgt', { readiness: { blocked_by: [{ via: 'task', id: 't_src', status: 'active' }] } });
  const hidden = row('t_hid', { readiness: { blocked_by: [{ via: 'task', id: null, status: null }] } });
  const get = async (path, query = {}) => {
    if (path === '/next') {
      return { tasks: query.state === 'blocked:dependency' ? [held, hidden] : [], counts: {} };
    }
    if (path === '/agent-runs') {
      return { runs: [] };
    }
    throw new Error(`unexpected ${path}`);
  };
  const listed = { ...row('t_src', { status: 'active' }), role_refs: [{ role: 'implements', url: 'https://gh/pr/9' }], after_integration: { leaves: 'release' }, updated_at: now };
  const all = async () => { return [listed]; };
  const merged = { url: 'https://gh/pr/9', repo: 'o/r', merged: true, closed: false, draft: false };
  const snap = await run({ client: { get, all }, project: 'proj_x', now, extra: { params: { retargetByAgent: false }, tasks: { t_src: { change: merged } } } });
  const by = Object.fromEntries(snap.tasks.map((t) => { return [t.id, t]; }));
  assert.deepEqual([by.t_tgt.blockedBy, by.t_hid.blockedBy, by.t_src.blockedBy], [['t_src'], [null], []]);
  assert.deepEqual(plan(snap).at(-1).heldByIntegrated, [{ task: 't_tgt', sources: [{ task: 't_src', url: 'https://gh/pr/9' }] }]);
});

test('a task whose waits on a person are all scheduled in the future is deferred to the latest date; an external or a passed one is not', () => {
  const wait = (kind, until, on = 'user_x') => { return { via: 'wait', kind, on, until }; };
  const snap = build({
    ...base,
    slices: [
      row('t_def', { status: 'calendar', readiness: { blocked_by: [wait('scheduled', '2026-11-05T00:00:00Z'), wait('scheduled', '2026-11-07T00:00:00Z', 'user_y')] } }),
      row('t_ext', { status: 'waiting', readiness: { blocked_by: [wait('external', '2026-11-05T00:00:00Z')] } }),
      row('t_mix', { status: 'waiting', readiness: { blocked_by: [wait('scheduled', '2026-11-05T00:00:00Z'), wait('external', null)] } }),
      row('t_past', { status: 'calendar', readiness: { blocked_by: [wait('scheduled', '2026-11-01T00:00:00Z')] } }),
      row('t_nobody', { status: 'calendar', readiness: { blocked_by: [wait('scheduled', '2026-11-05T00:00:00Z', null)] } }),
    ],
  });
  const by = Object.fromEntries(snap.tasks.map((t) => { return [t.id, t.deferredUntil]; }));
  assert.deepEqual(by, { t_def: '2026-11-07T00:00:00Z', t_ext: null, t_mix: null, t_past: null, t_nobody: null });
  const outside = Object.fromEntries(snap.tasks.map((t) => { return [t.id, t.heldOutside]; }));
  assert.deepEqual(outside, { t_def: false, t_ext: false, t_mix: false, t_past: false, t_nobody: true });
});

test('a task carries every change it implements; one whose only open change is unread is left out, never read as integrated', async () => {
  const get = async (path) => {
    if (path === '/next') {
      return { tasks: [], counts: {} };
    }
    if (path === '/agent-runs') {
      return { runs: [] };
    }
    throw new Error(`unexpected ${path}`);
  };
  const listed = (id, urls) => {
    return { ...row(id, { status: 'waiting' }), role_refs: urls.map((url) => { return { role: 'implements', url }; }), after_integration: { leaves: 'release' }, updated_at: now };
  };
  const all = async () => {
    return [
      listed('t_two', ['https://github.com/o/r/pull/1', 'https://github.com/o/s/pull/2']),
      listed('t_part', ['https://github.com/o/r/pull/3', 'https://github.com/o/secret/pull/4']),
    ];
  };
  const gh = async (path) => {
    if (path.startsWith('repos/o/secret')) {
      throw Object.assign(new Error('gh failed'), { stderr: 'gh: Not Found (HTTP 404)' });
    }
    const merged = !path.endsWith('pulls/2');
    return { title: 'x', body: '', draft: false, merged, merged_at: merged ? '2026-11-01T00:00:00Z' : null, state: merged ? 'closed' : 'open', created_at: '2026-10-31T00:00:00Z' };
  };
  const snap = await run({ client: { get, all }, project: 'proj_x', now, repos: ['o/r', 'o/s'], gh, host: 'state' });
  const by = Object.fromEntries(snap.tasks.map((t) => { return [t.id, t]; }));
  assert.deepEqual(by.t_two.changes.map((c) => { return [c.url, c.merged]; }), [['https://github.com/o/r/pull/1', true], ['https://github.com/o/s/pull/2', false]]);
  assert.deepEqual(by.t_part.changes, []);
  assert.equal(plan(snap).filter((a) => { return a.act === 'release_step'; }).length, 0);
});

test('a task assigned to a member or a team is held by them, so the planner offers it to no child', () => {
  const snap = build({ ...base, candidates: [row('t_mine', { assignee: 'user_x' }), row('t_team', { assignee: 'team_y' }), row('t_free', { assignee: null })] });
  assert.deepEqual(snap.tasks.map((t) => { return [t.id, t.heldByPerson]; }), [['t_mine', true], ['t_team', true], ['t_free', false]]);
  const started = plan({ ...snap, params: { ...snap.params, maxRuns: 1 }, tasks: snap.tasks.map((t) => { return { ...t, brief: 'ready' }; }) })
    .filter((a) => { return a.act === 'start_child'; }).map((a) => { return a.tasks[0]; });
  assert.deepEqual(started, ['t_free']);
});

test('a focus is resolved from every form a tick writes', () => {
  assert.equal(focusOf(null), null);
  assert.deepEqual(focusOf('task_a'), { tasks: ['task_a'] });
  assert.deepEqual(focusOf('tag:billing'), { tag: 'billing' });
  assert.deepEqual(focusOf(['task_a', 'task_b', 'task_a']), { tasks: ['task_a', 'task_b'] });
  assert.deepEqual(focusOf({ task: 'task_a' }), { tasks: ['task_a'] });
  assert.deepEqual(focusOf({ tasks: [] }), null);
});

test('a focus on several tasks reads each target\'s upstream and marks their union in focus; a tag marks the tasks carrying it', async () => {
  const asked = [];
  const get = async (path, query = {}) => {
    asked.push(query);
    if (path === '/next') {
      if (query.upstream_of === 'task_a') {
        return { tasks: [row('t_a1'), row('task_a')] };
      }
      if (query.upstream_of === 'task_b') {
        return { tasks: [row('t_a1'), row('task_b')] };
      }
      return { tasks: query.slice === 'waiting' ? [row('t_out', { status: 'waiting' })] : [] };
    }
    return { runs: [] };
  };
  const all = async () => { return []; };
  const snap = await run({ client: { get, all }, project: 'proj_x', now, extra: { focus: ['task_a', 'task_b'] } });
  const by = Object.fromEntries(snap.tasks.map((t) => { return [t.id, t]; }));
  assert.deepEqual(['t_a1', 'task_a', 'task_b', 't_out'].map((id) => { return by[id].inFocus; }), [true, true, true, false]);
  assert.deepEqual([by.t_a1.rank, by.task_a.rank, by.task_b.rank], [0, 1, 2]);
  assert.deepEqual(snap.params.focus, { tasks: ['task_a', 'task_b'] });
  assert.ok(!asked.some((q) => { return q.limit === 10 && !q.upstream_of && !q.slice; }), 'no unfocused candidate read');
  const tagged = build({ ...base, candidates: [row('t_bill', { tags: ['billing'] })], slices: [row('t_other', { status: 'waiting' })], focusIds: new Set(['t_bill']), extra: { focus: 'tag:billing' } });
  assert.deepEqual(tagged.tasks.map((t) => { return [t.id, t.inFocus]; }), [['t_bill', true], ['t_other', false]]);
});

test('every candidate read asks for unassigned work alone, with or without a focus', async () => {
  for (const focus of [null, 'tag:billing', ['task_a', 'task_b']]) {
    const asked = [];
    const get = async (path, query = {}) => {
      if (path === '/next') {
        asked.push(query);
        return { tasks: [] };
      }
      return { runs: [] };
    };
    await run({ client: { get, all: async () => { return []; } }, project: 'proj_x', now, extra: focus ? { focus } : {} });
    const candidates = asked.filter((q) => { return q.limit === 10; });
    assert.equal(candidates.length, Array.isArray(focus) ? 2 : 1);
    assert.ok(candidates.every((q) => { return q.assignee === 'none'; }), `focus ${JSON.stringify(focus)}`);
  }
});

// The invariant: a judge's answer lives on the task, so the next plan built
// from the same Flow rows and host state never asks it again, and `--extra`
// carries no judgment.
test('every judge answer is read back from the task: the same rows give the same plan, and an answered judge is not asked again', () => {
  const judges = (snap) => { return plan(snap).filter((a) => { return a.act === 'judge'; }).map((a) => { return [a.about, a.task]; }); };
  const merged = { url: 'https://github.com/o/r/pull/1', repo: 'o/r', merged: true, closed: false, draft: false, writtenSince: true };
  // Host state only: each change as the code host reports it.
  const host = { tasks: { t_back: { changes: [merged] }, t_rel: { changes: [{ ...merged, url: 'https://github.com/o/r/pull/2' }] } } };
  const snapOf = ({ tags = {}, references = {}, extra = host }) => {
    return build({
      ...base,
      candidates: [row('t_new', { tags: tags.t_new })],
      slices: [row('t_back', { tags: tags.t_back }), row('t_rel', { tags: tags.t_rel })],
      handoffs: { t_back: { leaves: 'check' }, t_rel: { leaves: 'release' } },
      references,
      extra,
    });
  };
  assert.deepEqual(plan(snapOf({})), plan(snapOf({})));
  assert.deepEqual(judges(snapOf({})), [['sent_back', 't_back'], ['released', 't_rel'], ['ready_brief', 't_new']]);
  const answered = snapOf({ tags: { t_new: ['flow-brief-ready'], t_back: ['flow-sent-back-check'], t_rel: ['flow-sent-back-round'] } });
  assert.deepEqual(judges(answered), []);
  const starts = plan(answered).filter((a) => { return a.act === 'start_child'; });
  assert.deepEqual(starts.map((a) => { return [a.tasks[0], a.kind, a.untag ?? null]; }).sort(), [
    ['t_back', 'check', ['flow-sent-back-check']],
    ['t_new', 'implement', null],
    ['t_rel', 'round', ['flow-sent-back-round']],
  ]);
  // Under a branch cap, the repos are the task's references to each repo's root.
  const capped = { ...host, params: { branchesPerRepo: 1 } };
  const ready = { t_new: ['flow-brief-ready'], t_back: ['flow-sent-back-check'], t_rel: ['flow-sent-back-round'] };
  assert.deepEqual(judges(snapOf({ tags: ready, extra: capped })), [['repos', 't_rel'], ['repos', 't_new']]);
  const repo = [{ role: 'context', url: 'https://github.com/o/s' }];
  const named = snapOf({ tags: ready, extra: capped, references: { t_new: repo, t_rel: repo } });
  assert.deepEqual(judges(named), []);
  assert.deepEqual(named.tasks.find((t) => { return t.id === 't_new'; }).repos, ['o/s']);
});

test('a repo reference names a push repo only at its root, live, and within the project’s Repos when known', () => {
  const refs = [
    { role: 'context', url: 'https://github.com/o/r' },
    { role: 'context', url: 'https://github.com/o/r/issues/3' },
    { role: 'context', url: 'https://github.com/o/gone/', retracted_at: '2026-11-01T00:00:00Z' },
    { role: 'implements', url: 'https://github.com/o/pr' },
    { role: 'spec', url: 'https://github.com/O/Other.git' },
  ];
  assert.deepEqual(reposOf({ references: refs }), ['o/r', 'O/Other']);
  assert.deepEqual(reposOf({ references: refs, projectRepos: ['o/other'] }), ['o/other']);
  assert.equal(reposOf({ references: [{ url: 'https://github.com/o/r/pull/1' }] }), null);
});

test("under a branch cap, each candidate is read for its repo references; without one, no candidate is read", async () => {
  const readsOf = async (extra) => {
    const read = [];
    const get = async (path, query = {}) => {
      if (path === '/next') {
        return { tasks: query.limit === 10 ? [row('t_new')] : [] };
      }
      if (path.startsWith('/tasks/')) {
        read.push(path);
        return { task: { status: 'active' }, references: [{ role: 'context', url: 'https://github.com/o/r' }] };
      }
      return { runs: [] };
    };
    const snap = await run({ client: { get, all: async () => { return []; } }, project: 'proj_x', now, extra });
    return { read, repos: snap.tasks.find((t) => { return t.id === 't_new'; }).repos };
  };
  assert.deepEqual(await readsOf({ params: { branchesPerRepo: 1 } }), { read: ['/tasks/t_new'], repos: ['o/r'] });
  assert.deepEqual(await readsOf({}), { read: [], repos: null });
});
