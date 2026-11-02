import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The flow's health lines the Chase and the Audit report: a pure function from
// Flow's answers, verbatim, to the lines. It calls nothing; the model makes the
// reads, saves each answer to a file and runs this, so every window, label,
// order and edge case is decided here once instead of in prose.
//
// The labels follow the console's health view (TriangulosTecnologia/flow,
// packages/app/src/lib/flowStages.ts): a stage is a word beside Flow's own row,
// never a value of Flow's vocabulary, and no two rows are ever added together.
//
// Usage:
//   node health.mjs windows <now>
//   node health.mjs chase --this <metrics> --before <metrics> --bug-this <metrics> --bug-before <metrics>
//   node health.mjs audit --this <metrics> --before <metrics> --runs-this <runs> --runs-before <runs> --inbox <captures>
// where each file is one tool answer as Flow returned it: `get-project-metrics`,
// `list-agent-runs` with `group_by: outcome` and `limit: 0`, `list-captures`
// with `triaged: false` and `limit: 1`. Output: JSON `{ alert, lines, mismatches }`.

const DAY = 86_400_000;

/** The two windows every health read uses: the 7 days ending now, and the 7 before. */
export const windows = (now) => {
  const until = Date.parse(now);
  if (Number.isNaN(until)) {
    throw new Error(`not a date: ${now}`);
  }
  const iso = (ms) => {
    return new Date(ms).toISOString();
  };
  return {
    thisWeek: { since: iso(until - 7 * DAY), until: iso(until) },
    weekBefore: { since: iso(until - 14 * DAY), until: iso(until - 7 * DAY) },
  };
};

const keyOf = (row) => {
  return 'state' in row && row.state !== undefined ? `${row.status}|${row.state}|${Boolean(row.on)}` : row.status;
};

/** The stage a row reads as, in the console's order, or null. */
export const stageOf = (row) => {
  if (row.status === 'incubated') {
    return 'incubated';
  }
  if (row.on) {
    return 'a person';
  }
  if (row.status === 'waiting' && row.state === 'blocked:external') {
    return 'the gates';
  }
  if (row.status === 'active' && row.state === 'ready') {
    return 'ready';
  }
  if (row.status === 'blocked') {
    return 'a release';
  }
  if (row.status === 'calendar') {
    return 'the check';
  }
  return null;
};

/** A row as Flow names it, with its stage in front where one reads it. */
export const nameOf = (row) => {
  if (!('state' in row) || row.state === undefined) {
    return row.status;
  }
  const flow = `${row.status} · ${row.state}${row.on ? ' · on' : ''}`;
  const stage = stageOf(row);
  return stage ? `${stage} (${flow})` : flow;
};

const days = (value) => {
  return value === null || value === undefined ? 'no data' : `${value}d`;
};

const directionOf = (row) => {
  if (!row) {
    return null;
  }
  if (row.entered > row.left) {
    return 'growing';
  }
  return row.entered < row.left ? 'shrinking' : 'steady';
};

// Both weeks' rows by key, in the order Flow answered them, this week's first.
const pair = ({ now, before }) => {
  const rows = new Map();
  (now.states || []).forEach((row, index) => {
    rows.set(keyOf(row), { key: row, now: row, before: null, index });
  });
  (before.states || []).forEach((row, index) => {
    const found = rows.get(keyOf(row));
    if (found) {
      found.before = row;
    } else {
      rows.set(keyOf(row), { key: row, now: null, before: row, index: 1000 + index });
    }
  });
  return [...rows.values()];
};

const active = (row) => {
  return Boolean(row) && (row.open > 0 || row.entered > 0 || row.left > 0);
};

const growingBoth = (pairRow) => {
  return directionOf(pairRow.now) === 'growing' && directionOf(pairRow.before) === 'growing';
};

// Most open first; a row this week lacks after every row it has; then Flow's order.
const byOpen = (a, b) => {
  const openA = a.now ? a.now.open : -1;
  const openB = b.now ? b.now.open : -1;
  return openB - openA || a.index - b.index;
};

/** One queue line: this week, the week before, this week's direction and days. */
export const queueLine = (pairRow) => {
  const { now, before } = pairRow;
  const name = nameOf(pairRow.key);
  const was = before ? `${before.entered} in, ${before.left} out the week before` : 'no row the week before';
  if (!now) {
    return `${name}: no row this week (${was})`;
  }
  return `${name}: ${now.open} open · ${now.entered} in, ${now.left} out (${was}) · ${directionOf(now)} · p90 ${days(now.open_days?.p90)} · p50 left ${days(now.left_days?.p50)}`;
};

