import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { audit, chase, mismatches, nameOf, spendOf, windows } from './health.mjs';

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

const digest = chase({ thisWeek, weekBefore: before, bugThisWeek: bugThis, bugWeekBefore: bugBefore });

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
  assert.match(digest.lines[3], /^a release \(blocked · blocked:dependency\): 9 open/);
  // ready, the gates and active · waiting:scheduled (last week only) have no line; incubated is the Audit's.
  assert.equal(digest.lines[4], '3 other states have no line: none holds a person\'s answer or grew in both weeks');
});

test('a person row growing in both weeks raises the alert, which never calls it decisions', () => {
  assert.match(digest.alert, /^The person queue grew in both weeks: a person \(waiting · blocked:external · on\)\./);
  assert.match(digest.alert, /entered it more than it left/);
  assert.doesNotMatch(digest.alert, /decision|answered/);
});

test('no alert when no person row grew in both weeks', () => {
  const calm = chase({ thisWeek: { ...thisWeek, states: thisWeek.states.filter((r) => { return !r.on; }) }, weekBefore: before, bugThisWeek: bugThis, bugWeekBefore: bugBefore });
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

test('spend: cost where priced, a lower bound when partly unpriced, tokens or nothing when all unpriced, and a missing group', () => {
  assert.equal(spendOf({ runs: 12, unpriced: 10, cost_usd: 19.9987 }), '12 runs · at least $20.00 (10 unpriced)');
  assert.equal(spendOf({ runs: 3, unpriced: 0, cost_usd: 1.5 }), '3 runs · $1.50');
  assert.equal(spendOf({ runs: 274, unpriced: 274, input_tokens: 4441646, output_tokens: 295500 }), '274 runs, all unpriced · 4,441,646 input, 295,500 output');
  assert.equal(spendOf({ runs: 2, unpriced: 2 }), '2 runs, all unpriced · no tokens reported');
  assert.equal(spendOf(undefined), 'no group');
});

test('audit: groups in order, incubated rows and exits named with `on`, passes inside incubated left out, the inbox now only', () => {
  const { lines, mismatches: off } = audit({
    thisWeek,
    weekBefore: before,
    runsThisWeek: { totals: { runs: 783, unpriced: 783, input_tokens: 22112377, output_tokens: 1388000 }, groups: [{ key: 'dropped', totals: { runs: 2, unpriced: 2 } }, { key: null, totals: { runs: 232, unpriced: 232, input_tokens: 8490000, output_tokens: 550000 } }] },
    runsWeekBefore: { totals: { runs: 342, unpriced: 319, cost_usd: 159.869 }, groups: [{ key: 'dropped', totals: { runs: 12, unpriced: 10, cost_usd: 19.9987 } }] },
    inbox: { captures: [{ inbox_age_ms: 3947732332 }], total: 60 },
  });
  assert.equal(lines[0], 'Spend, dropped (tasks closed without completing): 2 runs, all unpriced · no tokens reported (12 runs · at least $20.00 (10 unpriced) the week before)');
  assert.equal(lines[1], 'Spend, open (tasks still open): no group (no group the week before)');
  assert.match(lines[3], /^Spend, no task: 232 runs, all unpriced · 8,490,000 input, 550,000 output \(no group the week before\)$/);
  assert.match(lines[4], /^Spend, every run: 783 runs, all unpriced/);
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
  const out = JSON.parse(execFileSync('node', [script, 'chase', '--this', file('t', thisWeek), '--before', file('b', before), '--bug-this', file('bt', bugThis), '--bug-before', file('bb', bugBefore)], { encoding: 'utf8' }));
  assert.deepEqual(out, digest);
  assert.deepEqual(JSON.parse(execFileSync('node', [script, 'windows', '2026-11-02T17:00:00Z'], { encoding: 'utf8' })), windows('2026-11-02T17:00:00Z'));
  assert.throws(() => { return execFileSync('node', [script, 'chase', '--this', file('t2', thisWeek)], { stdio: 'pipe' }); });
});
