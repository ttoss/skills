import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { clientFromEnv, mapLimit, parseFlags } from './flow-api.mjs';

// The tick's snapshot (flow/SKILL.md section 1), in plan.mjs's schema, read
// from Flow with the project's API key: the candidates and their rank, the
// slices the tick acts on, the children and which are this person's, what
// holds each task and what came due. What Flow cannot know stays with the
// model and comes in `--extra`: the code host's view of each change, the
// runtime's view of each child, the judgments (brief, leaves) and the rounds.
// `needs` lists the changes the model must read on the code host.
//
// Usage: node snapshot.mjs --project <proj_…> [--extra <file>] [--now <ISO>]
// --extra JSON: { "params": { maxRuns, staleAfterHours, autoRounds, reviewByAgent, agentsMayIntegrate },
//                 "tasks": { "task_…": { brief, leaves, rounds, repairs, change } },
//                 "children": { "arun_…": { runtime } },
//                 "defaults": [{ repo, sha, red, repairTask }] }
// Output: the snapshot plan.mjs reads, plus `needs: { changes: [{ task, url }],
// unread: [{ task, error }] }`: a task Flow could not answer is named, never guessed.

const CLOSED = ['completed', 'cancelled', 'discarded', 'archived'];

export const DEFAULT_PARAMS = { maxRuns: 2, staleAfterHours: 4, autoRounds: 1, reviewByAgent: false, agentsMayIntegrate: true, focus: null };

const waitsOf = (row) => {
  return (row.readiness?.blocked_by || []).filter((b) => { return b.via === 'wait'; });
};

/** The snapshot from what was read, as a pure function. */
export const build = ({ now, candidates, slices, dueIds, children, mine, childTasks, implementsOf, extra = {} }) => {
  const nowMs = Date.parse(now);
  const rank = new Map(candidates.map((t, i) => { return [t.id, i]; }));
  const rows = new Map();
  for (const row of [...candidates, ...slices]) {
    rows.set(row.id, row);
  }
  const tasks = [...rows.values()].map((row) => {
    const waits = waitsOf(row);
    const pastWait = waits.some((w) => { return w.kind === 'external' && w.until && Date.parse(w.until) <= nowMs; });
    const due = dueIds.has(row.id) || pastWait;
    const own = extra.tasks?.[row.id] || {};
    return {
      id: row.id,
      status: row.status,
      priority: row.priority,
      tags: row.tags || [],
      rank: rank.has(row.id) ? rank.get(row.id) : null,
      heldByPerson: waits.some((w) => { return Boolean(w.on); }),
      inFocus: true,
      candidate: rank.has(row.id),
      due,
      dueKind: due ? (row.status === 'calendar' ? 'check' : 'other') : null,
      brief: own.brief ?? null,
      leaves: own.leaves ?? null,
      rounds: own.rounds ?? 0,
      repairs: own.repairs ?? null,
      change: own.change ?? null,
    };
  });
  const snapshotChildren = children.map((run) => {
    const held = (run.works_on || []).map((id) => { return childTasks[id]; }).filter(Boolean);
    return {
      run: run.id,
      tasks: run.works_on || [],
      startedAt: run.started_at,
      byMe: mine.has(run.id),
      runtime: extra.children?.[run.id]?.runtime ?? null,
      // Its handoff is written: every task it holds closed, or waiting on the gates or a person.
      handoff: held.length > 0 && held.every((t) => { return CLOSED.includes(t.status) || t.status === 'waiting'; }),
    };
  });
  const needs = Object.entries(implementsOf).flatMap(([task, urls]) => {
    return urls.filter((url) => { return !extra.tasks?.[task]?.change; }).map((url) => { return { task, url }; });
  });
  return {
    now,
    params: { ...DEFAULT_PARAMS, ...(extra.params || {}) },
    defaults: extra.defaults || [],
    children: snapshotChildren,
    tasks,
    needs: { changes: needs },
  };
};

/** Every read, then the snapshot. */
export const run = async ({ client, project, now = new Date().toISOString(), extra = {} }) => {
  const { get } = client;
  const next = await get('/next', { project, limit: 10 });
  const counts = next.counts || {};
  const slice = (name) => {
    return get('/next', { project, slice: name, assignee: 'any', limit: 20 });
  };
  const [waiting, blocked, dateCame, holdCleared, children, mine] = await Promise.all([
    slice('waiting'), slice('blocked'),
    counts.date_came ? slice('date_came') : { tasks: [] },
    counts.hold_cleared ? slice('hold_cleared') : { tasks: [] },
    get('/agent-runs', { project, status: 'running', agent: 'flow child', limit: 100 }),
    get('/agent-runs', { project, status: 'running', agent: 'flow child', by: 'me', limit: 100 }),
  ]);
  const slices = [...waiting.tasks, ...blocked.tasks, ...dateCame.tasks, ...holdCleared.tasks];
  const ids = [...new Set([...slices.map((t) => { return t.id; }), ...children.runs.flatMap((r) => { return r.works_on || []; })])];
  // A task Flow cannot answer right now is named in `needs.unread`, never guessed.
  const unread = [];
  const full = Object.fromEntries((await mapLimit(ids, 4, async (id) => {
    try {
      return [id, await get(`/tasks/${id}`)];
    } catch (error) {
      unread.push({ task: id, error: error.message });
      return null;
    }
  })).filter(Boolean));
  const implementsOf = Object.fromEntries(Object.entries(full).map(([id, answer]) => {
    return [id, (answer.references || []).filter((r) => { return r.role === 'implements' && !r.retracted_at; }).map((r) => { return r.url; })];
  }).filter(([, urls]) => { return urls.length; }));
  const snapshot = build({
    now,
    candidates: next.tasks || [],
    slices,
    dueIds: new Set([...dateCame.tasks, ...holdCleared.tasks].map((t) => { return t.id; })),
    children: children.runs,
    mine: new Set(mine.runs.map((r) => { return r.id; })),
    childTasks: Object.fromEntries(Object.entries(full).map(([id, a]) => { return [id, a.task]; })),
    implementsOf,
    extra,
  });
  snapshot.needs.unread = unread;
  return snapshot;
};

const isMain = process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain) {
  const f = parseFlags(process.argv.slice(2));
  if (!f.project) {
    process.stderr.write('usage: snapshot.mjs --project <proj_…> [--extra <file>] [--now <ISO>]\n');
    process.exit(2);
  }
  run({ client: clientFromEnv(), project: f.project, now: f.now, extra: f.extra ? JSON.parse(readFileSync(f.extra, 'utf8')) : {} }).then(
    (result) => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); },
    (error) => { process.stderr.write(`${error.message}\n`); process.exit(1); },
  );
}
