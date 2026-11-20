import test from 'node:test';
import assert from 'node:assert/strict';
import { createTracker, updateTracker } from '../src/laps.js';

const MIN = 2;

// Three absent frames, so the tracker leaves the zone.
function leave(tracker, time) {
  for (let k = 1; k <= 3; k++) updateTracker(tracker, false, time + k * 0.03, MIN);
}

test('the first present frame is a crossing', () => {
  const tracker = createTracker();
  assert.equal(updateTracker(tracker, false, 0, MIN), false);
  assert.equal(updateTracker(tracker, true, 1, MIN), true);
  assert.equal(tracker.lastCrossing, 1);
});

test('a car that stays in the zone crosses only once', () => {
  const tracker = createTracker();
  assert.equal(updateTracker(tracker, true, 1, MIN), true);
  assert.equal(updateTracker(tracker, true, 1.03, MIN), false);
  assert.equal(updateTracker(tracker, true, 5, MIN), false);
});

test('flicker during a crossing does not count twice', () => {
  const tracker = createTracker();
  assert.equal(updateTracker(tracker, true, 1, MIN), true);
  assert.equal(updateTracker(tracker, false, 1.03, MIN), false);
  assert.equal(updateTracker(tracker, false, 1.06, MIN), false);
  assert.equal(updateTracker(tracker, true, 5, MIN), false);
});

test('a new crossing counts after three absent frames', () => {
  const tracker = createTracker();
  updateTracker(tracker, true, 1, MIN);
  leave(tracker, 1);
  assert.equal(updateTracker(tracker, true, 4, MIN), true);
  assert.equal(tracker.lastCrossing, 4);
});

test('a crossing inside the minimum lap time is ignored', () => {
  const tracker = createTracker();
  updateTracker(tracker, true, 1, MIN);
  leave(tracker, 1);
  assert.equal(updateTracker(tracker, true, 2, MIN), false);
  assert.equal(tracker.lastCrossing, 1);
  leave(tracker, 2);
  assert.equal(updateTracker(tracker, true, 3.5, MIN), true);
});
