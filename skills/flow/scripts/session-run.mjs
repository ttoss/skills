import { readdirSync, readFileSync, realpathSync } from 'node:fs';
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
// usage; the last line of an id holds the final count.
const messagesOf = (path) => {
  const byId = new Map();
  for (const line of readLines(path)) {
    if (!line.includes('"usage"')) {
      continue;
    }
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const message = entry.message;
    if (message?.role === 'assistant' && message.usage) {
      byId.set(message.id || `${byId.size}`, message);
    }
  }
  return [...byId.values()];
};

const subagentTranscripts = (transcriptPath) => {
  const dir = join(dirname(transcriptPath), basename(transcriptPath, '.jsonl'), 'subagents');
  try {
    return readdirSync(dir).filter((name) => { return name.endsWith('.jsonl'); }).map((name) => { return join(dir, name); });
  } catch {
    return [];
  }
};

/**
 * What the session spent, from its transcript and its subagents': token sums,
 * `peak_context` the largest prompt of the main thread, and the main thread's
 * last model. No `cost_usd`: the transcript holds no price.
 */
export const usageOf = (transcriptPath) => {
  const main = messagesOf(transcriptPath);
  const all = [...main, ...subagentTranscripts(transcriptPath).flatMap(messagesOf)];
  if (all.length === 0) {
    return { usage: null, model: null };
  }
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, peak_context: 0 };
  for (const { usage: u } of all) {
    usage.input_tokens += u.input_tokens || 0;
    usage.output_tokens += u.output_tokens || 0;
    usage.cache_read_tokens += u.cache_read_input_tokens || 0;
    usage.cache_write_tokens += u.cache_creation_input_tokens || 0;
  }
  for (const { usage: u } of main) {
    const prompt = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    usage.peak_context = Math.max(usage.peak_context, prompt);
  }
  const model = main.map((m) => { return m.model; }).filter((m) => { return m && !m.startsWith('<'); }).at(-1) || null;
  return { usage, model };
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
  const { usage, model } = usageOf(input.transcript_path || '');
  const answer = await post({ ...(usage ? { usage } : {}), ...(model ? { model } : {}) });
  // A cloud session's /clear keeps its address, so the run goes on. A run a
  // tick already closed, `failed` say, keeps its status.
  const continues = input.reason === 'clear' && env.CLAUDE_CODE_REMOTE_SESSION_ID;
  if (event === 'SessionEnd' && !continues && answer?.run?.status === 'running') {
    await post({ status: 'completed' });
  }
  return written;
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
    const input = JSON.parse((await readStdin()) || '{}');
    const client = process.env.FLOW_API_KEY ? clientFromEnv() : null;
    await record({ input, project: f.project, agent: typeof f.agent === 'string' ? f.agent : undefined, client });
  })().catch((error) => {
    process.stderr.write(`flow session-run: ${error.message}\n`);
  }).finally(() => {
    process.exit(0);
  });
}
