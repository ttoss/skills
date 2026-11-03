import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { clientFromEnv, mapLimit, parseFlags } from './flow-api.mjs';
import { readChange, readDefault } from './host.mjs';
import { load as loadParams } from './params.mjs';

// The tick's snapshot (flow/SKILL.md section 1), in plan.mjs's schema, read
// from Flow with the project's API key: the candidates and their rank, the
// slices the tick acts on, the children and which are this person's, what
// holds each task and what came due. What Flow cannot know stays with the
// model and comes in `--extra`: the code host's view of each change, the
// runtime's view of each child, the judgments (brief, leaves) and the rounds.
// `needs` lists the changes the model must read on the code host.
//
// Usage: node snapshot.mjs --root <repo dir> [--extra <file>] [--now <ISO>]
//   (params and repos from the parameters there, the code host through `gh`),
//   or --project <proj_…> [--extra <file>] with everything else in the file.
// --extra JSON: { "params": { maxRuns, staleAfterHours, autoRounds, reviewByAgent, reviewRequired, reviewGraceMinutes, agentsMayIntegrate },
//                 "tasks": { "task_…": { brief, leaves, rounds, repairs, change } },
//                 "children": { "arun_…": { runtime } },
//                 "defaults": [{ repo, sha, red, repairTask }] }
// Output: the snapshot plan.mjs reads, plus `needs: { changes: [{ task, url }],
// unread: [{ task, error }], host: [{ repo | task, error }] }`: what could not
// be read is named, never guessed.

const CLOSED = ['completed', 'cancelled', 'discarded', 'archived'];

export const DEFAULT_PARAMS = { maxRuns: 2, staleAfterHours: 4, autoRounds: 1, reviewByAgent: false, reviewRequired: null, reviewGraceMinutes: 30, agentsMayIntegrate: true, focus: null, openChanges: null, personQueue: null };

const waitsOf = (row) => {
  return (row.readiness?.blocked_by || []).filter((b) => { return b.via === 'wait'; });
};

