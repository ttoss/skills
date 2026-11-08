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

/** The commit status a reviewer sets on the head it judged. */
export const REVIEW_CONTEXT = 'flow/review';

// An author GitHub lets push to the repo: only they may set a commit status,
// and only their review or comment counts when the project names no Reviewer.
const WRITE = ['OWNER', 'MEMBER', 'COLLABORATOR'];

const MARKER = /<!--\s*flow-verdict\s+sha=([0-9a-f]{7,40})\s+result=(CLEAN|FINDINGS)\s*-->/;

const allowed = ({ login, association, reviewers }) => {
  return reviewers.length ? reviewers.includes(login) : WRITE.includes(association);
};

/**
 * The verdicts on a change, each bound to the commit it judged and to an
 * author who may give one: the `flow/review` commit status (CLEAN on
 * `success`, FINDINGS on `failure`, a claim while `pending`), a pull request
 * review that approved or asked for changes, and, for reviewers that cannot
 * set a status, a comment carrying `<!-- flow-verdict sha=… result=… -->`.
 * Prose such as "Verdict: CLEAN" is never read: anyone can quote it.
 */
export const verdictsOf = ({ statuses = [], reviews = [], comments = [], reviewers = [] }) => {
  const out = [];
  // Statuses come newest first; the newest from an allowed creator decides.
  const status = statuses.find((s) => {
    return s.context === REVIEW_CONTEXT && (!reviewers.length || reviewers.includes(s.creator?.login));
  });
  let pendingSince = null;
  if (status?.state === 'success' || status?.state === 'failure') {
    out.push({ sha: status.sha ?? null, result: status.state === 'success' ? 'CLEAN' : 'FINDINGS', source: 'status' });
  } else if (status?.state === 'pending') {
    pendingSince = status.created_at;
  }
  const latest = new Map();
  for (const review of reviews) {
    if (['APPROVED', 'CHANGES_REQUESTED'].includes(review.state) && allowed({ login: review.user?.login, association: review.author_association, reviewers })) {
      latest.set(review.user.login, review);
    }
  }
  for (const review of latest.values()) {
    out.push({ sha: review.commit_id, result: review.state === 'APPROVED' ? 'CLEAN' : 'FINDINGS', source: 'review' });
  }
  for (const comment of comments) {
    const m = MARKER.exec(comment.body || '');
    if (m && allowed({ login: comment.user?.login, association: comment.author_association, reviewers })) {
      out.push({ sha: m[1], result: m[2], source: 'comment' });
    }
  }
  return { verdicts: out, pendingSince };
};

/**
 * The verdict for `head`: FINDINGS when any verdict on it says so, else
 * CLEAN when one does, else null. A verdict on an older commit is none.
 */
export const verdictFor = (verdicts, head) => {
  const onHead = verdicts.filter((v) => { return v.sha && head.startsWith(v.sha); });
  const result = onHead.some((v) => { return v.result === 'FINDINGS'; }) ? 'FINDINGS'
    : onHead.some((v) => { return v.result === 'CLEAN'; }) ? 'CLEAN' : null;
  return result ? { sha: head, result } : null;
};

/**
 * Whether the code host refuses to integrate into `branch` without a
 * review: `flow/review` among its required status checks, or a required
 * approving review, by branch protection or a ruleset. Null when unread.
 */
export const reviewEnforcedOf = ({ branch, rules }) => {
  if (!branch && !rules) {
    return null;
  }
  const protection = branch?.protection || {};
  const contexts = [
    ...(protection.required_status_checks?.contexts || []),
    ...(protection.required_status_checks?.checks || []).map((c) => { return c.context; }),
  ];
  let approvals = protection.required_pull_request_reviews?.required_approving_review_count || 0;
  for (const rule of rules || []) {
    if (rule.type === 'required_status_checks') {
      contexts.push(...(rule.parameters?.required_status_checks || []).map((c) => { return c.context; }));
    }
    if (rule.type === 'pull_request') {
      approvals = Math.max(approvals, rule.parameters?.required_approving_review_count || 0);
    }
  }
  return contexts.includes(REVIEW_CONTEXT) || approvals > 0;
};

const TASK = /task_[0-9a-hjkmnp-tv-z]{10}/;

export const parseChangeUrl = (url) => {
  const m = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/.exec(url);
  return m ? { repo: m[1], number: Number(m[2]) } : null;
};

/**
 * Whether `gh` failed because the session cannot read the repo, rather than
 * for a reason a retry could clear: every other change there fails the same.
 */
export const unreadable = (error) => {
  return /HTTP 40[34]|Not Found|Resource not accessible|Could not resolve to a Repository/i.test(String(error?.stderr || error?.message || ''));
};

