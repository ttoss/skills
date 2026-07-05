#!/usr/bin/env node
// Minimal, dependency-free skill validator for this repo (ttoss/skills).
// Checks the few invariants that break silently; deliberately NOT a markdown/prose linter.
// Run: node scripts/validate-skills.mjs
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = join(repoRoot, 'skills');
const errors = [];
const err = (skill, msg) => errors.push(`${skill}: ${msg}`);

// Drop fenced code blocks so illustrative example paths (e.g. src/foo.ts) aren't treated as references.
const stripFences = (text) => {
  let inFence = false;
  return text
    .split('\n')
    .filter((line) => {
      if (line.trimStart().startsWith('```')) { inFence = !inFence; return false; }
      return !inFence;
    })
    .join('\n');
};

const parseFrontmatter = (text) => {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return fm;
};

const skills = readdirSync(skillsDir).filter((n) => statSync(join(skillsDir, n)).isDirectory());
if (skills.length === 0) errors.push('no skills found under skills/');

for (const skill of skills) {
  const root = join(skillsDir, skill);
  const skillMd = join(root, 'SKILL.md');
  if (!existsSync(skillMd)) { err(skill, 'missing SKILL.md'); continue; }
  const raw = readFileSync(skillMd, 'utf8');

  // 1. Structural: frontmatter present, required keys, name === directory.
  const fm = parseFrontmatter(raw);
  if (!fm) err(skill, 'SKILL.md has no YAML frontmatter');
  else {
    if (!fm.name) err(skill, 'frontmatter missing `name`');
    else if (fm.name !== skill) err(skill, `frontmatter name "${fm.name}" != directory "${skill}"`);
    if (!fm.description) err(skill, 'frontmatter missing `description`');
  }

  // 2. Referential integrity: every internal `reference/…md` / `modes/…md` mention resolves (fences ignored).
  const scanFiles = [skillMd];
  for (const sub of ['reference', 'modes']) {
    const d = join(root, sub);
    if (existsSync(d)) for (const f of readdirSync(d)) if (f.endsWith('.md')) scanFiles.push(join(d, f));
  }
  for (const file of scanFiles) {
    const body = stripFences(readFileSync(file, 'utf8'));
    for (const ref of body.matchAll(/`((?:reference|modes)\/[^`\s]+\.md)`/g)) {
      if (!existsSync(join(root, ref[1]))) err(skill, `${file.slice(root.length + 1)} references missing ${ref[1]}`);
    }
  }

  // 3. Contract agreement: modes/*.md set === modes declared in argument-hint.
  const modesDir = join(root, 'modes');
  if (existsSync(modesDir)) {
    const fileModes = readdirSync(modesDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
    const hint = fm?.['argument-hint']?.match(/([a-z|]+)/)?.[1] ?? '';
    const hintModes = hint.split('|').filter(Boolean).sort();
    if (hintModes.length && fileModes.join(',') !== hintModes.join(',')) {
      err(skill, `modes/ (${fileModes.join(',')}) != argument-hint (${hintModes.join(',')})`);
    }
  }
}

const unique = [...new Set(errors)];
if (unique.length) {
  console.error(`✗ skill validation failed (${unique.length}):`);
  for (const e of unique) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✓ ${skills.length} skill(s) valid: ${skills.join(', ')}`);
