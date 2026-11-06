import assert from 'node:assert/strict';
import { test } from 'node:test';

import { digest, pick, run } from './chase.mjs';

const members = [
  { user_id: 'user_pedro', email: 'pedro@example.com', role: 'admin', pending: false },
  { user_id: 'user_ana', email: 'ana@example.com', role: 'member', pending: false },
];
const open = { url: 'https://gh/pr/1', merged: false, closed: false, draft: false };
const merged = { url: 'https://gh/pr/2', merged: true, closed: false, draft: false };
const t = (id, over = {}) => {
  return { id, priority: null, tags: [], waitsOn: [], change: open, ...over };
};
const detail = (id, reason, over = {}) => {
  return { task: { title: `title ${id}`, url: `https://flow/app/tasks/${id}` }, unblocks: 0, readiness: { blocked_by: [{ via: 'wait', on: 'user_pedro', reason, until: null }] }, ...over };
};

test('only what waits on a person is listed: a change at its gates or the agents is left to them, and so is what is not in the queue', () => {
  const out = pick({
    tasks: [
      t('t_person', { waitsOn: ['user_pedro'] }),
      t('t_gates'),
      t('t_draft', { waitsOn: ['user_pedro'], change: { ...open, draft: true } }),
      t('t_merged_agents', { change: merged }),
      t('t_no_change', { waitsOn: ['user_pedro'], change: null }),
    ],
    details: { t_person: detail('t_person', 'merge it') },
    members,
  });
  assert.deepEqual(out.queue, { now: 2, limit: 20 });
  assert.deepEqual(out.person.map((i) => { return [i.id, i.who, i.what]; }), [['t_person', 'pedro@example.com', 'merge it']]);
});

test('the order is the tick’s: very_high, then a high bug, then open changes before integrated ones, then priority, then what it frees', () => {
  const tasks = [
    t('integrated', { waitsOn: ['user_ana'], change: merged, priority: 'high' }),
    t('open_low', { waitsOn: ['user_ana'], priority: 'low' }),
    t('open_frees', { waitsOn: ['user_ana'], priority: 'low' }),
    t('high_bug', { waitsOn: ['user_ana'], tags: ['bug'], priority: 'high', change: merged }),
    t('very_high', { waitsOn: ['user_ana'], priority: 'very_high', change: merged }),
    t('open_medium', { waitsOn: ['user_ana'], priority: 'medium' }),
  ];
  const details = Object.fromEntries(tasks.map((x) => { return [x.id, detail(x.id, 'r', { unblocks: x.id === 'open_frees' ? 3 : 0 })]; }));
  const out = pick({ tasks, details, members });
  assert.deepEqual(out.person.map((i) => { return i.id; }), ['very_high', 'high_bug', 'open_medium', 'open_frees', 'open_low', 'integrated']);
});

test('each list holds as many lines as the limit; over it no decision is sent, within it the decisions follow', () => {
  const tasks = Array.from({ length: 25 }, (_, i) => { return t(`t${i}`, { waitsOn: ['user_pedro'] }); });
  const decisions = Array.from({ length: 14 }, (_, i) => {
    return { id: `d${i}`, title: `decide ${i}`, url: `u${i}`, readiness: { blocked_by: [{ via: 'wait', on: 'user_ana', reason: 'pick one' }] } };
  });
  const over = pick({ tasks, decisions, limit: 10, members });
  assert.equal(over.person.length, 10);
  assert.equal(over.personTotal, 25);
  assert.equal(over.decisions, null);
  const within = pick({ tasks: tasks.slice(0, 12), decisions, limit: 12, members });
  assert.deepEqual([within.person.length, within.decisions.length, within.decisionsTotal], [12, 12, 14]);
  assert.deepEqual(within.decisions[0], { id: 'd0', title: 'decide 0', url: 'u0', who: 'ana@example.com', what: 'pick one' });
});

test('the digest says where the queue stands and shows the decisions section only within the limit', () => {
  const over = digest({ date: '2026-11-05', picked: pick({ tasks: [t('a', { waitsOn: ['user_pedro'] }), t('b')], details: { a: detail('a', 'merge it') }, limit: 1, members }) });
  assert.match(over, /Release queue: 2, limit 1\. The tick starts no new work/);
  assert.match(over, /## Only a person can move these \(1 of 1\)\n- \[title a\]\(https:\/\/flow\/app\/tasks\/a\) — pedro@example\.com — merge it/);
  assert.doesNotMatch(over, /Decisions/);
  const within = digest({ date: '2026-11-05', picked: pick({ tasks: [], limit: 10, members }) });
  assert.match(within, /## Only a person can move these \(0 of 0\)\n- none/);
  assert.match(within, /## Decisions the team owes \(0 of 0\)\n- none/);
});

test('run reads the tick’s snapshot and asks for decisions only within the limit', async () => {
  const asked = [];
  const pr = (id) => { return { id, status: 'waiting', priority: null, tags: [], readiness: { blocked_by: [{ via: 'wait', kind: 'external', on: 'user_pedro', reason: 'merge it' }] } }; };
  const get = async (path, query = {}) => {
    asked.push([path, query]);
    if (path === '/projects/proj_x') {
      return { members };
    }
    if (path === '/next') {
      return query.kind === 'decision' ? { tasks: [] } : { tasks: [], counts: {} };
    }
    if (path === '/agent-runs') {
      return { runs: [] };
    }
    return { task: { title: path, url: path, status: 'waiting' }, unblocks: 0, readiness: pr('x').readiness, references: [{ url: 'https://gh/pr/9', role: 'implements' }] };
  };
  const all = async () => { return [pr('t_pr')]; };
  const extra = { params: { releaseQueue: 5 }, tasks: { t_pr: { change: { url: 'https://gh/pr/9', merged: false, closed: false, draft: false } } } };
  const out = await run({ client: { get, all }, project: 'proj_x', now: '2026-11-05T12:00:00Z', extra });
  assert.deepEqual([out.queue, out.person, out.decisions], [{ now: 1, limit: 5 }, 1, 0]);
  assert.ok(asked.some(([path, q]) => { return path === '/next' && q.kind === 'decision'; }));
  const over = await run({ client: { get, all }, project: 'proj_x', now: '2026-11-05T12:00:00Z', extra: { ...extra, params: { releaseQueue: 0 } } });
  assert.equal(over.decisions, null);
});
