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
// Usage, reading Flow itself with the API key in FLOW_API_KEY (and FLOW_URL,
// default https://flow.ttoss.dev), so no answer passes through the model:
//   node health.mjs chase --project <proj_…> [--now <ISO 8601>]
//   node health.mjs audit --project <proj_…> [--now <ISO 8601>]
// or, with no key, from answers the model saved verbatim, one file each:
//   node health.mjs windows <ISO 8601>
//   node health.mjs chase --this <metrics> --before <metrics> --bug-this <metrics> --bug-before <metrics>
//   node health.mjs audit --this <metrics> --before <metrics> --runs-this <runs> --runs-before <runs> --inbox <captures>
// where each file is one tool answer: `get-project-metrics`, `list-agent-runs`
// with `group_by: outcome` and `limit: 0`, `list-captures` with `triaged: false`
// and `limit: 1`. Output: JSON `{ alert, lines, mismatches }`.

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

const priced = (totals) => {
  return Boolean(totals) && totals.unpriced < totals.runs && totals.cost_usd !== undefined;
};

/**
 * One spend group, both weeks, in one unit: cost when both weeks have priced
 * runs, else tokens for both, so a reader never sets dollars beside tokens.
 * A token count a week did not report is said, never taken as 0.
 */
export const spendPair = ({ now, before }) => {
  if (priced(now) && priced(before)) {
    return `${spendOf(now)} (${spendOf(before)} the week before)`;
  }
  const fields = TOKENS.filter(([field]) => {
    return (now && now[field] !== undefined) || (before && before[field] !== undefined);
  });
  const tokens = (totals) => {
    if (!totals) {
      return 'no group';
    }
    const runs = `${totals.runs} ${totals.runs === 1 ? 'run' : 'runs'}`;
    if (!fields.length) {
      return `${runs}, no tokens reported`;
    }
    return `${runs} · ${fields.map(([field, label]) => {
      return totals[field] === undefined ? `${label} not reported` : `${totals[field].toLocaleString('en-US')} ${label}`;
    }).join(', ')}`;
  };
  return `${tokens(now)} (${tokens(before)} the week before), in tokens because a week has no cost reported`;
};

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
    lines.push(`Spend, ${label}: ${spendPair({ now: groupOf(runsThisWeek, key), before: groupOf(runsWeekBefore, key) })}`);
  }
  lines.push(`Spend, every run: ${spendPair({ now: runsThisWeek.totals, before: runsWeekBefore.totals })}; a run on tasks with different outcomes counts in each group, so the groups do not add up to it`);

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
    inbox.unreadable
      ? `Untriaged inbox: not readable with this credential (${inbox.unreadable})`
      : inbox.total
      ? `Untriaged inbox, now (the account's, across every project): ${inbox.total} captures, the oldest ${(oldest.inbox_age_ms / DAY).toFixed(1)}d old`
      : 'Untriaged inbox, now (the account\'s, across every project): empty',
  );
  return { alert: null, lines, mismatches: mismatches({ now: thisWeek, before: weekBefore }) };
};

/**
 * Flow's answers for one routine, read with an API key. `fetchImpl` is the
 * global fetch unless a test passes another. Every read is a GET: the script
 * never writes, whatever the key may do.
 */
export const readFlow = async ({ routine, project, now, key, base = 'https://flow.ttoss.dev', fetchImpl = fetch }) => {
  const w = windows(now);
  const get = async (path, query) => {
    const url = new URL(`/api/v1${path}`, base);
    for (const [name, value] of Object.entries(query)) {
      url.searchParams.append(name, String(value));
    }
    const res = await fetchImpl(url, { headers: { authorization: `Bearer ${key}`, accept: 'application/json' } });
    if (!res.ok) {
      const error = new Error(`GET ${url.pathname} answered ${res.status}${res.status === 404 ? ': the key cannot reach it' : ''}`);
      error.status = res.status;
      throw error;
    }
    return res.json();
  };
  const metrics = (win, tag) => {
    return get(`/projects/${project}/metrics`, { since: win.since, until: win.until, ...(tag ? { tag } : {}) });
  };
  if (routine === 'chase') {
    const [thisWeek, weekBefore, bugThisWeek, bugWeekBefore] = await Promise.all([
      metrics(w.thisWeek), metrics(w.weekBefore), metrics(w.thisWeek, 'bug'), metrics(w.weekBefore, 'bug'),
    ]);
    return { thisWeek, weekBefore, bugThisWeek, bugWeekBefore };
  }
  const runs = (win) => {
    return get('/agent-runs', { project, since: win.since, until: win.until, group_by: 'outcome', limit: 0 });
  };
  const [thisWeek, weekBefore, runsThisWeek, runsWeekBefore] = await Promise.all([
    metrics(w.thisWeek), metrics(w.weekBefore), runs(w.thisWeek), runs(w.weekBefore),
  ]);
  // A key restricted to projects is never given the inbox, which is in no
  // project: Flow answers 404, and the line says so instead of failing.
  const inbox = await get('/captures', { triaged: false, limit: 1 }).catch((error) => {
    if (error.status === 404 || error.status === 403) {
      return { unreadable: 'a key restricted to projects is not given the inbox' };
    }
    throw error;
  });
  return { thisWeek, weekBefore, runsThisWeek, runsWeekBefore, inbox };
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

const run = async (argv, env) => {
  const [mode, ...rest] = argv;
  if (mode === 'windows') {
    return windows(rest[0]);
  }
  if (mode !== 'chase' && mode !== 'audit') {
    throw new Error('usage: health.mjs windows <now> | chase … | audit …');
  }
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i].startsWith('--') || rest[i + 1] === undefined) {
      throw new Error(`expected --name <value>, got ${rest[i]}`);
    }
    opts[rest[i].slice(2)] = rest[i + 1];
  }
  if (opts.project) {
    if (!env.FLOW_API_KEY) {
      throw new Error('--project reads Flow itself and needs FLOW_API_KEY');
    }
    const answers = await readFlow({
      routine: mode,
      project: opts.project,
      now: opts.now || new Date().toISOString(),
      key: env.FLOW_API_KEY,
      base: env.FLOW_URL || 'https://flow.ttoss.dev',
    });
    return mode === 'chase' ? chase(answers) : audit(answers);
  }
  const f = flags(rest);
  if (mode === 'chase') {
    need(f, ['this', 'before', 'bug-this', 'bug-before']);
    return chase({ thisWeek: f.this, weekBefore: f.before, bugThisWeek: f['bug-this'], bugWeekBefore: f['bug-before'] });
  }
  need(f, ['this', 'before', 'runs-this', 'runs-before', 'inbox']);
  return audit({ thisWeek: f.this, weekBefore: f.before, runsThisWeek: f['runs-this'], runsWeekBefore: f['runs-before'], inbox: f.inbox });
};

// Resolved on both sides, as plan.mjs does, for a skill installed through a symlink.
const isMain = process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain) {
  run(process.argv.slice(2), process.env).then(
    (result) => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); },
    (error) => { process.stderr.write(`${error.message}\n`); process.exit(1); },
  );
}
