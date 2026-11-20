export const ABSENT_FRAMES = 3;

export function createTracker() {
  return { present: false, misses: 0, lastCrossing: null };
}

// Feeds one frame into the tracker. Returns true when this frame is a
// counted crossing: the car entered the zone, and the minimum lap time has
// passed since the last counted crossing.
export function updateTracker(tracker, isPresent, time, minLapTime) {
  if (!isPresent) {
    if (tracker.present) {
      tracker.misses++;
      if (tracker.misses >= ABSENT_FRAMES) {
        tracker.present = false;
        tracker.misses = 0;
      }
    }
    return false;
  }
  tracker.misses = 0;
  if (tracker.present) return false;
  tracker.present = true;
  if (
    tracker.lastCrossing !== null &&
    time - tracker.lastCrossing < minLapTime
  ) {
    return false;
  }
  tracker.lastCrossing = time;
  return true;
}
