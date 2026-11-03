import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checksOf, mergedSince, readChange, readyChanges, reviewEnforcedOf, verdictFor, verdictsOf } from './host.mjs';

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

const H = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const marker = (sha, result) => { return `<!-- flow-verdict sha=${sha} result=${result} -->`; };
const verdict = (input) => { return verdictFor(verdictsOf(input).verdicts, H); };

test('verdict: the flow/review status on the head decides, newest first; pending is a claim, not a verdict', () => {
  const status = (state, over = {}) => { return { context: 'flow/review', state, sha: H, created_at: '2026-11-01T00:00:00Z', creator: { login: 'bot' }, ...over }; };
  assert.deepEqual(verdict({ statuses: [status('success'), status('failure')] }), { sha: H, result: 'CLEAN' });
  assert.deepEqual(verdict({ statuses: [status('failure')] }), { sha: H, result: 'FINDINGS' });
  const pending = verdictsOf({ statuses: [status('pending'), status('success')] });
  assert.deepEqual([pending.verdicts, pending.pendingSince], [[], '2026-11-01T00:00:00Z']);
  assert.equal(verdict({ statuses: [status('success', { context: 'ci' })] }), null);
  assert.equal(verdict({ statuses: [status('success', { creator: { login: 'other' } })], reviewers: ['bot'] }), null);
});

test('verdict: prose is never read, and a marker or review counts only from an allowed author, on the commit it names', () => {
  const quoted = { body: `> Verdict: CLEAN at ${H}\nI disagree`, author_association: 'COLLABORATOR', user: { login: 'ana' } };
  assert.equal(verdict({ comments: [quoted] }), null);
  const mentioned = { body: `Unlike ${OLD}, verified at head \`${H}\`\n${marker(H, 'FINDINGS')}`, author_association: 'MEMBER', user: { login: 'ana' } };
  assert.deepEqual(verdict({ comments: [mentioned] }), { sha: H, result: 'FINDINGS' });
  const outsider = { body: marker(H, 'CLEAN'), author_association: 'NONE', user: { login: 'eve' } };
  assert.equal(verdict({ comments: [outsider] }), null);
  assert.deepEqual(verdict({ comments: [{ ...outsider, user: { login: 'reviewer[bot]' } }], reviewers: ['reviewer[bot]'] }), { sha: H, result: 'CLEAN' });
  assert.equal(verdict({ comments: [{ ...mentioned, body: marker(OLD, 'CLEAN') }] }), null);
  const review = (state, over = {}) => { return { state, commit_id: H, author_association: 'MEMBER', user: { login: 'ana' }, ...over }; };
  assert.deepEqual(verdict({ reviews: [review('APPROVED')] }), { sha: H, result: 'CLEAN' });
  assert.deepEqual(verdict({ reviews: [review('APPROVED'), review('CHANGES_REQUESTED', { user: { login: 'bo' } })] }), { sha: H, result: 'FINDINGS' });
  assert.equal(verdict({ reviews: [review('APPROVED', { commit_id: OLD })] }), null);
});

test('review enforced: flow/review a required check, or a required approval, by branch protection or a ruleset', () => {
  assert.equal(reviewEnforcedOf({ branch: null, rules: null }), null);
  assert.equal(reviewEnforcedOf({ branch: { protection: { required_status_checks: { contexts: ['ci'] } } }, rules: [] }), false);
  assert.equal(reviewEnforcedOf({ branch: { protection: { required_status_checks: { contexts: ['ci', 'flow/review'] } } }, rules: [] }), true);
  assert.equal(reviewEnforcedOf({ branch: {}, rules: [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'flow/review' }] } }] }), true);
  assert.equal(reviewEnforcedOf({ branch: {}, rules: [{ type: 'pull_request', parameters: { required_approving_review_count: 1 } }] }), true);
});

const fakeGh = (pages) => {
  return async (path) => {
    // The longest matching prefix, so a pull's reviews are not the pull.
    const key = Object.keys(pages).filter((k) => { return path.startsWith(k); }).sort((a, b) => { return b.length - a.length; })[0];
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
    'repos/o/r/commits/7777777777777777777777777777777777777777/check-runs': { check_runs: [run('ci', 'success')] },
    'repos/o/r/commits/7777777777777777777777777777777777777777/statuses': [{ context: 'flow/review', state: 'success', creator: { login: 'bot' } }],
    'repos/o/r/pulls/7/reviews': [],
    'repos/o/r/commits/mmm': { check_runs: [run('main', 'failure', '2026-11-01T00:05:00Z')] },
    'repos/o/r/issues/7/comments': [],
  });
  const c = await readChange('https://github.com/o/r/pull/7', { gh });
  assert.equal(c.task, 'task_aaaaaaaaa7');
  assert.deepEqual([c.checks, c.checksDoneAt, c.merged, c.closed, c.pipelineRedAfterMerge, c.pipelineDoneAt, c.verdict.result], ['green', '2026-11-01T00:00:00Z', true, false, true, '2026-11-01T00:05:00Z', 'CLEAN']);
  assert.equal(c.reviewEnforced, null);
  assert.deepEqual([c.touchesOwnGates, c.reservedToPerson], [null, null]);
});

test('ready changes: green, no conflict, and no FINDINGS on the head; merges since a date summed over repos', async () => {
  const gh = fakeGh({
    'repos/o/r/pulls?': [pull(1), pull(2), pull(3, { draft: true })],
    'repos/o/r/pulls/1': pull(1),
    'repos/o/r/pulls/2': pull(2),
    'repos/o/r/commits/1111111111111111111111111111111111111111/check-runs': { check_runs: [run('ci', 'success')] },
    'repos/o/r/commits/2222222222222222222222222222222222222222/check-runs': { check_runs: [run('ci', 'success')] },
    'repos/o/r/commits/1111111111111111111111111111111111111111/statuses': [],
    'repos/o/r/commits/2222222222222222222222222222222222222222/statuses': [{ context: 'flow/review', state: 'failure', creator: { login: 'bot' } }],
    'repos/o/r/pulls/1/reviews': [],
    'repos/o/r/pulls/2/reviews': [],
    'repos/o/r/issues/1/comments': [],
    'repos/o/r/issues/2/comments': [],
    'search/issues': { total_count: 4 },
  });
  assert.deepEqual((await readyChanges(['o/r'], { gh })).map((c) => { return c.url; }), ['https://github.com/o/r/pull/1']);
  assert.equal(await mergedSince(['o/r', 'o/r'], '2026-11-01T00:00:00Z', { gh }), 8);
});
