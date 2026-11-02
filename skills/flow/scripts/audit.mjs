import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { clientFromEnv, parseFlags } from './flow-api.mjs';
import { audit as healthLines, readFlow, spendOf, spendPair, windows } from './health.mjs';
import { load as loadParams } from './params.mjs';

// The weekly Audit's report lines that are arithmetic (token-audit's routine,
// step 4): spend in total and by agent, the three costliest tasks, the runs
// that reached no task or stayed open, this week against the week before,
// then what feeds and drains the graph (health.mjs). Read with the project's
// API key; it writes nothing. What is waste, the fix and its saving stay with
// the model.
//
// Usage: node audit.mjs (--root <repo dir> | --project <proj_…>) [--now <ISO 8601>]
// Output: JSON `{ lines, mismatches }`.

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
  return {
    lines: [...report({ agentsThis, agentsBefore, tasksThis, titles, unlinkedThis, unlinkedBefore, lingering: lingering.runs || [] }), ...health.lines],
    mismatches: health.mismatches,
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
