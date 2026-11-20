# race-car-timer

A lap timer for small remote-controlled cars. A phone above the track watches
the finish line through its camera and counts the laps of each car.

Open on the phone (Chrome, Android): https://upeter.github.io/race-car-timer/

## What you need

- A phone fixed above the track, camera pointing straight down at the finish
  line.
- A coloured sticky note on the roof of each car (maximum 4 cars). Use colours
  that differ clearly from each other and from the floor. On a wood floor use
  pink, green and blue, not orange or yellow.
- Good, even light.

## Setup

1. **Set zone**: drag a box over the finish line, about one car length wide.
2. **Capture empty track**: with no car in the box.
3. **Add car**: put one car on the finish line and press the button. Repeat
   for each car. The bar next to a car shows how well the camera sees its
   note; the white mark is the level at which a crossing counts.
4. Select **Practice** or **Race** (with a number of laps) and press **Start**.

If a pass is not counted, add light, use a larger note, or increase the colour
tolerance in Settings.

## Modes

- **Practice**: a car's clock starts on its first crossing. Each later
  crossing is a lap.
- **Race**: cars start behind the line. After the countdown, each crossing is
  a lap. A car finishes at the lap target.

## Development

No build step and no dependencies.

```bash
npm test                    # unit tests (Node 20 or later)
python3 -m http.server 8000 # then open http://localhost:8000/
```

The design is in `docs/superpowers/specs/2026-11-21-lap-timer-design.md`.