/**
 * Only where a change stands (`state`): open, draft, integrated or closed,
 * in one read. What the Chase counts the release queue by; the checks,
 * verdicts and mergeability the tick acts on are `readChange`'s.
 */
export const readChangeState = async (url, { gh = ghApi } = {}) => {
  const ref = parseChangeUrl(url);
  if (!ref) {
    return null;
  }
  const pull = await gh(`repos/${ref.repo}/pulls/${ref.number}`);
  const merged = Boolean(pull.merged);
  return {
    url,
    repo: ref.repo,
    title: pull.title,
    task: (TASK.exec(pull.body || '') || [null])[0],
    draft: Boolean(pull.draft),
    createdAt: pull.created_at,
    merged,
    mergedAt: pull.merged_at,
    closed: pull.state === 'closed' && !merged,
  };
};

/** A change as plan.mjs's snapshot holds it, from the code host. */
export const readChange = async (url, { gh = ghApi, reviewers = [] } = {}) => {
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
  const [head, statuses, reviews, comments] = await Promise.all([
    gh(`repos/${ref.repo}/commits/${pull.head.sha}/check-runs?per_page=100`),
    gh(`repos/${ref.repo}/commits/${pull.head.sha}/statuses?per_page=100`),
    gh(`repos/${ref.repo}/pulls/${ref.number}/reviews?per_page=100`, { paginate: true }),
    gh(`repos/${ref.repo}/issues/${ref.number}/comments?per_page=100`, { paginate: true }),
  ]);
  const { verdicts, pendingSince } = verdictsOf({
    statuses: statuses.map((s) => { return { ...s, sha: pull.head.sha }; }),
    reviews,
    comments,
    reviewers,
  });
  const checks = checksOf(head.check_runs);
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
    // When the change was opened: a fix run is a child started after it.
    createdAt: pull.created_at,
    headSha: pull.head.sha,
    checks,
    // When the head's checks last finished: a review is expected from then.
    checksDoneAt: checks === 'green' ? head.check_runs.map((r) => { return r.completed_at; }).filter(Boolean).sort().at(-1) || null : null,
    redOnDefault: null,
    conflict: pull.mergeable === false || pull.mergeable_state === 'dirty',
    merged,
    mergedAt: pull.merged_at,
    pipelineDoneAt,
    closed: pull.state === 'closed' && !merged,
    checksBeforeRepair: false,
    pipelineRedAfterMerge,
    // The reversal path is prose in the description (Before proposing): the
    // tick reads it when the pipeline is red, as a judge.
    reversal: null,
    verdict: verdictFor(verdicts, pull.head.sha),
    // A reviewer's `pending` status on the head: the review is claimed.
    reviewPendingSince: pendingSince,
    reviewRunActive: false,
    // Set from the repo's default branch (readDefault) by the snapshot.
    reviewEnforced: null,
    // Judgments: the planner asks for them with a `judge` act.
    touchesOwnGates: null,
    reservedToPerson: null,
    findingsToPerson: null,
  };
};

/** A repo's default branch head, and whether its checks are red there. */
export const readDefault = async (repo, { gh = ghApi } = {}) => {
  const meta = await gh(`repos/${repo}`);
  const branch = await gh(`repos/${repo}/branches/${meta.default_branch}`);
  const [runs, rules] = await Promise.all([
    gh(`repos/${repo}/commits/${branch.commit.sha}/check-runs?per_page=100`),
    // Rulesets apply to everyone who can read the branch; unreadable → null.
    gh(`repos/${repo}/rules/branches/${meta.default_branch}`).catch(() => { return null; }),
  ]);
  return {
    repo,
    sha: branch.commit.sha,
    red: checksOf(runs.check_runs) === 'red',
    reviewEnforced: reviewEnforcedOf({ branch, rules }),
    repairTask: null,
  };
};

/**
 * The open, non-draft changes whose checks are green and whose newest
 * verdict, if any, is CLEAN on its head: what the Chase calls ready for a
 * person to integrate, once their task waits on one.
 */
export const readyChanges = async (repos, { gh = ghApi, reviewers = [] } = {}) => {
  const out = [];
  for (const repo of repos) {
    const pulls = (await gh(`repos/${repo}/pulls?state=open&per_page=100`, { paginate: true })).filter((p) => { return !p.draft; });
    const changes = await mapLimit(pulls, 4, (p) => { return readChange(p.html_url, { gh, reviewers }); });
    out.push(...changes.filter((c) => {
      return c && c.checks === 'green' && !c.conflict && c.verdict?.result !== 'FINDINGS';
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