const movesBy = ({ now, before, pick }) => {
  const rows = new Map();
  const id = (move) => {
    return `${keyOf(move.from)}>${keyOf(move.to)}`;
  };
  (now.moves || []).filter(pick).forEach((move) => {
    rows.set(id(move), { from: move.from, to: move.to, now: move.count, before: 0 });
  });
  (before.moves || []).filter(pick).forEach((move) => {
    const found = rows.get(id(move));
    if (found) {
      found.before = move.count;
    } else {
      rows.set(id(move), { from: move.from, to: move.to, now: 0, before: move.count });
    }
  });
  return [...rows.values()];
};

const isReady = (end) => {
  return end.status === 'active' && end.state === 'ready';
};

const completedLine = ({ label, now, before }) => {
  const one = (m) => {
    return `${m.completed.count} completed · p50 ${days(m.completed.days?.p50)} · p90 ${days(m.completed.days?.p90)}`;
  };
  return `${label}: ${one(now)} (${one(before)} the week before)`;
};

/**
 * The rows where open at the end of this week is not open at the end of the
 * week before plus this week's entered minus left. Flow's answers always hold
 * it over two adjacent windows, so a mismatch means the windows were not
 * adjacent or an answer was not copied verbatim: read them again.
 */
export const mismatches = ({ now, before }) => {
  return pair({ now, before })
    .filter((r) => { return r.now; })
    .filter((r) => { return (r.before ? r.before.open : 0) + r.now.entered - r.now.left !== r.now.open; })
    .map((r) => { return nameOf(r.key); });
};

/** The Chase's health lines and, when a person's row grew both weeks, the alert. */
export const chase = ({ thisWeek, weekBefore, bugThisWeek, bugWeekBefore }) => {
  const rows = pair({ now: thisWeek, before: weekBefore }).filter((r) => {
    return r.key.status !== 'incubated';
  });
  const person = rows.filter((r) => {
    return r.key.on && (active(r.now) || active(r.before));
  });
  const others = rows.filter((r) => {
    return !r.key.on && growingBoth(r);
  });
  const shown = [...person.sort(byOpen), ...others.sort(byOpen)];
  const lines = shown.map(queueLine);
  const left = rows.length - shown.length;
  if (left > 0) {
    lines.push(`${left} other ${left === 1 ? 'state has' : 'states have'} no line: none holds a person's answer or grew in both weeks`);
  }

  const growingPerson = person.filter(growingBoth);
  const alert = growingPerson.length
    ? `The person queue grew in both weeks: ${growingPerson.map((r) => { return nameOf(r.key); }).join('; ')}. Work only somebody's answer frees entered it more than it left, and more agents or tasks will not help. The lines per person below name whom each wait is on.`
    : null;

  lines.push(completedLine({ label: 'Delivery', now: thisWeek, before: weekBefore }));

  const fromCheck = movesBy({
    now: thisWeek,
    before: weekBefore,
    pick: (m) => { return m.from.status === 'calendar' && isReady(m.to); },
  });
  lines.push(
    ...(fromCheck.length
      ? fromCheck.map((m) => { return `Back from the check, ${nameOf(m.from)} → ready: ${m.now} (${m.before} the week before)`; })
      : ['Back from the check: none in either week']),
  );

  const fromNobody = movesBy({
    now: thisWeek,
    before: weekBefore,
    pick: (m) => { return m.from.status === 'waiting' && m.from.state === 'blocked:external' && !m.from.on && isReady(m.to); },
  });
  lines.push(
    ...(fromNobody.length
      ? fromNobody.map((m) => { return `Back from a wait on nobody (the gates in most projects, not counted as rework) → ready: ${m.now} (${m.before} the week before)`; })
      : ['Back from a wait on nobody: none in either week']),
  );

  const bugs = pair({ now: bugThisWeek, before: bugWeekBefore }).filter((r) => {
    return r.key.status !== 'incubated' && r.key.on && (active(r.now) || active(r.before));
  });
  lines.push(...bugs.sort(byOpen).map((r) => { return `Bugs, ${queueLine(r)}`; }));
  lines.push(
    `Bugs completed: ${bugThisWeek.completed.count} of ${thisWeek.completed.count} (${bugWeekBefore.completed.count} of ${weekBefore.completed.count} the week before)`,
  );

  return {
    alert,
    lines,
    mismatches: [
      ...mismatches({ now: thisWeek, before: weekBefore }),
      ...mismatches({ now: bugThisWeek, before: bugWeekBefore }).map((n) => { return `bug: ${n}`; }),
    ],
  };
};

const OUTCOMES = [
  ['dropped', 'dropped (tasks closed without completing)'],
  ['open', 'open (tasks still open)'],
  ['completed', 'completed'],
  [null, 'no task'],
];

