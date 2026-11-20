# Lap timer for small RC cars — design

Date: 2026-11-21

## Goal

A web page that runs in Chrome on an Android phone mounted above a track. It
watches the finish line through the rear camera, counts laps for each car
automatically, and shows lap counts and times as an overlay on the live video.

## Scope (first version)

In scope:

- Up to 4 cars.
- Each car carries a coloured sticky note on its roof. The page learns that
  colour in a calibration step and identifies the car by it.
- Two modes: Practice and Race.

Out of scope:

- Saved history or results between sessions.
- Direction detection (a car that reverses over the line counts a lap).
- Jump-start detection.
- Native Android app.

## Physical setup

- The phone is fixed above the track, camera pointing straight down, with the
  finish strip in view.
- Each car has a sticky note on its roof. The note colours must differ clearly
  from each other, from the floor, and from the finish strip. On an oak floor
  with an orange strip, use pink, green and blue. Do not use orange or yellow.
- Lighting is even and bright enough to keep motion blur low.

## Screens

The page has three screens: Setup, Practice and Race. Setup comes first.

### Setup

Live rear-camera video, full screen, with a panel of controls. The steps are
done in this order. Each step is enabled only when the step before it is done.

1. **Zone.** The user drags a rectangle over the finish strip. It must be
   roughly one car length wide in the direction of travel, because a fast car
   moves several centimetres between frames.
2. **Empty track.** With no car in the zone, the user presses "Capture empty
   track". The page stores the baseline (see Calibration).
3. **Cars.** The user puts one car on the finish line and presses "Add car".
   The page learns the note colour and shows the result: a swatch, the name
   ("Car 1", editable), and a live match meter. The user takes the car away and
   repeats for the next car. Each car has a Remove button.
4. **Mode.** Practice or Race. For Race, the lap target (default 10).
5. **Start.** Goes to the Practice or Race screen.

Settings, collapsed by default: colour tolerance (default ±15° hue), minimum
lap time (default 2 s).

If the zone is changed, the baseline and all cars are cleared, because they
were measured in the old zone.

The zone, baseline, cars and settings are stored in `localStorage`, so a page
reload does not lose the setup. A "Clear setup" button deletes them.

### Practice

- Live video with the zone outlined.
- Overlay table, one row per car: swatch and name, lap count, last lap, best
  lap, total time.
- A car's clock starts on its first crossing. That crossing does not count a
  lap.
- A beep on each counted lap.
- Buttons: Reset (clears laps and times) and Setup.

### Race

Assumption: the rules below are a proposal. The user has not confirmed them.

- Cars start behind the line, outside the zone.
- The user presses "Start race". The page shows a 3-2-1 countdown with a low
  beep per second and a high beep at "Go".
- The race clock starts at "Go" for all cars. Crossings before "Go" are
  ignored.
- Each crossing after "Go" completes a lap for that car. With a start behind
  the line, the first crossing completes lap 1.
- A car finishes when its lap count reaches the lap target. Its finish time is
  the race time of that crossing. Later crossings of that car are ignored.
- The overlay table is sorted by position: finished cars by finish time, then
  running cars by lap count (more is better), then by time of the last
  crossing (earlier is better). Columns: position, swatch and name, laps as
  "3/10", last lap, best lap, total time.
- The race ends when all cars have finished or the user presses "Stop". The
  final table stays on screen. Buttons: "New race" (same setup) and Setup.

## Calibration

All calibration works on the downscaled zone image (see Detection).

### Baseline (empty track)

- Average the zone pixels over 10 frames. Store the result as the baseline
  image.

### Add car

1. Average the zone pixels over 5 frames.
2. Changed pixels: pixels whose RGB distance from the baseline is more
   than 40 (on a 0–255 scale).
3. Note pixels: changed pixels with saturation ≥ 0.35 and value ≥ 0.30. This
   removes the car body, the tyres and shadows, which are not saturated.
4. Make a hue histogram of the note pixels with 36 bins of 10°. Take the
   highest bin and its two neighbours. The circular mean hue of the pixels in
   these bins is the car's hue.
5. The calibrated area is the fraction of zone pixels that match this hue
   (with the match test from Detection).
6. The noise floor is the fraction of baseline pixels that match this hue.
7. The car's threshold is the larger of: 30 % of the calibrated area, and the
   noise floor plus 1 % of the zone. The 30 % allows for motion blur and for a
   car that crosses near the edge of the zone.

The stored data for a car: name, hue, threshold, noise floor.

### Checks at "Add car"

