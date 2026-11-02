import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { clientFromEnv, mapLimit, parseFlags } from './flow-api.mjs';
import { chase as healthLines, readFlow } from './health.mjs';
import { mergedSince, readChange, readyChanges } from './host.mjs';
import { load as loadParams } from './params.mjs';

// The Chase's digest (references/chase.md): every section, its order, its
// size and the health lines, read from Flow with the project's API key. It
// writes nothing. The model records the run, passes what only the code host
// knows in a small file, translates the words and delivers the digest.
//
// Usage: node chase.mjs --root <repo dir> [--now <ISO 8601>]
//   reads the parameters there (project, size, Stale after, repos) and the code
//   host with `gh`; or --project <proj_…> [--host <file>] [--lines 5]
//   [--stale-after-hours 4] with the code host's facts in a file:
// --host is JSON the model reads from the code host:
//   { "integratedSinceLastChase": 3,
//     "waitingChanges": [{ "url", "title", "task": "task_…" }],  // ready, not draft, checks and review passed
//     "integratedTasks": ["task_…"] }                           // tasks whose `implements` change is integrated
// Output: JSON `{ digest, sections, alert, mismatches }`; `digest` is the text.

const HOUR = 3_600_000;
const DAY = 86_400_000;
const OPEN = ['active', 'waiting', 'calendar', 'blocked'];
const AGENTS = ['flow tick', 'flow child', 'flow chase'];

const ACTIONS = {
  retracted_basis: 'propose a new basis, or reconsider it: it cites a withdrawn record as its cause',
  supersedes_cycle: 'say which supersedes edge to retract: these records supersede each other in a loop',
  canonical_memory_or_view: 'cite the source it was derived from instead of a memory or a view',
  self_basis: 'retract the edge that cites itself and name a real cause',
  calendar_without_date: 'give the date: it is on calendar with no scheduled wait carrying one',
};

export const SECTIONS = [
  'Critical bugs',
  'Changes waiting to be integrated by a person',
  'No owner',
  'Overdue checks',
  'Old decisions',
  'Stale sessions',
  'Overdue waits',
  'Findings and due reviews',
];

/** An external wait past its date, or with no date and untouched for a week. */
export const isDueWait = (row, nowMs) => {
  const wait = (row.readiness?.blocked_by || []).find((b) => { return b.via === 'wait'; });
  if (!wait || row.kind === 'decision') {
    return false;
  }
  return wait.until ? Date.parse(wait.until) <= nowMs : Boolean(row.review_due_at && Date.parse(row.review_due_at) <= nowMs);
};

const waitOf = (row) => {
  return (row.readiness?.blocked_by || []).find((b) => { return b.via === 'wait'; });
};

// Holding the most tasks first, then the oldest (the earliest date given).
const byWeight = (a, b) => {
  return (b.unblocks || 0) - (a.unblocks || 0) || String(a.since || '').localeCompare(String(b.since || ''));
};

/**
 * The sections from what was read, as a pure function: each task once, in the
 * first section that takes it; the items of a section in order.
 */
