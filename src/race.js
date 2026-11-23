import { createTracker, updateTracker } from './laps.js';

export function createSession({
  mode,
  carCount,
  lapTarget = 10,
  minLapTime = 2,
  winBy = 'finish',
}) {
  return {
    mode,
    lapTarget,
    minLapTime,
    winBy,
    goTime: null,
    cars: Array.from({ length: carCount }, () => ({
      tracker: createTracker(),
      startTime: null,
      lastCrossing: null,
      laps: [],
      bestLapTime: null,
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
      const lap = time - (car.lastCrossing ?? session.goTime);
      // Strictly shorter, so an equal later lap keeps the earlier time.
      const counted = countedLaps(session, car);
      const lapCounts = !byFastestLap(session) || car.laps.length > 0;
      if (lapCounts && (counted.length === 0 || lap < Math.min(...counted))) {
        car.bestLapTime = time;
      }
      car.laps.push(lap);
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
    bestLap: bestLap(session, car),
    total,
    finished: car.finishTime !== null,
  };
}

function byFastestLap(session) {
  return session.mode === 'race' && session.winBy === 'fastestLap';
}

// Lap 1 starts from the grid just before the line, so a fastest-lap race
// does not count it.
function countedLaps(session, car) {
  return byFastestLap(session) ? car.laps.slice(1) : car.laps;
}

function bestLap(session, car) {
  const laps = countedLaps(session, car);
  return laps.length > 0 ? Math.min(...laps) : null;
}

function compareBestLaps(session, a, b) {
  const carA = session.cars[a];
  const carB = session.cars[b];
  const bestA = bestLap(session, carA);
  const bestB = bestLap(session, carB);
  if (bestA === null && bestB === null) return a - b;
  if (bestA === null) return 1;
  if (bestB === null) return -1;
  if (bestA !== bestB) return bestA - bestB;
  return carA.bestLapTime - carB.bestLapTime || a - b;
}

// Car indices, best position first. Practice keeps the car order. A
// fastest-lap race ranks by best lap.
export function standings(session) {
  const order = session.cars.map((_, index) => index);
  if (session.mode !== 'race') return order;
  if (byFastestLap(session)) {
    return order.sort((a, b) => compareBestLaps(session, a, b));
  }
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

// How far each car is behind the leader, in standings order: the leader
// gets null, a car on fewer laps { laps }, a car on the same lap { seconds }
// between their last crossings. In a fastest-lap race: { seconds } between
// best laps.
export function gaps(session) {
  const order = standings(session);
  if (order.length === 0) return [];
  const leader = session.cars[order[0]];
  if (byFastestLap(session)) {
    const leaderBest = bestLap(session, leader);
    return order.map((index, position) => {
      const best = bestLap(session, session.cars[index]);
      if (position === 0 || best === null || leaderBest === null) return null;
      return { seconds: best - leaderBest };
    });
  }
  return order.map((index, position) => {
    if (position === 0) return null;
    const car = session.cars[index];
    const behind = leader.laps.length - car.laps.length;
    if (behind > 0) return { laps: behind };
    const leaderTime = leader.finishTime ?? leader.lastCrossing;
    const carTime = car.finishTime ?? car.lastCrossing;
    if (leaderTime === null || carTime === null) return null;
    return { seconds: carTime - leaderTime };
  });
}

// The fastest lap of the session: { car, time }, or null before any lap.
// On an equal time a fastest-lap race picks the lap set earlier, matching
// the standings.
export function fastestLap(session) {
  let best = null;
  session.cars.forEach((car, index) => {
    const time = bestLap(session, car);
    if (time === null) return;
    const earlier =
      best !== null &&
      time === best.time &&
      byFastestLap(session) &&
      car.bestLapTime < session.cars[best.car].bestLapTime;
    if (best === null || time < best.time || earlier) best = { car: index, time };
  });
  return best;
}

export function isRaceOver(session) {
  return (
    session.mode === 'race' &&
    session.cars.every((car) => car.finishTime !== null)
  );
}
