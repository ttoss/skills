import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseFlags } from './flow-api.mjs';

test('flags: --name value pairs, and a flag with no value is true wherever it stands', () => {
  assert.deepEqual(parseFlags(['--root', '.', '--no-host']), { root: '.', 'no-host': true });
  assert.deepEqual(parseFlags(['--no-host', '--lines', '5']), { 'no-host': true, lines: '5' });
  assert.throws(() => { return parseFlags(['root']); }, /expected --name/);
});
