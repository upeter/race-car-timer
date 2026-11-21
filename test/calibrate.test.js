import test from 'node:test';
import assert from 'node:assert/strict';
import {
  averageFrames,
  findNoteHue,
  hueAround,
  calibrateCar,
} from '../src/calibrate.js';
import { hueDistance } from '../src/color.js';
import { FLOOR, PINK, ORANGE, GREY, mix, fill, near } from './helpers.js';

const baseline = fill(1000, FLOOR);
// A grey car body with a pink note on a floor: 10 % of the zone is note.
const pinkCar = mix([[800, FLOOR], [100, GREY], [100, PINK]]);

test('averageFrames averages each channel', () => {
  const result = averageFrames([fill(2, [0, 0, 0]), fill(2, [100, 50, 200])]);
  assert.deepEqual(Array.from(result), [50, 25, 100, 255, 50, 25, 100, 255]);
});

test('findNoteHue finds the note and ignores the car body', () => {
  const note = findNoteHue(baseline, pinkCar);
  near(note.hue, 329.2);
  near(note.noteFraction, 0.1, 1e-9);
});

test('findNoteHue returns null when nothing changed', () => {
  assert.equal(findNoteHue(baseline, baseline), null);
});

test('findNoteHue returns null for an unsaturated object', () => {
  assert.equal(findNoteHue(baseline, mix([[800, FLOOR], [200, GREY]])), null);
});

test('hueAround averages the saturated pixels around a point', () => {
  near(hueAround(fill(16, PINK), 4, 4, 1, 1, 1), 329.2);
  assert.equal(hueAround(fill(16, GREY), 4, 4, 1, 1, 1), null);
});

test('calibrateCar accepts a clear note colour', () => {
  const result = calibrateCar({
    baseline,
    frame: pinkCar,
    tolerance: 15,
    existingCars: [],
  });
  assert.equal(result.ok, true);
  near(result.car.hue, 329.2);
  assert.equal(result.car.noiseFloor, 0);
  near(result.car.threshold, 0.03, 1e-9);
  assert.equal(result.car.color, '#ff3ca0');
});

test('calibrateCar rejects a frame without a note', () => {
  const result = calibrateCar({
    baseline,
    frame: baseline,
    tolerance: 15,
    existingCars: [],
  });
  assert.deepEqual(result, { ok: false, reason: 'no-note' });
});

test('calibrateCar rejects a note smaller than 2 % of the zone', () => {
  const result = calibrateCar({
    baseline,
    frame: mix([[990, FLOOR], [10, PINK]]),
    tolerance: 15,
    existingCars: [],
  });
  assert.deepEqual(result, { ok: false, reason: 'no-note' });
});

test('calibrateCar rejects a hue within 30 degrees of another car', () => {
  const result = calibrateCar({
    baseline,
    frame: pinkCar,
    tolerance: 15,
    existingCars: [{ hue: 135 }, { hue: 310 }],
  });
  assert.deepEqual(result, {
    ok: false,
    reason: 'too-close-to-car',
    carIndex: 1,
  });
});

test('calibrateCar rejects a note with the hue of the floor', () => {
  const result = calibrateCar({
    baseline,
    frame: mix([[800, FLOOR], [100, GREY], [100, ORANGE]]),
    tolerance: 15,
    existingCars: [],
  });
  assert.deepEqual(result, { ok: false, reason: 'too-close-to-floor' });
});

test('calibrateCar uses a given hue in place of the automatic one', () => {
  const result = calibrateCar({
    baseline,
    frame: pinkCar,
    tolerance: 15,
    existingCars: [],
    hue: 330,
  });
  assert.equal(result.ok, true);
  assert.equal(result.car.hue, 330);
});

test('calibrateCar rejects a given hue that is not in the frame', () => {
  const result = calibrateCar({
    baseline,
    frame: pinkCar,
    tolerance: 15,
    existingCars: [],
    hue: 135,
  });
  assert.deepEqual(result, { ok: false, reason: 'no-note' });
});

test('calibrateCar needs twice the tolerance as hue separation when that is larger', () => {
  const existingCars = [{ hue: 294.2 }]; // 35° from the pink note
  const wide = calibrateCar({
    baseline,
    frame: pinkCar,
    tolerance: 20,
    existingCars,
  });
  assert.deepEqual(wide, { ok: false, reason: 'too-close-to-car', carIndex: 0 });
  const narrow = calibrateCar({
    baseline,
    frame: pinkCar,
    tolerance: 15,
    existingCars,
  });
  assert.equal(narrow.ok, true);
});

test('findNoteHue averages across the 0/360 degree boundary', () => {
  const frame = mix([[800, FLOOR], [100, [255, 40, 60]], [100, [255, 60, 40]]]);
  const note = findNoteHue(baseline, frame);
  assert.ok(hueDistance(note.hue, 0) <= 2, `hue was ${note.hue}`);
});
