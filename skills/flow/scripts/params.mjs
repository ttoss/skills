import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFlags } from './flow-api.mjs';

// The project's parameters as the scripts read them. The file is found by
// the precedence the parameters page gives (`.agents/flow.md`,
// `.claude/flow.md`, then a `## Flow parameters` section of `AGENTS.md` or
// `CLAUDE.md`), read as its list of `- **Name**: value` items, and the file
// its `Runtime` points to is read the same way. A value a script needs is
// taken from its own item when there is one, else from the prose that states
// it, else the default; `sources` says which, so nothing is silently guessed.
//
// Usage: node params.mjs [--root <repo dir>]
// Output: JSON `{ file, projectId, standingDecision, repos, reviewers, params, sources, items }`.

export const LOCATIONS = ['.agents/flow.md', '.claude/flow.md', 'AGENTS.md', 'CLAUDE.md'];

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5 };

/** Every top-level `- **Name**: value` item, continuation lines joined. */
export const items = (markdown) => {
  const out = {};
  let current = null;
  for (const line of markdown.split('\n')) {
    const match = /^- \*\*([^*]+)\*\*[,:]?\s*(.*)$/.exec(line);
    if (match) {
      current = match[1].trim().replace(/:$/, '');
      out[current] = match[2].trim();
    } else if (current && /^\s+\S/.test(line)) {
      out[current] += ` ${line.trim()}`;
    } else if (line.trim() === '' || /^#/.test(line)) {
      current = line.trim() === '' ? current : null;
    } else {
      current = null;
    }
  }
  return out;
};

