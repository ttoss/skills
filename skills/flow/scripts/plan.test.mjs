import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { plan } from './plan.mjs';

const now = '2026-10-30T12:00:00Z';
const params = {
  maxRuns: 2,
  staleAfterHours: 4,
  autoRounds: 1,
  reviewByAgent: true,
  agentsMayIntegrate: true,
  focus: null,
};
const change = (over = {}) => { return {
  url: 'https://github.com/o/r/pull/1',
  repo: 'o/r',
  draft: false,
  headSha: 'h',
  checks: 'green',
  redOnDefault: false,
  checksBeforeRepair: false,
  conflict: false,
  merged: false,
  closed: false,
  pipelineRedAfterMerge: false,
  verdict: { sha: 'h', result: 'CLEAN' },
  reviewRunActive: false,
  touchesOwnGates: false,
  reservedToPerson: false,
  ...over,
} };
const task = (over = {}) => { return {
  id: 'task_a',
  status: 'waiting',
  priority: null,
  tags: [],
  rank: 1,
  heldByPerson: false,
  inFocus: true,
  candidate: false,
  due: false,
  dueKind: null,
  brief: 'ready',
  leaves: 'close',
  rounds: 0,
  repairs: null,
  change: null,
  ...over,
} };
const acts = (snapshot, kind) => { return plan({ now, params, ...snapshot }).filter((a) => { return a.act === kind }) };

test('a CLEAN verdict on the head with green checks integrates', () => {
  assert.deepEqual(
    acts({ tasks: [task({ change: change() })] }, 'integrate').map((a) => { return a.task }),
    ['task_a'],
  );
});

test('a verdict for an older head is no verdict: a review child starts', () => {
  const start = acts(
    { tasks: [task({ change: change({ verdict: { sha: 'old', result: 'CLEAN' } }) })] },
    'start_child',
  );
  assert.deepEqual(
    start.map((a) => { return a.kind }),
    ['review'],
  );
});

test('a review already running starts no second one', () => {
  assert.equal(
    acts(
      { tasks: [task({ change: change({ verdict: null, reviewRunActive: true }) })] },
      'start_child',
    ).length,
    0,
  );
});

test('a change to its own gates waits on a person', () => {
  const out = plan({ now, params, tasks: [task({ change: change({ touchesOwnGates: true }) })] });
  assert.equal(out.filter((a) => { return a.act === 'integrate' }).length, 0);
  assert.equal(out.filter((a) => { return a.act === 'wait_on_person' }).length, 1);
});

test('an unread gate question becomes a judge act, never an integration', () => {
  const out = plan({ now, params, tasks: [task({ change: change({ touchesOwnGates: null }) })] });
  assert.equal(out.filter((a) => { return a.act === 'integrate' }).length, 0);
  assert.equal(out.find((a) => { return a.act === 'judge' }).about, 'merge_rule');
});

test('red checks take one round, then wait on a person', () => {
  assert.deepEqual(
    acts({ tasks: [task({ change: change({ checks: 'red' }) })] }, 'start_child').map(
      (a) => { return a.kind },
    ),
    ['round'],
  );
  assert.equal(
    acts({ tasks: [task({ rounds: 1, change: change({ checks: 'red' }) })] }, 'wait_on_person')
      .length,
    1,
  );
});

test('red caused on the default branch counts no round', () => {
  const out = plan({
    now,
    params,
    tasks: [task({ change: change({ checks: 'red', redOnDefault: true }) })],
  });
  assert.equal(
    out.filter((a) => { return ['start_child', 'move_task', 'wait_on_person'].includes(a.act) }).length,
    0,
  );
});

const red = { repo: 'o/r', sha: 'bad', red: true, repairTask: null };

test('a red default branch opens one repair task, blocking the changes it holds', () => {
  const out = plan({
    now,
    params,
    defaults: [red, { repo: 'o/other', sha: 'ok', red: false, repairTask: null }],
    tasks: [
      task({ id: 'task_merged', status: 'calendar', change: change({ merged: true, pipelineRedAfterMerge: true }) }),
      task({ id: 'task_open', change: change({ url: 'https://github.com/o/r/pull/2' }) }),
      task({ id: 'task_elsewhere', change: change({ repo: 'o/other', url: 'https://github.com/o/other/pull/1' }) }),
    ],
  });
  const repair = out.filter((a) => { return a.act === 'repair_default' });
  assert.deepEqual(repair.map((a) => { return [a.repo, a.sha, a.blocks] }), [['o/r', 'bad', ['task_merged', 'task_open']]]);
  // Nothing lands on a red branch, and no change that landed there gets a round
  // of its own: the repair task is the one fix.
  assert.deepEqual(
    out.filter((a) => { return a.act === 'integrate' }).map((a) => { return a.task }),
    ['task_elsewhere'],
  );
  assert.equal(out.filter((a) => { return a.act === 'move_task' }).length, 0);
});

