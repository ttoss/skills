import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { clientFromEnv, parseFlags } from './flow-api.mjs';
import { audit as healthLines, readFlow, spendOf, spendPair, windows } from './health.mjs';
import { load as loadParams } from './params.mjs';

// The weekly Audit's report lines that are arithmetic (token-audit's routine,
// step 4): spend in total and by agent, the three costliest tasks, the runs
// that reached no task or stayed open, this week against the week before,
// then what feeds and drains the graph (health.mjs), then the decisions a
// person answered over the last four weeks, as data for the model to read for
// an answer given more than once (token-audit's routine, step 5). Read with the
// project's API key; it writes nothing. What is waste, the fix and its saving,
// and which answers are the same answer, stay with the model.
//
// Usage: node audit.mjs (--root <repo dir> | --project <proj_…>) [--now <ISO 8601>]
// Output: JSON `{ lines, mismatches, answers }`.

const DAY = 24 * 3600 * 1000;
const ANSWER_WEEKS = 4;

const weight = (totals) => {
  return totals.cost_usd ?? (totals.input_tokens || 0) + (totals.output_tokens || 0);
};

/** The report lines from what was read, as a pure function. */
export const report = ({ agentsThis, agentsBefore, tasksThis, titles, unlinkedThis, unlinkedBefore, lingering }) => {
  // The total is health.mjs's "Spend, every run" line, which follows these.
  const lines = [];
  const before = new Map((agentsBefore.groups || []).map((g) => { return [g.key, g.totals]; }));
  for (const group of [...(agentsThis.groups || [])].sort((a, b) => { return weight(b.totals) - weight(a.totals); })) {
    lines.push(`Spend, agent ${group.key ?? 'unnamed'}: ${spendPair({ now: group.totals, before: before.get(group.key) })}`);
  }
  const costliest = [...(tasksThis.groups || [])].filter((g) => { return g.key; }).sort((a, b) => { return weight(b.totals) - weight(a.totals); }).slice(0, 3);
  for (const group of costliest) {
    const task = titles[group.key];
    lines.push(`Costliest task this week: [${task?.title || group.key}](${task?.url || `https://flow.ttoss.dev/app/tasks/${group.key}`}): ${spendOf(group.totals)}`);
  }
  lines.push(`Runs that reached no task: ${spendPair({ now: unlinkedThis.totals, before: unlinkedBefore.totals })}`);
  lines.push(lingering.length
    ? `Runs still open after every task they worked on closed: ${lingering.map((r) => { return `${r.agent} ${r.url}`; }).join(', ')}`
    : 'Runs still open after every task they worked on closed: none');
  return lines;
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

/** Every read, then the lines. */
export const run = async ({ client, project, now = new Date().toISOString() }) => {
  const { get } = client;
  const w = windows(now);
  const runs = (win, query) => {
    return get('/agent-runs', { project, since: win.since, until: win.until, limit: 0, ...query });
  };
  const [agentsThis, agentsBefore, tasksThis, unlinkedThis, unlinkedBefore, lingering] = await Promise.all([
    runs(w.thisWeek, { group_by: 'agent' }), runs(w.weekBefore, { group_by: 'agent' }),
    runs(w.thisWeek, { group_by: 'task' }),
    runs(w.thisWeek, { linked: false }), runs(w.weekBefore, { linked: false }),
    get('/agent-runs', { project, lingering: true, limit: 100 }),
  ]);
  const top = [...(tasksThis.groups || [])].filter((g) => { return g.key; }).sort((a, b) => { return weight(b.totals) - weight(a.totals); }).slice(0, 3);
  const titles = Object.fromEntries(await Promise.all(top.map(async (g) => {
    return [g.key, (await get(`/tasks/${g.key}`)).task];
  })));
  const health = healthLines(await readFlow({ routine: 'audit', project, now, client }));
  // Closed decisions, newest write first; the summary carries no outcome, so
  // each within the window is read whole. The list is cut at the first one
  // older than the window, since `updated_at` never precedes the close.
  const since = Date.parse(now) - ANSWER_WEEKS * 7 * DAY;
  const closed = await get('/tasks', { project, kind: 'decision', status: ['completed', 'cancelled'], limit: 100 });
  const recent = (closed.tasks || []).filter((t) => { return Date.parse(t.updated_at) >= since; });
  const decisions = await Promise.all(recent.map(async (t) => { return (await get(`/tasks/${t.id}`)).task; }));
  const list = answers({ decisions, now });
  return {
    lines: [...report({ agentsThis, agentsBefore, tasksThis, titles, unlinkedThis, unlinkedBefore, lingering: lingering.runs || [] }), ...health.lines, answersLine({ answers: list, now })],
    mismatches: health.mismatches,
    answers: list,
  };
};

const isMain = process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain) {
  const f = parseFlags(process.argv.slice(2));
  const project = f.project || (f.root ? loadParams(f.root).projectId : null);
  if (!project) {
    process.stderr.write('usage: audit.mjs (--root <repo dir> | --project <proj_…>) [--now <ISO>]\n');
    process.exit(2);
  }
  run({ client: clientFromEnv(), project, now: f.now }).then(
    (result) => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); },
    (error) => { process.stderr.write(`${error.message}\n`); process.exit(1); },
  );
}
