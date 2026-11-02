// The one way the routines' scripts read Flow: GET only, with the API key in
// FLOW_API_KEY (a key restricted to the project; see flow-setup's
// prerequisites). No script writes: writes stay with the model, through the
// MCP tools, where the standing decision and `basis` apply.

export const DEFAULT_BASE = 'https://flow.ttoss.dev';

export class FlowError extends Error {
  constructor({ path, status, detail = '' }) {
    super(`GET ${path} answered ${status}${status === 404 ? ': the key cannot reach it' : ''}${detail ? `: ${detail}` : ''}`);
    this.status = status;
  }
}

/**
 * A client over `/api/v1`. `get(path, query)` repeats a query key for each
 * value of an array; `all(path, query, field)` follows `next_cursor` to the
 * end and returns every row of `field`.
 */
export const createClient = ({ key, base = DEFAULT_BASE, fetchImpl = fetch }) => {
  if (!key) {
    throw new Error('FLOW_API_KEY is not set');
  }
  const get = async (path, query = {}) => {
    const url = new URL(`/api/v1${path}`, base);
    for (const [name, value] of Object.entries(query)) {
      if (value === undefined || value === null) {
        continue;
      }
      for (const one of Array.isArray(value) ? value : [value]) {
        url.searchParams.append(name, String(one));
      }
    }
    const headers = { authorization: `Bearer ${key}`, accept: 'application/json' };
    let res = await fetchImpl(url, { headers });
    // A 502 or 503 is Flow's dependency being briefly away (Naturali answers a
    // task's body): one retry, then the caller hears it.
    if (res.status === 502 || res.status === 503) {
      await new Promise((resolve) => { setTimeout(resolve, 1000); });
      res = await fetchImpl(url, { headers });
    }
    if (!res.ok) {
      // A 4xx body is Flow's own message about the request, never the data.
      const detail = res.status === 400 ? (await res.text().catch(() => { return ''; })).slice(0, 300) : '';
      throw new FlowError({ path: url.pathname, status: res.status, detail });
    }
    return res.json();
  };
  const all = async (path, query, field) => {
    const rows = [];
    let cursor;
    do {
      const page = await get(path, { ...query, cursor });
      rows.push(...(page[field] || []));
      cursor = page.next_cursor || undefined;
    } while (cursor);
    return rows;
  };
  return { get, all };
};

/** The client the scripts use when run from the command line. */
export const clientFromEnv = (env = process.env) => {
  return createClient({ key: env.FLOW_API_KEY, base: env.FLOW_URL || DEFAULT_BASE });
};

/** `--name value` pairs, as every script here takes them. */
export const parseFlags = (args) => {
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith('--') || args[i + 1] === undefined) {
      throw new Error(`expected --name <value>, got ${args[i]}`);
    }
    out[args[i].slice(2)] = args[i + 1];
  }
  return out;
};

/** `fn` over `items`, at most `limit` at a time, results in order. */
export const mapLimit = async (items, limit, fn) => {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
};
