export const MIN_SATURATION = 0.35;
export const MIN_VALUE = 0.3;

export function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max / 255 };
}

export function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function circularMeanHue(hues) {
  let x = 0;
  let y = 0;
  for (const hue of hues) {
    const rad = (hue * Math.PI) / 180;
    x += Math.cos(rad);
    y += Math.sin(rad);
  }
  const mean = (Math.atan2(y, x) * 180) / Math.PI;
  return (mean + 360) % 360;
}

export function isSaturated(s, v) {
  return s >= MIN_SATURATION && v >= MIN_VALUE;
}

// Fraction of the pixels in an RGBA buffer that are saturated and whose hue
// is within `tolerance` degrees of `hue`.
export function matchFraction(data, hue, tolerance) {
  const pixels = data.length / 4;
  if (pixels === 0) return 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    const { h, s, v } = rgbToHsv(data[i], data[i + 1], data[i + 2]);
    if (isSaturated(s, v) && hueDistance(h, hue) <= tolerance) count++;
  }
  return count / pixels;
}
