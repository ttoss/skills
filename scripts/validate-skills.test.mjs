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

test('finding tag with unknown dimension slug fails (slugs parsed from methodology.md)', () => {
  const body = `${fm('foo')}\n[P1][G-001][not-a-slug][enforcement] Bad tag\n  Key: a.ts:x:not-a-slug:rule\n`;
  withSkill('foo', body, (dir) => {
    mkdirSync(join(dir, 'foo', 'reference'), { recursive: true });
    writeFileSync(join(dir, 'foo', 'reference', 'methodology.md'), '1. **Verification loop** (`verification-loop`) — x.\n');
    const errors = validate(dir);
    assert.ok(errors.some((e) => e.includes('unknown dimension slug')), errors.join('; '));
  });
});

test('finding tag with unknown ladder rung fails', () => {
  const body = `${fm('foo')}\n[P1][G-001][verification-loop][not-a-rung] Bad rung\n  Key: a.ts:x:verification-loop:rule\n`;
  withSkill('foo', body, (dir) => {
    const errors = validate(dir);
    assert.ok(errors.some((e) => e.includes('unknown ladder rung')), errors.join('; '));
  });
});

test('file emitting finding tags without a Key: line fails', () => {
  const body = `${fm('foo')}\n[P1][G-001][verification-loop][enforcement] Tag without key\n`;
  withSkill('foo', body, (dir) => {
    const errors = validate(dir);
    assert.ok(errors.some((e) => e.includes('no Key: line')), errors.join('; '));
  });
});

test('template placeholders like [P0/P1][G-###] do not trigger tag checks', () => {
  const body = `${fm('foo')}\n### Required fixes [P0/P1][G-###][dimension][rung] ...\n`;
  withSkill('foo', body, (dir) => assert.deepEqual(validate(dir), []));
});

test('README mode table drifting from modes/ fails; matching passes', () => {
  withSkill('foo', fm('foo'), (dir) => {
    mkdirSync(join(dir, 'foo', 'modes'), { recursive: true });
    writeFileSync(join(dir, 'foo', 'modes', 'plan.md'), '# plan\n');
    writeFileSync(join(dir, 'foo', 'README.md'), '| Mode | Does |\n| --- | --- |\n| `plan` | x |\n| `ghost` | y |\n');
    const errors = validate(dir);
    assert.ok(errors.some((e) => e.includes('README mode table')), errors.join('; '));
    writeFileSync(join(dir, 'foo', 'README.md'), '| Mode | Does |\n| --- | --- |\n| `plan` | x |\n');
    assert.deepEqual(validate(dir), []);
  });
});

test('README referencing a nonexistent /skill mode fails', () => {
  withSkill('foo', fm('foo'), (dir) => {
    mkdirSync(join(dir, 'foo', 'modes'), { recursive: true });
    writeFileSync(join(dir, 'foo', 'modes', 'plan.md'), '# plan\n');
    writeFileSync(join(dir, 'foo', 'README.md'), 'Run /foo bogus to start.\n');
    const errors = validate(dir);
    assert.ok(errors.some((e) => e.includes('/foo bogus')), errors.join('; '));
  });
});

test('SKILL.md over 130 lines fails', () => {
  const body = fm('foo') + Array.from({ length: 130 }, (_, i) => `line ${i}`).join('\n');
  withSkill('foo', body, (dir) => {
    const errors = validate(dir);
    assert.ok(errors.some((e) => e.includes('max 130')), errors.join('; '));
  });
});