/** The snapshot from what was read, as a pure function. */
export const build = ({ now, candidates, slices, dueIds, children, mine, childTasks, implementsOf, repairRows = [], decisions = [], extra = {} }) => {
  const nowMs = Date.parse(now);
  const rank = new Map(candidates.map((t, i) => { return [t.id, i]; }));
  // Each repo's open repair task, found by its `source` commit: the task
  // repairs that repo, so its own change is never held by the red it fixes.
  const repairOf = new Map((extra.defaults || []).filter((d) => { return d.repairTask; }).map((d) => { return [d.repairTask, d.repo]; }));
  const rows = new Map();
  // A repair task is in the snapshot even when no slice holds it, since a red
  // default branch is the first thing the tick works.
  // Open decisions are in the snapshot as what waits on a person (the
  // `Person queue` limit), whether or not a slice holds them.
  for (const row of [...candidates, ...slices, ...decisions, ...repairRows.filter((r) => { return repairOf.has(r.id); })]) {
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
      kind: row.kind ?? null,
      assignee: row.assignee ?? null,
      waitsOn: [...new Set(waits.map((w) => { return w.on; }).filter(Boolean))],
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
      repairs: own.repairs ?? repairOf.get(row.id) ?? null,
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
export const run = async ({ client, project, now = new Date().toISOString(), extra = {}, repos = null, reviewers = [], gh }) => {
  const { get } = client;
  const next = await get('/next', { project, limit: 10 });
  const counts = next.counts || {};
  const slice = (name) => {
    return get('/next', { project, slice: name, assignee: 'any', limit: 20 });
  };
  const [waiting, blocked, dateCame, holdCleared, decisions, children, mine, running] = await Promise.all([
    slice('waiting'), slice('blocked'),
    counts.date_came ? slice('date_came') : { tasks: [] },
    counts.hold_cleared ? slice('hold_cleared') : { tasks: [] },
    get('/tasks', { project, kind: 'decision', status: ['active', 'waiting'], limit: 100 }),
    get('/agent-runs', { project, status: 'running', agent: 'flow child', limit: 100 }),
    get('/agent-runs', { project, status: 'running', agent: 'flow child', by: 'me', limit: 100 }),
    // Every running run, whoever started it: a reviewer outside the tick
    // that recorded its run holds the task as surely as a child does.
    repos?.length ? get('/agent-runs', { project, status: 'running', limit: 100 }) : { runs: [] },
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
  // With the repos known, the code host is read with `gh`: each change a task
  // implements, each repo's default branch and its open repair task. A change
  // or repo `gh` cannot read stays in `needs`, never guessed.
  const hostErrors = [];
  let repairRows = [];
  if (repos?.length) {
    const opts = { ...(gh ? { gh } : {}), reviewers };
    const defaults = await mapLimit(repos, 2, async (repo) => {
      try {
        return await readDefault(repo, opts);
      } catch (error) {
        hostErrors.push({ repo, error: String(error.stderr || error.message).split('\n')[0].slice(0, 200) });
        return null;
      }
    });
    const repairs = await get('/tasks', { project, tag: 'repair', status: ['active', 'waiting', 'blocked'], limit: 100 });
    repairRows = repairs.tasks || [];
    for (const d of defaults.filter(Boolean)) {
      for (const task of repairs.tasks || []) {
        const refs = (await get(`/tasks/${task.id}`)).references || [];
        if (refs.some((r) => { return r.url.includes(`github.com/${d.repo}/`); })) {
          d.repairTask = task.id;
          break;
        }
      }
    }
    extra = { ...extra, defaults: extra.defaults || defaults.filter(Boolean), tasks: { ...(extra.tasks || {}) } };
    const red = new Map((extra.defaults || []).map((d) => { return [d.repo, d.red]; }));
    const enforced = new Map((extra.defaults || []).map((d) => { return [d.repo, d.reviewEnforced ?? null]; }));
    const holders = new Set([...children.runs, ...running.runs].flatMap((r) => { return r.works_on || []; }));
    await mapLimit(Object.entries(implementsOf), 4, async ([task, urls]) => {
      if (extra.tasks[task]?.change) {
        return;
      }
      try {
        const changes = (await Promise.all(urls.map((u) => { return readChange(u, opts); }))).filter(Boolean);
        // The open change when there is one, else the last integrated.
        const change = changes.find((c) => { return !c.merged && !c.closed; }) || changes.at(-1);
        if (change) {
          const { title, task: named, mergedAt, pipelineDoneAt, ...rest } = change;
          // Written after the merge and after its pipeline finished: the tick
          // (or a person) already applied what integrating left.
          const updated = full[task]?.task?.updated_at;
          const settled = [mergedAt, pipelineDoneAt].filter(Boolean).map(Date.parse);
          const writtenSince = Boolean(change.merged && updated && settled.length && Date.parse(updated) > Math.max(...settled));
          extra.tasks[task] = { ...(extra.tasks[task] || {}), change: { ...rest, writtenSince, redOnDefault: red.get(change.repo) ?? null, reviewEnforced: enforced.get(change.repo) ?? null, reviewRunActive: holders.has(task) } };
        }
      } catch (error) {
        hostErrors.push({ task, error: String(error.stderr || error.message).split('\n')[0].slice(0, 200) });
      }
    });
  }
  const snapshot = build({
    now,
    candidates: next.tasks || [],
    slices,
    dueIds: new Set([...dateCame.tasks, ...holdCleared.tasks].map((t) => { return t.id; })),
    children: children.runs,
    mine: new Set(mine.runs.map((r) => { return r.id; })),
    childTasks: Object.fromEntries(Object.entries(full).map(([id, a]) => { return [id, a.task]; })),
    implementsOf,
    repairRows,
    decisions: decisions.tasks || [],
    extra,
  });
  snapshot.needs.unread = unread;
  snapshot.needs.host = hostErrors;
  return snapshot;
};

const isMain = process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain) {
  const f = parseFlags(process.argv.slice(2));
  // --root reads the project's parameters (params.mjs) into `params`, and the
  // code host in their repos with `gh`.
  const p = f.root ? loadParams(f.root) : null;
  const project = f.project || p?.projectId;
  if (!project) {
    process.stderr.write('usage: snapshot.mjs (--root <repo dir> | --project <proj_…>) [--extra <file>] [--now <ISO>]\n');
    process.exit(2);
  }
  const extra = f.extra ? JSON.parse(readFileSync(f.extra, 'utf8')) : {};
  if (p && !extra.params) {
    extra.params = p.params;
  }
  run({ client: clientFromEnv(), project, now: f.now, extra, repos: p?.repos, reviewers: p?.reviewers ?? [] }).then(
    (result) => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); },
    (error) => { process.stderr.write(`${error.message}\n`); process.exit(1); },
  );
}
