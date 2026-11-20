import { matchFraction } from './color.js';

// Fraction of zone pixels that match each car's hue.
export function matchLevels(data, cars, tolerance) {
  return cars.map((car) => matchFraction(data, car.hue, tolerance));
}

// A car is present when its level is above its own threshold.
export function presence(levels, cars) {
  return levels.map((level, index) => level > cars[index].threshold);
}
