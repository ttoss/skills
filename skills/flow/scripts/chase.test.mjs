import assert from 'node:assert/strict';
import { test } from 'node:test';

import { digest, sections, SECTIONS } from './chase.mjs';

const now = '2026-11-02T12:00:00Z';
const members = [
  { user_id: 'user_pedro', email: 'pedro@example.com', role: 'admin', pending: false },
  { user_id: 'user_ana', email: 'ana@example.com', role: 'member', pending: false },
];
const wait = (over) => {
  return { readiness: { state: 'blocked:external', blocked_by: [{ via: 'wait', kind: 'external', reason: 'r', until: null, on: null, ...over }] } };
};
const task = (id, over = {}) => {
  return { id, title: id, url: `https://flow/app/tasks/${id}`, status: 'waiting', kind: 'commitment', unblocks: 0, updated_at: '2026-10-01T00:00:00Z', review_due_at: '2026-10-20T00:00:00Z', assignee: null, ...over };
};
const empty = {
  now, project: 'proj_x', members, bugs: [], runningRuns: [], waits: [], dateCame: [], decisions: [],
  staleRuns: [], staleTasks: {}, findings: [], findingTasks: {}, reviews: { tasks: [], total: 0 }, host: null, staleAfterHours: 4,
};

test('a bug only agents hold on time is counted, not listed; any other is a line naming what holds it', () => {
  const out = sections({
    ...empty,
    bugs: [task('bug_a', { status: 'active', readiness: { blocked_by: [] } }), task('bug_b', { status: 'active', readiness: { blocked_by: [] } })],
    runningRuns: [{ agent: 'flow child', started_at: '2026-11-02T11:00:00Z', works_on: ['bug_a'], by: 'user_pedro', url: 'u' }],
  }).sections;
  assert.equal(out['Critical bugs'].note, '1 with agents, on time');
  assert.deepEqual(out['Critical bugs'].items.map((i) => { return [i.id, i.what, i.who]; }), [['bug_b', 'ready, nobody took it', 'pedro@example.com']]);
});

test('each task appears once, in the first section that takes it', () => {
  const both = task('t1', { kind: 'commitment', ...wait({ until: '2026-10-30T00:00:00Z', on: 'user_ana' }) });
  const out = sections({ ...empty, bugs: [both], waits: [both], reviews: { tasks: [both], total: 1 } }).sections;
  assert.equal(out['Critical bugs'].items.length, 1);
  assert.equal(out['Overdue waits'].items.length, 0);
  assert.equal(out['Findings and due reviews'].items.length, 0);
});

test('external waits split into no owner, overdue checks (integrated or date came) and overdue waits, decisions left to their section', () => {
  const out = sections({
    ...empty,
    host: { integratedTasks: ['t_check'], waitingChanges: [] },
    waits: [
      task('t_none', wait({ until: '2026-10-30T00:00:00Z' })),
      task('t_check', wait({ until: '2026-10-31T00:00:00Z', on: 'user_ana' })),
      task('t_late', wait({ on: 'user_ana' })),
      task('t_future', wait({ until: '2026-11-09T00:00:00Z', on: 'user_ana' })),
      task('t_decision', { kind: 'decision', ...wait({ until: '2026-10-01T00:00:00Z', on: 'user_ana' }) }),
    ],
    dateCame: [task('t_came', { status: 'calendar' })],
  }).sections;
  assert.match(out['No owner'].items[0].what, /^name whom this waits on \(overdue 3d\)/);
  assert.equal(out['No owner'].items[0].who, 'pedro@example.com');
  // Oldest first when they hold as many tasks: t_came's review came due 10-20, t_check's wait 10-31.
  assert.deepEqual(out['Overdue checks'].items.map((i) => { return i.id; }), ['t_came', 't_check']);
  assert.deepEqual(out['Overdue waits'].items.map((i) => { return [i.id, i.what]; }), [['t_late', 'no chase date, untouched for a week: r']]);
});

test('a change waits on a person only when its task does; without the code host the section says so', () => {
  const t = task('t1', wait({ on: 'user_ana', until: '2026-11-09T00:00:00Z' }));
  const out = sections({ ...empty, waits: [t], host: { waitingChanges: [{ url: 'https://gh/pr/1', title: 'PR 1', task: 't1' }, { url: 'https://gh/pr/2', title: 'PR 2', task: 'nope' }] } }).sections;
  assert.deepEqual(out['Changes waiting to be integrated by a person'].items.map((i) => { return [i.url, i.who]; }), [['https://gh/pr/1', 'ana@example.com']]);
  assert.equal(sections(empty).sections['Changes waiting to be integrated by a person'].note, 'the code host was not read');
});

test('stale sessions are people’s runs only, each open task they hold; findings skip wait_without_on', () => {
  const out = sections({
    ...empty,
    staleRuns: [
      { agent: 'claude', by: 'user_ana', works_on: ['t1', 't2'], started_at: '2026-11-01T00:00:00Z', url: 'https://s' },
      { agent: 'flow child', by: 'user_ana', works_on: ['t3'], started_at: '2026-11-01T00:00:00Z', url: 'https://c' },
    ],
    staleTasks: { t1: task('t1', { status: 'active' }), t2: task('t2', { status: 'completed' }), t3: task('t3', { status: 'active' }) },
    findings: [{ check: 'wait_without_on', task: 't9' }, { check: 'calendar_without_date', task: 't4' }],
    findingTasks: { t4: task('t4', { assignee: 'user_ana' }) },
  }).sections;
  assert.deepEqual(out['Stale sessions'].items.map((i) => { return i.id; }), ['t1']);
  assert.deepEqual(out['Findings and due reviews'].items.map((i) => { return [i.id, i.who]; }), [['t4', 'ana@example.com']]);
});

test('the digest: alert to admins, a line per person, sections in order and capped, Critical bugs never left out', () => {
  const out = sections({ ...empty, decisions: [1, 2, 3].map((n) => { return task(`d${n}`, { kind: 'decision', unblocks: n, ...wait({ on: 'user_ana' }) }); }) });
  const text = digest({ date: '2026-11-02', sections: out.sections, alert: 'The person queue grew.', admins: out.admins, health: ['h1'], base: ['b1'], size: 2 });
  const lines = text.split('\n');
  assert.equal(lines[0], '# Chase — 2026-11-02');
  assert.equal(lines[2], '**pedro@example.com**: The person queue grew.');
  assert.ok(lines.includes('- ana@example.com: 2 lines (Old decisions)'));
  assert.ok(text.indexOf('## Critical bugs\n- none') > 0);
  assert.ok(text.indexOf('## Changes waiting to be integrated by a person\n- the code host was not read') > 0);
  // Holding the most tasks first, capped at the size, the rest counted.
  assert.match(text, /## Old decisions\n- \[d3\][^\n]*\n- \[d2\][^\n]*\n- and 1 more/);
  assert.ok(!text.includes('## Stale sessions'));
  assert.ok(text.endsWith('## Health\n- b1\n- h1'));
  assert.equal(SECTIONS.length, 8);
});
