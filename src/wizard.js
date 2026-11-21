// The setup steps, in order. Each step needs the ones before it to be done.
export const STEPS = ['zone', 'baseline', 'cars', 'mode', 'ready'];

// The last step the setup allows: the first step that is not done yet, or
// 'ready' when zone, empty track and at least one car are there.
export function furthestStep(setup) {
  if (!setup.zone) return 'zone';
  if (!setup.baseline) return 'baseline';
  if (setup.cars.length === 0) return 'cars';
  return 'ready';
}

// `step`, or the furthest allowed step when `step` is beyond it.
export function clampStep(step, setup) {
  const limit = furthestStep(setup);
  return STEPS.indexOf(step) > STEPS.indexOf(limit) ? limit : step;
}
