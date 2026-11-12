import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { clientFromEnv, parseFlags } from './flow-api.mjs';

// The runtime records each Claude Code session's run (the `Run records`
// parameter, GTF-S7), so no agent spends a turn on it: SessionStart creates
// the run, Stop writes the session's `usage` and `model` at each turn's end
// (which also renews the run's hold), and SessionEnd closes it. A tick or a
// child writing the same address only adds what it knows: `agent`, `parent`,
// `works_on`, `authority`.
//
// The key comes from FLOW_API_KEY in the environment, never from the repo.
// Without it the hook does nothing. It never fails the session: any error is
// one line on stderr and exit 0.
//
// Usage (a command hook on SessionStart, Stop and SessionEnd, the hook's JSON
// on stdin): node session-run.mjs --project <proj_…> [--agent <label>]
//
// A session whose hooks never load (a cloud session with several repos runs
// from their parent directory, where no repo's .claude/settings.json is read)
// writes its own usage as its last act: node session-run.mjs --project <proj_…>
// --self. It finds its transcript by CLAUDE_CODE_SESSION_ID and writes what a
// Stop would; the final message it writes after is the only spend it misses.

export const DEFAULT_AGENT = 'claude code session';

/**
 * The run's address: the claude.ai URL of a cloud session, whose remote id
 * `cse_X` is the session `session_X`; else a URI naming the local session.
 */
export const sessionAddress = ({ env = process.env, sessionId }) => {
  const remote = env.CLAUDE_CODE_REMOTE_SESSION_ID;
  if (remote) {
    return `https://claude.ai/code/${remote.replace(/^cse_/, 'session_')}`;
  }
  return sessionId ? `claude-code:session/${sessionId}` : null;
};

const readLines = (path) => {
  try {
    return readFileSync(path, 'utf8').split('\n');
  } catch {
    return [];
  }
};

// Each API message is one transcript line per content block, all carrying its
// usage; the last line of an id holds the final count. A subagent's own run is
// the address of its first `upsert-agent-run` call: a flow child records its
// run as its first act.
const transcriptOf = (path) => {
  const byId = new Map();
  let run = null;
  for (const line of readLines(path)) {
    const usage = line.includes('"usage"');
    if (!usage && (run || !line.includes('upsert-agent-run'))) {
      continue;
    }
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const message = entry.message;
    if (message?.role !== 'assistant') {
      continue;
    }
    if (message.usage) {
      byId.set(message.id || `${byId.size}`, message);
    }
    const call = !run && Array.isArray(message.content) && message.content.find((block) => {
      return block?.type === 'tool_use' && block.name?.endsWith('upsert-agent-run') && typeof block.input?.url === 'string';
    });
    if (call) {
      run = call.input.url;
    }
  }
  return { messages: [...byId.values()], run };
};

const subagentTranscripts = (transcriptPath) => {
  const dir = join(dirname(transcriptPath), basename(transcriptPath, '.jsonl'), 'subagents');
  try {
    return readdirSync(dir).filter((name) => { return name.endsWith('.jsonl'); }).map((name) => { return join(dir, name); });
  } catch {
    return [];
  }
};

// A synthetic message (`<synthetic>`) is no API call and names no model.
const modelOf = (message) => {
  return message.model && !message.model.startsWith('<') ? message.model : null;
};

const promptOf = (u) => {
  return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
};

// Token sums, and `peak_context` the largest prompt among `peakOf`.
const sumOf = ({ messages, peakOf = messages }) => {
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, peak_context: 0 };
  for (const { usage: u } of messages) {
    usage.input_tokens += u.input_tokens || 0;
    usage.output_tokens += u.output_tokens || 0;
    usage.cache_read_tokens += u.cache_read_input_tokens || 0;
    usage.cache_write_tokens += u.cache_creation_input_tokens || 0;
  }
  for (const { usage: u } of peakOf) {
    usage.peak_context = Math.max(usage.peak_context, promptOf(u));
  }
  return usage;
};

/**
 * What the session spent, from its transcript and its subagents', per model,
 * so a child on another model is never counted at the session's. The session's
 * own run (`usage`, `model`) holds the main thread's last model: its tokens and
 * those of every subagent on it with no run of its own, `peak_context` the main
 * thread's largest prompt. A subagent that recorded its own run gets its tokens
 * there (`children`); every other model's tokens are one entry of `models`. No
 * `cost_usd`: the transcript holds no price.
 */