test('an open repair task is never opened twice, and its child goes first', () => {
  const out = plan({
    now,
    params: { ...params, maxRuns: 1 },
    defaults: [{ ...red, repairTask: 'task_fix' }],
    tasks: [
      task({ id: 'task_bug', status: 'active', candidate: true, tags: ['bug'], priority: 'very_high', rank: 0 }),
      task({ id: 'task_fix', status: 'active', candidate: true, repairs: 'o/r', brief: null, rank: 5 }),
    ],
  });
  assert.equal(out.filter((a) => { return a.act === 'repair_default' }).length, 0);
  assert.deepEqual(
    out.filter((a) => { return a.act === 'start_child' }).map((a) => { return [a.kind, a.tasks[0]] }),
    [['repair', 'task_fix']],
  );
});

test("a repair's own red change takes a round; its green one integrates", () => {
  const defaults = [{ ...red, repairTask: 'task_fix' }];
  const fix = (over) => { return task({ id: 'task_fix', repairs: 'o/r', change: change(over) }) };
  assert.deepEqual(
    acts({ defaults, tasks: [fix({ checks: 'red', redOnDefault: true })] }, 'start_child').map((a) => { return a.kind }),
    ['round'],
  );
  assert.deepEqual(
    acts({ defaults, tasks: [fix({})] }, 'integrate').map((a) => { return a.task }),
    ['task_fix'],
  );
});

test('red checks that ran before the repair update the branch without a round', () => {
  const out = plan({ now, params, tasks: [task({ rounds: 1, change: change({ checks: 'red', checksBeforeRepair: true }) })] });
  assert.equal(out.filter((a) => { return a.act === 'wait_on_person' }).length, 0);
  assert.deepEqual(
    out.filter((a) => { return a.act === 'move_task' }).map((a) => { return a.status }),
    ['active'],
  );
  assert.equal(out.find((a) => { return a.act === 'start_child' }).kind, 'round');
});

test('a conflict goes to a child before new work', () => {
  const out = acts(
    {
      tasks: [
        task({ id: 'task_new', status: 'active', candidate: true, rank: 0 }),
        task({ id: 'task_c', change: change({ conflict: true }) }),
      ],
    },
    'start_child',
  );
  assert.deepEqual(
    out.map((a) => { return [a.kind, a.tasks[0]] }),
    [
      ['conflict', 'task_c'],
      ['implement', 'task_new'],
    ],
  );
});

test('a high bug goes before a conflict', () => {
  const out = acts(
    {
      tasks: [
        task({ id: 'task_c', change: change({ conflict: true }) }),
        task({
          id: 'task_bug',
          status: 'active',
          candidate: true,
          tags: ['bug'],
          priority: 'high',
        }),
      ],
    },
    'start_child',
  );
  assert.equal(out[0].tasks[0], 'task_bug');
});

test('a very_high task goes before a conflict, bug or not; a high one without the tag does not', () => {
  const conflict = task({ id: 'task_c', change: change({ conflict: true }) });
  const urgent = acts(
    { tasks: [conflict, task({ id: 'task_urgent', status: 'active', candidate: true, priority: 'very_high' })] },
    'start_child',
  );
  assert.equal(urgent[0].tasks[0], 'task_urgent');
  const merelyHigh = acts(
    { tasks: [conflict, task({ id: 'task_high', status: 'active', candidate: true, priority: 'high' })] },
    'start_child',
  );
  assert.equal(merelyHigh[0].tasks[0], 'task_c');
});

test('closed without integrating retracts and waits on a person', () => {
  const out = plan({ now, params, tasks: [task({ change: change({ closed: true }) })] });
  assert.equal(out.filter((a) => { return a.act === 'retract_reference' }).length, 1);
  assert.equal(out.filter((a) => { return a.act === 'wait_on_person' }).length, 1);
});

test('integrated: the body decides what is left', () => {
  const merged = change({ merged: true });
  assert.equal(acts({ tasks: [task({ change: merged })] }, 'move_task')[0].status, 'completed');
  assert.equal(
    acts({ tasks: [task({ leaves: 'check', change: merged })] }, 'move_task')[0].status,
    'calendar',
  );
  assert.equal(
    acts({ tasks: [task({ leaves: 'release', change: merged })] }, 'release_step').length,
    1,
  );
  assert.equal(
    acts({ tasks: [task({ leaves: 'none', change: merged })] }, 'wait_on_person').length,
    1,
  );
  // Not read yet: the planner asks, never takes silence for "says nothing".
  assert.equal(acts({ tasks: [task({ leaves: null, change: merged })] }, 'judge')[0].about, 'leaves');
  // Written after the merge: already advanced, left as it stands.
  assert.equal(plan({ now, params, defaults: [], children: [], tasks: [task({ change: change({ merged: true, writtenSince: true }) })] }).filter((a) => { return a.act !== 'report'; }).length, 0);
  // Even a red pipeline: the write after it already answered it.
  assert.equal(plan({ now, params, defaults: [], children: [], tasks: [task({ change: change({ merged: true, writtenSince: true, pipelineRedAfterMerge: true }) })] }).filter((a) => { return a.act !== 'report'; }).length, 0);
});

