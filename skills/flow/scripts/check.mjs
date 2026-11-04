import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { clientFromEnv, parseFlags } from './flow-api.mjs';
import { readDefault } from './host.mjs';
import { load as loadParams } from './params.mjs';

// Whether this runtime can run the routines' scripts against a project: the
// key is there, reaches the project, is restricted to it, and the deployment
// answers what the scripts read. flow-setup runs it as a prerequisite and each
// routine at its start. It never prints the key.
//
// With --root, it also reads each repo's default branch on the code host:
// a `Review` that names a reviewer the host does not require leaves every
// change to a person to integrate, since the planner never integrates on its
// own reading of a verdict.
//
// Usage: node check.mjs --project <proj_…> | --root <repo dir>
// Output: JSON `{ ok, checks: [{ name, ok, detail }] }`; `ok` is false when a
// check the scripts cannot run without fails. A warning is a check with
// `ok: true` and a detail to act on.

/** Whether each repo's default branch requires the review `Review` names. */
export const hostChecks = async ({ repos = [], reviewRequired, gh }) => {
  if (!reviewRequired) {
    return [];
  }
  return Promise.all(repos.map(async (repo) => {
    try {
      const { reviewEnforced } = await readDefault(repo, gh ? { gh } : {});
      return { name: `review-enforced ${repo}`, ok: true, detail: reviewEnforced
        ? `${repo}'s default branch requires the review`
        : `warning: ${repo}'s default branch does not require the review, so the tick integrates nothing there and waits on a person: add the \`flow/review\` status to its required checks (branch protection or a ruleset)` };
    } catch (error) {
      return { name: `review-enforced ${repo}`, ok: true, detail: `warning: ${repo} could not be read with gh (${String(error.stderr || error.message).split('\n')[0].slice(0, 120)}), so the tick integrates nothing there` };
    }
  }));
};

/** Every check, in order; stops at the first one the rest depend on. */
export const check = async ({ project, client }) => {
  const checks = [];
  const add = (name, ok, detail) => {
    checks.push({ name, ok, detail });
  };
  if (!client) {
    add('key', false, 'FLOW_API_KEY is not in the environment: mint a key restricted to this project on the console\'s API keys page, with an expiry, and add it to the environment the routines run in, never to a file or a chat');
    return { ok: false, checks };
  }
  add('key', true, 'FLOW_API_KEY is set');

  try {
    await client.get(`/projects/${project}`);
    add('reach', true, `the key reaches ${project}`);
  } catch (error) {
    add('reach', false, error.status === 401
      ? 'the key was refused (401): revoked, expired or mistyped; mint a new one'
      : `the key does not reach ${project} (${error.status}): restrict a key to this project`);
    return { ok: false, checks };
  }

  const { projects } = await client.get('/projects');
  add('restricted', true, projects.length === 1
    ? 'the key reaches this project alone'
    : `warning: the key reaches ${projects.length} projects; restrict it to this one, since a leaked key reaches every project it names`);

  const now = new Date();
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  const metrics = await client.get(`/projects/${project}/metrics`, { since, until: now.toISOString() });
  const hasMetrics = Array.isArray(metrics.moves) && (metrics.states || []).every((row) => { return 'entered' in row; });
  add('metrics', hasMetrics, hasMetrics
    ? 'get-project-metrics answers entered and moves'
    : 'this Flow deployment predates entered and moves (TriangulosTecnologia/flow#320): update it');

  // A warning, not a failure: without groups the Chase loses its lines per
  // holder and keeps every other one.
  const grouped = await client.get(`/projects/${project}/metrics`, { since, until: now.toISOString(), group_by: 'on' });
  add('holders', true, Array.isArray(grouped.groups)
    ? 'get-project-metrics groups by holder'
    : 'warning: this Flow deployment does not group metrics by holder (group_by=on), so the Chase has no line per person: update it');

  const runs = await client.get('/agent-runs', { project, group_by: 'outcome', limit: 0 });
  const outcomeKeys = new Set(['completed', 'open', 'dropped', null]);
  const hasOutcome = Array.isArray(runs.groups) && runs.groups.every((g) => { return outcomeKeys.has(g.key); });
  add('outcome', hasOutcome, hasOutcome
    ? 'list-agent-runs groups by outcome'
    : 'this Flow deployment does not group runs by outcome (TriangulosTecnologia/flow#320): update it');

  return { ok: checks.every((c) => { return c.ok; }), checks };
};

const isMain = process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain) {
  const f = parseFlags(process.argv.slice(2));
  const p = f.root ? loadParams(f.root) : null;
  const project = f.project || p?.projectId;
  if (!project) {
    process.stderr.write('usage: check.mjs (--root <repo dir> | --project <proj_…>)\n');
    process.exit(2);
  }
  const client = process.env.FLOW_API_KEY ? clientFromEnv() : null;
  Promise.all([check({ project, client }), hostChecks({ repos: p?.repos, reviewRequired: p?.params.reviewRequired })]).then(
    ([flow, host]) => {
      const result = { ok: flow.ok, checks: [...flow.checks, ...host] };
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exit(result.ok ? 0 : 1);
    },
    (error) => {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    },
  );
}
