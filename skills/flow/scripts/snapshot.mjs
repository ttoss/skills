import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { clientFromEnv, mapLimit, parseFlags } from './flow-api.mjs';
import { ghApi, parseChangeUrl, readChange, readChangeState, readDefault, unreadable } from './host.mjs';
import { load as loadParams } from './params.mjs';
import { BRIEF_READY, SENT_BACK_CHECK, SENT_BACK_ROUND } from './plan.mjs';

// The tick's snapshot (flow/SKILL.md section 1), in plan.mjs's schema, read
// from Flow with the project's API key: the candidates and their rank, the
// slices the tick acts on, every task whose change is out (`ref_role`, every
// page), the children and which are this person's, what
// holds each task and what came due. What Flow cannot know stays with the
// model and comes in `--extra`: what it observed of the world (the code
// host's view of each change, the runtime's view of each child), never what
// it judged. Every judge's answer is read back from where the tick wrote it:
// a ready brief and a send-back from the task's tags, the repos its child
// pushes to from its references, what integrating leaves from its
// `after_integration`; the rounds are counted from Flow's runs.
// `needs` lists the changes the model must read on the code host.
//
// Usage: node snapshot.mjs --root <repo dir> [--extra <file>] [--now <ISO>]
//   (params and repos from the parameters there, the code host through `gh`),
//   or --project <proj_…> [--extra <file>] with everything else in the file.
// --extra JSON: { "focus": "task_…" | "tag:<name>" | ["task_…", …] | { tasks: [id] } | { tag },
//                   (or params.focus): only what it resolves to starts a child,
//                 "params": { maxRuns, maxShortRuns, staleAfterHours, autoRounds, reviewByAgent, reviewRequired, agentsMayIntegrate, leavesByAgent, branchesPerRepo },
//                   (with --root, laid over the parameters file's)
//                 "tasks": { "task_…": { rounds, repairs, changes: [change] } },   (brief, personFree, leaves,
//                   sentBack, released, repos: a judge's answer laid over what the task carries)
//                 "children": { "arun_…": { runtime, kind } },   (kind: what the tick started it as, when it knows)
//                 "defaults": [{ repo, sha, red, repairTask }] }
// Output: the snapshot plan.mjs reads, plus `needs: { changes: [{ task, url }],
// unread: [{ task, error }], host: [{ repo | task, error }] }`: what could not
// be read is named, never guessed.

const CLOSED = ['completed', 'cancelled', 'discarded', 'archived'];
// The statuses a task with a change in flight can hold.
const WORKED = ['active', 'waiting', 'calendar'];

export const DEFAULT_PARAMS = { maxRuns: 3, maxShortRuns: 2, staleAfterHours: 4, autoRounds: 1, reviewByAgent: false, reviewRequired: null, agentsMayIntegrate: true, focus: null, releaseQueue: null, leavesByAgent: null, retargetByAgent: null, branchesPerRepo: null };

// The tick's own wait for a missing after_integration, by the words the
// planner's reason carries, so a later tick can read it again when the
// Closing evidence gives the agent that choice.
const LEAVES_WAIT = /does not say what integrating leaves/i;

const waitsOf = (row) => {
  return (row.readiness?.blocked_by || []).filter((b) => { return b.via === 'wait'; });
};

// The open `blocks` sources holding a row, `null` for one in a project the
// caller cannot reach; null when the row carries no readiness.
const blockersOf = (row) => {
  if (!row.readiness) {
    return null;
  }
  return row.readiness.blocked_by.filter((b) => { return b.via === 'task'; }).map((b) => { return b.id; });
};

/**
 * How many fix rounds a task has had: the closed `flow child` runs on it that
 * started after one of its changes was opened and list that change as
 * `produced`, each run once. The child that opened a change started before
 * it; a review or check child pushes nothing to it, so neither counts.
 */
export const roundsOf = ({ runs, changes }) => {
  return runs.filter((r) => {
    return r.status !== 'running' && changes.some((c) => {
      const opened = Date.parse(c.createdAt);
      return !Number.isNaN(opened) && Date.parse(r.started_at) > opened && (r.produced || []).includes(c.url);
    });
  }).length;
};

