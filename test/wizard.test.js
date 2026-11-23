import test from 'node:test';
import assert from 'node:assert/strict';
import { furthestStep, clampStep, openingStep } from '../src/wizard.js';

const zone = { x: 0.4, y: 0.1, w: 0.2, h: 0.6 };
const baseline = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
const car = { name: 'Car 1', hue: 60, threshold: 0.1 };

test('furthestStep is the first step that is not done', () => {
  assert.equal(furthestStep({ zone: null, baseline: null, cars: [] }), 'zone');
  assert.equal(furthestStep({ zone, baseline: null, cars: [] }), 'baseline');
  assert.equal(furthestStep({ zone, baseline, cars: [] }), 'cars');
  assert.equal(furthestStep({ zone, baseline, cars: [car] }), 'ready');
});

test('clampStep keeps a step that is allowed', () => {
  const setup = { zone, baseline, cars: [car] };
  assert.equal(clampStep('zone', setup), 'zone');
  assert.equal(clampStep('mode', setup), 'mode');
  assert.equal(clampStep('ready', setup), 'ready');
});

test('clampStep goes back when the setup lost a step', () => {
  assert.equal(clampStep('ready', { zone, baseline, cars: [] }), 'cars');
  assert.equal(clampStep('mode', { zone, baseline: null, cars: [] }), 'baseline');
  assert.equal(clampStep('cars', { zone: null, baseline: null, cars: [] }), 'zone');
});

test('openingStep shows the session step when the setup is complete', () => {
  assert.equal(openingStep({ zone, baseline, cars: [car] }), 'mode');
  assert.equal(openingStep({ zone, baseline, cars: [] }), 'cars');
  assert.equal(openingStep({ zone: null, baseline: null, cars: [] }), 'zone');
});
