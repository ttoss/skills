#!/usr/bin/env node
// Guardian field kit — record one Guardian run (or event) as a JSONL line.
// Dependency-free. The Guardian output format (verdicts, [P?][class][G-NNN][dim][rung]
// headlines, Key: lines, coverage lines) is the parsing contract.
//
// Usage:
//   node guardian-record.mjs <output.md>          # record a run from a saved output
//   ... | node guardian-record.mjs                # record a run from stdin
//   node guardian-record.mjs --improve <key>      # record that a finding was fixed
//   node guardian-record.mjs --fp <key> [reason]  # record a false positive
//
// Sink: appends to $GUARDIAN_STATS_FILE (default ./guardian-stats.jsonl).
import { readFileSync, appendFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const STATS_FILE = process.env.GUARDIAN_STATS_FILE ?? './guardian-stats.jsonl';

const repo = () => {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    return execSync('git remote get-url origin', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim().replace(/\.git$/, '').split(/[:/]/).slice(-2).join('/');
  } catch { return 'unknown'; }
};

const emit = (event) => {
  const line = JSON.stringify({ ts: new Date().toISOString(), repo: repo(), source: process.env.GITHUB_ACTIONS ? 'ci' : 'local', ...event });
  appendFileSync(STATS_FILE, line + '\n');
  console.log(`recorded → ${STATS_FILE}`);
  console.log(line);
};

// Parse one Guardian run output into a run event (no ts/repo/source — emit() adds those).
// Exported so it can be unit-tested; the CLI below only runs when invoked directly.
export const parseRun = (text) => {
  // Mode: inferred from the mode-specific template shapes.
  const mode =
    /### Verdict AUDIT_BACKLOG/.test(text) ? 'audit'
    : /### Documentation verdict/.test(text) ? 'docs'
    : /### Finding fixed/.test(text) ? 'improve'
    : /### PR title/.test(text) ? 'pr'
    : /### Verdict (READY|NEEDS_CLARIFICATION|TOO_RISKY)/.test(text) ? 'plan'
    : 'review';

  const verdict = text.match(/### (?:Documentation verdict|Verdict)\s+`?([A-Z_]+)/)?.[1]
    ?? (/PASS \(trivial/.test(text) ? 'PASS_TRIVIAL' : null);

  // Coverage: review "reviewed N/N changed files" or audit "Read N/N files".
  const cov = text.match(/reviewed (\d+)\/(\d+) changed files/i) ?? text.match(/Read (\d+)\/(\d+) files/i);

  // Findings: each concrete [Pn][class][G-nnn][dim][rung] headline binds to a Key: only within
  // its OWN span (headline → next headline), so a finding missing its Key can neither steal the
  // next finding's key nor drop it. Full form = Key on an indented line under the headline;
  // one-line form = Key inline after "—". A keyless finding is still emitted (without `key`).
  const findings = [];
  const headlineRe = /\[P(\d)\]\[(dominant|trade)\]\[G-(\d+)\]\[([a-z-]+)\]\[([a-z-]+)\]/g;
  const heads = [...text.matchAll(headlineRe)];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const span = text.slice(h.index + h[0].length, i + 1 < heads.length ? heads[i + 1].index : text.length);
    const key = span.match(/Key:\s*(\S+)/)?.[1];
    findings.push({ sev: `P${h[1]}`, class: h[2], id: `G-${h[3].padStart(3, '0')}`, dim: h[4], rung: h[5], ...(key ? { key } : {}) });
  }

  return {
    type: 'run',
    mode,
    ...(verdict ? { verdict } : {}),
    ...(cov ? { coverage: { reviewed: +cov[1], total: +cov[2] } } : {}),
    findings,
  };
};

// CLI — only when run directly (`node guardian-record.mjs …`), not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , arg1, arg2, ...rest] = process.argv;
  if (arg1 === '--improve' || arg1 === '--fp') {
    if (!arg2) { console.error(`usage: guardian-record.mjs ${arg1} <durable-key> [reason]`); process.exit(1); }
    emit({ type: arg1 === '--improve' ? 'improve' : 'fp', key: arg2, ...(rest.length ? { reason: rest.join(' ') } : {}) });
  } else {
    emit(parseRun(arg1 ? readFileSync(arg1, 'utf8') : readFileSync(0, 'utf8')));
  }
}