// The changes the model already gave for a task, as `changes` or one `change`.
const given = (own) => {
  return Boolean(own?.changes || own?.change);
};

/**
 * The tick's focus (flow/SKILL.md § Focus) as `{ tasks: [id] }`, `{ tag }` or
 * null, from the forms a tick writes: one or several `task_…` ids, `tag:<name>`,
 * or either object.
 */
export const focusOf = (focus) => {
  if (!focus) {
    return null;
  }
  if (typeof focus === 'string') {
    return focus.startsWith('tag:') ? { tag: focus.slice(4) } : { tasks: [focus] };
  }
  if (Array.isArray(focus)) {
    return focus.length ? { tasks: [...new Set(focus)] } : null;
  }
  if (focus.tag) {
    return { tag: focus.tag };
  }
  const tasks = focus.tasks ?? (focus.task ? [focus.task] : []);
  return tasks.length ? { tasks: [...new Set(tasks)] } : null;
};

// A reference to a repo's root names a repo the task's child pushes to.
const REPO_ROOT = /^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i;

/**
 * The repos a task's live references name by their root URL, kept to the
 * project's `Repos` when they are known; null when none does.
 */
export const reposOf = ({ references = [], projectRepos = null }) => {
  const named = references
    .filter((r) => { return !r.retracted_at && r.role !== 'implements'; })
    .map((r) => { return REPO_ROOT.exec(r.url || '')?.[1]; })
    .filter(Boolean)
    .map((repo) => { return projectRepos?.find((p) => { return p.toLowerCase() === repo.toLowerCase(); }) ?? (projectRepos?.length ? null : repo); })
    .filter(Boolean);
  return named.length ? [...new Set(named)] : null;
};

// What a send-back tag answers of the sent_back judge.
const sentBackOf = (tags) => {
  if (tags.includes(SENT_BACK_ROUND)) {
    return 'round';
  }
  return tags.includes(SENT_BACK_CHECK) ? 'check' : null;
};

