const KEY = 'race-car-timer-setup';

export const DEFAULT_SETTINGS = {
  tolerance: 15,
  minLapTime: 2,
  mode: 'practice',
  lapTarget: 10,
};

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

export function serializeSetup(setup) {
  const { baseline } = setup;
  return JSON.stringify({
    ...setup,
    baseline: baseline
      ? { ...baseline, data: Array.from(baseline.data) }
      : null,
  });
}

export function deserializeSetup(text) {
  try {
    const raw = JSON.parse(text);
    if (
      raw === null ||
      typeof raw !== 'object' ||
      !Array.isArray(raw.cars) ||
      typeof raw.settings !== 'object' ||
      raw.settings === null
    ) {
      return null;
    }
    const baseline =
      raw.baseline && isNumber(raw.baseline.width) && isNumber(raw.baseline.height)
        ? { ...raw.baseline, data: Uint8ClampedArray.from(raw.baseline.data) }
        : null;
    const cars = baseline
      ? raw.cars.filter(
          (car) => car && isNumber(car.hue) && isNumber(car.threshold),
        )
      : [];
    return {
      zone: raw.zone ?? null,
      baseline,
      cars,
      settings: { ...DEFAULT_SETTINGS, ...raw.settings },
    };
  } catch {
    return null;
  }
}

export function saveSetup(setup) {
  try {
    localStorage.setItem(KEY, serializeSetup(setup));
  } catch {
    // Storage is not available (private mode, quota). The app works without.
  }
}

export function loadSetup() {
  try {
    const text = localStorage.getItem(KEY);
    return text === null ? null : deserializeSetup(text);
  } catch {
    return null;
  }
}

export function clearSetup() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
