import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createClient } from './flow-api.mjs';
import { record, selfInput, sessionAddress, usageOf } from './session-run.mjs';

const PROJECT = 'proj_0123456789';
const REMOTE = { CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_01AbC' };
const URL_ = 'https://claude.ai/code/session_01AbC';

const line = ({ id, model = 'claude-test-1', input = 0, read = 0, write = 0, output = 0 }) => {
  return JSON.stringify({
    message: {
      id,
      role: 'assistant',
      model,
      usage: { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: write, output_tokens: output },
    },
  });
};

// A session that made two API calls (the first split across two lines) and
// ran one subagent.
const transcript = () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-run-'));
  const path = join(dir, 'sess.jsonl');
  writeFileSync(path, [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    line({ id: 'm1', input: 10, write: 1000, output: 1 }),
    line({ id: 'm1', input: 10, write: 1000, output: 40 }),
    line({ id: 'm2', input: 5, read: 1000, write: 200, output: 60 }),
    'not json "usage"',
  ].join('\n'));
  mkdirSync(join(dir, 'sess', 'subagents'), { recursive: true });
  writeFileSync(join(dir, 'sess', 'subagents', 'agent-1.jsonl'), line({ id: 's1', input: 3, write: 5000, output: 7 }));
  return path;
};

// The Flow API in memory: upserts merge by `url`, as `upsert-agent-run` does.
const fakeFlow = () => {
  const runs = new Map();
  const calls = [];
  const fetchImpl = async (url, init) => {
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.authorization, 'Bearer k');
    assert.equal(new URL(url).pathname, '/api/v1/agent-runs');
    const body = JSON.parse(init.body);
    calls.push(body);
    const run = { status: 'running', ...runs.get(body.url), ...body };
    runs.set(body.url, run);
    return { ok: true, status: 200, json: async () => { return { run: { url: run.url, status: run.status } }; } };
  };
  return { runs, calls, client: createClient({ key: 'k', fetchImpl }) };
};

test('address: a cloud session is its claude.ai URL, a local one a URI of its id', () => {
  assert.equal(sessionAddress({ env: REMOTE, sessionId: 'x' }), URL_);
  assert.equal(sessionAddress({ env: {}, sessionId: 'abc' }), 'claude-code:session/abc');
  assert.equal(sessionAddress({ env: {}, sessionId: undefined }), null);
});

test('usage: each message counted once, subagents in the sums, peak from the main thread', () => {
  assert.deepEqual(usageOf(transcript()), {
    usage: { input_tokens: 18, output_tokens: 107, cache_read_tokens: 1000, cache_write_tokens: 6200, peak_context: 1205 },
    model: 'claude-test-1',
  });
  assert.deepEqual(usageOf('/nonexistent.jsonl'), { usage: null, model: null });
});

test('a session records its run at start, its usage at each turn, and closes it at the end', async () => {
  const flow = fakeFlow();
  const path = transcript();
  const base = { session_id: 's', transcript_path: path };
  await record({ input: { ...base, hook_event_name: 'SessionStart', source: 'startup', model: 'claude-test-1' }, project: PROJECT, env: REMOTE, client: flow.client });
  assert.deepEqual(flow.runs.get(URL_), { status: 'running', url: URL_, project: PROJECT, agent: 'claude code session', model: 'claude-test-1' });

  await record({ input: { ...base, hook_event_name: 'Stop' }, project: PROJECT, env: REMOTE, client: flow.client });
  assert.equal(flow.runs.get(URL_).status, 'running');
  assert.equal(flow.runs.get(URL_).usage.output_tokens, 107);

  await record({ input: { ...base, hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' }, project: PROJECT, env: REMOTE, client: flow.client });
  assert.equal(flow.runs.get(URL_).status, 'completed');
  assert.equal(flow.runs.get(URL_).agent, 'claude code session');
});

test('a resumed session keeps the agent a tick wrote, and the end keeps a status a tick wrote', async () => {
  const flow = fakeFlow();
  flow.runs.set(URL_, { url: URL_, agent: 'flow tick', status: 'failed' });
  await record({ input: { session_id: 's', hook_event_name: 'SessionStart', source: 'resume' }, project: PROJECT, env: REMOTE, client: flow.client });
  await record({ input: { session_id: 's', transcript_path: transcript(), hook_event_name: 'SessionEnd', reason: 'other' }, project: PROJECT, env: REMOTE, client: flow.client });
  assert.equal(flow.runs.get(URL_).agent, 'flow tick');
  assert.equal(flow.runs.get(URL_).status, 'failed');
  assert.ok(flow.calls.every((c) => { return !('status' in c); }));
});

test('a cloud session /clear keeps its run open', async () => {
  const flow = fakeFlow();
  await record({ input: { session_id: 's', hook_event_name: 'SessionEnd', reason: 'clear' }, project: PROJECT, env: REMOTE, client: flow.client });
  assert.equal(flow.runs.get(URL_).status, 'running');
});

test('without a key, a project or an address, nothing is written', async () => {
  const flow = fakeFlow();
  const input = { session_id: 's', hook_event_name: 'SessionStart', source: 'startup' };
  assert.deepEqual(await record({ input, project: PROJECT, env: REMOTE, client: null }), []);
  assert.deepEqual(await record({ input, project: undefined, env: REMOTE, client: flow.client }), []);
  assert.deepEqual(await record({ input: { hook_event_name: 'Stop' }, project: PROJECT, env: {}, client: flow.client }), []);
  assert.equal(flow.calls.length, 0);
});

test('--self: a session no hook reaches finds its own transcript and writes what a Stop would', async () => {
  const root = mkdtempSync(join(tmpdir(), 'projects-'));
  mkdirSync(join(root, '-home-user'));
  const path = join(root, '-home-user', 'abc.jsonl');
  writeFileSync(path, line({ id: 'm1', input: 2, output: 9 }));
  assert.deepEqual(selfInput({ env: { CLAUDE_CODE_SESSION_ID: 'abc' }, root }), { hook_event_name: 'Stop', session_id: 'abc', transcript_path: path });
  assert.equal(selfInput({ env: { CLAUDE_CODE_SESSION_ID: 'other' }, root }), null);
  assert.equal(selfInput({ env: {}, root }), null);
});