/** The snapshot from what was read, as a pure function. */
export const build = ({ now, candidates, slices, held = [], dueIds, children, mine, childTasks, implementsOf, handoffs = {}, references = {}, projectRepos = null, repairRows = [], focusIds = null, extra = {} }) => {
  const focus = focusOf(extra.focus ?? extra.params?.focus);
  // What the focus resolves to: the tasks its reads answered (the union of
  // get-next upstream_of over each target), or any task carrying its tag.
  const inFocus = (row) => {
    if (!focus) {
      return true;
    }
    return Boolean(focusIds?.has(row.id)) || Boolean(focus.tag && (row.tags || []).includes(focus.tag));
  };
  const nowMs = Date.parse(now);
  const rank = new Map(candidates.map((t, i) => { return [t.id, i]; }));
  // Each repo's open repair task, found by its `source` commit: the task
  // repairs that repo, so its own change is never held by the red it fixes.
  const repairOf = new Map((extra.defaults || []).filter((d) => { return d.repairTask; }).map((d) => { return [d.repairTask, d.repo]; }));
  const rows = new Map();
  // A repair task is in the snapshot even when no slice holds it, since a red
  // default branch is the first thing the tick works.
  // A task some `blocks` edge holds is in it too, read first so a slice's
  // row of the same task wins: the planner reports one held only by sources
  // whose change integrated.
  for (const row of [...held, ...candidates, ...slices, ...repairRows.filter((r) => { return repairOf.has(r.id); })]) {
    rows.set(row.id, row);
  }
  const tasks = [...rows.values()].map((row) => {
    const waits = waitsOf(row);
    const pastWait = waits.some((w) => { return w.kind === 'external' && w.until && Date.parse(w.until) <= nowMs; });
    const due = dueIds.has(row.id) || pastWait;
    // A person who dated a `scheduled` wait on themselves deferred the work to
    // that date; an `external` wait's `until` is only when to chase it.
    const personWaits = waits.filter((w) => { return Boolean(w.on); });
    const deferred = personWaits.length > 0 && personWaits.every((w) => { return w.kind === 'scheduled' && w.until && Date.parse(w.until) > nowMs; });
    const own = extra.tasks?.[row.id] || {};
    // What integrating leaves is the handoff's field; a judge reads the body
    // only for a task handed off before the field existed.
    const handoff = handoffs[row.id] || null;
    const tags = row.tags || [];
    return {
      id: row.id,
      status: row.status,
      waitsOn: [...new Set(waits.map((w) => { return w.on; }).filter(Boolean))],
      blockedBy: blockersOf(row),
      priority: row.priority,
      // The priority it holds through an open commitment it blocks, above its
      // own (get-next's `inherited_priority`); null when none, or on a row
      // that does not carry it.
      inherited: row.inherited_priority?.priority ?? null,
      tags,
      rank: rank.has(row.id) ? rank.get(row.id) : null,
      // A task assigned to a member or a team is theirs: agents never take
      // work by its assignee, so the planner offers it to no child.
      heldByPerson: personWaits.length > 0 || Boolean(row.assignee),
      // A wait on nobody is outside the team: nothing the team does drains it.
      heldOutside: waits.some((w) => { return !w.on; }),
      deferredUntil: deferred ? personWaits.map((w) => { return w.until; }).sort().at(-1) : null,
      inFocus: inFocus(row),
      candidate: rank.has(row.id),
      due,
      dueKind: due ? (row.status === 'calendar' ? 'check' : 'other') : null,
      // A judge's answer is written on the task and read back here; `--extra`
      // only lays one over it. Short and split need no tag: a short brief
      // waits on the person, and a split made the tasks that replace it.
      brief: own.brief ?? (tags.includes(BRIEF_READY) ? 'ready' : null),
      // The planner reads the person-free tags itself.
      personFree: own.personFree ?? null,
      leaves: own.leaves ?? handoff?.leaves ?? null,
      sentBack: own.sentBack ?? sentBackOf(tags),
      released: own.released ?? (tags.includes(SENT_BACK_ROUND) ? false : null),
      check: handoff?.check ?? null,
      leavesWait: own.leavesWait ?? waits.some((w) => { return Boolean(w.on) && LEAVES_WAIT.test(w.reason || ''); }),
      rounds: own.rounds ?? 0,
      repairs: own.repairs ?? repairOf.get(row.id) ?? null,
      repos: own.repos ?? (references[row.id] ? reposOf({ references: references[row.id], projectRepos }) : null),
      // Every change the task implements, one per repo: the planner gates each
      // and advances the task only once all integrated. A hand-written task
      // may give one `change`.
      changes: own.changes ?? (own.change ? [own.change] : []),
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
      kind: extra.children?.[run.id]?.kind ?? null,
      // Its handoff is written: every task it holds closed, or waiting on the gates or a person.
      handoff: held.length > 0 && held.every((t) => { return CLOSED.includes(t.status) || t.status === 'waiting'; }),
    };
  });
  const needs = Object.entries(implementsOf).flatMap(([task, urls]) => {
    return urls.filter(() => { return !given(extra.tasks?.[task]); }).map((url) => { return { task, url }; });
  });
  return {
    now,
    params: { ...DEFAULT_PARAMS, ...(extra.params || {}), focus },
    defaults: extra.defaults || [],
    children: snapshotChildren,
    tasks,
    needs: { changes: needs },
  };
};

// What a `ref_role` row already answers of `get-task`: the live
// `implements` references, what integrating leaves and when it was written.
// Null on a deployment whose rows do not carry `role_refs`.
const answerOfRow = (row) => {
  if (!Array.isArray(row.role_refs)) {
    return null;
  }
  return {
    task: { status: row.status, title: row.title, url: row.url, updated_at: row.updated_at, after_integration: row.after_integration ?? null },
    references: row.role_refs,
  };
};

const firstLine = (error) => {
  return String(error.stderr || error.message).split('\n')[0].slice(0, 200);
};

/**
 * Every read, then the snapshot. `host: 'state'` reads only where each change
 * stands (open, draft, integrated, closed), one `gh` call each: what the
 * release queue is counted by, and all the Chase needs. `progress` hears a line
 * per stage, for stderr.
 */
