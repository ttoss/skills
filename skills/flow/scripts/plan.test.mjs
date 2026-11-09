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
  reviewRequired: true,
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
  checksDoneAt: '2026-10-30T11:50:00Z',
  verdict: { sha: 'h', result: 'CLEAN' },
  reviewPendingSince: null,
  reviewRunActive: false,
  reviewEnforced: true,
  touchesOwnGates: false,
  reservedToPerson: false,
  findingsToPerson: false,
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

// Gates fail closed: a missing verdict never reads as the gates passed.
const external = { ...params, reviewByAgent: false };
const noVerdict = (over = {}) => { return task({ change: change({ verdict: null, ...over }) }) };
const kinds = (out) => { return out.filter((a) => { return a.act !== 'report' }).map((a) => { return a.act }) };

test('a reviewer outside the tick: no verdict waits, never integrates, while the request is fresh', () => {
  assert.deepEqual(kinds(plan({ now, params: external, tasks: [noVerdict()] })), []);
});

test('a reviewer outside the tick: past Stale after with no claim, the request is lost', () => {
  const fresh = plan({ now, params: external, tasks: [noVerdict({ checksDoneAt: '2026-10-30T11:00:00Z' })] });
  assert.deepEqual(kinds(fresh), []);
  const out = plan({ now, params: external, tasks: [noVerdict({ checksDoneAt: '2026-10-30T07:00:00Z' })] });
  assert.deepEqual(kinds(out), ['review_lost']);
});

test('a reviewer outside the tick: a claim past Stale after with no run holding the task is lost too', () => {
  const stale = noVerdict({ checksDoneAt: '2026-10-30T06:00:00Z', reviewPendingSince: '2026-10-30T07:00:00Z' });
  assert.deepEqual(kinds(plan({ now, params: external, tasks: [stale] })), ['review_lost']);
  const held = noVerdict({ checksDoneAt: '2026-10-30T06:00:00Z', reviewRunActive: true });
  assert.deepEqual(kinds(plan({ now, params: external, tasks: [held] })), []);
});

test('Review none: the gates are the checks, and no verdict integrates', () => {
  const out = plan({ now, params: { ...external, reviewRequired: false }, tasks: [noVerdict({ reviewEnforced: null })] });
  assert.deepEqual(kinds(out), ['integrate']);
});

test('Review not stated: no verdict is a judge, never an integration', () => {
  const out = plan({ now, params: { ...external, reviewRequired: null }, tasks: [noVerdict()] });
  assert.deepEqual(out.filter((a) => { return a.act === 'judge' }).map((a) => { return a.about }), ['review']);
  assert.equal(out.filter((a) => { return a.act === 'integrate' }).length, 0);
});

test('a review child is not started while a reviewer’s claim on the head is fresh', () => {
  const fresh = noVerdict({ reviewPendingSince: '2026-10-30T11:55:00Z' });
  assert.equal(acts({ tasks: [fresh] }, 'start_child').length, 0);
  const stale = noVerdict({ reviewPendingSince: '2026-10-30T06:00:00Z' });
  assert.deepEqual(acts({ tasks: [stale] }, 'start_child').map((a) => { return a.kind }), ['review']);
});