const section = (markdown, heading) => {
  const start = markdown.search(new RegExp(`^##\\s+${heading}\\s*$`, 'mi'));
  if (start < 0) {
    return null;
  }
  const rest = markdown.slice(start).split('\n').slice(1);
  const end = rest.findIndex((l) => { return /^##?\s/.test(l); });
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
};

/** The parameters file and its text, by precedence, or null. */
export const findFile = (root) => {
  for (const name of LOCATIONS) {
    const path = join(root, name);
    if (!existsSync(path)) {
      continue;
    }
    const text = readFileSync(path, 'utf8');
    if (name.endsWith('flow.md')) {
      return { file: name, text };
    }
    const part = section(text, 'Flow parameters');
    if (part) {
      return { file: `${name} § Flow parameters`, text: part };
    }
  }
  return null;
};

const hours = (value) => {
  const m = /(\d+(?:\.\d+)?)\s*(minute|min|hour|h\b|day)/i.exec(value || '');
  if (!m) {
    return null;
  }
  const n = Number(m[1]);
  return /min/i.test(m[2]) ? n / 60 : /day/i.test(m[2]) ? n * 24 : n;
};

const yesNo = (value) => {
  if (/^\s*(yes|true|on)\b/i.test(value || '')) {
    return true;
  }
  return /^\s*(no|false|off|none)\b/i.test(value || '') ? false : null;
};

// `Review`: none → false; any reviewer named → true; not stated → null.
const reviewNamed = (value) => {
  const text = (value || '').replace(/[`*.]/g, '').trim();
  if (!text) {
    return null;
  }
  return !/^(none|no)\b/i.test(text);
};

/** What the scripts need, from the items of the parameters and runtime files. */
export const resolve = ({ file, main, runtime = {} }) => {
  const sources = {};
  const pick = (name, sourcesList, defaultValue) => {
    for (const [where, value] of sourcesList) {
      if (value !== null && value !== undefined) {
        sources[name] = where;
        return value;
      }
    }
    sources[name] = 'default';
    return defaultValue;
  };
  const intOf = (v) => { const m = /(\d+)/.exec(v || ''); return m ? Number(m[1]) : null; };

  const params = {
    maxRuns: pick('maxRuns', [
      ['Max runs', intOf(main['Max runs'])],
      ['Runtime file: Max runs', intOf(runtime['Max runs'])],
      ['Runtime: "max runs N"', intOf((/max runs (\d+)/i.exec(main.Runtime || '') || [])[1])],
    ], 3),
    // Check and review children, which only read and end within minutes, take
    // their own limit, so a due check never takes a slot new work could use.
    maxShortRuns: pick('maxShortRuns', [
      ['Max short runs', intOf(main['Max short runs'])],
      ['Runtime file: Max short runs', intOf(runtime['Max short runs'])],
      ['Runtime: "max short runs N"', intOf((/max short runs (\d+)/i.exec(main.Runtime || '') || [])[1])],
    ], 2),
    staleAfterHours: pick('staleAfterHours', [
      ['Stale after', hours(main['Stale after'])],
      ['Runtime file: Stale after', hours(runtime['Stale after'])],
    ], 4),
    autoRounds: pick('autoRounds', [
      ['Rounds', intOf(main.Rounds)],
      ['Merge rule: "N automatic round"', (() => {
        const m = /\b(\d+|one|two|three|four|five) automatic rounds?\b/i.exec(main['Merge rule'] || '');
        return m ? (WORDS[m[1].toLowerCase()] ?? Number(m[1])) : null;
      })()],
    ], 1),
    reviewByAgent: pick('reviewByAgent', [['Review child', yesNo(main['Review child'])]], false),
    // A gate's parameter fails closed: a `Review` the file does not state is
    // null, which the planner asks about, never "no review".
    reviewRequired: pick('reviewRequired', [
      ['Review child', yesNo(main['Review child']) === true ? true : null],
      ['Review', reviewNamed(main.Review)],
    ], null),
    agentsMayIntegrate: pick('agentsMayIntegrate', [['Agents integrate', yesNo(main['Agents integrate'])]], true),
    focus: null,
    // The WIP limit on new work; null leaves the planner's default, 20.
    releaseQueue: pick('releaseQueue', [
      ['Release queue', intOf(main['Release queue'])],
      ['Runtime file: Release queue', intOf(runtime['Release queue'])],
      // The name it had before it covered everything up to the release.
      ['Review queue', intOf(main['Review queue'])],
      ['Runtime file: Review queue', intOf(runtime['Review queue'])],
    ], null),
    // How many person-free tasks may be in flight while that queue is full;
    // null leaves the planner's default, 1, and 0 closes the lane.
    personFreeLane: pick('personFreeLane', [
      ['Person-free lane', intOf(main['Person-free lane'])],
      ['Runtime file: Person-free lane', intOf(runtime['Person-free lane'])],
    ], null),
    // Whether the `Closing evidence` gives the agent the choice of what
    // integrating leaves: it says so in prose, so a judge reads it when a
    // task needs the answer, never a guess here.
    leavesByAgent: null,
    // Whether the standing decision delegates retracting a `blocks` edge
    // whose source integrated: the decision is a Flow task, so a judge reads
    // it when the planner finds such an edge, never a guess here.
    retargetByAgent: null,
    // How many children may push to one repo in one tick; null: no cap, as
    // when each child runs in a session of its own.
    branchesPerRepo: pick('branchesPerRepo', [
      ['Branches per repo', intOf(main['Branches per repo'])],
      ['Runtime file: Branches per repo', intOf(runtime['Branches per repo'])],
    ], null),
  };
  const projectId = (/proj_[0-9a-hjkmnp-tv-z]{10}/.exec(main['Flow project id'] || '') || [null])[0];
  const standingDecision = (/task_[0-9a-hjkmnp-tv-z]{10}/.exec(main['Standing-decision task id'] || '') || [null])[0];
  const repos = [...(main.Repos || '').matchAll(/`([\w.-]+\/[\w.-]+)`/g)].map((m) => { return m[1]; });
  // The code-host identities whose verdict counts; none named → any identity
  // with write access to the repo.
  const reviewers = [...(main.Reviewer || main.Reviewers || '').matchAll(/`([^`\s]+)`/g)].map((m) => { return m[1]; });
  return { file, projectId, standingDecision, repos, reviewers, params, sources, items: main };
};

/** The parameters of the repo at `root`, or an error naming what is missing. */
export const load = (root = '.') => {
  const found = findFile(root);
  if (!found) {
    throw new Error(`no parameters in ${root}: looked in ${LOCATIONS.join(', ')}; run /flow-setup`);
  }
  const main = items(found.text);
  const pointer = (/`([^`]+\.md)`/.exec(main.Runtime || '') || [])[1];
  const runtime = pointer && existsSync(join(root, pointer)) ? items(readFileSync(join(root, pointer), 'utf8')) : {};
  const out = resolve({ file: found.file, main, runtime });
  if (!out.projectId || !out.standingDecision) {
    throw new Error(`${found.file} names no ${out.projectId ? 'standing-decision task id' : 'Flow project id'}`);
  }
  return out;
};

const isMain = process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain) {
  try {
    const { root = '.' } = parseFlags(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(load(root), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
