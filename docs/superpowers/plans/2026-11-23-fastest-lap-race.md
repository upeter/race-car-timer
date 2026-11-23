# Fastest-lap race Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a race setting `winBy` so the car with the shortest single lap can win, instead of the first car to finish.

**Architecture:** The race rules stay in `src/race.js` (pure, no DOM): the session carries `winBy`, each car records when it set its best lap, and `standings` and `gaps` get a fastest-lap branch. `src/storage.js` gets the default. `src/main.js` and `index.html` add the Winner switch in setup and show the new ranking on the live and result screens.

**Tech Stack:** Plain ES modules in the browser, no build step. Tests: `node --test` (Node's built-in runner, `node:assert/strict`).

Spec: `docs/superpowers/specs/2026-11-23-fastest-lap-race-design.md`

## Global Constraints

- Always `source ~/.bash_profile` before running a command (`node`, `git`).
- `src/race.js` and `src/storage.js` must not touch `document`, `window`, `navigator` or `localStorage` at import time; `src/race.js` never.
- Setting values are exactly `'finish'` and `'fastestLap'`. The default is `'finish'`.
- Copy, exactly: "Winner", "First to finish", "Fastest lap", "Fastest lap wins", `Race · 10 laps · Fastest lap`, "Finish · Fastest lap", "Stopped · Fastest lap", "The first car to complete 10 laps wins.", "Every car drives 10 laps. The shortest single lap wins." (10 = the lap target; "1 lap" when it is 1).
- Practice mode does not change. A first-to-finish race does not change.
- Comments only for a non-obvious why.
- Commit messages: a plain sentence subject in the style of `git log` ("Add …"), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/race.js` | Session state and race rules | `winBy`, `bestLapTime`, fastest-lap `standings` and `gaps` |
| `test/race.test.js` | Race rule tests | new fastest-lap tests |
| `src/storage.js` | Saved setup and defaults | `winBy: 'finish'` default |
| `test/storage.test.js` | Storage tests | fixture gains `winBy`, one new test |
| `index.html` | Markup and styles | Winner row, run-bar label, styles |
| `src/main.js` | Wiring and rendering | switch, labels, card stats, finish label |
| `docs/superpowers/specs/2026-11-21-lap-timer-design.md` | Main spec | Race section mentions the setting |

---

### Task 1: Fastest-lap ranking and gaps in the race logic

**Files:**
- Modify: `src/race.js` (`createSession`, `onFrame`, `standings`, `gaps`)
- Test: `test/race.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `createSession({ mode, carCount, lapTarget = 10, minLapTime = 2, winBy = 'finish' })` → session with `session.winBy` and `car.bestLapTime` (race time of the car's best lap, `null` before a lap).
  - `standings(session) → number[]`: for `mode === 'race' && winBy === 'fastestLap'`, by best lap.
  - `gaps(session) → Array<null | { seconds } | { laps }>`: for fastest-lap, `{ seconds }` = best lap minus the leader's best lap; `null` for the leader and cars with no lap.

- [ ] **Step 1: Let the test helper pass `winBy`**

In `test/race.test.js`, replace the `race` helper:

```js
function race(carCount, lapTarget, winBy) {
  const session = createSession({ mode: 'race', carCount, lapTarget, winBy });
  startRace(session, 10);
  return session;
}
```

`winBy` undefined falls back to the default in `createSession`, so existing tests keep their meaning.

- [ ] **Step 2: Write the failing tests**

Append to `test/race.test.js`. "Go" is at 10 in every test. Calls to `cross` must be in time order.

```js
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
  cross(session, 1, 13); // lap 3 at 13
  cross(session, 0, 14); // lap 4
  cross(session, 0, 17); // lap 3 at 17
  assert.deepEqual(standings(session), [1, 0]);
});

test('fastest lap: cars without a lap come last, in car order', () => {
  const session = race(3, 10, 'fastestLap');
  cross(session, 2, 14);
  assert.deepEqual(standings(session), [2, 0, 1]);
});

test('fastest lap: an equal later lap keeps the earlier best lap time', () => {
  const session = race(1, 10, 'fastestLap');
  cross(session, 0, 13);
  cross(session, 0, 16);
  assert.equal(session.cars[0].bestLapTime, 13);
});

test('fastest lap: gaps are best-lap differences', () => {
  const session = race(3, 10, 'fastestLap');
  cross(session, 0, 13); // car 0 best 3
  cross(session, 1, 14.5); // lap 4.5
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `source ~/.bash_profile && node --test test/race.test.js`
Expected: the first, second, fourth and fifth new tests FAIL (finish order is used, `bestLapTime` is `undefined`, gaps compare crossings). The third and the practice test may already pass. All old tests PASS.

- [ ] **Step 4: Store `winBy` and `bestLapTime`**

In `src/race.js`, change `createSession`:

```js
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
```

In `onFrame`, replace the race branch's first two lines:

```js
    if (racing) {
      car.laps.push(time - (car.lastCrossing ?? session.goTime));
      car.lastCrossing = time;
```

with:

```js
    if (racing) {
      const lap = time - (car.lastCrossing ?? session.goTime);
      // Strictly shorter, so an equal later lap keeps the earlier time.
      if (car.laps.length === 0 || lap < Math.min(...car.laps)) {
        car.bestLapTime = time;
      }
      car.laps.push(lap);
      car.lastCrossing = time;
```

- [ ] **Step 5: Add the fastest-lap branch to `standings` and `gaps`**

In `src/race.js`, add above `standings`:

```js
function bestLap(car) {
  return car.laps.length > 0 ? Math.min(...car.laps) : null;
}

function byFastestLap(session) {
  return session.mode === 'race' && session.winBy === 'fastestLap';
}

function compareBestLaps(session, a, b) {
  const carA = session.cars[a];
  const carB = session.cars[b];
  const bestA = bestLap(carA);
  const bestB = bestLap(carB);
  if (bestA === null && bestB === null) return a - b;
  if (bestA === null) return 1;
  if (bestB === null) return -1;
  if (bestA !== bestB) return bestA - bestB;
  return carA.bestLapTime - carB.bestLapTime || a - b;
}
```

In `standings`, after `if (session.mode !== 'race') return order;` add:

```js
  if (byFastestLap(session)) {
    return order.sort((a, b) => compareBestLaps(session, a, b));
  }
```

Update the comment above `standings` to:

```js
// Car indices, best position first. Practice keeps the car order. A
// fastest-lap race ranks by best lap.
```

In `gaps`, after `const leader = session.cars[order[0]];` add:

```js
  if (byFastestLap(session)) {
    const leaderBest = bestLap(leader);
    return order.map((index, position) => {
      const best = bestLap(session.cars[index]);
      if (position === 0 || best === null || leaderBest === null) return null;
      return { seconds: best - leaderBest };
    });
  }
```

Extend the comment above `gaps` with one line: `// In a fastest-lap race: { seconds } between best laps.`

Use `bestLap` in `carStats` too: `bestLap: bestLap(car),` instead of the inline `Math.min` expression.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `source ~/.bash_profile && node --test`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
source ~/.bash_profile && git add src/race.js test/race.test.js && git commit -m "Rank a fastest-lap race by best lap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Default for the saved setting

**Files:**
- Modify: `src/storage.js` (`DEFAULT_SETTINGS`)
- Test: `test/storage.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `setup.settings.winBy` is always `'finish'` or a saved value after `deserializeSetup` / `loadSetup`.

- [ ] **Step 1: Write the failing test**

In `test/storage.test.js`, add `winBy: 'finish'` to the fixture's settings (the round-trip test compares the whole setup, and the loaded setup will carry the default):

```js
  settings: { tolerance: 15, minLapTime: 2, mode: 'race', lapTarget: 10, zoom: 2, winBy: 'finish' },
```

Append:

```js
test('a setup saved before the winner setting races to the finish', () => {
  const text = JSON.stringify({
    zone: null,
    cars: [],
    settings: { tolerance: 15, minLapTime: 2, mode: 'race', lapTarget: 10, zoom: null },
  });
  assert.equal(deserializeSetup(text).settings.winBy, 'finish');
});

test('a saved fastest-lap setting is kept', () => {
  const saved = { ...setup, settings: { ...setup.settings, winBy: 'fastestLap' } };
  assert.equal(deserializeSetup(serializeSetup(saved)).settings.winBy, 'fastestLap');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source ~/.bash_profile && node --test test/storage.test.js`
Expected: "a setup saved before the winner setting races to the finish" FAILS (`undefined !== 'finish'`). The others PASS.

- [ ] **Step 3: Add the default**

In `src/storage.js`:

```js
export const DEFAULT_SETTINGS = {
  tolerance: 15,
  minLapTime: 2,
  mode: 'practice',
  lapTarget: 10,
  winBy: 'finish',
  zoom: null, // null: the camera's widest view
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source ~/.bash_profile && node --test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
source ~/.bash_profile && git add src/storage.js test/storage.test.js && git commit -m "Save the race winner setting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Winner switch and fastest-lap screens

**Files:**
- Modify: `index.html` (styles; Race card in `data-step="mode"`; `.run-bar` in `#live-view`)
- Modify: `src/main.js` (`updateButtons`, `renderSetup`, `sessionLabel`, mode handlers, `newSession`, `carCard`, `renderLive`, `renderResult`)
- Modify: `docs/superpowers/specs/2026-11-21-lap-timer-design.md` (Race section)

**Interfaces:**
- Consumes: `createSession({ …, winBy })`, `standings`, `gaps` from Task 1; `setup.settings.winBy` from Task 2. `gaps`, `formatGap`, `formatTime` are already imported in `src/main.js`.
- Produces: no new exports.

`src/main.js` touches the DOM at import time, so it has no unit tests; this task is checked by the full test run and by hand.

- [ ] **Step 1: Add the Winner row to the Race card**

In `index.html`, inside `<div id="mode-race" class="mode">`, right after the closing `</div>` of `<div class="laps">`, add:

```html
        <div class="winner">
          <span class="winner-label">Winner</span>
          <div class="seg" role="group" aria-label="Winner">
            <button id="win-finish" data-win-by="finish" aria-pressed="false">First to finish</button>
            <button id="win-fastest" data-win-by="fastestLap" aria-pressed="false">Fastest lap</button>
          </div>
          <p id="win-text" class="win-text"></p>
        </div>
```

- [ ] **Step 2: Add the run-bar label**

In `index.html`, replace:

```html
      <div class="run-bar"><span id="run-tag" class="tag"></span><span id="run-clock" class="clock"></span></div>
```

with:

```html
      <div class="run-bar">
        <span class="run-left"><span id="run-tag" class="tag"></span><span id="run-rule" class="label" hidden>Fastest lap wins</span></span>
        <span id="run-clock" class="clock"></span>
      </div>
```

- [ ] **Step 3: Add the styles**

In `index.html`, after the `.stepper input::-webkit-inner-spin-button` rule, add:

```css
    .winner { display: flex; flex-direction: column; gap: 8px; padding: 0 14px 14px; }
    .winner-label { font: 600 14px/1 var(--cond); letter-spacing: 0.14em; text-transform: uppercase; }
    .seg { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border: 1px solid var(--line); }
    .seg button { clip-path: none; min-height: 44px; padding: 0 8px; background: #1e1e22;
      color: var(--muted); font: 800 15px/1 var(--cond); letter-spacing: 0.08em; }
    .seg button[aria-pressed="true"] { background: var(--white); color: var(--bg); }
    .seg button:disabled { background: #1a1a1d; color: #44444a; }
    .win-text { margin: 0; font: 400 13px/1.4 var(--body); color: var(--text); }
```

After the `.run-bar` rule, add:

```css
    .run-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
```

After the `.stat b` rule, add:

```css
    .stat.key b { font-size: 20px; }
```

- [ ] **Step 4: Wire the switch in setup**

In `src/main.js`, in `updateButtons`, change:

```js
  for (const id of ['lap-target', 'laps-down', 'laps-up']) $(id).disabled = !race;
```

to:

```js
  for (const id of ['lap-target', 'laps-down', 'laps-up', 'win-finish', 'win-fastest']) {
    $(id).disabled = !race;
  }
```

In `renderSetup`, after `$('lap-target').value = settings.lapTarget;`, add:

```js
  for (const button of document.querySelectorAll('[data-win-by]')) {
    button.setAttribute('aria-pressed', String(settings.winBy === button.dataset.winBy));
  }
  $('win-text').textContent = winText(settings);
```

Replace `sessionLabel` and add `winText` next to it:

```js
function lapCount(lapTarget) {
  return lapTarget === 1 ? '1 lap' : `${lapTarget} laps`;
}

function sessionLabel({ mode, lapTarget, winBy }) {
  if (mode !== 'race') return 'Practice';
  const rule = winBy === 'fastestLap' ? ' · Fastest lap' : '';
  return `Race · ${lapCount(lapTarget)}${rule}`;
}

function winText({ winBy, lapTarget }) {
  return winBy === 'fastestLap'
    ? `Every car drives ${lapCount(lapTarget)}. The shortest single lap wins.`
    : `The first car to complete ${lapCount(lapTarget)} wins.`;
}
```

After the `[data-mode]` click handler loop, add:

```js
for (const button of document.querySelectorAll('[data-win-by]')) {
  button.addEventListener('click', () => {
    setup.settings.winBy = button.dataset.winBy;
    save();
    renderSetup();
  });
}
```

- [ ] **Step 5: Pass `winBy` into the session**

In `newSession`, change:

```js
  const { mode, lapTarget, minLapTime } = setup.settings;
  session = createSession({
    mode,
    carCount: setup.cars.length,
    lapTarget,
    minLapTime,
  });
```

to:

```js
  const { mode, lapTarget, minLapTime, winBy } = setup.settings;
  session = createSession({
    mode,
    carCount: setup.cars.length,
    lapTarget,
    minLapTime,
    winBy,
  });
```

- [ ] **Step 6: Show the fastest-lap live screen**

In `src/main.js`, near `leaderLaps`, add:

```js
function byFastestLap() {
  return session.mode === 'race' && session.winBy === 'fastestLap';
}
```

Change `carCard` to take the car's gap and pick the third stat:

```js
function carCard(carIndex, position, now, fastest, gap) {
```

and replace its `statRow.append(...)` call with:

```js
  const bestStat = stat('Best', formatTime(stats.bestLap), isFastest ? 'fastest' : '');
  const lapsStat = stat('Laps', race ? `${stats.laps}/${session.lapTarget}` : String(stats.laps));
  if (byFastestLap()) {
    bestStat.classList.add('key');
    statRow.append(bestStat, lapsStat, stat('Gap', formatGap(gap) || '–'));
  } else {
    statRow.append(bestStat, lapsStat, stat('Total', formatTime(stats.total)));
  }
```

In `renderLive`, replace the cards mapping and show the label:

```js
function renderLive(now) {
  const fastest = fastestLap(session);
  const carGaps = gaps(session);
  $('run-tag').textContent = runTag(now);
  $('run-rule').hidden = !byFastestLap();
  $('run-clock').textContent = formatTime(sessionClock(now));
  const cards = standings(session).map((carIndex, position) =>
    carCard(carIndex, position, now, fastest, carGaps[position]),
  );
  $('cards').classList.toggle('single', cards.length === 1);
  $('cards').replaceChildren(...cards);
}
```

- [ ] **Step 7: Label the result**

In `renderResult`, replace:

```js
  $('finish-label').textContent = finished ? 'Finish' : 'Stopped';
```

with:

```js
  const label = finished ? 'Finish' : 'Stopped';
  $('finish-label').textContent = byFastestLap() ? `${label} · Fastest lap` : label;
```

The podium and the list of other cars already use `standings` and `gaps`, so they follow the new ranking without further change.

- [ ] **Step 8: Update the main spec**

In `docs/superpowers/specs/2026-11-21-lap-timer-design.md`, in the `### Race` section, after the bullet that starts "- The cards are sorted by position:", add:

```markdown
- A "Winner" switch in the Race card picks "First to finish" (the rules
  above) or "Fastest lap": the shortest single lap wins, and cards, gaps and
  podium follow best laps. See `2026-11-23-fastest-lap-race-design.md`.
```

- [ ] **Step 9: Run all tests**

Run: `source ~/.bash_profile && node --test`
Expected: all tests PASS (no test imports `src/main.js`).

- [ ] **Step 10: Check by hand**

Run: `python3 -m http.server 8000` in the repo, open `http://localhost:8000/`. Check:
- Step 4 "Session": with Practice selected, the Winner buttons are disabled. With Race selected, clicking "Fastest lap" marks it white and the help text reads "Every car drives 10 laps. The shortest single lap wins."; the lap stepper updates the number.
- Reload: the choice is kept. The Ready screen reads `Race · 10 laps · Fastest lap`.
- With a camera and two cars (or on the phone through the HTTPS address after deploy): in a race, the bar shows "Fastest lap wins", cards show Best (larger), Laps, Gap, and sort by best lap; Stop shows "Stopped · Fastest lap", the winner with "Best …" and the others with "+…".
- Switch back to "First to finish": cards show Total again and the result label is "Finish" / "Stopped".

Stop the server with Ctrl+C.

- [ ] **Step 11: Commit**

```bash
source ~/.bash_profile && git add index.html src/main.js docs/superpowers/specs/2026-11-21-lap-timer-design.md && git commit -m "Let a race be won by the fastest lap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