export const run = async ({ client, project, now = new Date().toISOString(), extra = {}, repos = null, reviewers = [], gh, host = 'full', progress = () => {} }) => {
  const { get, all } = client;
  const slice = (name) => {
    return get('/next', { project, slice: name, assignee: 'any', limit: 20 });
  };
  // A focus narrows the candidates to its targets' upstream (each `task_…`
  // read on its own, since `upstream_of` takes one) or to its tag.
  const focus = focusOf(extra.focus ?? extra.params?.focus);
  // Only what nobody is assigned: a child never takes assigned work, and
  // skipping it writes nothing, so it would hold its row of the window on
  // every tick and hide the startable work ranked below it.
  const ready = (query = {}) => {
    return get('/next', { project, ...query, assignee: 'none', limit: 10 });
  };
  const candidatesOf = async () => {
    if (!focus) {
      return ready();
    }
    if (focus.tag) {
      return ready({ tag: focus.tag });
    }
    const answers = await Promise.all(focus.tasks.map((id) => { return ready({ upstream_of: id }); }));
    const seen = new Map();
    for (const row of answers.flatMap((a) => { return a.tasks || []; })) {
      if (!seen.has(row.id)) {
        seen.set(row.id, row);
      }
    }
    return { tasks: [...seen.values()] };
  };
  // Every read at once: an empty slice costs less than waiting on `counts`.
  const [next, waiting, dateCame, holdCleared, held, implemented, children, mine, running] = await Promise.all([
    candidatesOf(),
    slice('waiting'), slice('date_came'), slice('hold_cleared'),
    // Every task a `blocks` edge holds, whatever its status: its row already
    // names the sources, so none is read again.
    get('/next', { project, state: 'blocked:dependency', assignee: 'any', limit: 100 }),
    // Every task whose change is out, every page: the release queue is counted
    // from these, and a slice's limit would hide all but its first rows.
    all('/tasks', { project, status: WORKED, ref_role: 'implements', limit: 100 }, 'tasks'),
    get('/agent-runs', { project, status: 'running', agent: 'flow child', limit: 100 }),
    get('/agent-runs', { project, status: 'running', agent: 'flow child', by: 'me', limit: 100 }),
    // Every running run, whoever started it: a reviewer outside the tick
    // that recorded its run holds the task as surely as a child does.
    repos?.length ? get('/agent-runs', { project, status: 'running', limit: 100 }) : { runs: [] },
  ]);
  progress(`flow: ${implemented.length} tasks with a change out`);
  const sliced = [...waiting.tasks, ...dateCame.tasks, ...holdCleared.tasks];
  // A listed row already answers what get-task would: each get-task loads the
  // whole graph, so reading it again per row was most of the Flow side's time.
  const full = {};
  for (const row of implemented) {
    const answer = answerOfRow(row);
    if (answer) {
      full[row.id] = answer;
    }
  }
  // Under a branch cap, a candidate's repos are its references, so each
  // candidate is read too; otherwise get-next's row is all it needs.
  const capped = Boolean(extra.params?.branchesPerRepo);
  const ids = [...new Set([...sliced, ...implemented, ...(capped ? next.tasks || [] : [])].map((t) => { return t.id; }).concat(children.runs.flatMap((r) => { return r.works_on || []; })))]
    .filter((id) => { return !full[id]; });
  // A task Flow cannot answer right now is named in `needs.unread`, never guessed.
  const unread = [];
  let read = 0;
  await mapLimit(ids, 4, async (id) => {
    try {
      full[id] = await get(`/tasks/${id}`);
    } catch (error) {
      unread.push({ task: id, error: error.message });
    }
    read += 1;
    if (read % 20 === 0 || read === ids.length) {
      progress(`flow: ${read}/${ids.length} tasks read`);
    }
  });
  const implementsOf = Object.fromEntries(Object.entries(full).map(([id, answer]) => {
    return [id, (answer.references || []).filter((r) => { return r.role === 'implements' && !r.retracted_at; }).map((r) => { return r.url; })];
  }).filter(([, urls]) => { return urls.length; }));
  // A row listed by `ref_role` with no live `implements` reference means Flow
  // did not apply the filter: it stays out, named, rather than widening the tick.
  const listed = implemented.filter((t) => {
    if (implementsOf[t.id] || !full[t.id]) {
      return true;
    }
    unread.push({ task: t.id, error: 'listed by ref_role=implements without a live implements reference' });
    return false;
  });
  const slices = [...sliced, ...listed];
  // With the repos known, the code host is read with `gh`: each change a task
  // implements, each repo's default branch and its open repair task. A change
  // or repo `gh` cannot read stays in `needs`, never guessed.
  const hostErrors = [];
  let repairRows = [];
  if (repos?.length) {
    const opts = { ...(gh ? { gh } : {}), reviewers };
    // A repo the session cannot read fails every change in it the same way:
    // named once, and its changes are not asked for again.
    const blind = new Map();
    let defaults = [];
    if (host === 'full') {
      defaults = await mapLimit(repos, 2, async (repo) => {
        try {
          return await readDefault(repo, opts);
        } catch (error) {
          hostErrors.push({ repo, error: firstLine(error) });
          if (unreadable(error)) {
            blind.set(repo, firstLine(error));
          }
          return null;
        }
      });
      const repairs = await get('/tasks', { project, tag: 'repair', status: ['active', 'waiting'], limit: 100 });
      repairRows = repairs.tasks || [];
      // Each repair task read once, not once per repo.
      const repairRefs = Object.fromEntries(await mapLimit(repairRows, 4, async (task) => {
        return [task.id, (full[task.id] || await get(`/tasks/${task.id}`)).references || []];
      }));
      for (const d of defaults.filter(Boolean)) {
        const found = repairRows.find((task) => { return repairRefs[task.id].some((r) => { return r.url.includes(`github.com/${d.repo}/`); }); });
        if (found) {
          d.repairTask = found.id;
        }
      }
    }
    extra = { ...extra, defaults: extra.defaults || defaults.filter(Boolean), tasks: { ...(extra.tasks || {}) } };
    const red = new Map((extra.defaults || []).map((d) => { return [d.repo, d.red]; }));
    const enforced = new Map((extra.defaults || []).map((d) => { return [d.repo, d.reviewEnforced ?? null]; }));
    const holders = new Set([...children.runs, ...running.runs].flatMap((r) => { return r.works_on || []; }));
    const toRead = Object.entries(implementsOf).filter(([task]) => { return !given(extra.tasks[task]); });
    // Each repo the changes live in is asked once before any change: one the
    // session cannot read (the repo outside the session's access, say) is
    // skipped from the start, not refused once per change.
    const known = new Set([...blind.keys(), ...defaults.filter(Boolean).map((d) => { return d.repo; })]);
    const unknown = [...new Set(toRead.flatMap(([, urls]) => { return urls.map((u) => { return parseChangeUrl(u)?.repo; }); }).filter(Boolean))]
      .filter((repo) => { return !known.has(repo); });
    await mapLimit(unknown, 4, async (repo) => {
      try {
        await (gh || ghApi)(`repos/${repo}`);
      } catch (error) {
        if (unreadable(error)) {
          blind.set(repo, firstLine(error));
          hostErrors.push({ repo, error: firstLine(error) });
        }
      }
    });
    if (blind.size) {
      progress(`host: not readable by this session: ${[...blind.keys()].join(', ')}`);
    }
    const total = toRead.reduce((n, [, urls]) => { return n + urls.length; }, 0);
    let done = 0;
    const readOne = async (task, url) => {
      const repo = parseChangeUrl(url)?.repo;
      try {
        if (repo && blind.has(repo)) {
          throw Object.assign(new Error(`${repo} is not readable by this session: ${blind.get(repo)}`), { skipped: true });
        }
        return host === 'state' ? await readChangeState(url, opts) : await readChange(url, opts);
      } catch (error) {
        if (repo && !error.skipped && unreadable(error)) {
          blind.set(repo, firstLine(error));
        }
        hostErrors.push({ task, url, ...(repo ? { repo } : {}), error: firstLine(error) });
        return null;
      } finally {
        done += 1;
        if (done % 10 === 0 || done === total) {
          progress(`host: ${done}/${total} changes`);
        }
      }
    };
    // Rounds are Flow's answer, from the runs on the task, never a count the
    // model carries between ticks; where a change stands needs none. One read
    // for every task that needs them, started beside the host reads.
    const counted = host === 'state' ? [] : toRead.map(([task]) => { return task; }).filter((task) => { return extra.tasks[task]?.rounds === undefined; });
    const childRuns = counted.length
      ? all('/agent-runs', { project, task: counted, agent: 'flow child', limit: 100 }, 'runs').catch((error) => { return { error }; })
      : null;
    await mapLimit(toRead, host === 'state' ? 8 : 4, async ([task, urls]) => {
      // One change the host cannot read never hides the others the task cites,
      // but a task whose open changes are all unread is left out: what it reads
      // as integrated may not be, and the planner would close it.
      const changes = (await Promise.all(urls.map((u) => { return readOne(task, u); }))).filter(Boolean);
      if (!changes.length || (changes.length < urls.length && !changes.some((c) => { return !c.merged && !c.closed; }))) {
        return;
      }
      try {
        // A fix run counts once, whichever of the task's changes it pushed to.
        const runs = counted.includes(task) ? await childRuns : null;
        if (runs?.error) {
          throw runs.error;
        }
        const own = runs?.filter((r) => { return (r.works_on || []).includes(task); });
        const rounds = extra.tasks[task]?.rounds ?? (own ? roundsOf({ runs: own, changes }) : 0);
        const updated = full[task]?.task?.updated_at;
        extra.tasks[task] = {
          ...(extra.tasks[task] || {}),
          rounds,
          changes: changes.map((change) => {
            const { title, task: named, mergedAt, pipelineDoneAt, createdAt, ...rest } = change;
            // Written after the merge and after its pipeline finished: the tick
            // (or a person) already applied what integrating left.
            const settled = [mergedAt, pipelineDoneAt].filter(Boolean).map(Date.parse);
            const writtenSince = Boolean(change.merged && updated && settled.length && Date.parse(updated) > Math.max(...settled));
            return { ...rest, writtenSince, redOnDefault: red.get(change.repo) ?? null, reviewEnforced: enforced.get(change.repo) ?? null, reviewRunActive: holders.has(task) };
          }),
        };
      } catch (error) {
        hostErrors.push({ task, error: firstLine(error) });
      }
    });
  }
  const snapshot = build({
    now,
    candidates: next.tasks || [],
    slices,
    held: held.tasks || [],
    dueIds: new Set([...dateCame.tasks, ...holdCleared.tasks].map((t) => { return t.id; })),
    children: children.runs,
    mine: new Set(mine.runs.map((r) => { return r.id; })),
    childTasks: Object.fromEntries(Object.entries(full).map(([id, a]) => { return [id, a.task]; })),
    implementsOf,
    handoffs: Object.fromEntries(Object.entries(full).map(([id, a]) => { return [id, a.task?.after_integration ?? null]; })),
    references: Object.fromEntries(Object.entries(full).map(([id, a]) => { return [id, a.references || []]; })),
    projectRepos: repos,
    repairRows,
    focusIds: focus ? new Set((next.tasks || []).map((t) => { return t.id; })) : null,
    extra,
  });
  snapshot.needs.unread = unread;
  snapshot.needs.host = hostErrors;
  // What Flow answered of each row (title, url, readiness, unblocks), for a
  // caller that would otherwise read every task again; out of the JSON.
  const rows = {};
  for (const row of [...(held.tasks || []), ...(next.tasks || []), ...slices, ...repairRows]) {
    rows[row.id] = row;
  }
  Object.defineProperty(snapshot, 'rows', { value: rows, enumerable: false });
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
  // What only the tick knows this run, such as `branchesPerRepo` when its
  // children share its push branch, is laid over the file's parameters.
  if (p) {
    extra.params = { ...p.params, ...(extra.params || {}) };
  }
  const progress = (line) => { process.stderr.write(`${line}\n`); };
  run({ client: clientFromEnv(), project, now: f.now, extra, repos: p?.repos, reviewers: p?.reviewers ?? [], progress }).then(
    (result) => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); },
    (error) => { process.stderr.write(`${error.message}\n`); process.exit(1); },
  );
}