The car is not added, and the page says why, when:

- Fewer than 2 % of zone pixels are note pixels: "No coloured note found. Put
  the car on the finish line."
- The hue is less than 30° from the hue of a car already added: "Too close to
  Car N. Use a different colour."
- The noise floor is more than half of the calibrated area: "This colour is
  too close to the floor or the strip. Use a different colour."

### Fallback

If the automatic sample finds the wrong colour, the user can tap the note in
the video. The page then uses the average hue in a small square around the tap
in place of steps 2–4. Steps 5–7 and the checks stay the same.

## Detection

For each video frame:

1. Draw the detection zone to a small offscreen canvas (downscaled, about
   80 pixels on the long side) and read its pixels.
2. Convert each pixel to hue, saturation and value.
3. A pixel matches a car when its hue is within the tolerance of the car's
   hue, its saturation is ≥ 0.35 and its value is ≥ 0.30. Hue distance is
   circular.
4. The match level of a car is the fraction of zone pixels that match it.
5. A car is "present" when its match level is above its threshold.

Frames are driven by `requestVideoFrameCallback`, and the timestamp of a
crossing is the frame's media time, not the time the script ran. Accuracy is
about one frame (33 ms at 30 fps). Fallback when the callback is not available:
`requestAnimationFrame` with `performance.now()`.

The camera is requested with `facingMode: environment`, 1280×720, and the
highest frame rate the device offers.

## Lap logic

Per car, a small state machine:

- State: `absent` or `present`, the time of the last counted crossing, and the
  list of lap times.
- A crossing is the change from `absent` to `present`.
- A crossing is ignored if it occurs less than the minimum lap time after the
  last counted crossing.
- To change from `present` back to `absent`, the match level must be below the
  threshold for 3 frames in a row. This prevents double counts from flicker.

What a counted crossing does depends on the mode:

- Practice: the first crossing starts the car's clock. Each later crossing
  adds a lap. Lap time = crossing time − previous crossing time.
- Race: each crossing after "Go" adds a lap. The time of lap 1 = crossing
  time − "Go" time. Crossings after the car has finished are ignored.

Between crossings the overlay shows the running time.

## Code structure

No framework and no build step. ES modules loaded directly by the page.

| File | Purpose | Depends on |
|---|---|---|
| `index.html` | Markup and styles for the three screens | — |
| `src/color.js` | RGB to HSV, circular hue distance and mean, pixel match test | nothing |
| `src/calibrate.js` | Baseline + car frame → car colour, threshold, check result | `color.js` |
| `src/detector.js` | Pixel buffer + cars → match level and presence per car | `color.js` |
| `src/laps.js` | Crossing state machine per car | nothing |
| `src/race.js` | Practice and Race rules, lap lists, standings | `laps.js` |
| `src/camera.js` | Opens the camera, delivers frames with timestamps | browser APIs |
| `src/storage.js` | Saves and loads the setup in `localStorage` | browser APIs |
| `src/ui.js` | Setup steps, overlay drawing, countdown, beeps | DOM |
| `src/main.js` | Connects the modules | all |

`color.js`, `calibrate.js`, `detector.js`, `laps.js` and `race.js` are pure
functions on plain data. They have no DOM or camera dependency.

## Error handling

- Camera permission denied or no camera: a full-screen message with the reason
  and a Retry button.
- Page not served over HTTPS (camera API missing): a message that says so.
- Start is disabled until the zone, the baseline and at least one car exist.
- The screen is kept on with the Wake Lock API when available.

## Testing

- Unit tests for the five pure modules with Node's built-in test runner
  (`node --test`), using synthetic pixel buffers and crossing sequences. Cases
  include: hue wrap-around at red, each calibration check, a note colour on a
  floor of similar hue, flicker during a crossing, a crossing inside the
  minimum lap time, two cars in the zone in the same frame, race standings
  with finished and running cars, crossings before "Go".
- Manual test on the phone above the real track. This is the only test of
  camera behaviour, frame rate and colour matching in real light.

## Hosting

GitHub Pages from the `main` branch of `upeter/race-car-timer`, which gives the
HTTPS origin that camera access requires.

## Known risks

- Motion blur at high speed lowers the match level. Mitigations: more light,
  a larger sticky note, a lower threshold.
- Auto exposure and auto white balance can shift colours during a session.
  Mitigations: the tolerance slider, and capturing the empty track and the
  cars again.
- If 30 fps is too coarse for fast cars, the next step is a native app with
  high-frame-rate capture. That is a separate project.