const TOKENS = [
  ['input_tokens', 'input'],
  ['output_tokens', 'output'],
  ['cache_read_tokens', 'cache reads'],
  ['cache_write_tokens', 'cache writes'],
];

/** One week of one spend group, as the answer gives it. */
export const spendOf = (totals) => {
  if (!totals) {
    return 'no group';
  }
  const runs = `${totals.runs} ${totals.runs === 1 ? 'run' : 'runs'}`;
  if (totals.unpriced < totals.runs && totals.cost_usd !== undefined) {
    const bound = totals.unpriced > 0 ? `at least $${totals.cost_usd.toFixed(2)} (${totals.unpriced} unpriced)` : `$${totals.cost_usd.toFixed(2)}`;
    return `${runs} · ${bound}`;
  }
  const tokens = TOKENS.filter(([field]) => { return totals[field] !== undefined; }).map(([field, label]) => {
    return `${totals[field].toLocaleString('en-US')} ${label}`;
  });
  return `${runs}, all unpriced · ${tokens.length ? tokens.join(', ') : 'no tokens reported'}`;
};

/** The Audit's lines on what feeds and drains the graph. */
export const audit = ({ thisWeek, weekBefore, runsThisWeek, runsWeekBefore, inbox }) => {
  const lines = [];
  const groupOf = (answer, key) => {
    return (answer.groups || []).find((g) => { return g.key === key; })?.totals;
  };
  for (const [key, label] of OUTCOMES) {
    lines.push(`Spend, ${label}: ${spendOf(groupOf(runsThisWeek, key))} (${spendOf(groupOf(runsWeekBefore, key))} the week before)`);
  }
  lines.push(`Spend, every run: ${spendOf(runsThisWeek.totals)} (${spendOf(runsWeekBefore.totals)} the week before); a run on tasks with different outcomes counts in each group, so the groups do not add up to it`);

  const incubated = pair({ now: thisWeek, before: weekBefore }).filter((r) => {
    return r.key.status === 'incubated' && (active(r.now) || active(r.before));
  });
  lines.push(...incubated.sort(byOpen).map(queueLine));
  const exits = movesBy({
    now: thisWeek,
    before: weekBefore,
    pick: (m) => { return m.from.status === 'incubated' && m.to.status !== 'incubated'; },
  });
  lines.push(
    ...(exits.length
      ? exits.map((m) => { return `Out of ${nameOf(m.from)} → ${nameOf(m.to)}: ${m.now} (${m.before} the week before)`; })
      : ['Out of incubated: none in either week']),
  );
  const piling = incubated.filter(growingBoth);
  if (piling.length) {
    lines.push(`${piling.map((r) => { return nameOf(r.key); }).join('; ')} took in more than it let out in both weeks: ideas written down and not looked at again, which the weekly review is for`);
  }

  const oldest = (inbox.captures || [])[0];
  lines.push(
    inbox.total
      ? `Untriaged inbox, now (the account's, across every project): ${inbox.total} captures, the oldest ${(oldest.inbox_age_ms / DAY).toFixed(1)}d old`
      : 'Untriaged inbox, now (the account\'s, across every project): empty',
  );
  return { alert: null, lines, mismatches: mismatches({ now: thisWeek, before: weekBefore }) };
};

const flags = (args) => {
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith('--') || args[i + 1] === undefined) {
      throw new Error(`expected --name <file>, got ${args[i]}`);
    }
    out[args[i].slice(2)] = JSON.parse(readFileSync(args[i + 1], 'utf8'));
  }
  return out;
};

const need = (got, names) => {
  const missing = names.filter((n) => { return !(n in got); });
  if (missing.length) {
    throw new Error(`missing ${missing.map((n) => { return `--${n}`; }).join(', ')}`);
  }
};

// Resolved on both sides, as plan.mjs does, for a skill installed through a symlink.
const isMain = process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain) {
  const [mode, ...rest] = process.argv.slice(2);
  let result;
  if (mode === 'windows') {
    result = windows(rest[0]);
  } else if (mode === 'chase') {
    const f = flags(rest);
    need(f, ['this', 'before', 'bug-this', 'bug-before']);
    result = chase({ thisWeek: f.this, weekBefore: f.before, bugThisWeek: f['bug-this'], bugWeekBefore: f['bug-before'] });
  } else if (mode === 'audit') {
    const f = flags(rest);
    need(f, ['this', 'before', 'runs-this', 'runs-before', 'inbox']);
    result = audit({ thisWeek: f.this, weekBefore: f.before, runsThisWeek: f['runs-this'], runsWeekBefore: f['runs-before'], inbox: f.inbox });
  } else {
    throw new Error('usage: health.mjs windows <now> | chase … | audit …');
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
