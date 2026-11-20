import {
  cameraSupported,
  openCamera,
  onFrames,
  createZoneReader,
} from './camera.js';
import { averageFrames, calibrateCar, hueAround } from './calibrate.js';
import { matchLevels, presence } from './detector.js';
import {
  createSession,
  startRace,
  onFrame,
  carStats,
  standings,
  isRaceOver,
} from './race.js';
import {
  DEFAULT_SETTINGS,
  loadSetup,
  saveSetup,
  clearSetup,
} from './storage.js';
import {
  createBeeper,
  formatTime,
  hueToCss,
  normalizedPoint,
} from './ui.js';

const MAX_CARS = 4;
const BASELINE_FRAMES = 10;
const CAR_FRAMES = 5;
const COUNTDOWN_SECONDS = 3;
const TAP_RADIUS = 2;
const MIN_ZONE_SIZE = 0.03;
const SETUP_STAGE_HEIGHT = '50dvh'; // the Setup panel covers the rest
const RUN_STAGE_HEIGHT = '100dvh';
const FPS_WINDOW_SECONDS = 1;
const PICTURE_CHANGED =
  'The camera picture changed. Capture the empty track and add the cars again.';
const TOLERANCE_CHANGED = 'Colour tolerance changed. Add the cars again.';

const $ = (id) => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const stage = $('stage');
const beeper = createBeeper();