test('a draft is skipped', () => {
  const out = plan({ now, params, tasks: [task({ change: change({ draft: true }) })] });
  assert.deepEqual(
    out.map((a) => { return a.act }),
    ['report'],
  );
});

test('a stale unreadable child closes failed; a fresh one stays', () => {
  const out = acts(
    {
      children: [
        {
          run: 'arun_old',
          tasks: ['t'],
          startedAt: '2026-10-30T07:00:00Z',
          byMe: true,
          runtime: null,
          handoff: false,
        },
        {
          run: 'arun_new',
          tasks: ['t'],
          startedAt: '2026-10-30T11:00:00Z',
          byMe: true,
          runtime: null,
          handoff: false,
        },
      ],
    },
    'close_run',
  );
  assert.deepEqual(
    out.map((a) => { return [a.run, a.status] }),
    [['arun_old', 'failed']],
  );
});

test('closing a child frees its slot', () => {
  const out = plan({
    now,
    params,
    children: [
      {
        run: 'arun_1',
        tasks: ['t1'],
        startedAt: '2026-10-30T11:00:00Z',
        byMe: true,
        runtime: 'idle',
        handoff: true,
      },
      {
        run: 'arun_2',
        tasks: ['t2'],
        startedAt: '2026-10-30T11:00:00Z',
        byMe: true,
        runtime: 'working',
        handoff: false,
      },
    ],
    tasks: [task({ id: 'task_new', status: 'active', candidate: true })],
  });
  assert.equal(out.filter((a) => { return a.act === 'start_child' }).length, 1);
});

test("another person's children take no slot", () => {
  const others = [1, 2].map((n) => { return {
    run: `arun_${n}`,
    tasks: [],
    startedAt: '2026-10-30T11:00:00Z',
    byMe: false,
    runtime: 'working',
    handoff: false,
  } });
  assert.equal(
    acts({ children: others, tasks: [task({ status: 'active', candidate: true })] }, 'start_child')
      .length,
    1,
  );
});

test('an unjudged brief takes a slot as a judge act; a short one waits on its author', () => {
  const out = plan({
    now,
    params,
    tasks: [
      task({ id: 'task_u', status: 'active', candidate: true, brief: null, rank: 1 }),
      task({ id: 'task_s', status: 'active', candidate: true, brief: 'short', rank: 0 }),
    ],
  });
  assert.equal(out.find((a) => { return a.act === 'judge' }).task, 'task_u');
  assert.equal(out.find((a) => { return a.act === 'wait_on_person' }).task, 'task_s');
});

test('a task held by a person is skipped with its reason', () => {
  const report = plan({
    now,
    params,
    tasks: [task({ status: 'active', candidate: true, heldByPerson: true })],
  }).at(-1);
  assert.deepEqual(report.skipped, [{ task: 'task_a', reason: 'held by a person' }]);
  assert.equal(report.freeSlots, 2);
});

test('an empty graph reports free slots with a reason', () => {
  const report = plan({ now, params }).at(-1);
  assert.equal(report.freeReason, 'no candidate left in the focus');
});

test('the report carries the line a tick opens its report with', () => {
  const report = plan({ now, params, tasks: [task({ change: change() })] }).at(-1);
  assert.equal(report.line, 'plan: 1 acts (integrate 1) · runs 0/2 by me (2 free: no candidate left in the focus)');
});

test('a task a person holds starts no check, round or review child', () => {
  const held = [
    task({ id: 'task_check', heldByPerson: true, status: 'waiting', due: true, dueKind: 'check' }),
    task({ id: 'task_round', heldByPerson: true, change: change({ checks: 'red' }) }),
  ];
  const out = plan({ now, params, tasks: held });
  assert.equal(out.filter((a) => { return a.act === 'start_child' }).length, 0);
  assert.deepEqual(out.at(-1).skipped.map((s) => { return s.task }).sort(), ['task_check', 'task_round']);
});

test('the planner prints its acts when run through a symlinked skill directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plan-'));
  const link = join(dir, 'flow');
  symlinkSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'), link);
  const out = execFileSync(process.execPath, [join(link, 'scripts', 'plan.mjs')], {
    input: JSON.stringify({ now, params, tasks: [] }),
  }).toString();
  const acts = JSON.parse(out);
  assert.equal(acts.at(-1).act, 'report');
});
