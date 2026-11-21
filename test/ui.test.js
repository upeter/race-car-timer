import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, hueToCss, carColor, formatGap } from '../src/ui.js';

test('formatTime shows minutes, seconds and hundredths', () => {
  assert.equal(formatTime(0), '0:00.00');
  assert.equal(formatTime(5.5), '0:05.50');
  assert.equal(formatTime(65.25), '1:05.25');
  assert.equal(formatTime(600), '10:00.00');
});

test('formatTime rounds to hundredths without showing 60 seconds', () => {
  assert.equal(formatTime(59.999), '1:00.00');
  assert.equal(formatTime(1.234), '0:01.23');
});

test('formatTime shows a dash when there is no time', () => {
  assert.equal(formatTime(null), '–');
});

test('hueToCss makes an hsl colour', () => {
  assert.equal(hueToCss(329.2), 'hsl(329 90% 55%)');
});

test('carColor prefers the measured sticker colour', () => {
  assert.equal(carColor({ hue: 329.2, color: '#e04a8c' }), '#e04a8c');
  assert.equal(carColor({ hue: 329.2 }), 'hsl(329 90% 55%)');
});

test('formatGap shows seconds on the same lap and laps when lapped', () => {
  assert.equal(formatGap(null), '');
  assert.equal(formatGap({ seconds: 0.784 }), '+0.78');
  assert.equal(formatGap({ seconds: 75.5 }), '+1:15.50');
  assert.equal(formatGap({ laps: 1 }), '+1 lap');
  assert.equal(formatGap({ laps: 2 }), '+2 laps');
});
