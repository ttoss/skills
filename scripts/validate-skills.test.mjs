// Dependency-free self-test for the skill validator (node:test). Run: node --test scripts/validate-skills.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate } from './validate-skills.mjs';

const fm = (name) => `---\nname: ${name}\ndescription: test skill\n---\n\n# ${name}\n`;

// Build a temp skills/ dir containing one skill, run fn(skillsDir), always clean up.
const withSkill = (name, skillMd, fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'skilltest-'));
  try {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, 'SKILL.md'), skillMd);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('valid skill passes', () => {
  withSkill('foo', fm('foo'), (dir) => assert.deepEqual(validate(dir), []));
});

test('frontmatter name != directory fails', () => {
  withSkill('foo', fm('bar'), (dir) => {
    const errors = validate(dir);
    assert.ok(errors.some((e) => e.includes('name')), errors.join('; '));
  });
});

test('broken internal reference fails', () => {
  withSkill('foo', `${fm('foo')}\nSee \`reference/nope.md\`.\n`, (dir) => {
    const errors = validate(dir);
    assert.ok(errors.some((e) => e.includes('missing reference/nope.md')), errors.join('; '));
  });
});

test('reference inside a fenced block is ignored (no false positive)', () => {
  withSkill('foo', `${fm('foo')}\n\`\`\`\n\`reference/inside-fence.md\`\n\`\`\`\n`, (dir) => {
    assert.deepEqual(validate(dir), []);
  });
});

test('empty skills dir reports an error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skilltest-'));
  try {
    assert.ok(validate(dir).length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