test('a CLEAN verdict the code host does not enforce waits on a person to integrate', () => {
  for (const reviewEnforced of [false, null]) {
    const out = plan({ now, params, tasks: [task({ change: change({ reviewEnforced }) })] });
    assert.deepEqual(kinds(out), ['wait_on_person']);
  }
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

test('findings take a round only when an agent can fix them: what the Merge rule gives to a person waits on one at once', () => {
  const findings = (over) => { return change({ verdict: { sha: 'h', result: 'FINDINGS' }, ...over }); };
  assert.deepEqual(acts({ tasks: [task({ change: findings() })] }, 'start_child').map((a) => { return a.kind }), ['round']);
  for (const over of [{ reservedToPerson: true }, { findingsToPerson: true }]) {
    const out = plan({ now, params, tasks: [task({ change: findings(over) })] });
    assert.equal(out.filter((a) => { return a.act === 'start_child' || a.act === 'move_task' }).length, 0);
    assert.match(out.find((a) => { return a.act === 'wait_on_person' }).reason, /no automatic round/);
  }
  const unread = plan({ now, params, tasks: [task({ change: findings({ findingsToPerson: null }) })] });
  assert.equal(unread.find((a) => { return a.act === 'judge' }).about, 'findings');
  assert.equal(unread.filter((a) => { return a.act === 'start_child' }).length, 0);
  // Rounds spent: a person either way, with nothing left to judge.
  const spent = plan({ now, params, tasks: [task({ rounds: 1, change: findings({ findingsToPerson: null }) })] });
  assert.deepEqual(spent.filter((a) => { return a.act === 'judge' || a.act === 'wait_on_person' }).map((a) => { return a.act }), ['wait_on_person']);
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
  const out = plan({
    now,
    params: { ...params, maxRuns: 3 },
    tasks: [
      task({ id: 'task_new', status: 'active', candidate: true, rank: 0 }),
      task({ id: 'task_c', change: change({ conflict: true }) }),
    ],
  }).filter((a) => { return a.act === 'start_child' });
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

test('a red integration pipeline reverts the change by its recorded path, then a round', () => {
  const merged = (over) => { return task({ id: 'task_m', status: 'calendar', change: change({ merged: true, pipelineRedAfterMerge: true, ...over }) }) };
  const unread = plan({ now, params, tasks: [merged({ reversal: null })] });
  assert.deepEqual(unread.filter((a) => { return a.act === 'judge' }).map((a) => { return a.about }), ['reversal']);
  assert.equal(unread.filter((a) => { return a.act === 'move_task' }).length, 0);
  const none = plan({ now, params, tasks: [merged({ reversal: 'none' })] });
  assert.equal(none.filter((a) => { return a.act === 'wait_on_person' }).length, 1);
  assert.equal(none.filter((a) => { return a.act === 'revert' }).length, 0);
  const recorded = plan({ now, params, tasks: [merged({ reversal: 'recorded' })] });
  assert.deepEqual(
    recorded.filter((a) => { return a.act === 'revert' || a.act === 'move_task' }).map((a) => { return [a.act, a.status ?? a.url] }),
    [['revert', 'https://github.com/o/r/pull/1'], ['move_task', 'active']],
  );
  assert.equal(recorded.find((a) => { return a.act === 'start_child' }).kind, 'round');
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

test("integrated and waiting on a person for what integrating leaves: writing after_integration hands it back to the tick", () => {
  const since = change({ merged: true, writtenSince: true });
  const held = (over) => { return task({ heldByPerson: true, leavesWait: true, change: since, ...over }) };
  assert.equal(acts({ tasks: [held({ leaves: 'close' })] }, 'move_task')[0].status, 'completed');
  assert.equal(acts({ tasks: [held({ leaves: 'check' })] }, 'move_task')[0].status, 'calendar');
  assert.equal(acts({ tasks: [held({ leaves: 'release' })] }, 'release_step').length, 1);
  const quiet = (t) => { return plan({ now, params: { ...params, leavesByAgent: false }, defaults: [], children: [], tasks: [t] }).filter((a) => { return a.act !== 'report'; }).length };
  // Still nothing stated: the wait already names it, and is not written again.
  assert.equal(quiet(held({ leaves: 'none' })), 0);
  assert.equal(quiet(held({ leaves: null })), 0);
  // A red pipeline's wait is about the pipeline, whatever the handoff says.
  assert.equal(quiet(held({ change: change({ merged: true, writtenSince: true, pipelineRedAfterMerge: true }) })), 0);
});

test("a check child's wait on a person is not that person's answer", () => {
  // The check child ran the check, found the missing half is the person's
  // act, and waited on them: after_integration predates that wait.
  const blocked = task({
    status: 'waiting',
    heldByPerson: true,
    leavesWait: false,
    leaves: 'check',
    check: { observe: 'the probe answers 200', where: 'the endpoint', visible_at: '2026-10-29T12:00:00Z' },
    change: change({ merged: true, writtenSince: true }),
  });
  assert.equal(plan({ now, params, defaults: [], children: [], tasks: [blocked] }).filter((a) => { return a.act !== 'report'; }).length, 0);
});

test('a past-due wait on a task already advanced past its merge is judged against the world', () => {
  const since = change({ merged: true, writtenSince: true });
  const judged = (over) => { return acts({ tasks: [task({ heldByPerson: true, change: since, ...over })] }, 'judge').map((a) => { return a.about; }) };
  assert.deepEqual(judged({ due: true, dueKind: 'other' }), ['wait_against_world']);
  // Not due yet, or a check, which the check stage runs: no judge.
  assert.deepEqual(judged({ due: false }), []);
  assert.deepEqual(judged({ due: true, dueKind: 'check', status: 'calendar' }), []);
  // The tick's own wait for what integrating leaves: cleared would mean a round, so not judged.
  assert.deepEqual(judged({ due: true, dueKind: 'other', leavesWait: true, leaves: 'none' }), []);
  // Not yet advanced past the merge: the advance acts, not the judge.
  assert.deepEqual(judged({ due: true, dueKind: 'other', change: change({ merged: true }) }), []);
});

test('a check that failed after the merge sends the task back a round, on a fresh change', () => {
  // The check child moved it calendar -> active, so it was written after the merge.
  const failed = (over = {}, changeOver = {}) => { return task({ status: 'active', leaves: 'check', change: change({ merged: true, writtenSince: true, ...changeOver }), ...over }) };
  const out = plan({ now, params, defaults: [], children: [], tasks: [failed()] });
  assert.deepEqual(out.filter((a) => { return a.act !== 'report'; }).map((a) => { return [a.act, a.kind, a.tasks]; }), [['start_child', 'round', ['task_a']]]);
  // A run already holds it, such as the round's own child: left to it.
  assert.equal(acts({ tasks: [failed({}, { reviewRunActive: true })] }, 'start_child').length, 0);
  // A person holds it: theirs.
  assert.equal(acts({ tasks: [failed({ heldByPerson: true })] }, 'start_child').length, 0);
});

test('a check applied with its date past is dated now, never in the past', () => {
  const check = (visible_at) => {
    return acts({ tasks: [task({ leaves: 'check', check: { observe: 'o', where: 'w', visible_at }, change: change({ merged: true }) })] }, 'move_task')[0].until;
  };
  assert.equal(check('2026-10-29T12:00:00Z'), now);
  assert.equal(check('2026-11-02T12:00:00Z'), '2026-11-02T12:00:00Z');
});

test("the tick's own wait for what integrating leaves is read again when the Closing evidence gives the agent the choice", () => {
  const since = change({ merged: true, writtenSince: true });
  const parked = (over) => { return task({ heldByPerson: true, leavesWait: true, leaves: null, change: since, ...over }) };
  const with_ = (leavesByAgent, t) => { return plan({ now, params: { ...params, leavesByAgent }, defaults: [], children: [], tasks: [t] }).filter((a) => { return a.act !== 'report'; }) };
  // Not read yet: the planner asks the parameter before anything else.
  assert.deepEqual(with_(null, parked()).map((a) => { return [a.act, a.about]; }), [['judge', 'closing_evidence']]);
  // It gives the agent the choice: the level is judged again, from the change and the task.
  assert.deepEqual(with_(true, parked()).map((a) => { return [a.act, a.about]; }), [['judge', 'leaves']]);
  // Its answer is applied as a person's would be.
  assert.equal(with_(true, parked({ leaves: 'close' })).find((a) => { return a.act === 'move_task'; }).status, 'completed');
  // The choice stays a person's, or the judge already answered no level: the wait stands.
  assert.equal(with_(false, parked()).length, 0);
  assert.equal(with_(true, parked({ leaves: 'none' })).length, 0);
  // A wait a person wrote, or one about a red pipeline, is never read again.
  assert.equal(with_(true, parked({ leavesWait: false })).length, 0);
  assert.equal(with_(true, parked({ change: change({ merged: true, writtenSince: true, pipelineRedAfterMerge: true }) })).length, 0);
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
    params: { ...params, maxRuns: 3 },
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

const fresh = (id, over = {}) => { return task({ id, status: 'active', candidate: true, rank: Number(id.slice(-1)), leaves: null, ...over }) };
const atGates = (id, over = {}) => { return task({ id, change: change({ url: `https://github.com/o/r/pull/${id}`, checks: 'pending', verdict: null, ...over }) }) };
const started = (snapshot, over = {}) => {
  return plan({ now, params: { ...params, maxRuns: 3, ...over }, ...snapshot })
    .filter((a) => { return a.act === 'start_child' && a.reason === 'new' })
    .map((a) => { return a.tasks[0] });
};

test('the release queue: new work starts only up to the limit, 20 by default', () => {
  const queue = ['task_o1', 'task_o2', 'task_o3', 'task_o4', 'task_o5'].map((id) => { return atGates(id) });
  assert.deepEqual(started({ tasks: [...queue, fresh('task_n1'), fresh('task_n2')] }, { releaseQueue: 6 }), ['task_n1']);
  assert.deepEqual(started({ tasks: [...queue.slice(0, 2), fresh('task_n1'), fresh('task_n2')] }, { releaseQueue: 6 }), ['task_n1', 'task_n2']);
  const many = Array.from({ length: 19 }, (_, i) => { return atGates(`task_q${i}`) });
  assert.deepEqual(started({ tasks: [...many, fresh('task_n1'), fresh('task_n2')] }), ['task_n1']);
  const report = plan({ now, params: { ...params, releaseQueue: 5 }, tasks: [...queue, fresh('task_n1')] }).at(-1);
  assert.equal(report.freeReason, 'new work held upstream: release queue 5/5');
  assert.deepEqual(report.skipped, [{ task: 'task_n1', reason: 'held upstream: release queue 5/5' }]);
});

test('an integrated change waiting on a person to validate it is in the queue; a draft or one an agent checks is not', () => {
  const validating = (id) => { return task({ id, waitsOn: ['user_ana'], change: change({ merged: true }) }) };
  const checked = (id) => { return task({ id, status: 'calendar', change: change({ merged: true }) }) };
  const full = [atGates('task_o1'), atGates('task_o2'), validating('task_v1'), validating('task_v2')];
  assert.deepEqual(started({ tasks: [...full, fresh('task_n1')] }, { releaseQueue: 4 }), []);
  const light = [atGates('task_o1'), atGates('task_d1', { draft: true }), checked('task_c1'), checked('task_c2')];
  assert.deepEqual(started({ tasks: [...light, fresh('task_n1')] }, { releaseQueue: 2 }), ['task_n1']);
});

test('a validation a person dated in the future enters the queue on its date; an external wait on a person or an undated one counts now, one on nobody never', () => {
  const merged = change({ merged: true });
  const deferred = (id) => { return task({ id, status: 'calendar', waitsOn: ['user_ana'], deferredUntil: '2026-11-05T00:00:00Z', change: merged }) };
  const cameDue = (id) => { return task({ id, status: 'calendar', due: true, dueKind: 'check', change: merged }) };
  const chased = (id) => { return task({ id, waitsOn: ['user_ana'], change: merged }) };
  const deferredOnly = [atGates('task_o1'), deferred('task_f1'), deferred('task_f2'), deferred('task_f3')];
  assert.deepEqual(started({ tasks: [...deferredOnly, fresh('task_n1')] }, { releaseQueue: 2 }), ['task_n1']);
  assert.deepEqual(started({ tasks: [atGates('task_o1'), cameDue('task_f1'), fresh('task_n1')] }, { releaseQueue: 2 }), []);
  assert.deepEqual(started({ tasks: [atGates('task_o1'), chased('task_x1'), fresh('task_n1')] }, { releaseQueue: 2 }), []);
  const outside = (id) => { return task({ id, due: true, dueKind: 'other', heldOutside: true, change: merged }) };
  assert.deepEqual(started({ tasks: [atGates('task_o1'), outside('task_e1'), outside('task_e2'), fresh('task_n1')] }, { releaseQueue: 2 }), ['task_n1']);
  const draftDeferred = task({ id: 'task_p1', waitsOn: ['user_ana'], deferredUntil: '2026-11-05T00:00:00Z', change: change() });
  assert.deepEqual(started({ tasks: [atGates('task_o1'), draftDeferred, fresh('task_n1')] }, { releaseQueue: 2 }), []);
});

test('decisions do not hold implementation: any number of choices waiting on a person', () => {
  const decisions = Array.from({ length: 50 }, (_, i) => { return task({ id: `task_d${i}`, waitsOn: ['user_ana'] }) });
  assert.deepEqual(started({ tasks: [...decisions, atGates('task_o1'), atGates('task_o2'), fresh('task_n1'), fresh('task_n2')] }), ['task_n1', 'task_n2']);
});

test('the limit holds only new work: very_high, a high bug, rounds and checks go on', () => {
  const full = [0, 1, 2, 3].map((i) => { return atGates(`task_o${i}`) });
  const urgent = fresh('task_n1', { priority: 'very_high' });
  const bug = fresh('task_n2', { priority: 'high', tags: ['bug'] });
  const round = task({ id: 'task_r1', status: 'active', change: change({ url: 'https://github.com/o/r/pull/r1', checks: 'red', verdict: null }) });
  const acted = plan({ now, params: { ...params, maxRuns: 4, releaseQueue: 4 }, tasks: [...full, urgent, bug, round, fresh('task_n3')] });
  assert.deepEqual(acted.filter((a) => { return a.act === 'start_child' }).map((a) => { return a.tasks[0] }).sort(), ['task_n1', 'task_n2', 'task_r1']);
});

test('from Max runs 2 up, new work never takes the last free slot; what ages faster does', () => {
  const report = plan({ now, params, tasks: [fresh('task_n1'), fresh('task_n2')] }).at(-1);
  assert.deepEqual(started({ tasks: [fresh('task_n1'), fresh('task_n2')] }, { maxRuns: 2 }), ['task_n1']);
  assert.equal(report.freeReason, 'kept for what ages faster');
  assert.deepEqual(report.skipped, [{ task: 'task_n2', reason: 'the last free slot is kept for what ages faster' }]);
  const conflict = task({ id: 'task_c', change: change({ conflict: true }) });
  const both = plan({ now, params, tasks: [fresh('task_n1'), conflict] }).filter((a) => { return a.act === 'start_child' });
  assert.deepEqual(both.map((a) => { return a.tasks[0] }), ['task_c']);
  const urgent = plan({ now, params, tasks: [fresh('task_n1'), fresh('task_n2', { priority: 'very_high' })] }).filter((a) => { return a.act === 'start_child' });
  assert.deepEqual(urgent.map((a) => { return a.tasks[0] }), ['task_n2']);
});

test('with Max runs 1 there is no slot to keep: new work takes the only one', () => {
  assert.deepEqual(started({ tasks: [fresh('task_n1')] }, { maxRuns: 1 }), ['task_n1']);
});

test('an inherited very_high or high on a bug is as urgent as an asserted one', () => {
  const full = [0, 1].map((i) => { return atGates(`task_o${i}`) });
  const blocker = fresh('task_n1', { inherited: 'very_high' });
  const bugBlocker = fresh('task_n2', { tags: ['bug'], inherited: 'high' });
  const plain = fresh('task_n3', { inherited: 'high' });
  const acted = plan({ now, params: { ...params, maxRuns: 4, releaseQueue: 2 }, tasks: [...full, blocker, bugBlocker, plain] });
  assert.deepEqual(acted.filter((a) => { return a.act === 'start_child' }).map((a) => { return a.tasks[0] }), ['task_n1', 'task_n2']);
});

// A `blocks` edge gates until its source closes; once the source's change
// integrated and the source stays open (a release or a check later), the tick
// reports the target held only by it, and retracts the edge only when the
// standing decision delegates that.
const source = (over = {}) => {
  return task({ id: 'task_src', status: 'blocked', leaves: 'release', change: change({ merged: true, writtenSince: true }), ...over });
};
const target = (over = {}) => { return task({ id: 'task_tgt', status: 'active', change: null, blockedBy: ['task_src'], ...over }) };
const decided = { ...params, retargetByAgent: false };

test('a source whose change has not integrated is no finding: the edge holds what it should', () => {
  const out = plan({ now, params: decided, tasks: [source({ status: 'waiting', change: change() }), target()] });
  assert.deepEqual(out.at(-1).heldByIntegrated, []);
  assert.equal(out.filter((a) => { return a.about === 'integrated_blockers' || a.act === 'retarget_blocks' }).length, 0);
  assert.doesNotMatch(out.at(-1).line, /held by integrated/);
});

test('a target held only by an integrated, open source is reported, never written', () => {
  const out = plan({ now, params: decided, tasks: [source(), target()] });
  const report = out.at(-1);
  assert.deepEqual(report.heldByIntegrated, [{ task: 'task_tgt', sources: [{ task: 'task_src', url: 'https://github.com/o/r/pull/1' }] }]);
  assert.match(report.line, /held by integrated blockers: 1$/);
  assert.equal(out.filter((a) => { return a.act === 'retarget_blocks' }).length, 0);
});

test('a second source not yet integrated, or one the snapshot cannot name, keeps it from being a finding', () => {
  const other = task({ id: 'task_src2', status: 'waiting', change: change({ url: 'https://github.com/o/r/pull/2' }) });
  assert.deepEqual(plan({ now, params: decided, tasks: [source(), other, target({ blockedBy: ['task_src', 'task_src2'] })] }).at(-1).heldByIntegrated, []);
  assert.deepEqual(plan({ now, params: decided, tasks: [source(), target({ blockedBy: ['task_src', null] })] }).at(-1).heldByIntegrated, []);
  assert.deepEqual(plan({ now, params: decided, tasks: [target()] }).at(-1).heldByIntegrated, []);
});

test('whether the standing decision delegates the retraction is a judge until answered', () => {
  const out = plan({ now, params: { ...params, retargetByAgent: null }, tasks: [source(), target()] });
  assert.deepEqual(out.filter((a) => { return a.act === 'judge' }).map((a) => { return [a.about, a.tasks] }), [['integrated_blockers', ['task_tgt']]]);
});

test('with the standing decision delegating it, the tick retracts each edge and records mentions', () => {
  const out = plan({ now, params: { ...params, retargetByAgent: true }, tasks: [source(), target()] });
  assert.deepEqual(out.filter((a) => { return a.act === 'retarget_blocks' }).map((a) => { return [a.task, a.from, a.url] }), [['task_tgt', 'task_src', 'https://github.com/o/r/pull/1']]);
  assert.deepEqual(out.at(-1).heldByIntegrated, []);
});

test("children sharing the tick's push branch: one starts per repo, the next is skipped with that reason", () => {
  const inRepo = (id, repos) => { return task({ id, status: 'active', candidate: true, leaves: null, rank: Number(id.slice(-1)), repos }) };
  const capped = { ...params, maxRuns: 3, branchesPerRepo: 1 };
  const out = plan({ now, params: capped, tasks: [inRepo('task_n1', ['o/r']), inRepo('task_n2', ['o/r'])] });
  assert.deepEqual(out.filter((a) => { return a.act === 'start_child' }).map((a) => { return a.tasks[0] }), ['task_n1']);
  const report = out.at(-1);
  assert.deepEqual(report.skipped, [{ task: 'task_n2', reason: "the repo's push branch is taken this tick" }]);
  assert.equal(report.freeReason, "the repo's push branch is taken this tick");
  const apart = plan({ now, params: capped, tasks: [inRepo('task_n1', ['o/r']), inRepo('task_n2', ['o/s'])] });
  assert.deepEqual(apart.filter((a) => { return a.act === 'start_child' }).map((a) => { return a.tasks[0] }), ['task_n1', 'task_n2']);
  const sessions = plan({ now, params: { ...capped, branchesPerRepo: null }, tasks: [inRepo('task_n1', ['o/r']), inRepo('task_n2', ['o/r'])] });
  assert.deepEqual(sessions.filter((a) => { return a.act === 'start_child' }).map((a) => { return a.tasks[0] }), ['task_n1', 'task_n2']);
});

test('under a branch cap, a round takes its change repo, a review pushes nothing, and unknown repos are a judge', () => {
  const capped = { ...params, maxRuns: 3, branchesPerRepo: 1 };
  const round = task({ id: 'task_r1', status: 'active', change: change({ checks: 'red', verdict: null }) });
  const review = task({ id: 'task_v1', change: change({ url: 'https://github.com/o/r/pull/2', verdict: null }) });
  const fresh = task({ id: 'task_n1', status: 'active', candidate: true, leaves: null, rank: 5, repos: ['o/r'] });
  const out = plan({ now, params: capped, tasks: [round, review, fresh] });
  assert.deepEqual(out.filter((a) => { return a.act === 'start_child' }).map((a) => { return a.tasks[0] }).sort(), ['task_r1', 'task_v1']);
  assert.deepEqual(out.at(-1).skipped, [{ task: 'task_n1', reason: "the repo's push branch is taken this tick" }]);
  const unknown = plan({ now, params: capped, tasks: [task({ id: 'task_n2', status: 'active', candidate: true, leaves: null, repos: null })] });
  assert.deepEqual(unknown.filter((a) => { return a.act === 'judge' }).map((a) => { return a.about }), ['repos']);
});
