import test from 'node:test';
import assert from 'node:assert/strict';
import { near } from './helpers.js';
import {
  createSession,
  startRace,
  onFrame,
  carStats,
  standings,
  isRaceOver,
  gaps,
  fastestLap,
} from '../src/race.js';

// One car crosses the line at `time`: one present frame, then three absent
// frames. Returns the events of the present frame.
function cross(session, car, time) {
  const count = session.cars.length;
  const present = new Array(count).fill(false);
  present[car] = true;
  const events = onFrame(session, present, time);
  for (let k = 1; k <= 3; k++) {
    onFrame(session, new Array(count).fill(false), time + k * 0.03);
  }
  return events;
}

function race(carCount, lapTarget) {
  const session = createSession({ mode: 'race', carCount, lapTarget });
  startRace(session, 10);
  return session;
}

test('practice: the first crossing starts the clock without a lap', () => {
  const session = createSession({ mode: 'practice', carCount: 1 });
  assert.equal(carStats(session, 0, 3).total, null);
  assert.deepEqual(cross(session, 0, 5), [{ car: 0, type: 'start' }]);
  assert.deepEqual(carStats(session, 0, 7), {
    laps: 0,
    lastLap: null,
    bestLap: null,
    total: 2,
    finished: false,
  });
});

test('practice: later crossings add laps', () => {
  const session = createSession({ mode: 'practice', carCount: 1 });
  cross(session, 0, 5);
  assert.deepEqual(cross(session, 0, 10), [{ car: 0, type: 'lap' }]);
  cross(session, 0, 13);
  assert.deepEqual(carStats(session, 0, 14), {
    laps: 2,
    lastLap: 3,
    bestLap: 3,
    total: 9,
    finished: false,
  });
});

test('practice: two cars in the zone in the same frame both start', () => {
  const session = createSession({ mode: 'practice', carCount: 2 });
  assert.deepEqual(onFrame(session, [true, true], 5), [
    { car: 0, type: 'start' },
    { car: 1, type: 'start' },
  ]);
});

test('practice: standings keep the car order and the race is never over', () => {
  const session = createSession({ mode: 'practice', carCount: 3 });
  cross(session, 2, 5);
  assert.deepEqual(standings(session), [0, 1, 2]);
  assert.equal(isRaceOver(session), false);
});

test('race: crossings are ignored until startRace and until Go', () => {
  const session = createSession({ mode: 'race', carCount: 1, lapTarget: 3 });
  assert.deepEqual(cross(session, 0, 5), []);
  startRace(session, 10);
  assert.deepEqual(cross(session, 0, 9), []);
  assert.equal(carStats(session, 0, 9.5).total, null);
  assert.deepEqual(cross(session, 0, 10.5), [{ car: 0, type: 'lap' }]);
  assert.deepEqual(carStats(session, 0, 11), {
    laps: 1,
    lastLap: 0.5,
    bestLap: 0.5,
    total: 1,
    finished: false,
  });
});

test('race: a car finishes at the lap target and then stops counting', () => {
  const session = race(1, 2);
  assert.deepEqual(cross(session, 0, 13), [{ car: 0, type: 'lap' }]);
  assert.deepEqual(cross(session, 0, 17), [{ car: 0, type: 'finish' }]);
  assert.deepEqual(cross(session, 0, 20), []);
  assert.deepEqual(carStats(session, 0, 30), {
    laps: 2,
    lastLap: 4,
    bestLap: 3,
    total: 7,
    finished: true,
  });
});

test('race: standings sort by finish, then laps, then last crossing', () => {
  const session = race(4, 2);
  cross(session, 1, 13);
  cross(session, 2, 13.5);
  cross(session, 0, 14);
  cross(session, 1, 16);
  // Car 1 finished. Cars 2 and 0 have one lap, car 2 crossed first.
  // Car 3 has no lap.
  assert.deepEqual(standings(session), [1, 2, 0, 3]);
});

test('race: finished cars are sorted by finish time', () => {
  const session = race(2, 1);
  cross(session, 1, 12);
  cross(session, 0, 13);
  assert.deepEqual(standings(session), [1, 0]);
});

test('race: the race is over when all cars have finished', () => {
  const session = race(2, 1);
  cross(session, 0, 12);
  assert.equal(isRaceOver(session), false);
  cross(session, 1, 13);
  assert.equal(isRaceOver(session), true);
});

test('gaps are seconds on the same lap and laps when lapped', () => {
  const session = race(3, 10);
  cross(session, 0, 15);
  cross(session, 1, 16);
  cross(session, 2, 17);
  cross(session, 0, 20);
  cross(session, 1, 21.5);
  const result = gaps(session);
  assert.equal(result[0], null);
  near(result[1].seconds, 1.5);
  assert.deepEqual(result[2], { laps: 1 });
});

test('gaps leave a car without a lap time empty', () => {
  const session = race(2, 10);
  assert.deepEqual(gaps(session), [null, null]);
});

test('fastestLap finds the quickest lap of any car', () => {
  const session = race(2, 10);
  assert.equal(fastestLap(session), null);
  cross(session, 0, 15);
  cross(session, 1, 14);
  cross(session, 0, 19.5);
  const best = fastestLap(session);
  assert.equal(best.car, 1);
  near(best.time, 4);
});