export const sections = ({ now, project, members, teams = [], bugs, runningRuns, waits, dateCame, decisions, staleRuns, staleTasks, findings, findingTasks, reviews, host, staleAfterHours }) => {
  const nowMs = Date.parse(now);
  const email = new Map(members.map((m) => { return [m.user_id, m.email]; }));
  const admins = members.filter((m) => { return m.role === 'admin' && !m.pending; }).map((m) => { return m.email; });
  const teamOf = new Map(teams.map((t) => { return [t.id, t]; }));
  const who = (id) => {
    if (!id) {
      return admins.join(', ');
    }
    if (teamOf.has(id)) {
      const team = teamOf.get(id);
      return (team.members || []).map((m) => { return email.get(m.user_id || m) || m; }).join(', ') || team.name;
    }
    return email.get(id) || id;
  };
  const taken = new Set();
  const out = Object.fromEntries(SECTIONS.map((s) => { return [s, { items: [], more: 0, note: null }]; }));
  const put = (section, item) => {
    if (taken.has(item.id)) {
      return;
    }
    taken.add(item.id);
    out[section].items.push(item);
  };

  // 1. Critical bugs, and what holds each.
  const onTime = [];
  for (const bug of bugs) {
    const runs = runningRuns.filter((r) => { return (r.works_on || []).includes(bug.id); });
    const agentsOnly = runs.length > 0 && runs.every((r) => {
      return ['flow tick', 'flow child'].includes(r.agent) && nowMs - Date.parse(r.started_at) < staleAfterHours * HOUR;
    });
    const wait = waitOf(bug);
    const blocker = (bug.readiness?.blocked_by || []).find((b) => { return b.via === 'task'; });
    if (agentsOnly && !wait) {
      onTime.push(bug.id);
      taken.add(bug.id);
      continue;
    }
    let holder;
    let acts;
    if (wait) {
      holder = `waits: ${wait.reason}`;
      acts = who(wait.on);
    } else if (blocker) {
      holder = blocker.id ? `held by ${blocker.title || blocker.id}` : 'held by a task in a project you cannot see';
      acts = who(bug.assignee);
    } else if (runs.length) {
      holder = `held by a run past its time: ${runs.map((r) => { return r.url; }).join(', ')}`;
      acts = runs.map((r) => { return who(r.by); }).join(', ');
    } else {
      holder = 'ready, nobody took it';
      acts = who(bug.assignee);
    }
    put('Critical bugs', { id: bug.id, title: bug.title, url: bug.url, who: acts, what: holder, unblocks: bug.unblocks, since: bug.updated_at });
  }
  if (onTime.length) {
    out['Critical bugs'].note = `${onTime.length} with agents, on time`;
  }

  // 2. Changes waiting to be integrated by a person: their task waits on one.
  const waitingOnPerson = new Map(waits.filter((w) => { return waitOf(w)?.on; }).map((w) => { return [w.id, w]; }));
  if (!host) {
    out['Changes waiting to be integrated by a person'].note = 'the code host was not read';
  } else {
    for (const change of host.waitingChanges || []) {
      const task = waitingOnPerson.get(change.task);
      if (task) {
        put('Changes waiting to be integrated by a person', { id: task.id, title: change.title || task.title, url: change.url, who: who(waitOf(task).on), what: `integrate it, for ${task.url}`, unblocks: task.unblocks, since: task.updated_at });
      }
    }
  }

  // 3. No owner, overdue checks and overdue waits, from every external wait.
  const integrated = new Set(host?.integratedTasks || []);
  for (const row of [...waits].sort(byWeight)) {
    if (row.kind === 'decision') {
      continue;
    }
    const wait = waitOf(row);
    if (!wait) {
      continue;
    }
    const until = wait.until ? Date.parse(wait.until) : null;
    if (!isDueWait(row, nowMs)) {
      continue;
    }
    const late = until !== null ? `overdue ${Math.floor((nowMs - until) / DAY)}d` : 'no chase date, untouched for a week';
    const item = { id: row.id, title: row.title, url: row.url, unblocks: row.unblocks, since: wait.until || row.review_due_at };
    if (!wait.on) {
      put('No owner', { ...item, who: who(null), what: `name whom this waits on (${late}): ${wait.reason}` });
    } else if (integrated.has(row.id)) {
      put('Overdue checks', { ...item, who: who(wait.on), what: `run the check (${late}): ${wait.reason}` });
    } else {
      put('Overdue waits', { ...item, who: who(wait.on), what: `${late}: ${wait.reason}` });
    }
  }
  for (const row of dateCame) {
    const wait = waitOf(row);
    put('Overdue checks', { id: row.id, title: row.title, url: row.url, who: who(wait?.on || row.assignee), what: `its date came and no check ran${wait ? `: ${wait.reason}` : ''}`, unblocks: row.unblocks, since: wait?.until || row.review_due_at });
  }

  // 4. Old decisions.
  for (const row of [...decisions].sort(byWeight)) {
    const wait = waitOf(row);
    put('Old decisions', { id: row.id, title: row.title, url: row.url, who: who(wait?.on || row.assignee), what: `decide, untouched for a week${wait ? `: ${wait.reason}` : ''}`, unblocks: row.unblocks, since: row.review_due_at });
  }

  // 5. Stale sessions: a person's run past Stale after, each open task it holds.
  for (const run of staleRuns.filter((r) => { return !AGENTS.includes(r.agent); })) {
    for (const id of run.works_on || []) {
      const task = staleTasks[id];
      if (task && OPEN.includes(task.status)) {
        put('Stale sessions', { id, title: task.title, url: task.url, who: who(run.by), what: `end or hand back the session holding it since ${run.started_at}: ${run.url}`, unblocks: 0, since: run.started_at });
      }
    }
  }

  // 6. Findings, then due reviews.
  for (const finding of findings.filter((f) => { return f.check !== 'wait_without_on'; })) {
    const id = finding.task || finding.to || finding.record || (finding.records || [])[0];
    const task = findingTasks[id];
    put('Findings and due reviews', { id, title: task?.title || id, url: task?.url || `https://flow.ttoss.dev/app/tasks/${id}`, who: who(task?.assignee), what: ACTIONS[finding.check] || finding.check, unblocks: 0, since: null });
  }
  for (const row of reviews.tasks) {
    put('Findings and due reviews', { id: row.id, title: row.title, url: row.url, who: who(row.assignee), what: 'confirm what still holds, saying what was checked, or change it', unblocks: row.unblocks, since: row.review_due_at });
  }
  out['Findings and due reviews'].extra = Math.max(0, (reviews.total || 0) - reviews.tasks.length);

  for (const name of SECTIONS) {
    if (!['Overdue waits', 'No owner', 'Findings and due reviews'].includes(name)) {
      out[name].items.sort(byWeight);
    }
  }
  return { sections: out, admins, project };
};

