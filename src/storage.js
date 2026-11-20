const KEY = 'race-car-timer-setup';

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
    return {
      zone: raw.zone ?? null,
      baseline: raw.baseline
        ? { ...raw.baseline, data: Uint8ClampedArray.from(raw.baseline.data) }
        : null,
      cars: raw.cars,
      settings: raw.settings,
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
