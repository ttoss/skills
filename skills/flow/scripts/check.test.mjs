import assert from 'node:assert/strict';
import { test } from 'node:test';

import { check, hostChecks } from './check.mjs';

const gh = (requiredContexts) => {
  return async (path) => {
    if (path === 'repos/o/r') {
      return { default_branch: 'main' };
    }
    if (path === 'repos/o/r/branches/main') {
      return { commit: { sha: 'h' }, protection: { required_status_checks: { contexts: requiredContexts } } };
    }
    if (path.startsWith('repos/o/r/rules/')) {
      return [];
    }
    return { check_runs: [] };
  };
};

test('review enforced: no Review, nothing to check; a reviewer the host does not require is a warning', async () => {
  assert.deepEqual(await hostChecks({ repos: ['o/r'], reviewRequired: false, gh: gh([]) }), []);
  const [missing] = await hostChecks({ repos: ['o/r'], reviewRequired: true, gh: gh(['ci']) });
  assert.match(missing.detail, /^warning: .*flow\/review/);
  const [held] = await hostChecks({ repos: ['o/r'], reviewRequired: true, gh: gh(['ci', 'flow/review']) });
  assert.equal(held.detail, "o/r's default branch requires the review");
});

test('a deployment that does not group metrics by holder is a warning, never a failure', async () => {
  const client = (groups) => {
    return {
      get: async (path, query = {}) => {
        if (path === '/projects') {
          return { projects: [{ id: 'proj_x' }] };
        }
        if (path === '/agent-runs') {
          return { groups: [] };
        }
        if (path.endsWith('/metrics')) {
          return { states: [], moves: [], ...(query.group_by && groups ? { groups: [] } : {}) };
        }
        return {};
      },
    };
  };
  const old = await check({ project: 'proj_x', client: client(false) });
  const holders = old.checks.find((c) => { return c.name === 'holders'; });
  assert.equal(old.ok, true);
  assert.match(holders.detail, /^warning: .*group_by=on/);
  const current = await check({ project: 'proj_x', client: client(true) });
  assert.equal(current.checks.find((c) => { return c.name === 'holders'; }).detail, 'get-project-metrics groups by holder');
});
