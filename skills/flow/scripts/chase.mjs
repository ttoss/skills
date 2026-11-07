import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { clientFromEnv, mapLimit, parseFlags } from './flow-api.mjs';
import { load as loadParams } from './params.mjs';
import { effectivePriority, inReleaseQueue, urgencyTier } from './plan.mjs';
import { run as readSnapshot } from './snapshot.mjs';

// The Chase's digest (references/chase.md): what only a person can do to drain
// the release queue, in the order the tick works, and, while the queue is within
// its limit, the decisions the team owes. Read from the tick's own snapshot,
// so the Chase and the tick never disagree about what is in the queue. It
// writes nothing. The model records the run, translates the words and delivers
// the digest.
//
// Usage: node chase.mjs --root <repo dir> [--now <ISO 8601>]
//   reads the parameters there (project, Release queue, repos)
//   and the code host with `gh`; or --project <proj_…> [--extra <file>]
//   [--release-queue 20], with what the code host knows in the
//   file as snapshot.mjs takes it.
// Output: JSON `{ digest, queue: { now, limit }, person, decisions }`.

const DEFAULT_LIMIT = 20;
const PRIORITY = ['very_high', 'high', 'medium', 'low', 'very_low'];

const priorityRank = (priority) => {
  const i = PRIORITY.indexOf(priority);
  return i === -1 ? PRIORITY.length : i;
};

/**
 * The order the tick works in (process rule 3): a `very_high` task, then a
 * `high` bug; then integrated work waiting to be seen in effect before an open
 * change, since a regression in effect runs until somebody looks; then Flow's
 * ranking, priority then how many tasks it frees; then the oldest date its
 * wait gives.
 */
export const byTickOrder = (a, b) => {
  return urgencyTier(a) - urgencyTier(b)
    || Number(Boolean(b.change?.merged)) - Number(Boolean(a.change?.merged))
    || priorityRank(effectivePriority(a)) - priorityRank(effectivePriority(b))
    || (b.unblocks || 0) - (a.unblocks || 0)
    || String(a.since || '9999').localeCompare(String(b.since || '9999'));
};

const whoOf = ({ members = [], teams = [] }) => {
  const email = new Map(members.map((m) => { return [m.user_id, m.email]; }));
  const admins = members.filter((m) => { return m.role === 'admin' && !m.pending; }).map((m) => { return m.email; });
  const teamOf = new Map(teams.map((t) => { return [t.id, t]; }));
  return (ids) => {
    const named = (ids || []).flatMap((id) => {
      if (teamOf.has(id)) {
        const team = teamOf.get(id);
        const each = (team.members || []).map((m) => { return email.get(m.user_id || m) || m; });
        return each.length ? each : [team.name];
      }
      return [email.get(id) || id];
    });
    return [...new Set(named)].join(', ') || admins.join(', ');
  };
};

const waitOn = (detail, holders) => {
  const waits = (detail?.readiness?.blocked_by || []).filter((b) => { return b.via === 'wait'; });
  return waits.find((w) => { return holders.includes(w.on); }) || waits[0] || null;
};

/**
 * The digest's two lists from what was read, as a pure function. Each shows
 * as many lines as the release queue's limit, the size the project set for what
 * may wait on a person. `tasks` is
 * the snapshot's; `details` each task's `get-task` answer, by id, for those
 * waiting on a person; `decisions` the `waiting` rows `get-next` ranked.
 */
export const pick = ({ tasks, details = {}, decisions = [], limit = DEFAULT_LIMIT, members = [], teams = [] }) => {
  const who = whoOf({ members, teams });
  const queue = tasks.filter(inReleaseQueue);
  // A task in the queue that waits on nobody is the agents' or the gates': an
  // agent can move it, so the Chase leaves it to them.
  const person = queue.filter((t) => { return (t.waitsOn || []).length > 0; }).map((t) => {
    const detail = details[t.id] || {};
    const wait = waitOn(detail, t.waitsOn);
    return {
      id: t.id,
      title: detail.task?.title || t.id,
      url: detail.task?.url || `https://flow.ttoss.dev/app/tasks/${t.id}`,
      who: who(t.waitsOn),
      what: wait?.reason || (t.change?.merged ? 'see the change in effect' : 'integrate the change'),
      priority: t.priority,
      inherited: t.inherited ?? null,
      tags: t.tags,
      change: t.change,
      unblocks: detail.unblocks ?? 0,
      since: wait?.until || null,
    };
  }).sort(byTickOrder);
  // The decision queue: what waits on a person's answer before it can start,
  // a `decision` or a task whose brief needs one; a task with its change out
  // is the release queue's. Decisions hold only the work they block, and new
  // work waits while the queue is over its limit, so they are worth a person's
  // time only within it.
  const within = queue.length <= limit;
  const out = new Set(tasks.filter((t) => { return t.change; }).map((t) => { return t.id; }));
  const answers = decisions.filter((row) => {
    return !out.has(row.id) && (row.readiness?.blocked_by || []).some((b) => { return b.via === 'wait' && b.on; });
  });
  const owed = within ? answers.slice(0, limit).map((row) => {
    const wait = (row.readiness?.blocked_by || []).find((b) => { return b.via === 'wait' && b.on; });
    return { id: row.id, title: row.title, url: row.url, who: who([wait.on]), what: wait.reason || 'decide' };
  }) : null;
  return {
    queue: { now: queue.length, limit },
    person: person.slice(0, limit),
    personTotal: person.length,
    decisions: owed,
    decisionsTotal: within ? answers.length : null,
  };
};

