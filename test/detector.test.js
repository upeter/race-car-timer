import test from 'node:test';
import assert from 'node:assert/strict';
import { matchLevels, presence } from '../src/detector.js';
import { FLOOR, PINK, GREEN, GREY, mix, fill, near } from './helpers.js';

const cars = [
  { hue: 329, threshold: 0.03 },
  { hue: 135, threshold: 0.03 },
];

test('an empty zone has no car present', () => {
  const levels = matchLevels(fill(1000, FLOOR), cars, 15);
  assert.deepEqual(levels, [0, 0]);
  assert.deepEqual(presence(levels, cars), [false, false]);
});

test('one car in the zone is present, the other is not', () => {
  const data = mix([[800, FLOOR], [100, GREY], [100, PINK]]);
  const levels = matchLevels(data, cars, 15);
  near(levels[0], 0.1, 1e-9);
  assert.equal(levels[1], 0);
  assert.deepEqual(presence(levels, cars), [true, false]);
});

test('two cars in the zone in the same frame are both present', () => {
  const data = mix([[800, FLOOR], [100, PINK], [100, GREEN]]);
  assert.deepEqual(presence(matchLevels(data, cars, 15), cars), [true, true]);
});

test('a level equal to the threshold is not present', () => {
  assert.deepEqual(presence([0.03, 0.031], cars), [false, true]);
});
