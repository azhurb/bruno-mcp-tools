import assert from 'node:assert/strict';
import test from 'node:test';

import { formatToolOutput } from '../../src/runner.js';

test('formatToolOutput includes status, headers, and body', () => {
  const text = formatToolOutput(
    {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      bodyText: '{"ok":true}'
    },
    65_536
  );

  assert.match(text, /Status: 200/);
  assert.match(text, /Headers:/);
  assert.match(text, /Body:/);
});

test('formatToolOutput truncates long body', () => {
  const text = formatToolOutput(
    {
      statusCode: 200,
      headers: {},
      bodyText: 'a'.repeat(500)
    },
    100
  );

  assert.match(text, /truncated to 100 bytes/);
});