const WHAT_MAX = 280;

/**
 * What the person does, kept whole when it fits; a longer reason is cut at
 * its last sentence that fits, else its last word, so a line never ends
 * mid-word.
 */
export const shorten = (text, max = WHAT_MAX) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) {
    return flat;
  }
  const head = flat.slice(0, max);
  const sentence = head.match(/^.*[.;:!?](?=\s)/);
  if (sentence && sentence[0].length >= max / 2) {
    return `${sentence[0]} …`;
  }
  return `${head.slice(0, head.lastIndexOf(' ')).replace(/[\s,;:—-]+$/, '')} …`;
};

const lineOf = (item) => {
  return `- [${item.title}](${item.url}) — ${item.who} — ${shorten(item.what)}`;
};

/** The digest text: the queue against its limit, then the two lists. */
export const digest = ({ date, picked }) => {
  const { queue, person, personTotal, decisions, decisionsTotal } = picked;
  const lines = [`# Chase — ${date}`, ''];
  lines.push(queue.now > queue.limit
    ? `Release queue: ${queue.now}, limit ${queue.limit}. The tick starts no new work until it is within the limit; these are what only a person can move.`
    : `Release queue: ${queue.now}, limit ${queue.limit}. The tick starts new work; the decisions below hold what it would start next.`);
  lines.push('', `## Only a person can move these (${person.length} of ${personTotal})`);
  lines.push(...(person.length ? person.map(lineOf) : ['- none']));
  if (decisions) {
    lines.push('', `## Decisions the team owes (${decisions.length} of ${decisionsTotal})`);
    lines.push(...(decisions.length ? decisions.map(lineOf) : ['- none']));
  }
  return lines.join('\n');
};

/** Every read the digest needs, then the digest. */
export const run = async ({ client, project, now = new Date().toISOString(), extra = {}, repos = null, reviewers = [], gh, limit = null }) => {
  const { get } = client;
  const [projectAnswer, snapshot] = await Promise.all([
    get(`/projects/${project}`),
    readSnapshot({ client, project, now, extra, repos, reviewers, gh }),
  ]);
  const queueLimit = limit ?? snapshot.params.releaseQueue ?? DEFAULT_LIMIT;
  const waitingOnPerson = snapshot.tasks.filter((t) => { return inReleaseQueue(t) && (t.waitsOn || []).length > 0; });
  const details = Object.fromEntries(await mapLimit(waitingOnPerson, 4, async (t) => {
    return [t.id, await get(`/tasks/${t.id}`)];
  }));
  const within = snapshot.tasks.filter(inReleaseQueue).length <= queueLimit;
  const decisions = within
    ? await get('/next', { project, status: 'waiting', assignee: 'any', limit: 100 })
    : { tasks: [] };
  const picked = pick({
    tasks: snapshot.tasks, details, decisions: decisions.tasks || [], limit: queueLimit,
    members: projectAnswer.members, teams: projectAnswer.teams,
  });
  return {
    digest: digest({ date: now.slice(0, 10), picked }),
    queue: picked.queue,
    person: picked.personTotal,
    decisions: picked.decisionsTotal,
    needs: snapshot.needs,
  };
};

const isMain = process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain) {
  const f = parseFlags(process.argv.slice(2));
  // --root reads the project's parameters (params.mjs): the project, the
  // release queue's limit, the Chase's size and the repos the code host is
  // read in.
  const p = f.root ? loadParams(f.root) : null;
  const project = f.project || p?.projectId;
  if (!project) {
    process.stderr.write('usage: chase.mjs (--root <repo dir> | --project <proj_…> [--extra <file>]) [--release-queue 20] [--now <ISO>]\n');
    process.exit(2);
  }
  const extra = f.extra ? JSON.parse(readFileSync(f.extra, 'utf8')) : {};
  if (p && !extra.params) {
    extra.params = p.params;
  }
  run({
    client: clientFromEnv(),
    project,
    now: f.now,
    extra,
    repos: p?.repos,
    reviewers: p?.reviewers ?? [],
    limit: f['release-queue'] ? Number(f['release-queue']) : null,
  }).then(
    (result) => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); },
    (error) => { process.stderr.write(`${error.message}\n`); process.exit(1); },
  );
}
