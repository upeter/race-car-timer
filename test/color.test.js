import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rgbToHsv,
  hueDistance,
  circularMeanHue,
  isSaturated,
  matchFraction,
} from '../src/color.js';
import { FLOOR, PINK, GREY, mix, fill, near } from './helpers.js';

test('rgbToHsv converts primary colours', () => {
  assert.deepEqual(rgbToHsv(255, 0, 0), { h: 0, s: 1, v: 1 });
  assert.deepEqual(rgbToHsv(0, 255, 0), { h: 120, s: 1, v: 1 });
  assert.deepEqual(rgbToHsv(0, 0, 255), { h: 240, s: 1, v: 1 });
});

test('rgbToHsv gives zero saturation for grey and black', () => {
  assert.equal(rgbToHsv(128, 128, 128).s, 0);
  assert.deepEqual(rgbToHsv(0, 0, 0), { h: 0, s: 0, v: 0 });
});

test('rgbToHsv gives a hue between 300 and 360 for pink', () => {
  near(rgbToHsv(...PINK).h, 329.2);
});

test('hueDistance is circular', () => {
  assert.equal(hueDistance(350, 10), 20);
  assert.equal(hueDistance(10, 350), 20);
  assert.equal(hueDistance(0, 180), 180);
  assert.equal(hueDistance(90, 90), 0);
});

test('circularMeanHue wraps around red', () => {
  near(hueDistance(circularMeanHue([350, 10]), 0), 0, 0.001);
  near(circularMeanHue([100, 120]), 110, 0.001);
});

test('isSaturated applies both minimums', () => {
  assert.equal(isSaturated(0.35, 0.3), true);
  assert.equal(isSaturated(0.34, 0.9), false);
  assert.equal(isSaturated(0.9, 0.29), false);
});

test('matchFraction counts saturated pixels within the tolerance', () => {
  const data = mix([[700, FLOOR], [100, GREY], [200, PINK]]);
  near(matchFraction(data, 329, 15), 0.2, 1e-9);
  near(matchFraction(data, 33, 15), 0.7, 1e-9);
  assert.equal(matchFraction(data, 135, 15), 0);
});

test('matchFraction ignores unsaturated pixels and empty buffers', () => {
  assert.equal(matchFraction(fill(10, GREY), 240, 180), 0);
  assert.equal(matchFraction(new Uint8ClampedArray(0), 0, 15), 0);
});