function defaultSetup() {
  return {
    zone: null,
    baseline: null,
    cars: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

// ---- State ----------------------------------------------------------------

let setup = loadSetup() ?? defaultSetup();
let readZone = null;
let stopFrames = null;
let lastTime = 0;
let levels = [];
let collector = null; // { frames, count, resolve }: frames wanted by a capture
let capturing = false; // a capture is pending: the setup buttons are off
let pointerMode = 'none'; // 'none' | 'zone' | 'tap'
let dragStart = null;
let draftZone = null;
let session = null; // null on the Setup screen
let frozenTime = null; // time at which a race ended or was stopped
let countdownShown = null;
let wakeLock = null;
let fpsStart = null; // { time, frames }: window for the frame rate

function save() {
  saveSetup(setup);
}

// ---- Camera ---------------------------------------------------------------

function showMessage(text) {
  $('message-text').textContent = text;
  $('message').hidden = false;
}

async function startCamera() {
  $('message').hidden = true;
  if (!cameraSupported()) {
    showMessage(
      'Camera access is not available. Open this page over HTTPS in Chrome.',
    );
    return;
  }
  try {
    await openCamera(video);
  } catch (error) {
    showMessage(
      `Could not open the camera: ${error.message} ` +
        "Allow the camera for this site in Chrome's site settings, then press Retry.",
    );
    return;
  }
  layout();
  keepAwake();
  readZone = createZoneReader(video);
  if (stopFrames) stopFrames();
  stopFrames = onFrames(video, handleFrame, showFrameError);
}

// Sizes the stage to the video's aspect ratio. On the Setup screen it stays
// above the panel, so the whole picture can be boxed and tapped.
function layout() {
  const { videoWidth, videoHeight } = video;
  if (!videoWidth || !videoHeight) return;
  const height = session === null ? SETUP_STAGE_HEIGHT : RUN_STAGE_HEIGHT;
  stage.style.aspectRatio = `${videoWidth} / ${videoHeight}`;
  stage.style.width = `min(100vw, calc(${height} * ${videoWidth / videoHeight}))`;
  overlay.width = videoWidth;
  overlay.height = videoHeight;
}

function onVideoResize() {
  // Its frames may have different sizes.
  if (cancelCapture()) setHint(nextHint());
  layout();
}

video.addEventListener('resize', onVideoResize);

function showFrameError(error) {
  const text = `Error: ${error.message}`;
  if (session === null) setHint(text);
  else $('run-status').textContent = text;
}

async function keepAwake() {
  if (wakeLock && !wakeLock.released) return;
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    // The screen can go dark. The timer still works while it is on.
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') keepAwake();
});

function updateStatus(time) {
  fpsStart ??= { time, frames: 0 };
  fpsStart.frames++;
  const elapsed = time - fpsStart.time;
  if (elapsed < FPS_WINDOW_SECONDS) return;
  const fps = Math.round(fpsStart.frames / elapsed);
  $('status').textContent = `${fps} fps · ${video.videoWidth}×${video.videoHeight}`;
  fpsStart = { time, frames: 0 };
}

// ---- Frame loop -----------------------------------------------------------

function handleFrame(time) {
  lastTime = time;
  updateStatus(time);
  drawOverlay();
  if (!setup.zone) return;

  const image = readZone(setup.zone);

  // A stored baseline from another camera resolution cannot be used.
  if (
    setup.baseline &&
    (setup.baseline.width !== image.width ||
      setup.baseline.height !== image.height)
  ) {
    handlePictureChange();
  }

  if (collector) {
    collector.frames.push(image);
    if (collector.frames.length >= collector.count) {
      const done = collector;
      collector = null;
      done.resolve({
        data: averageFrames(done.frames.map((frame) => frame.data)),
        width: image.width,
        height: image.height,
      });
    }
  }

  levels = matchLevels(image.data, setup.cars, setup.settings.tolerance);

  if (session === null) {
    updateMeters();
    return;
  }
  updateCountdown(time);
  if (frozenTime === null) {
    const events = onFrame(session, presence(levels, setup.cars), time);
    for (const event of events) {
      if (event.type === 'finish') beeper.beep(1320, 0.5);
      else beeper.beep(880, 0.12);
    }
    if (isRaceOver(session)) endRace(time);
  }
  renderRun(frozenTime ?? time);
}

// The baseline and the cars no longer fit the picture. Leaves the run
// screen first, so nothing renders a car that is gone.
function handlePictureChange() {
  setup.baseline = null;
  setup.cars = [];
  save();
  cancelCapture();
  if (session !== null) showSetupScreen();
  renderSetup(PICTURE_CHANGED);
}

// Resolves with the average of the next `count` zone images, or with null
// when the capture is cancelled. The setup buttons are off meanwhile.
async function collect(count) {
  setCapturing(true);
  try {
    return await new Promise((resolve) => {
      collector = { frames: [], count, resolve };
    });
  } finally {
    setCapturing(false);
  }
}

// Returns true when a capture was pending.
function cancelCapture() {
  if (collector === null) return false;
  const cancelled = collector;
  collector = null;
  cancelled.resolve(null);
  return true;
}

function drawOverlay() {
  const context = overlay.getContext('2d');
  context.clearRect(0, 0, overlay.width, overlay.height);
  const zone = draftZone ?? setup.zone;
  if (!zone) return;
  context.lineWidth = Math.max(3, overlay.width / 200);
  context.strokeStyle = draftZone ? '#ffd60a' : '#35c759';
  context.strokeRect(
    zone.x * overlay.width,
    zone.y * overlay.height,
    zone.w * overlay.width,
    zone.h * overlay.height,
  );
}

// ---- Setup screen ---------------------------------------------------------

function setHint(text) {
  $('hint').textContent = text;
}

function nextHint() {
  if (!setup.zone) {
    return 'Press "Set zone" and drag a box over the finish strip.';
  }
  if (!setup.baseline) {
    return 'Take all cars out of the zone, then press "Capture empty track".';
  }
  if (setup.cars.length === 0) {
    return 'Put one car on the finish line and press "Add car".';
  }
  if (setup.cars.length < MAX_CARS) {
    return 'Add the next car, or press Start.';
  }
  return 'Press Start.';
}

function setCapturing(value) {
  capturing = value;
  updateButtons();
}

function updateButtons() {
  const { zone, baseline, cars } = setup;
  const canAdd = baseline !== null && cars.length < MAX_CARS && !capturing;
  $('set-zone').disabled = capturing;
  $('clear-setup').disabled = capturing;
  $('capture-baseline').disabled = zone === null || capturing;
  $('add-car').disabled = !canAdd;
  $('tap-note').disabled = !canAdd;
  $('start').disabled = zone === null || baseline === null || cars.length === 0;
}

// `hint` replaces the usual next-step hint, for messages that must stay.
function renderSetup(hint = nextHint()) {
  const { cars, settings } = setup;
  updateButtons();

  document.querySelector(
    `input[name="mode"][value="${settings.mode}"]`,
  ).checked = true;
  $('lap-target').value = settings.lapTarget;
  $('lap-target').disabled = settings.mode !== 'race';
  $('tolerance').value = settings.tolerance;
  $('tolerance-value').textContent = `±${settings.tolerance}°`;
  $('min-lap').value = settings.minLapTime;
  $('min-lap-value').textContent = `${settings.minLapTime} s`;

  $('cars').replaceChildren(...cars.map(carItem));
  setHint(hint);
}

function carItem(car, index) {
  const item = document.createElement('li');

  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.background = hueToCss(car.hue);

  const name = document.createElement('input');
  name.type = 'text';
  name.maxLength = 12;
  name.value = car.name;
  name.addEventListener('change', () => {
    car.name = name.value.trim() || `Car ${index + 1}`;
    name.value = car.name;
    save();
  });

  const bar = document.createElement('div');
  bar.className = 'bar';
  const fill = document.createElement('div');
  fill.className = 'fill';
  bar.append(fill);

  const remove = document.createElement('button');
  remove.className = 'quiet';
  remove.textContent = 'Remove';
  remove.addEventListener('click', () => {
    setup.cars.splice(index, 1);
    save();
    renderSetup();
  });

  item.append(swatch, name, bar, remove);
  return item;
}

// The white mark in the middle of a bar is the car's threshold.
function updateMeters() {
  document.querySelectorAll('#cars .fill').forEach((fill, index) => {
    const car = setup.cars[index];
    if (!car) return;
    const level = levels[index] ?? 0;
    fill.style.width = `${Math.min(100, (level / car.threshold) * 50)}%`;
    fill.classList.toggle('on', level > car.threshold);
  });
}

function calibrationMessage(result) {
  if (result.reason === 'no-note') {
    return 'No coloured note found. Put the car on the finish line.';
  }
  if (result.reason === 'too-close-to-car') {
    const other = setup.cars[result.carIndex].name;
    return `Too close to ${other}. Use a different colour.`;
  }
  return 'This colour is too close to the floor or the strip. Use a different colour.';
}

function applyCalibration(result) {
  if (!result.ok) {
    setHint(calibrationMessage(result));
    return;
  }
  setup.cars.push({ name: `Car ${setup.cars.length + 1}`, ...result.car });
  save();
  renderSetup();
}

$('set-zone').addEventListener('click', () => {
  pointerMode = 'zone';
  setHint('Drag a box over the finish strip, about one car length wide.');
});

$('capture-baseline').addEventListener('click', async () => {
  setHint('Capturing…');
  const image = await collect(BASELINE_FRAMES);
  if (image === null) return;
  setup.baseline = image;
  save();
  renderSetup();
});

$('add-car').addEventListener('click', async () => {
  setHint('Looking for the note…');
  const image = await collect(CAR_FRAMES);
  if (image === null) return; // cancelled: the canceller set the hint
  if (setup.baseline === null) {
    setHint(nextHint());
    return;
  }
  applyCalibration(
    calibrateCar({
      baseline: setup.baseline.data,
      frame: image.data,
      tolerance: setup.settings.tolerance,
      existingCars: setup.cars,
    }),
  );
});

$('tap-note').addEventListener('click', () => {
  pointerMode = 'tap';
  setHint('Put the car on the finish line, then tap its note in the picture.');
});

async function handleTap(point) {
  const { zone } = setup;
  const zx = (point.x - zone.x) / zone.w;
  const zy = (point.y - zone.y) / zone.h;
  if (zx < 0 || zx >= 1 || zy < 0 || zy >= 1) {
    setHint('Tap the note while the car is on the finish line, inside the box.');
    return;
  }
  setHint('Looking for the note…');
  const image = await collect(CAR_FRAMES);
  if (image === null) return; // cancelled: the canceller set the hint
  if (setup.baseline === null) {
    setHint(nextHint());
    return;
  }
  const hue = hueAround(
    image.data,
    image.width,
    image.height,
    Math.floor(zx * image.width),
    Math.floor(zy * image.height),
    TAP_RADIUS,
  );
  if (hue === null) {
    setHint('No colour found at that point. Tap the middle of the note.');
    return;
  }
  applyCalibration(
    calibrateCar({
      baseline: setup.baseline.data,
      frame: image.data,
      tolerance: setup.settings.tolerance,
      existingCars: setup.cars,
      hue,
    }),
  );
}

overlay.addEventListener('pointerdown', (event) => {
  if (session !== null || capturing) return;
  const point = normalizedPoint(event, overlay);
  if (pointerMode === 'tap') {
    pointerMode = 'none';
    handleTap(point);
  } else if (pointerMode === 'zone') {
    overlay.setPointerCapture(event.pointerId);
    dragStart = point;
  }
});

overlay.addEventListener('pointermove', (event) => {
  if (dragStart === null) return;
  const point = normalizedPoint(event, overlay);
  draftZone = {
    x: Math.min(dragStart.x, point.x),
    y: Math.min(dragStart.y, point.y),
    w: Math.abs(point.x - dragStart.x),
    h: Math.abs(point.y - dragStart.y),
  };
});

function finishDrag() {
  if (dragStart === null) return;
  const zone = draftZone;
  dragStart = null;
  draftZone = null;
  pointerMode = 'none';
  if (zone === null || zone.w < MIN_ZONE_SIZE || zone.h < MIN_ZONE_SIZE) {
    setHint('The box is too small. Press "Set zone" and try again.');
    return;
  }
  // The baseline and the cars were measured in the old zone.
  cancelCapture();
  setup.zone = zone;
  setup.baseline = null;
  setup.cars = [];
  save();
  renderSetup();
}

overlay.addEventListener('pointerup', finishDrag);
overlay.addEventListener('pointercancel', finishDrag);

for (const radio of document.querySelectorAll('input[name="mode"]')) {
  radio.addEventListener('change', () => {
    setup.settings.mode = radio.value;
    save();
    renderSetup();
  });
}

$('lap-target').addEventListener('change', () => {
  const value = Math.round(Number($('lap-target').value));
  setup.settings.lapTarget = Math.min(999, Math.max(1, value || 10));
  save();
  renderSetup();
});

// While dragging, only the label changes.
$('tolerance').addEventListener('input', () => {
  $('tolerance-value').textContent = `±${$('tolerance').value}°`;
});

// The cars were calibrated at the old tolerance, so they are removed.
$('tolerance').addEventListener('change', () => {
  const tolerance = Number($('tolerance').value);
  if (tolerance === setup.settings.tolerance) return;
  setup.settings.tolerance = tolerance;
  setup.cars = [];
  save();
  renderSetup(TOLERANCE_CHANGED);
});

$('min-lap').addEventListener('input', () => {
  setup.settings.minLapTime = Number($('min-lap').value);
  $('min-lap-value').textContent = `${setup.settings.minLapTime} s`;
  save();
});

$('clear-setup').addEventListener('click', () => {
  cancelCapture();
  clearSetup();
  setup = defaultSetup();
  pointerMode = 'none';
  draftZone = null;
  dragStart = null;
  renderSetup();
});

// ---- Practice and Race ----------------------------------------------------

function newSession() {
  const { mode, lapTarget, minLapTime } = setup.settings;
  session = createSession({
    mode,
    carCount: setup.cars.length,
    lapTarget,
    minLapTime,
  });
  frozenTime = null;
  countdownShown = null;
  $('countdown').hidden = true;
  $('run-status').textContent = '';
}

$('start').addEventListener('click', () => {
  beeper.unlock();
  newSession();
  const race = setup.settings.mode === 'race';
  $('setup').hidden = true;
  $('run').hidden = false;
  $('start-race').hidden = !race;
  $('start-race').textContent = 'Start race';
  $('stop-race').hidden = true;
  $('reset').hidden = race;
  layout();
});

$('start-race').addEventListener('click', () => {
  beeper.unlock();
  newSession();
  startRace(session, lastTime + COUNTDOWN_SECONDS);
  $('start-race').hidden = true;
  $('stop-race').hidden = false;
});

function endRace(time) {
  frozenTime = time;
  $('stop-race').hidden = true;
  $('start-race').hidden = false;
  $('start-race').textContent = 'New race';
}

$('stop-race').addEventListener('click', () => {
  endRace(lastTime);
  $('countdown').hidden = true;
});

$('reset').addEventListener('click', newSession);

function showSetupScreen() {
  session = null;
  $('countdown').hidden = true;
  $('run').hidden = true;
  $('setup').hidden = false;
  layout();
}

$('back').addEventListener('click', () => {
  showSetupScreen();
  renderSetup();
});

// Shows 3, 2, 1 before "Go" and "Go" for one second after it.
function updateCountdown(time) {
  if (session.mode !== 'race' || session.goTime === null) return;
  if (frozenTime !== null) return;
  const element = $('countdown');
  const remaining = session.goTime - time;
  if (remaining > 0) {
    const number = Math.ceil(remaining);
    if (countdownShown !== number) {
      countdownShown = number;
      element.textContent = String(number);
      element.hidden = false;
      beeper.beep(440, 0.15);
    }
  } else if (remaining > -1) {
    if (countdownShown !== 'go') {
      countdownShown = 'go';
      element.textContent = 'Go';
      element.hidden = false;
      beeper.beep(880, 0.5);
    }
  } else {
    element.hidden = true;
  }
}

function cell(text) {
  const element = document.createElement('td');
  element.textContent = text;
  return element;
}

function renderRun(now) {
  const race = session.mode === 'race';
  const rows = standings(session).map((carIndex, position) => {
    const car = setup.cars[carIndex];
    const stats = carStats(session, carIndex, now);
    const row = document.createElement('tr');

    const name = document.createElement('td');
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = hueToCss(car.hue);
    name.append(swatch, ` ${car.name}`);

    row.append(
      cell(race ? String(position + 1) : ''),
      name,
      cell(race ? `${stats.laps}/${session.lapTarget}` : String(stats.laps)),
      cell(formatTime(stats.lastLap)),
      cell(formatTime(stats.bestLap)),
      cell(formatTime(stats.total)),
    );
    return row;
  });
  $('standings').replaceChildren(...rows);
}

// ---- Start ----------------------------------------------------------------

$('retry').addEventListener('click', startCamera);
renderSetup();
startCamera();
