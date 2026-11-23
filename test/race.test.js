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

function race(carCount, lapTarget, winBy) {
  const session = createSession({ mode: 'race', carCount, lapTarget, winBy });
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

test('fastest lap: standings rank by best lap, not finish or laps', () => {
  const session = race(3, 2, 'fastestLap');
  cross(session, 0, 13); // lap 3
  cross(session, 2, 14); // lap 4
  cross(session, 1, 15); // lap 5
  cross(session, 0, 16); // lap 3, car 0 finishes first
  cross(session, 1, 17.5); // lap 2.5, car 1 finishes second
  assert.deepEqual(standings(session), [1, 0, 2]);
});

test('fastest lap: an equal best lap set earlier ranks higher', () => {
  const session = race(2, 10, 'fastestLap');
  cross(session, 1, 13); // lap 1
  cross(session, 0, 14); // lap 1
  cross(session, 1, 16); // lap 3 at 16
  cross(session, 0, 17); // lap 3 at 17
  assert.deepEqual(standings(session), [1, 0]);
});

test('fastest lap: cars without a lap come last, in car order', () => {
  const session = race(3, 10, 'fastestLap');
  cross(session, 2, 14);
  cross(session, 2, 17);
  assert.deepEqual(standings(session), [2, 0, 1]);
});

test('fastest lap: an equal later lap keeps the earlier best lap time', () => {
  const session = race(1, 10, 'fastestLap');
  cross(session, 0, 13);
  cross(session, 0, 16);
  cross(session, 0, 19);
  assert.equal(session.cars[0].bestLapTime, 16);
});

test('fastest lap: gaps are best-lap differences', () => {
  const session = race(3, 10, 'fastestLap');
  cross(session, 0, 13); // lap 1
  cross(session, 0, 16); // car 0 best 3
  cross(session, 1, 14.5); // lap 1
  cross(session, 1, 18); // car 1 best 3.5
  const result = gaps(session);
  assert.equal(result[0], null);
  near(result[1].seconds, 0.5);
  assert.equal(result[2], null);
});

test('fastest lap: practice keeps the car order', () => {
  const session = createSession({ mode: 'practice', carCount: 2, winBy: 'fastestLap' });
  cross(session, 1, 5);
  cross(session, 1, 8);
  assert.deepEqual(standings(session), [0, 1]);
});

test('fastest lap: a short lap 1 does not count for the ranking', () => {
  const session = race(2, 10, 'fastestLap');
  cross(session, 0, 10.5); // lap 1 of 0.5
  cross(session, 0, 20.5); // lap 2 of 10
  cross(session, 1, 13); // lap 1 of 3
  cross(session, 1, 17); // lap 2 of 4
  assert.deepEqual(standings(session), [1, 0]);
  near(gaps(session)[1].seconds, 6);
});

test('fastest lap: a car with only lap 1 has no best lap and no gap', () => {
  const session = race(3, 10, 'fastestLap');
  cross(session, 0, 11); // lap 1 only
  cross(session, 2, 13);
  cross(session, 2, 17);
  assert.deepEqual(standings(session), [2, 0, 1]);
  assert.deepEqual(gaps(session), [null, null, null]);
  assert.equal(session.cars[0].bestLapTime, null);
});

test('carStats bestLap ignores lap 1 only in a fastest-lap race', () => {
  const byLap = race(1, 10, 'fastestLap');
  cross(byLap, 0, 10.5);
  assert.equal(carStats(byLap, 0, 12).bestLap, null);
  cross(byLap, 0, 15.5);
  near(carStats(byLap, 0, 16).bestLap, 5);
  const byFinish = race(1, 10, 'finish');
  cross(byFinish, 0, 10.5);
  cross(byFinish, 0, 15.5);
  near(carStats(byFinish, 0, 16).bestLap, 0.5);
});

test('fastestLap ignores lap 1 in a fastest-lap race', () => {
  const session = race(2, 10, 'fastestLap');
  cross(session, 0, 10.5); // lap 1 of 0.5
  cross(session, 0, 15.5); // lap 2 of 5
  cross(session, 1, 13);
  cross(session, 1, 17); // lap 2 of 4
  const best = fastestLap(session);
  assert.equal(best.car, 1);
  near(best.time, 4);
});

test('fastestLap picks the car that set an equal counted lap earlier', () => {
  const session = race(2, 10, 'fastestLap');
  cross(session, 0, 11);
  cross(session, 1, 12);
  cross(session, 1, 16); // lap 2 of 4 at 16 (set earlier)
  cross(session, 0, 17); // lap 2 of 6 at 17
  cross(session, 0, 21); // lap 3 of 4 at 21
  assert.equal(fastestLap(session).car, 1);
  assert.equal(standings(session)[0], 1);
});

test('gaps of a race without cars is empty', () => {
  assert.deepEqual(gaps(race(0, 10, 'finish')), []);
  assert.deepEqual(gaps(race(0, 10, 'fastestLap')), []);
});
