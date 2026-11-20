import { createTracker, updateTracker } from './laps.js';

export function createSession({
  mode,
  carCount,
  lapTarget = 10,
  minLapTime = 2,
}) {
  return {
    mode,
    lapTarget,
    minLapTime,
    goTime: null,
    cars: Array.from({ length: carCount }, () => ({
      tracker: createTracker(),
      startTime: null,
      lastCrossing: null,
      laps: [],
      finishTime: null,
    })),
  };
}

// Race mode: sets the time of "Go". Crossings before it are ignored.
export function startRace(session, goTime) {
  session.goTime = goTime;
}

// Feeds one frame into the session. `presence[i]` says if car i is in the
// zone. Returns the events of this frame.
export function onFrame(session, presence, time) {
  const events = [];
  const racing = session.mode === 'race';
  const beforeGo =
    racing && (session.goTime === null || time < session.goTime);

  session.cars.forEach((car, index) => {
    const crossed = updateTracker(
      car.tracker,
      presence[index],
      time,
      session.minLapTime,
    );
    if (beforeGo) {
      // A crossing before "Go" must not block the first lap.
      car.tracker.lastCrossing = null;
      return;
    }
    if (!crossed || car.finishTime !== null) return;

    if (racing) {
      car.laps.push(time - (car.lastCrossing ?? session.goTime));
      car.lastCrossing = time;
      if (car.laps.length >= session.lapTarget) {
        car.finishTime = time;
        events.push({ car: index, type: 'finish' });
      } else {
        events.push({ car: index, type: 'lap' });
      }
    } else if (car.startTime === null) {
      car.startTime = time;
      car.lastCrossing = time;
      events.push({ car: index, type: 'start' });
    } else {
      car.laps.push(time - car.lastCrossing);
      car.lastCrossing = time;
      events.push({ car: index, type: 'lap' });
    }
  });
  return events;
}

export function carStats(session, index, now) {
  const car = session.cars[index];
  const start = session.mode === 'race' ? session.goTime : car.startTime;
  let total = null;
  if (start !== null && now >= start) {
    total = (car.finishTime ?? now) - start;
  }
  return {
    laps: car.laps.length,
    lastLap: car.laps.length > 0 ? car.laps[car.laps.length - 1] : null,
    bestLap: car.laps.length > 0 ? Math.min(...car.laps) : null,
    total,
    finished: car.finishTime !== null,
  };
}

// Car indices, best position first. Practice keeps the car order.
export function standings(session) {
  const order = session.cars.map((_, index) => index);
  if (session.mode !== 'race') return order;
  return order.sort((a, b) => {
    const carA = session.cars[a];
    const carB = session.cars[b];
    if (carA.finishTime !== null || carB.finishTime !== null) {
      if (carA.finishTime === null) return 1;
      if (carB.finishTime === null) return -1;
      return carA.finishTime - carB.finishTime;
    }
    if (carA.laps.length !== carB.laps.length) {
      return carB.laps.length - carA.laps.length;
    }
    const lastA = carA.lastCrossing ?? Infinity;
    const lastB = carB.lastCrossing ?? Infinity;
    if (lastA !== lastB) return lastA < lastB ? -1 : 1;
    return a - b;
  });
}

export function isRaceOver(session) {
  return (
    session.mode === 'race' &&
    session.cars.every((car) => car.finishTime !== null)
  );
}
