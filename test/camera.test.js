import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionClock } from '../src/camera.js';

test('the clock passes frame times through before any restart', () => {
  const clock = createSessionClock();
  assert.equal(clock.time(0.5), 0.5);
  assert.equal(clock.time(1.25), 1.25);
});

test('after a restart the clock continues from the last time', () => {
  const clock = createSessionClock();
  clock.time(10);
  clock.restart();
  // A new stream starts its media time again near zero.
  assert.equal(clock.time(0.1), 10);
  assert.equal(clock.time(0.6), 10.5);
});

test('restarts add up', () => {
  const clock = createSessionClock();
  clock.time(10);
  clock.restart();
  clock.time(0);
  clock.time(2);
  clock.restart();
  assert.equal(clock.time(100), 12);
  assert.equal(clock.time(101), 13);
});
