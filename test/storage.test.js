import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeSetup, deserializeSetup } from '../src/storage.js';

const setup = {
  zone: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
  baseline: {
    data: Uint8ClampedArray.from([1, 2, 3, 255, 4, 5, 6, 255]),
    width: 2,
    height: 1,
  },
  cars: [{ name: 'Car 1', hue: 329, threshold: 0.03, noiseFloor: 0 }],
  settings: { tolerance: 15, minLapTime: 2, mode: 'race', lapTarget: 10 },
};

test('a setup survives a round trip', () => {
  const result = deserializeSetup(serializeSetup(setup));
  assert.deepEqual(result, setup);
  assert.ok(result.baseline.data instanceof Uint8ClampedArray);
});

test('a setup without a baseline survives a round trip', () => {
  const empty = { ...setup, zone: null, baseline: null, cars: [] };
  assert.deepEqual(deserializeSetup(serializeSetup(empty)), empty);
});

test('invalid text gives null', () => {
  assert.equal(deserializeSetup('not json'), null);
  assert.equal(deserializeSetup('null'), null);
  assert.equal(deserializeSetup('42'), null);
  assert.equal(deserializeSetup('{"zone":null}'), null);
});
