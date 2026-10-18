const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDate } = require('./date-parser');

test('parses a calendar date as midnight UTC', () => {
  assert.equal(parseDate('2026-01-15').toISOString(), '2026-01-15T00:00:00.000Z');
});
