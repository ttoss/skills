import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { clientFromEnv, parseFlags } from './flow-api.mjs';
import { readFlow, spend, spendOf, spendPair, windows } from './health.mjs';
import { load as loadParams } from './params.mjs';

// The weekly Audit's report lines that are arithmetic (token-audit's routine,
// step 4): spend by agent, the three costliest tasks (without the tick, which
// takes every task it delegates), the runs that reached no
// task or stayed open, then spend by what became of the runs' tasks and in
// total (health.mjs), this week against the week before. Read with the
// project's API key; it writes nothing. What is waste, the fix and its saving
// stay with the model. The flow's health is the Health's (health.mjs report).
//
// Usage: node audit.mjs (--root <repo dir> | --project <proj_…>) [--now <ISO 8601>]
//    or: node audit.mjs tasks --all <file> --ticks <file>  (two saved answers, no key)
// Output: JSON `{ lines }`.

// Ranked by every token read or written, cache included: what a session pays
// for is mostly its context re-read, and `cost_usd` is rarely there.
const weight = (totals) => {
  return ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens'].reduce((sum, field) => {
    return sum + (totals[field] || 0);
  }, 0);
};

// The counters a task group sums; `peak_context` is a maximum and cannot be
// taken apart.
const SUMMED = ['runs', 'unpriced', 'cost_usd', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens'];

/**
 * Each task's spend without the tick's runs. The tick takes every task it
 * starts a child on (GTF-S8), and Flow counts a run on several tasks whole in
 * each, so the tick's whole cost would repeat on every task it touched and
 * rank them by how often a tick ran rather than by what the work cost.
 */
export const withoutTicks = ({ tasks, ticks }) => {
  const tick = new Map((ticks?.groups || []).map((g) => { return [g.key, g.totals]; }));
  const groups = (tasks.groups || []).map((g) => {
    const minus = tick.get(g.key);
    if (!minus) {
      return g;
    }
    const totals = { ...g.totals };
    for (const key of SUMMED) {
      if (typeof totals[key] === 'number' && typeof minus[key] === 'number') {
        totals[key] = Math.max(0, totals[key] - minus[key]);
      }
    }
    return { ...g, totals };
  }).filter((g) => { return g.totals.runs > 0; });
  return { ...tasks, groups };
};

// The three costliest tasks, each named by the id its group already answers:
// a title would cost a get-task per group, and each get-task loads the graph.
const costliest = ({ tasks, ticks }) => {
  return [...(withoutTicks({ tasks, ticks }).groups || [])].filter((g) => { return g.key; }).sort((a, b) => { return weight(b.totals) - weight(a.totals); }).slice(0, 3)
    .map((g) => { return `Costliest task this week: [${g.key}](https://flow.ttoss.dev/app/tasks/${g.key}): ${spendOf(g.totals)}`; });
};

/** The report lines from what was read, as a pure function. */
export const report = ({ agentsThis, agentsBefore, tasksThis, ticksThis, unlinkedThis, unlinkedBefore, lingering }) => {
  // The total is health.mjs's "Spend, every run" line, which follows these.
  const lines = [];
  const before = new Map((agentsBefore.groups || []).map((g) => { return [g.key, g.totals]; }));
  for (const group of [...(agentsThis.groups || [])].sort((a, b) => { return weight(b.totals) - weight(a.totals); })) {
    lines.push(`Spend, agent ${group.key ?? 'unnamed'}: ${spendPair({ now: group.totals, before: before.get(group.key) })}`);
  }
  lines.push(...costliest({ tasks: tasksThis, ticks: ticksThis }));
  lines.push(`Runs that reached no task: ${spendPair({ now: unlinkedThis.totals, before: unlinkedBefore.totals })}`);
  lines.push(lingering.length
    ? `Runs still open after every task they worked on closed: ${lingering.map((r) => { return `${r.agent} ${r.url}`; }).join(', ')}`
    : 'Runs still open after every task they worked on closed: none');
  return lines;
};

/** Every read, then the lines. */
export const run = async ({ client, project, now = new Date().toISOString() }) => {
  const { get } = client;
  const w = windows(now);
  const runs = (win, query) => {
    return get('/agent-runs', { project, since: win.since, until: win.until, limit: 0, ...query });
  };
  const [agentsThis, agentsBefore, allTasks, ticksThis, unlinkedThis, unlinkedBefore, lingering] = await Promise.all([
    runs(w.thisWeek, { group_by: 'agent' }), runs(w.weekBefore, { group_by: 'agent' }),
    runs(w.thisWeek, { group_by: 'task' }), runs(w.thisWeek, { group_by: 'task', agent: 'flow tick' }),
    runs(w.thisWeek, { linked: false }), runs(w.weekBefore, { linked: false }),
    get('/agent-runs', { project, lingering: true, limit: 100 }),
  ]);
  const total = spend(await readFlow({ routine: 'spend', project, now, client }));
  return {
    lines: [...report({ agentsThis, agentsBefore, tasksThis: allTasks, ticksThis, unlinkedThis, unlinkedBefore, lingering: lingering.runs || [] }), ...total.lines],
  };
};

/**
 * The costliest-task lines from two saved `list-agent-runs` answers
 * (`group_by: task`, then the same with `agent: flow tick`), for a runtime
 * without the key: the subtraction stays a script's, never the model's.
 */
export const costliestFromFiles = ({ all, ticks }) => {
  return costliest({ tasks: all, ticks });
};

const isMain = process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain && process.argv[2] === 'tasks') {
  const f = parseFlags(process.argv.slice(3));
  if (!f.all || !f.ticks) {
    process.stderr.write('usage: audit.mjs tasks --all <file> --ticks <file>\n');
    process.exit(2);
  }
  const read = (file) => { return JSON.parse(readFileSync(file, 'utf8')); };
  process.stdout.write(`${JSON.stringify({ lines: costliestFromFiles({ all: read(f.all), ticks: read(f.ticks) }) }, null, 2)}\n`);
} else if (isMain) {
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
