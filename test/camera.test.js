import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyZoom,
  clampZoom,
  createSessionClock,
  zoomRange,
} from '../src/camera.js';

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

const range = { min: 1, max: 4, step: 0.1 };
const track = (zoom) => ({ getCapabilities: () => (zoom ? { zoom } : {}) });

test('zoomRange reads the zoom capability', () => {
  assert.deepEqual(zoomRange(track({ min: 1, max: 8, step: 0.5 })), {
    min: 1,
    max: 8,
    step: 0.5,
  });
});

test('zoomRange is null without zoom, with one level or without getCapabilities', () => {
  assert.equal(zoomRange(track(null)), null);
  assert.equal(zoomRange(track({ min: 1, max: 1, step: 0.1 })), null);
  assert.equal(zoomRange({}), null);
  assert.equal(zoomRange(undefined), null);
});

test('zoomRange uses a step of 0.1 when the camera gives none', () => {
  assert.equal(zoomRange(track({ min: 1, max: 2 })).step, 0.1);
});

test('clampZoom keeps the value in the range and on its steps', () => {
  assert.equal(clampZoom(2.34, range), 2.3);
  assert.equal(clampZoom(0.2, range), 1);
  assert.equal(clampZoom(9, range), 4);
});

test('clampZoom gives the minimum for no stored zoom', () => {
  assert.equal(clampZoom(null, range), 1);
  assert.equal(clampZoom(NaN, range), 1);
});

test('applyZoom sets the clamped zoom on the video track', async () => {
  const applied = [];
  const video = {
    ...track({ min: 1, max: 4, step: 0.1 }),
    applyConstraints: async (constraints) => applied.push(constraints),
  };
  const stream = { getVideoTracks: () => [video] };
  assert.equal(await applyZoom(stream, 5), 4);
  assert.deepEqual(applied, [{ advanced: [{ zoom: 4 }] }]);
});

test('applyZoom is null when the camera has no zoom', async () => {
  const stream = { getVideoTracks: () => [track(null)] };
  assert.equal(await applyZoom(stream, 2), null);
});
