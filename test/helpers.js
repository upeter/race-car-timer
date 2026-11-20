import assert from 'node:assert/strict';

// Colours as the camera might see them. Hues: FLOOR 33°, PINK 329°,
// GREEN 135°, BLUE 221°, ORANGE 33°. GREY is not saturated.
export const FLOOR = [200, 160, 110];
export const PINK = [255, 60, 160];
export const GREEN = [40, 200, 80];
export const BLUE = [40, 100, 230];
export const ORANGE = [255, 140, 0];
export const GREY = [130, 130, 135];

// mix([[800, FLOOR], [200, PINK]]) → RGBA buffer of 1000 pixels.
export function mix(parts) {
  const total = parts.reduce((sum, [count]) => sum + count, 0);
  const data = new Uint8ClampedArray(total * 4);
  let i = 0;
  for (const [count, [r, g, b]] of parts) {
    for (let k = 0; k < count; k++) {
      data[i++] = r;
      data[i++] = g;
      data[i++] = b;
      data[i++] = 255;
    }
  }
  return data;
}

export function fill(count, rgb) {
  return mix([[count, rgb]]);
}

export function near(actual, expected, eps = 0.5) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `expected ${actual} to be within ${eps} of ${expected}`,
  );
}
