import test from 'node:test';
import assert from 'node:assert/strict';

import { bumpCounter, formatDuration, randomDelayMs, remainingToday, todayKey } from '../src/lib/pacing.js';

test('randomDelayMs reste dans les bornes', () => {
  assert.equal(randomDelayMs(30, 60, () => 0), 30000);
  assert.equal(randomDelayMs(30, 60, () => 1), 60000);
  assert.equal(randomDelayMs(30, 60, () => 0.5), 45000);
  assert.equal(randomDelayMs(20, 10, () => 0.5), 20000);
});

test('formatDuration formate les durées', () => {
  assert.equal(formatDuration(45000), '45 s');
  assert.equal(formatDuration(125000), '2 min 05 s');
  assert.equal(formatDuration(3700000), '1 h 01');
});

test('le compteur quotidien se remet à zéro chaque jour', () => {
  const day = new Date('2026-03-04T10:00:00');
  assert.equal(remainingToday(null, 10, day), 10);
  const counter = bumpCounter(bumpCounter(null, day), day);
  assert.equal(counter.count, 2);
  assert.equal(counter.date, todayKey(day));
  assert.equal(remainingToday(counter, 10, day), 8);
  const nextDay = new Date('2026-03-05T09:00:00');
  assert.equal(remainingToday(counter, 10, nextDay), 10);
  assert.equal(remainingToday(counter, 0, day), Number.POSITIVE_INFINITY);
});
