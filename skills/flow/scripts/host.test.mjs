import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checksOf, mergedSince, readChange, readyChanges, verdictOf } from './host.mjs';

const run = (name, conclusion, started_at = '2026-11-01T00:00:00Z', status = 'completed') => {
  return { name, status, conclusion, started_at, completed_at: started_at };
};

test('checks: none is null; a failure is red; a cancelled or superseded run is not', () => {
  assert.equal(checksOf([]), null);
  assert.equal(checksOf([run('ci', 'success'), run('lint', 'failure')]), 'red');
  assert.equal(checksOf([run('ci', 'success'), run('deploy', 'cancelled')]), 'green');
  assert.equal(checksOf([run('ci', 'failure', '2026-11-01T00:00:00Z'), run('ci', 'success', '2026-11-01T01:00:00Z')]), 'green');
  assert.equal(checksOf([run('ci', null, '2026-11-01T00:00:00Z', 'in_progress')]), 'pending');
});

test('verdict: the newest comment naming a commit and CLEAN or FINDINGS', () => {
  const sha = 'a'.repeat(40);
  assert.deepEqual(verdictOf([{ body: `Verified at head \`${sha}\`\n\n**Verdict: CLEAN**` }]), { sha, result: 'CLEAN' });
  assert.deepEqual(verdictOf([{ body: `${sha}\nCLEAN` }, { body: `\`bbbbbbb\`\nFINDINGS\n- x` }]), { sha: 'bbbbbbb', result: 'FINDINGS' });
  assert.equal(verdictOf([{ body: 'looks clean to me' }]), null);
});

const fakeGh = (pages) => {
  return async (path) => {
    const key = Object.keys(pages).find((k) => { return path.startsWith(k); });
    if (!key) {
      throw new Error(`unexpected ${path}`);
    }
    return pages[key];
  };
};

const pull = (n, over = {}) => {
  return { number: n, html_url: `https://github.com/o/r/pull/${n}`, title: `PR ${n}`, body: `Task: https://flow/app/tasks/task_${'a'.repeat(9)}${n}`, draft: false, state: 'open', merged: false, mergeable: true, mergeable_state: 'blocked', head: { sha: `${n}`.repeat(40).slice(0, 40) }, ...over };
};

test('a change in the planner’s schema, its task from the description, judgments left null', async () => {
  const gh = fakeGh({
    'repos/o/r/pulls/7': pull(7, { state: 'closed', merged: true, merged_at: '2026-11-01T00:00:00Z', merge_commit_sha: 'm'.repeat(40) }),
    'repos/o/r/commits/7': { check_runs: [run('ci', 'success')] },
    'repos/o/r/commits/mmm': { check_runs: [run('main', 'failure', '2026-11-01T00:05:00Z')] },
    'repos/o/r/issues/7/comments': [{ body: `${'7'.repeat(40)}\n**Verdict: CLEAN**` }],
  });
  const c = await readChange('https://github.com/o/r/pull/7', { gh });
  assert.equal(c.task, 'task_aaaaaaaaa7');
  assert.deepEqual([c.checks, c.merged, c.closed, c.pipelineRedAfterMerge, c.pipelineDoneAt, c.verdict.result], ['green', true, false, true, '2026-11-01T00:05:00Z', 'CLEAN']);
  assert.deepEqual([c.touchesOwnGates, c.reservedToPerson], [null, null]);
});

test('ready changes: green, no conflict, and no FINDINGS on the head; merges since a date summed over repos', async () => {
  const gh = fakeGh({
    'repos/o/r/pulls?': [pull(1), pull(2), pull(3, { draft: true })],
    'repos/o/r/pulls/1': pull(1),
    'repos/o/r/pulls/2': pull(2),
    'repos/o/r/commits/1': { check_runs: [run('ci', 'success')] },
    'repos/o/r/commits/2': { check_runs: [run('ci', 'success')] },
    'repos/o/r/issues/1/comments': [],
    'repos/o/r/issues/2/comments': [{ body: `${'2'.repeat(40)}\nFINDINGS` }],
    'search/issues': { total_count: 4 },
  });
  assert.deepEqual((await readyChanges(['o/r'], { gh })).map((c) => { return c.url; }), ['https://github.com/o/r/pull/1']);
  assert.equal(await mergedSince(['o/r', 'o/r'], '2026-11-01T00:00:00Z', { gh }), 8);
});
