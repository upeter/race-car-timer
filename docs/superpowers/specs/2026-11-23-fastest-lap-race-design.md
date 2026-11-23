# Fastest-lap race — design

## Goal

Add a second way to win a race: the car with the shortest single lap wins.
Today the winner is always the first car to complete the lap target.

Mockup: [Fastest-lap race mockup](https://claude.ai/artifact/6Jm6iN8BWein7pM9dMJSVL)
(private Claude Design canvas: setup, live race, result).

## Scope

- One new race setting, `winBy`: `'finish'` (today's behavior) or
  `'fastestLap'`.
- Practice mode does not change.
- No time-limited races. A fastest-lap race ends exactly like a normal race.

## Setting

- `DEFAULT_SETTINGS` in `src/storage.js` gains `winBy: 'finish'`.
  Saved setups without `winBy` load as `'finish'` through the existing
  defaults merge.
- `createSession` takes `winBy` (default `'finish'`) and stores it on the
  session. `newSession()` in `src/main.js` passes it from the settings.

## Setup screen (step 4, "Session")

- The Race card gets a "Winner" row below the lap stepper: a label "Winner"
  and a two-button switch, "First to finish" | "Fastest lap". The selected
  button is white with dark text; both buttons have `aria-pressed`.
- One line of help text under the switch:
  - First to finish: "The first car to complete 10 laps wins."
  - Fastest lap: "Every car drives 10 laps. The shortest single lap wins."
  The number is the current lap target.
- The switch is disabled when Practice is selected, like the lap stepper.
- Choosing a button saves the setting, like the other settings.
- The Ready screen label (`sessionLabel`) becomes
  `Race · 10 laps · Fastest lap` for a fastest-lap race. A first-to-finish
  race keeps `Race · 10 laps`.

## Race rules that do not change

Grid start, countdown, "Go", ignored crossings before "Go", lap counting,
`minLapTime`, a car's finish at the lap target, and the end of the race (all
cars finished, or Stop) are the same for both settings.

## Ranking (`standings` in `src/race.js`)

For `winBy: 'fastestLap'`:

1. Cars with at least one lap rank by best lap, shortest first.
2. Equal best laps: the car that completed that lap earlier in race time
   ranks higher.
3. Cars with no lap rank last, in car order.

Finish order and lap count do not matter. `winBy: 'finish'` keeps today's
ranking unchanged.

To support rule 2, each car records the race time at which its best lap was
completed (`bestLapTime`), updated in `onFrame` when a new lap is strictly
shorter than the current best.

## Gaps (`gaps` in `src/race.js`)

For `winBy: 'fastestLap'`, the gap of each car is its best lap minus the
leader's best lap: `{ seconds }`. The leader gets `null`. A car with no lap
gets `null` (shown as "–"). `formatGap` needs no change. The
`'finish'` gaps do not change.

## Live screen

- The run tag stays `Lap 7/10` (the leader by laps). Next to it, a muted
  label "Fastest lap wins".
- Cards are in the new ranking order, with the position number.
- Card stats for a fastest-lap race: **Best** (first, at 20 px, the deciding
  number), **Laps** (`6/10`), **Gap** (the best-lap gap, "–" for the
  leader). This replaces Total, which decides nothing in this mode.
  A first-to-finish race keeps Best, Laps, Total.
- The purple "fastest" color stays on the session's fastest lap, which in
  this mode is always the leader's Best.

## Result screen

- The finish label is "Finish · Fastest lap" or "Stopped · Fastest lap".
  The laps box shows `leaderLaps()/lapTarget` as today.
- The podium and the list of other cars use the new ranking. The winner
  shows "Best 3.42"; the others show their best-lap gap ("+0.31") or "–".
- Buttons do not change.

## Edge cases

- Stop before any car completes a lap: all cars have no lap, so the order
  is car order and every gap is "–". The podium still shows, as it does
  today for a stopped race.
- A car that stops counting at the lap target keeps its best lap; other cars
  can still beat it until they finish.

## Code changes

| File | Change |
|---|---|
| `src/storage.js` | `winBy: 'finish'` in `DEFAULT_SETTINGS` |
| `src/race.js` | `winBy` on the session, `bestLapTime` per car, fastest-lap branch in `standings` and `gaps` |
| `src/main.js` | pass `winBy`, switch handling and rendering, `sessionLabel`, run tag label, card stats, finish label |
| `index.html` | Winner row in the Race card, styles for the switch |
| `docs/superpowers/specs/2026-11-21-lap-timer-design.md` | Race section: mention the Winner setting and link this spec |

## Testing

- `test/race.test.js`:
  - fastest-lap standings rank by best lap, ignore finish order and lap count
  - equal best laps: the earlier one ranks higher
  - cars with no lap rank last, in car order
  - fastest-lap gaps are best-lap differences; `null` for the leader and for
    cars with no lap
  - `winBy: 'finish'` standings and gaps do not change (existing tests)
- `test/storage.test.js`: a saved setup without `winBy` loads as `'finish'`.
- Manual check on a phone: the switch, the label on the Ready screen, the
  live cards and the result with two cars.
