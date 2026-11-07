import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createClient, DEFAULT_BASE } from './flow-api.mjs';
import { byTickOrder } from './chase.mjs';
import { load as loadParams } from './params.mjs';
import { inReleaseQueue } from './plan.mjs';
import { run as readSnapshot } from './snapshot.mjs';

// The lines the weekly Health reports, and the spend lines the Audit takes
// from here: pure functions from Flow's answers, verbatim, to the lines. They
// call nothing; the model makes the reads, saves each answer to a file and
// runs this, so every window, label, order and edge case is decided here once
// instead of in prose. `report` is the Health's whole run, reads included.
//
// The labels follow the console's health view (TriangulosTecnologia/flow,
// packages/app/src/lib/flowStages.ts): a stage is a word beside Flow's own row,
// never a value of Flow's vocabulary, and no two rows are ever added together.
//
// Usage, reading Flow itself with the API key in FLOW_API_KEY (and FLOW_URL,
// default https://flow.ttoss.dev), so no answer passes through the model:
//   node health.mjs report (--root <repo dir> | --project <proj_…>) [--now <ISO 8601>] [--inbox <captures>]
//   node health.mjs flow --project <proj_…> [--now <ISO 8601>]
//   node health.mjs feeds --project <proj_…> [--now <ISO 8601>] [--inbox <captures>]
//   node health.mjs spend --project <proj_…> [--now <ISO 8601>]
// or, with no key, from answers the model saved verbatim, one file each:
//   node health.mjs windows <ISO 8601>
//   node health.mjs flow --this <metrics> --before <metrics> --bug-this <metrics> --bug-before <metrics>
//   node health.mjs feeds --this <metrics> --before <metrics> --inbox <captures>
//   node health.mjs spend --runs-this <runs> --runs-before <runs>
//   node health.mjs queues --snapshot <snapshot> --decisions <get-next waiting> [--now <ISO 8601>]
// where each file is one tool answer: `get-project-metrics` (`group_by: on` for
// the flow's plain weeks, which adds a line per holder), `list-agent-runs`
// with `group_by: outcome` and `limit: 0`, `list-captures` with `triaged: false`
// and `limit: 1`. Output: JSON `{ alert, lines, mismatches }` for `flow`,
// `{ lines, mismatches }` for `feeds`, `{ lines }` for `spend`, and for
// `report` `{ alert, lines, mismatches, answers, drain }` (with `needs` when
// --root lets it read the tick's snapshot), `{ lines, drain }` for `queues`.

const DAY = 86_400_000;
const ANSWER_WEEKS = 4;

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

/**
 * Each holder's rows, this week beside the week before: whose answer the
 * person queue waits on, with arrivals against departures. One line per row,
 * never a holder's rows added together. A holder only one week has keeps a
 * line, so a queue that just emptied still shows what left it.
 */
export const holderLines = ({ thisWeek, weekBefore, nameOfHolder = (key) => { return key; } }) => {
  const groupsOf = (answer) => {
    return new Map((answer.groups || []).map((g) => { return [g.key, g]; }));
  };
  const now = groupsOf(thisWeek);
  const was = groupsOf(weekBefore);
  const keys = [...new Set([...now.keys(), ...was.keys()])].sort((a, b) => {
    return a === null ? 1 : b === null ? -1 : String(nameOfHolder(a)).localeCompare(String(nameOfHolder(b)));
  });
  return keys.flatMap((key) => {
    const label = key === null ? 'Waiting on nobody' : `Waiting on ${nameOfHolder(key)}`;
    return pair({ now: now.get(key) || { states: [] }, before: was.get(key) || { states: [] } })
      .filter((r) => { return active(r.now) || active(r.before); })
      .sort(byOpen)
      .map((r) => { return `${label}, ${queueLine(r)}`; });
  });
};

