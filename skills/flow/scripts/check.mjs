import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { clientFromEnv, parseFlags } from './flow-api.mjs';

// Whether this runtime can run the routines' scripts against a project: the
// key is there, reaches the project, is restricted to it, and the deployment
// answers what the scripts read. flow-setup runs it as a prerequisite and each
// routine at its start. It never prints the key.
//
// Usage: node check.mjs --project <proj_…>
// Output: JSON `{ ok, checks: [{ name, ok, detail }] }`; `ok` is false when a
// check the scripts cannot run without fails. A warning is a check with
// `ok: true` and a detail to act on.

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
  const { project } = parseFlags(process.argv.slice(2));
  if (!project) {
    process.stderr.write('usage: check.mjs --project <proj_…>\n');
    process.exit(2);
  }
  const client = process.env.FLOW_API_KEY ? clientFromEnv() : null;
  check({ project, client }).then(
    (result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exit(result.ok ? 0 : 1);
    },
    (error) => {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    },
  );
}
