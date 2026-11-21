import {
  rgbToHsv,
  hueDistance,
  circularMeanHue,
  isSaturated,
  matchFraction,
  meanMatchColor,
} from './color.js';

export const CHANGE_DISTANCE = 40;
export const MIN_NOTE_FRACTION = 0.02;
export const MIN_HUE_SEPARATION = 30;
export const AREA_FACTOR = 0.3;
export const NOISE_MARGIN = 0.01;

const HUE_BINS = 36;

// Average of several RGBA buffers of the same length.
export function averageFrames(frames) {
  const length = frames[0].length;
  const sum = new Float64Array(length);
  for (const frame of frames) {
    for (let i = 0; i < length; i++) sum[i] += frame[i];
  }
  const result = new Uint8ClampedArray(length);
  for (let i = 0; i < length; i++) result[i] = sum[i] / frames.length;
  return result;
}

// Finds the dominant hue of the saturated pixels that differ from the
// baseline. Returns null when there are none.
export function findNoteHue(baseline, frame) {
  const pixels = frame.length / 4;
  const hues = [];
  const bins = new Array(HUE_BINS).fill(0);
  for (let i = 0; i < frame.length; i += 4) {
    const dr = frame[i] - baseline[i];
    const dg = frame[i + 1] - baseline[i + 1];
    const db = frame[i + 2] - baseline[i + 2];
    if (Math.hypot(dr, dg, db) <= CHANGE_DISTANCE) continue;
    const { h, s, v } = rgbToHsv(frame[i], frame[i + 1], frame[i + 2]);
    if (!isSaturated(s, v)) continue;
    hues.push(h);
    bins[binOf(h)]++;
  }
  if (hues.length === 0) return null;
  const peak = bins.indexOf(Math.max(...bins));
  const selected = new Set([
    (peak + HUE_BINS - 1) % HUE_BINS,
    peak,
    (peak + 1) % HUE_BINS,
  ]);
  const hue = circularMeanHue(hues.filter((h) => selected.has(binOf(h))));
  return { hue, noteFraction: hues.length / pixels };
}

function binOf(hue) {
  return Math.floor(hue / (360 / HUE_BINS)) % HUE_BINS;
}

// Mean hue of the saturated pixels in a square around (x, y) of a
// width × height RGBA image. Returns null when none is saturated.
export function hueAround(frame, width, height, x, y, radius) {
  const hues = [];
  for (let py = y - radius; py <= y + radius; py++) {
    for (let px = x - radius; px <= x + radius; px++) {
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const i = (py * width + px) * 4;
      const { h, s, v } = rgbToHsv(frame[i], frame[i + 1], frame[i + 2]);
      if (isSaturated(s, v)) hues.push(h);
    }
  }
  return hues.length === 0 ? null : circularMeanHue(hues);
}

// Learns a car from a frame with the car on the finish line. When `hue` is
// given (the user tapped the note), the automatic hue detection is skipped.
export function calibrateCar({
  baseline,
  frame,
  tolerance,
  existingCars,
  hue = null,
}) {
  let carHue = hue;
  if (carHue === null) {
    const note = findNoteHue(baseline, frame);
    if (note === null || note.noteFraction < MIN_NOTE_FRACTION) {
      return { ok: false, reason: 'no-note' };
    }
    carHue = note.hue;
  }
  const area = matchFraction(frame, carHue, tolerance);
  if (area < MIN_NOTE_FRACTION) return { ok: false, reason: 'no-note' };

  // Cars calibrated apart by less than twice the tolerance would match each other.
  const separation = Math.max(MIN_HUE_SEPARATION, 2 * tolerance);
  const carIndex = existingCars.findIndex(
    (car) => hueDistance(car.hue, carHue) < separation,
  );
  if (carIndex !== -1) {
    return { ok: false, reason: 'too-close-to-car', carIndex };
  }

  const noiseFloor = matchFraction(baseline, carHue, tolerance);
  if (noiseFloor > area / 2) {
    return { ok: false, reason: 'too-close-to-floor' };
  }

  const threshold = Math.max(AREA_FACTOR * area, noiseFloor + NOISE_MARGIN);
  const color = meanMatchColor(frame, carHue, tolerance);
  return { ok: true, car: { hue: carHue, color, threshold, noiseFloor } };
}