const lineOf = (item) => {
  return `- [${item.title}](${item.url}) — ${item.who} — ${item.what}`;
};

/** The digest text: title, alert, a line per person, the sections, the health lines. */
export const digest = ({ date, sections: out, alert, admins, health, base, size }) => {
  const lines = [`# Chase — ${date}`];
  if (alert) {
    lines.push('', `**${admins.join(', ')}**: ${alert}`);
  }
  const shown = Object.fromEntries(SECTIONS.map((name) => { return [name, out[name].items.slice(0, size)]; }));
  const people = new Map();
  for (const name of SECTIONS) {
    for (const item of shown[name]) {
      for (const person of item.who.split(', ').filter(Boolean)) {
        const entry = people.get(person) || { count: 0, sections: new Set() };
        entry.count += 1;
        entry.sections.add(name);
        people.set(person, entry);
      }
    }
  }
  if (people.size) {
    lines.push('');
    for (const [person, entry] of [...people].sort((a, b) => { return b[1].count - a[1].count; })) {
      lines.push(`- ${person}: ${entry.count} ${entry.count === 1 ? 'line' : 'lines'} (${[...entry.sections].join(', ')})`);
    }
  }
  for (const name of SECTIONS) {
    const section = out[name];
    const more = section.items.length - shown[name].length + (section.extra || 0);
    if (!section.items.length && !section.note && name !== 'Critical bugs') {
      continue;
    }
    lines.push('', `## ${name}`);
    lines.push(...shown[name].map(lineOf));
    if (section.note) {
      lines.push(`- ${section.note}`);
    }
    if (name === 'Critical bugs' && !section.items.length && !section.note) {
      lines.push('- none');
    }
    if (more > 0) {
      lines.push(`- and ${more} more`);
    }
  }
  lines.push('', '## Health', ...base.map((l) => { return `- ${l}`; }), ...health.map((l) => { return `- ${l}`; }));
  return lines.join('\n');
};