/** The flow's health lines and, when a person's row grew both weeks, the alert. */
export const flowHealth = ({ thisWeek, weekBefore, bugThisWeek, bugWeekBefore, nameOfHolder }) => {
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

  lines.push(...holderLines({ thisWeek, weekBefore, nameOfHolder }));

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
 * One spend group, both weeks, in one unit: cost when every week that has the
 * group has priced runs, else tokens for both, so a reader never sets dollars beside tokens.
 * A token count a week did not report is said, never taken as 0.
 */
export const spendPair = ({ now, before }) => {
  // A group missing in one week takes the other week's unit.
  if ((priced(now) || !now) && (priced(before) || !before) && (now || before)) {
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

/** The Audit's spend by what became of the runs' tasks, then in total. */
export const spend = ({ runsThisWeek, runsWeekBefore }) => {
  const lines = [];
  const groupOf = (answer, key) => {
    return (answer.groups || []).find((g) => { return g.key === key; })?.totals;
  };
  for (const [key, label] of OUTCOMES) {
    lines.push(`Spend, ${label}: ${spendPair({ now: groupOf(runsThisWeek, key), before: groupOf(runsWeekBefore, key) })}`);
  }
  lines.push(`Spend, every run: ${spendPair({ now: runsThisWeek.totals, before: runsWeekBefore.totals })}; a run on tasks with different outcomes counts in each group, so the groups do not add up to it`);
  return { lines };
};

/** The Health's lines on what feeds and drains the graph: incubated work and the inbox. */
export const feeds = ({ thisWeek, weekBefore, inbox }) => {
  const lines = [];
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
  return { lines, mismatches: mismatches({ now: thisWeek, before: weekBefore }) };
};

// When a decision was answered: the change that closed it, else its last write.
const answeredAt = (task) => {
  const closing = [...(task.changes || [])].reverse().find((c) => { return c.status && c.status.to === task.status; });
  return closing ? closing.at : task.updated_at;
};

/**
 * The decisions a person closed over the last ANSWER_WEEKS weeks, newest
 * first, each with its answer: what the model reads for an answer given more
 * than once to the same kind of choice (GTF-E9). Closed decisions only: a
 * one-task wait a person answered recurs as the same question raised again,
 * which GTF-N6 already makes a decision the second time. Pure over what
 * `get-task` answered.
 */
export const answers = ({ decisions, now }) => {
  const since = Date.parse(now) - ANSWER_WEEKS * 7 * DAY;
  return decisions
    .map((task) => { return { id: task.id, url: task.url, title: task.title, outcome: task.outcome ?? null, at: answeredAt(task) }; })
    .filter((a) => { return Date.parse(a.at) >= since; })
    .sort((a, b) => { return Date.parse(b.at) - Date.parse(a.at); });
};

/** The line beside the data: how many were answered this week and the week before. */
export const answersLine = ({ answers: list, now }) => {
  const w = windows(now);
  const within = (win) => { return list.filter((a) => { return a.at >= win.since && a.at < win.until; }).length; };
  return `Decisions a person answered: ${within(w.thisWeek)} this week (${within(w.weekBefore)} the week before), ${list.length} over the last ${ANSWER_WEEKS} weeks`;
};

const DEFAULT_RELEASE_QUEUE = 20;

const ageOf = (ms) => {
  return `${(ms / DAY).toFixed(1)}d`;
};

// What is left before a change leaves the release queue, from what the code
// host and its task say: the next act, never an estimate of its size.
const leftOf = (task) => {
  const { change } = task;
  if (change.merged) {
    return 'integrated; waits to be seen in effect';
  }
  if (change.conflict) {
    return 'a conflict to resolve';
  }
  if (change.checks === 'red') {
    return 'red checks to fix';
  }
  if (change.checks !== 'green') {
    return 'checks still running';
  }
  return change.verdict?.result === 'CLEAN' ? 'to integrate' : 'a review';
};

/**
 * The two queues only a person drains, read for what averages hide (W15) and
 * for what a full queue should give up (W7): the oldest item in each, with its
 * age and who acts, and, while the release queue is at its limit, the changes
 * at the bottom of the tick's order, as many as bring it below the limit. Age
 * names an item and never orders one. Pure over the tick's snapshot `tasks`,
 * the `waiting` rows `get-next` ranked (`decisions`) and `who`, which names
 * the holders a wait is `on`.
 */
export const queues = ({ tasks, decisions = [], limit = DEFAULT_RELEASE_QUEUE, now, who = (ids) => { return (ids || []).join(', '); } }) => {
  const at = Date.parse(now);
  const queued = tasks.filter(inReleaseQueue).map((t) => {
    const since = t.change.merged ? t.change.mergedAt : t.change.createdAt;
    return {
      task: t.id,
      url: t.change.url,
      title: t.change.title || t.change.url,
      age: since ? at - Date.parse(since) : null,
      from: t.change.merged ? 'integrated' : 'opened',
      who: (t.waitsOn || []).length ? who(t.waitsOn) : 'the agents',
      left: leftOf(t),
      order: t,
    };
  });
  const out = new Set(tasks.filter((t) => { return t.change; }).map((t) => { return t.id; }));
  // A decision's summary carries no time it started waiting, only its last
  // write, so its age is how long it has gone untouched.
  const owed = decisions.filter((row) => {
    return !out.has(row.id) && (row.readiness?.blocked_by || []).some((b) => { return b.via === 'wait' && b.on; });
  }).map((row) => {
    const wait = row.readiness.blocked_by.find((b) => { return b.via === 'wait' && b.on; });
    return { task: row.id, url: row.url, title: row.title, age: row.updated_at ? at - Date.parse(row.updated_at) : null, who: who([wait.on]) };
  });
  const oldest = (list) => {
    return list.filter((i) => { return i.age !== null; }).sort((a, b) => { return b.age - a.age || a.task.localeCompare(b.task); })[0] || null;
  };
  const oldRelease = oldest(queued);
  const oldDecision = oldest(owed);
  const full = queued.length >= limit;
  const drain = full
    ? [...queued].sort((a, b) => { return byTickOrder(a.order, b.order) || a.task.localeCompare(b.task); })
      .slice(-(queued.length - limit + 1))
      .reverse()
      .map(({ order, ...item }) => { return item; })
    : [];
  const lines = [
    oldRelease
      ? `Oldest in the release queue (${queued.length}, limit ${limit}): [${oldRelease.title}](${oldRelease.url}), ${ageOf(oldRelease.age)} since ${oldRelease.from}, ${oldRelease.left}, ${oldRelease.who}`
      : `Oldest in the release queue (${queued.length}, limit ${limit}): none`,
    oldDecision
      ? `Oldest in the decision queue (${owed.length}): [${oldDecision.title}](${oldDecision.url}), untouched ${ageOf(oldDecision.age)}, ${oldDecision.who}`
      : `Oldest in the decision queue (${owed.length}): none`,
  ];
  if (full) {
    lines.push(`The release queue is at its limit: ${drain.length} ${drain.length === 1 ? 'change' : 'changes'} at the bottom of the tick's order proposed to drain`);
  }
  return {
    lines,
    drain: drain.map((d) => { return { ...d, age: d.age === null ? null : ageOf(d.age) }; }),
  };
};

/**
 * Flow's answers for one routine, read with an API key through `client`
 * (flow-api.mjs), or a client built from `key`, `base` and `fetchImpl`.
 */
export const readFlow = async ({ routine, project, now, client, key, base = DEFAULT_BASE, fetchImpl = fetch, inbox = null }) => {
  const w = windows(now);
  const { get } = client || createClient({ key, base, fetchImpl });
  const metrics = (win, tag, groupBy) => {
    return get(`/projects/${project}/metrics`, { since: win.since, until: win.until, tag, group_by: groupBy });
  };
  if (routine === 'flow') {
    // Grouped by holder: the rows are the same, and `groups` names whose
    // answer each person-queue row waits on.
    const [thisWeek, weekBefore, bugThisWeek, bugWeekBefore] = await Promise.all([
      metrics(w.thisWeek, undefined, 'on'), metrics(w.weekBefore, undefined, 'on'), metrics(w.thisWeek, 'bug'), metrics(w.weekBefore, 'bug'),
    ]);
    return { thisWeek, weekBefore, bugThisWeek, bugWeekBefore };
  }
  if (routine === 'spend') {
    const runs = (win) => {
      return get('/agent-runs', { project, since: win.since, until: win.until, group_by: 'outcome', limit: 0 });
    };
    const [runsThisWeek, runsWeekBefore] = await Promise.all([runs(w.thisWeek), runs(w.weekBefore)]);
    return { runsThisWeek, runsWeekBefore };
  }
  if (routine !== 'feeds') {
    throw new Error(`readFlow: unknown routine ${routine}`);
  }
  const [thisWeek, weekBefore] = await Promise.all([metrics(w.thisWeek), metrics(w.weekBefore)]);
  // The inbox is the account's, in no project, so a key restricted to one is
  // never given it: the session reads it through its own connection and
  // passes the answer as `inbox`. Without that, the key is asked, and a 404
  // is said in the line instead of failing.
  const captures = inbox ?? await get('/captures', { triaged: false, limit: 1 }).catch((error) => {
    if (error.status === 404 || error.status === 403) {
      return { unreadable: 'a key restricted to projects is not given the inbox; pass the session\'s list-captures answer as --inbox' };
    }
    throw error;
  });
  return { thisWeek, weekBefore, inbox: captures };
};

/**
 * The weekly Health's whole report, every read included: the flow's health
 * with a line per holder, what feeds and drains the graph, and the decisions a
 * person answered over the last four weeks, as data for the model to read for
 * an answer given more than once. It writes nothing.
 */
export const report = async ({ client, project, now = new Date().toISOString(), inbox = null, snapshot = null }) => {
  const { get } = client;
  // A person by their email, as the Chase names them; a team by its name,
  // since the line counts the team's queue rather than asking its members.
  const projectAnswer = await get(`/projects/${project}`);
  const emails = new Map((projectAnswer.members || []).map((m) => { return [m.user_id, m.email]; }));
  const teamNames = new Map((projectAnswer.teams || []).map((t) => { return [t.id, `the ${t.name} team`]; }));
  const nameOfHolder = (key) => { return emails.get(key) || teamNames.get(key) || key; };
  const [flowAnswers, feedAnswers] = await Promise.all([
    readFlow({ routine: 'flow', project, now, client }),
    readFlow({ routine: 'feeds', project, now, client, inbox }),
  ]);
  const flow = flowHealth({ ...flowAnswers, nameOfHolder });
  const fed = feeds(feedAnswers);
  // Closed decisions, newest write first; the summary carries no outcome, so
  // each within the window is read whole. The list is cut at the first one
  // older than the window, since `updated_at` never precedes the close.
  const since = Date.parse(now) - ANSWER_WEEKS * 7 * DAY;
  const closed = await get('/tasks', { project, kind: 'decision', status: ['completed', 'cancelled'], limit: 100 });
  const recent = (closed.tasks || []).filter((t) => { return Date.parse(t.updated_at) >= since; });
  const decisions = await Promise.all(recent.map(async (t) => { return (await get(`/tasks/${t.id}`)).task; }));
  const list = answers({ decisions, now });
  // The queues only a person drains, from the tick's own snapshot, so the
  // Health counts the release queue exactly as the tick and the Chase do.
  let queue = { lines: [], drain: [] };
  if (snapshot) {
    const waiting = await get('/next', { project, status: 'waiting', assignee: 'any', limit: 100 });
    const emailsOf = (ids) => {
      const named = (ids || []).map(nameOfHolder);
      const admins = (projectAnswer.members || []).filter((m) => { return m.role === 'admin' && !m.pending; }).map((m) => { return m.email; });
      return named.join(', ') || admins.join(', ');
    };
    queue = queues({
      tasks: snapshot.tasks,
      decisions: waiting.tasks || [],
      limit: snapshot.params?.releaseQueue ?? DEFAULT_RELEASE_QUEUE,
      now,
      who: emailsOf,
    });
  }
  return {
    alert: flow.alert,
    lines: [...flow.lines, ...queue.lines, ...fed.lines, answersLine({ answers: list, now })],
    mismatches: [...flow.mismatches, ...fed.mismatches],
    answers: list,
    drain: queue.drain,
    ...(snapshot ? { needs: snapshot.needs } : {}),
  };
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
  if (!['report', 'flow', 'feeds', 'spend', 'queues'].includes(mode)) {
    throw new Error('usage: health.mjs windows <now> | report … | flow … | feeds … | spend … | queues …');
  }
  if (mode === 'queues') {
    // By hand: the tick's snapshot and the `waiting` rows of `get-next`, as
    // saved; the holders stay as Flow names them, for the model to name.
    const now = rest.includes('--now') ? rest[rest.indexOf('--now') + 1] : new Date().toISOString();
    const f = flags(rest.filter((_, i) => { return rest[i] !== '--now' && rest[i - 1] !== '--now'; }));
    need(f, ['snapshot', 'decisions']);
    return queues({ tasks: f.snapshot.tasks, decisions: f.decisions.tasks || [], limit: f.snapshot.params?.releaseQueue ?? DEFAULT_RELEASE_QUEUE, now });
  }
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i].startsWith('--') || rest[i + 1] === undefined) {
      throw new Error(`expected --name <value>, got ${rest[i]}`);
    }
    opts[rest[i].slice(2)] = rest[i + 1];
  }
  const inboxOf = () => { return opts.inbox ? JSON.parse(readFileSync(opts.inbox, 'utf8')) : null; };
  if (mode === 'report') {
    const p = opts.root ? loadParams(opts.root) : null;
    const project = opts.project || p?.projectId;
    if (!project) {
      throw new Error('usage: health.mjs report (--root <repo dir> | --project <proj_…>) [--now <ISO>] [--inbox <file>]');
    }
    if (!env.FLOW_API_KEY) {
      throw new Error('report reads Flow itself and needs FLOW_API_KEY');
    }
    const client = createClient({ key: env.FLOW_API_KEY, base: env.FLOW_URL || DEFAULT_BASE });
    const now = opts.now || new Date().toISOString();
    // With the project's parameters, the release queue is read as the tick
    // reads it, the code host included; without them, the queue lines are
    // left out rather than counted from part of the graph.
    const snapshot = p
      ? await readSnapshot({ client, project, now, extra: { params: p.params }, repos: p.repos, reviewers: p.reviewers ?? [] })
      : null;
    return report({ client, project, now, inbox: inboxOf(), snapshot });
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
      inbox: inboxOf(),
    });
    return { flow: flowHealth, feeds, spend }[mode](answers);
  }
  const f = flags(rest);
  if (mode === 'flow') {
    need(f, ['this', 'before', 'bug-this', 'bug-before']);
    return flowHealth({ thisWeek: f.this, weekBefore: f.before, bugThisWeek: f['bug-this'], bugWeekBefore: f['bug-before'] });
  }
  if (mode === 'feeds') {
    need(f, ['this', 'before', 'inbox']);
    return feeds({ thisWeek: f.this, weekBefore: f.before, inbox: f.inbox });
  }
  need(f, ['runs-this', 'runs-before']);
  return spend({ runsThisWeek: f['runs-this'], runsWeekBefore: f['runs-before'] });
};

// Resolved on both sides, as plan.mjs does, for a skill installed through a symlink.
const isMain = process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain) {
  run(process.argv.slice(2), process.env).then(
    (result) => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); },
    (error) => { process.stderr.write(`${error.message}\n`); process.exit(1); },
  );
}
