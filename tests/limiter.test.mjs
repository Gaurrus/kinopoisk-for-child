import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { EpisodeLimiter, normalizeLimit } = require('../dist/main/limiter.js');

test('counts distinct episodes and blocks the next one', () => {
  const limiter = new EpisodeLimiter(2);

  assert.deepEqual(limiter.attempt('s1e1'), { allowed: true, alreadyCounted: false });
  assert.deepEqual(limiter.attempt('s1e2'), { allowed: true, alreadyCounted: false });
  assert.deepEqual(limiter.attempt('s1e3'), { allowed: false, alreadyCounted: false });

  const snapshot = limiter.snapshot();
  assert.equal(snapshot.used, 2);
  assert.equal(snapshot.remaining, 0);
  assert.deepEqual(snapshot.allowed.sort(), ['s1e1', 's1e2']);
});

test('rewatching an allowed episode does not spend the limit', () => {
  const limiter = new EpisodeLimiter(1);

  assert.equal(limiter.attempt('s1e1').allowed, true);
  assert.deepEqual(limiter.attempt('s1e1'), { allowed: true, alreadyCounted: true });
  assert.equal(limiter.snapshot().used, 1);
});

test('zero means unlimited', () => {
  const limiter = new EpisodeLimiter(0);
  for (let index = 0; index < 50; index += 1) {
    assert.equal(limiter.attempt(`ep-${index}`).allowed, true);
  }
  assert.equal(limiter.snapshot().remaining, null);
});

test('lowering the limit blocks new episodes immediately', () => {
  const limiter = new EpisodeLimiter(3);
  limiter.attempt('a');
  limiter.attempt('b');
  limiter.setLimit(1);

  assert.equal(limiter.attempt('c').allowed, false);
  assert.equal(limiter.attempt('a').allowed, true);
});

test('reset clears the counter', () => {
  const limiter = new EpisodeLimiter(1);
  limiter.attempt('a');
  limiter.reset(2);

  assert.equal(limiter.snapshot().used, 0);
  assert.equal(limiter.attempt('b').allowed, true);
});

test('normalizeLimit clamps values', () => {
  assert.equal(normalizeLimit('5'), 5);
  assert.equal(normalizeLimit(-3), 0);
  assert.equal(normalizeLimit(500), 99);
  assert.equal(normalizeLimit('nope'), 0);
});