export const usageOf = (transcriptPath, { address = null } = {}) => {
  const main = transcriptOf(transcriptPath).messages;
  const subagents = subagentTranscripts(transcriptPath).map(transcriptOf);
  const own = [...main];
  const children = [];
  for (const { messages, run } of subagents) {
    if (run && run !== address && messages.length > 0) {
      children.push({ url: run, model: messages.map(modelOf).filter(Boolean).at(-1) || null, usage: sumOf({ messages }) });
    } else {
      own.push(...messages);
    }
  }
  const model = main.map(modelOf).filter(Boolean).at(-1) || null;
  const byModel = new Map();
  for (const message of own) {
    const key = modelOf(message);
    if (key) {
      byModel.set(key, [...(byModel.get(key) || []), message]);
    }
  }
  const usage = model ? sumOf({ messages: byModel.get(model), peakOf: main }) : null;
  const models = [...byModel].filter(([key]) => { return key !== model; }).map(([key, messages]) => {
    return { model: key, usage: sumOf({ messages }) };
  });
  return { usage, model, models, children };
};

/** The address of the run holding a session's tokens on one more model. */
export const modelAddress = ({ url, model }) => {
  return `${url}#model=${encodeURIComponent(model)}`;
};

/** The writes one hook event makes, in order; none without a key or an address. */
export const record = async ({ input, project, agent = DEFAULT_AGENT, env = process.env, client }) => {
  const url = sessionAddress({ env, sessionId: input.session_id });
  if (!client || !project || !url) {
    return [];
  }
  const written = [];
  const post = async (body) => {
    const answer = await client.post('/agent-runs', { url, project, ...body });
    written.push(body);
    return answer;
  };
  const event = input.hook_event_name;
  if (event === 'SessionStart') {
    // Only a new session names the agent: on a resume or a compaction a tick
    // or a child may already have written its own.
    await post({ ...(input.source === 'startup' ? { agent } : {}), ...(input.model ? { model: input.model } : {}) });
    return written;
  }
  if (event !== 'Stop' && event !== 'SessionEnd') {
    return written;
  }
  const { usage, model, models, children } = usageOf(input.transcript_path || '', { address: url });
  const answer = await post({ ...(usage ? { usage } : {}), ...(model ? { model } : {}) });
  // A cloud session's /clear keeps its address, so the run goes on. A run a
  // tick already closed, `failed` say, keeps its status.
  const continues = input.reason === 'clear' && env.CLAUDE_CODE_REMOTE_SESSION_ID;
  const closes = event === 'SessionEnd' && !continues && answer?.run?.status === 'running';
  // The status a model's run ends with is the session's: it is only the part
  // of the session's spend on that model.
  const status = closes ? 'completed' : answer?.run?.status;
  const extra = [
    // A child's run is its own: only its spend is written, never its status.
    ...children.map((child) => { return { url: child.url, usage: child.usage, ...(child.model ? { model: child.model } : {}) }; }),
    ...models.map((entry) => {
      return { url: modelAddress({ url, model: entry.model }), parent: url, model: entry.model, usage: entry.usage, ...(status && status !== 'running' ? { status } : {}) };
    }),
  ];
  for (const body of extra) {
    // One run the key cannot write, a child's in another project say, never
    // keeps the others or the close from landing.
    try {
      await client.post('/agent-runs', { project, ...body });
      written.push(body);
    } catch (error) {
      process.stderr.write(`flow session-run: ${body.url}: ${error.message}\n`);
    }
  }
  if (closes) {
    await post({ status: 'completed' });
  }
  return written;
};

/**
 * The Stop input for the session running this process, from its id and the
 * transcript Claude Code keeps under ~/.claude/projects; null outside one.
 */
export const selfInput = ({ env = process.env, root = join(homedir(), '.claude', 'projects') } = {}) => {
  const sessionId = env.CLAUDE_CODE_SESSION_ID;
  if (!sessionId) {
    return null;
  }
  let dirs = [];
  try {
    dirs = readdirSync(root);
  } catch {
    return null;
  }
  const path = dirs.map((dir) => { return join(root, dir, `${sessionId}.jsonl`); }).find((candidate) => { return existsSync(candidate); });
  return path ? { hook_event_name: 'Stop', session_id: sessionId, transcript_path: path } : null;
};

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
};

const isMain = process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain) {
  (async () => {
    const f = parseFlags(process.argv.slice(2));
    const input = f.self ? selfInput() || {} : JSON.parse((await readStdin()) || '{}');
    const client = process.env.FLOW_API_KEY ? clientFromEnv() : null;
    await record({ input, project: f.project, agent: typeof f.agent === 'string' ? f.agent : undefined, client });
  })().catch((error) => {
    process.stderr.write(`flow session-run: ${error.message}\n`);
  }).finally(() => {
    process.exit(0);
  });
}
