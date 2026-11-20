import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, hueToCss } from '../src/ui.js';

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
