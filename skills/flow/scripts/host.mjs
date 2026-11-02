import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { mapLimit, parseFlags } from './flow-api.mjs';

// What the routines read on the code host, through the `gh` CLI (GitHub, the
// default code host): a change's state in plan.mjs's schema, a default
// branch's head, the ready changes and the merges since a date. Reads only.
// A project on another code host passes the same facts by hand.
//
// Usage: node host.mjs change <url>…  |  node host.mjs default <owner/repo>…
// Output: JSON.

const run = promisify(execFile);

/** `gh api` as JSON; `paginate` joins every page of an array. */
export const ghApi = async (path, { paginate = false } = {}) => {
  const args = ['api', path, ...(paginate ? ['--paginate', '--slurp'] : [])];
  const { stdout } = await run('gh', args, { maxBuffer: 64 * 1024 * 1024 });
  const value = JSON.parse(stdout);
  return paginate ? value.flat() : value;
};

// A cancelled run is not a failure: a pipeline cancels a run a newer push replaced.
const RED = ['failure', 'timed_out', 'action_required', 'startup_failure'];

/** A set of check runs as plan.mjs reads them: null when there are none. */
export const checksOf = (all) => {
  // The newest run of each check, so a re-run that passed replaces its failure.
  const latest = new Map();
  for (const run of all) {
    const prev = latest.get(run.name);
    if (!prev || String(run.started_at || '') > String(prev.started_at || '')) {
      latest.set(run.name, run);
    }
  }
  const runs = [...latest.values()].filter((r) => { return r.conclusion !== 'cancelled' && r.conclusion !== 'skipped'; });
  if (!runs.length) {
    return null;
  }
  if (runs.some((r) => { return RED.includes(r.conclusion); })) {
    return 'red';
  }
  return runs.every((r) => { return r.status === 'completed'; }) ? 'green' : 'pending';
};

/**
 * The newest review verdict among a change's comments: one naming a commit
 * and saying CLEAN or FINDINGS (child-prompt.md's review child, or a
 * project's reviewer writing `Verdict: CLEAN`).
 */
export const verdictOf = (comments) => {
  for (const comment of [...comments].reverse()) {
    const body = comment.body || '';
    const result = (/\bverdict\b\W*(CLEAN|FINDINGS)\b/i.exec(body) || /^\s*\**(CLEAN|FINDINGS)\b/m.exec(body) || [])[1];
    const sha = (/\b([0-9a-f]{40})\b/.exec(body) || /`([0-9a-f]{7,40})`/.exec(body) || [])[1];
    if (result && sha) {
      return { sha, result: result.toUpperCase() };
    }
  }
  return null;
};

const TASK = /task_[0-9a-hjkmnp-tv-z]{10}/;

export const parseChangeUrl = (url) => {
  const m = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/.exec(url);
  return m ? { repo: m[1], number: Number(m[2]) } : null;
};

/** A change as plan.mjs's snapshot holds it, from the code host. */
export const readChange = async (url, { gh = ghApi } = {}) => {
  const ref = parseChangeUrl(url);
  if (!ref) {
    return null;
  }
  let pull = await gh(`repos/${ref.repo}/pulls/${ref.number}`);
  if (pull.mergeable === null && pull.state === 'open') {
    // GitHub computes mergeability on demand: one more read after a moment.
    await new Promise((resolve) => { setTimeout(resolve, 1500); });
    pull = await gh(`repos/${ref.repo}/pulls/${ref.number}`);
  }
  const [head, comments] = await Promise.all([
    gh(`repos/${ref.repo}/commits/${pull.head.sha}/check-runs?per_page=100`),
    gh(`repos/${ref.repo}/issues/${ref.number}/comments?per_page=100`, { paginate: true }),
  ]);
  const verdict = verdictOf(comments);
  const merged = Boolean(pull.merged);
  let pipelineRedAfterMerge = false;
  let pipelineDoneAt = null;
  if (merged && pull.merge_commit_sha) {
    const after = await gh(`repos/${ref.repo}/commits/${pull.merge_commit_sha}/check-runs?per_page=100`);
    pipelineRedAfterMerge = checksOf(after.check_runs) === 'red';
    pipelineDoneAt = after.check_runs.map((r) => { return r.completed_at; }).filter(Boolean).sort().at(-1) || null;
  }
  return {
    url,
    repo: ref.repo,
    title: pull.title,
    task: (TASK.exec(pull.body || '') || [null])[0],
    draft: Boolean(pull.draft),
    headSha: pull.head.sha,
    checks: checksOf(head.check_runs),
    redOnDefault: null,
    conflict: pull.mergeable === false || pull.mergeable_state === 'dirty',
    merged,
    mergedAt: pull.merged_at,
    pipelineDoneAt,
    closed: pull.state === 'closed' && !merged,
    checksBeforeRepair: false,
    pipelineRedAfterMerge,
    verdict: verdict && pull.head.sha.startsWith(verdict.sha) ? { sha: pull.head.sha, result: verdict.result } : verdict,
    reviewRunActive: false,
    // Judgments: the planner asks for them with a `judge` act.
    touchesOwnGates: null,
    reservedToPerson: null,
  };
};

/** A repo's default branch head, and whether its checks are red there. */
export const readDefault = async (repo, { gh = ghApi } = {}) => {
  const meta = await gh(`repos/${repo}`);
  const branch = await gh(`repos/${repo}/branches/${meta.default_branch}`);
  const runs = await gh(`repos/${repo}/commits/${branch.commit.sha}/check-runs?per_page=100`);
  return { repo, sha: branch.commit.sha, red: checksOf(runs.check_runs) === 'red', repairTask: null };
};

/**
 * The open, non-draft changes whose checks are green and whose newest
 * verdict, if any, is CLEAN on its head: what the Chase calls ready for a
 * person to integrate, once their task waits on one.
 */
export const readyChanges = async (repos, { gh = ghApi } = {}) => {
  const out = [];
  for (const repo of repos) {
    const pulls = (await gh(`repos/${repo}/pulls?state=open&per_page=100`, { paginate: true })).filter((p) => { return !p.draft; });
    const changes = await mapLimit(pulls, 4, (p) => { return readChange(p.html_url, { gh }); });
    out.push(...changes.filter((c) => {
      return c && c.checks === 'green' && !c.conflict && (!c.verdict || (c.verdict.result === 'CLEAN' && c.verdict.sha === c.headSha));
    }));
  }
  return out;
};

/** How many changes each repo integrated since `since`, summed. */
export const mergedSince = async (repos, since, { gh = ghApi } = {}) => {
  let total = 0;
  for (const repo of repos) {
    const q = encodeURIComponent(`repo:${repo} is:pr is:merged merged:>=${since.slice(0, 19)}Z`);
    total += (await gh(`search/issues?q=${q}&per_page=1`)).total_count;
  }
  return total;
};

const isMain = process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain) {
  const [mode, ...rest] = process.argv.slice(2);
  const work = mode === 'change' ? Promise.all(rest.map((u) => { return readChange(u); }))
    : mode === 'default' ? Promise.all(rest.map((r) => { return readDefault(r); }))
    : mode === 'ready' ? readyChanges(rest)
    : mode === 'merged-since' ? (() => { const f = parseFlags(rest.slice(0, 2)); return mergedSince(rest.slice(2), f.since); })()
    : Promise.reject(new Error('usage: host.mjs change <url>… | default <repo>… | ready <repo>… | merged-since --since <ISO> <repo>…'));
  work.then(
    (result) => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); },
    (error) => { process.stderr.write(`${error.message}\n`); process.exit(1); },
  );
}