/** Every read the digest needs, then the digest. */
export const run = async ({ client, project, now = new Date().toISOString(), host = null, repos = null, gh, size = 5, staleAfterHours = 4 }) => {
  const { get, all } = client;
  const staleBefore = new Date(Date.parse(now) - staleAfterHours * HOUR).toISOString();
  const [projectAnswer, bugsHigh, veryHigh, runningRuns, waits, dateCame, decisions, staleRuns, validation, ready, chases] = await Promise.all([
    get(`/projects/${project}`),
    all('/tasks', { project, tag: 'bug', priority: ['very_high', 'high'], status: OPEN, limit: 100 }, 'tasks'),
    all('/tasks', { project, priority: 'very_high', status: OPEN, limit: 100 }, 'tasks'),
    get('/agent-runs', { project, status: 'running', limit: 100 }),
    all('/tasks', { project, status: 'waiting', state: 'blocked:external', limit: 100 }, 'tasks'),
    get('/next', { project, slice: 'date_came', assignee: 'any', limit: 100 }),
    get('/next', { project, kind: 'decision', status: 'waiting', assignee: 'any', review_due: true, limit: 100 }),
    get('/agent-runs', { project, status: 'running', until: staleBefore, limit: 100 }),
    get(`/projects/${project}/validate`),
    get('/next', { project, limit: 1 }),
    get('/agent-runs', { project, agent: 'flow chase', limit: 5 }),
  ]);
  // The code host's facts, read with `gh` when the repos are known and no
  // --host file was given: ready changes, the due waits whose change is
  // integrated, and the merges since the last Chase.
  const last = (chases.runs || []).find((r) => { return r.status !== 'running'; });
  let hostError = null;
  if (!host && repos?.length) {
    try {
    const nowMs = Date.parse(now);
    const due = waits.filter((w) => { return isDueWait(w, nowMs); });
    const implemented = await mapLimit(due, 4, async (w) => {
      const refs = ((await get(`/tasks/${w.id}`)).references || []).filter((r) => { return r.role === 'implements' && !r.retracted_at; });
      const changes = await Promise.all(refs.map((r) => { return readChange(r.url, gh ? { gh } : {}); }));
      return changes.some((c) => { return c?.merged; }) ? w.id : null;
    });
    const ready = await readyChanges(repos, gh ? { gh } : {});
    host = {
      waitingChanges: ready.map((c) => { return { url: c.url, title: c.title, task: c.task }; }),
      integratedTasks: implemented.filter(Boolean),
      integratedSinceLastChase: last ? await mergedSince(repos, last.started_at, gh ? { gh } : {}) : null,
    };
    } catch (error) {
      // A repo `gh` cannot read leaves the code host out, said, never guessed.
      host = null;
      hostError = String(error.stderr || error.message).split('\n')[0].slice(0, 200);
    }
  }
  const bugIds = new Set();
  const bugs = [...bugsHigh, ...veryHigh].filter((b) => { return !bugIds.has(b.id) && bugIds.add(b.id); });

  const staleIds = [...new Set(staleRuns.runs.filter((r) => { return !AGENTS.includes(r.agent); }).flatMap((r) => { return r.works_on || []; }))];
  const findingIds = [...new Set(validation.findings.filter((f) => { return f.check !== 'wait_without_on'; }).map((f) => { return f.task || f.to || f.record || (f.records || [])[0]; }))];
  const tasks = Object.fromEntries(await mapLimit([...new Set([...staleIds, ...findingIds])], 4, async (id) => {
    return [id, (await get(`/tasks/${id}`)).task];
  }));
  // Due reviews take the section's size plus whatever earlier sections took.
  const reviews = await get('/next', { project, slice: 'review', assignee: 'any', sort: 'review_due_at', limit: Math.min(200, size + bugs.length + waits.length + decisions.tasks.length) });

  const built = sections({
    now, project, members: projectAnswer.members, teams: projectAnswer.teams,
    bugs, runningRuns: runningRuns.runs, waits, dateCame: dateCame.tasks, decisions: decisions.tasks,
    staleRuns: staleRuns.runs, staleTasks: tasks, findings: validation.findings, findingTasks: tasks,
    reviews, host, staleAfterHours,
  });
  // The newest earlier Chase that finished (`last`) starts "since the last Chase".
  const ticks = last ? await get('/agent-runs', { project, agent: 'flow tick', since: last.started_at, limit: 100 }) : { runs: [] };
  const noPlanner = ticks.runs.filter((r) => { return r.summary && !/^flow tick: (plan|fallback):/.test(r.summary); });
  const noSummary = ticks.runs.filter((r) => { return !r.summary && r.status !== 'running'; });
  const staleHolding = staleIds.filter((id) => { return tasks[id]?.status === 'active'; }).length;
  const base = [
    `Integrated since the last Chase: ${host ? (host.integratedSinceLastChase ?? 'no earlier Chase') : `the code host was not read${hostError ? ` (${hostError})` : ''}`}`,
    `Ready: ${ready.total}, ${staleHolding} of them held by a stale session`,
    `Overdue waits naming nobody: ${built.sections['No owner'].items.length}`,
    `Ticks since the last Chase: ${ticks.runs.length}${ticks.runs.length === 100 ? ' (may be short)' : ''}, ${noPlanner.length} without the planner${noPlanner.length ? ` (${noPlanner.map((r) => { return r.url; }).join(', ')})` : ''}, ${noSummary.length} without a summary${noSummary.length ? ` (${noSummary.map((r) => { return r.url; }).join(', ')})` : ''}`,
  ];

  const health = healthLines(await readFlow({ routine: 'chase', project, now, client }));
  return {
    digest: digest({ date: now.slice(0, 10), sections: built.sections, alert: health.alert, admins: built.admins, health: health.lines, base, size }),
    sections: Object.fromEntries(SECTIONS.map((name) => { return [name, built.sections[name].items.length]; })),
    alert: health.alert,
    mismatches: health.mismatches,
  };
};

const isMain = process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain) {
  const f = parseFlags(process.argv.slice(2));
  // --root reads the project's parameters (params.mjs): the project, the
  // Chase's size, Stale after and the repos the code host is read in.
  const p = f.root ? loadParams(f.root) : null;
  const project = f.project || p?.projectId;
  if (!project) {
    process.stderr.write('usage: chase.mjs (--root <repo dir> | --project <proj_…>) [--host <file> | --no-host] [--lines 5] [--stale-after-hours 4] [--now <ISO>]\n');
    process.exit(2);
  }
  run({
    client: clientFromEnv(),
    project,
    now: f.now,
    host: f.host ? JSON.parse(readFileSync(f.host, 'utf8')) : null,
    repos: f['no-host'] ? null : p?.repos,
    size: f.lines ? Number(f.lines) : p?.chaseLines ?? 5,
    staleAfterHours: f['stale-after-hours'] ? Number(f['stale-after-hours']) : p?.params.staleAfterHours ?? 4,
  }).then(
    (result) => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); },
    (error) => { process.stderr.write(`${error.message}\n`); process.exit(1); },
  );
}
