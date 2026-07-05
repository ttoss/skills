#!/usr/bin/env node
// Guardian field kit — record one Guardian run (or event) as a JSONL line.
// Dependency-free. The Guardian output format (verdicts, [P?][G-NNN][dim][rung] tags,
// Key: lines, coverage lines) is the parsing contract.
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

const [, , arg1, arg2, ...rest] = process.argv;

if (arg1 === '--improve' || arg1 === '--fp') {
  if (!arg2) { console.error(`usage: guardian-record.mjs ${arg1} <durable-key> [reason]`); process.exit(1); }
  emit({ type: arg1 === '--improve' ? 'improve' : 'fp', key: arg2, ...(rest.length ? { reason: rest.join(' ') } : {}) });
  process.exit(0);
}

const text = arg1 ? readFileSync(arg1, 'utf8') : readFileSync(0, 'utf8');

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

// Findings: concrete tags with their durable keys.
const findings = [];
const tagRe = /\[P(\d)\]\[G-(\d+)\]\[([a-z-]+)\]\[([a-z-]+)\][^\n]*\n\s*Key:\s*(\S+)/g;
for (const m of text.matchAll(tagRe)) {
  findings.push({ sev: `P${m[1]}`, id: `G-${m[2].padStart(3, '0')}`, dim: m[3], rung: m[4], key: m[5] });
}
// Cut findings (audit): `[P1][dim] title — Key: ...`
for (const m of text.matchAll(/\[P(\d)\]\[([a-z-]+)\][^[\n]*?Key:\s*(\S+)/g)) {
  if (!findings.some((f) => f.key === m[3])) findings.push({ sev: `P${m[1]}`, dim: m[2], key: m[3], cut: true });
}

emit({
  type: 'run',
  mode,
  ...(verdict ? { verdict } : {}),
  ...(cov ? { coverage: { reviewed: +cov[1], total: +cov[2] } } : {}),
  findings,
});
