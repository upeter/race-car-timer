import {
  applyZoom,
  cameraSupported,
  closeCamera,
  createSessionClock,
  openCamera,
  onFrames,
  createZoneReader,
  zoomRange,
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
  gaps,
  fastestLap,
} from './race.js';
import {
  DEFAULT_SETTINGS,
  loadSetup,
  saveSetup,
  clearSetup,
} from './storage.js';
import {
  createBeeper,
  carColor,
  formatGap,
  formatTime,
  normalizedPoint,
} from './ui.js';
import { clampStep, furthestStep, openingStep } from './wizard.js';

const MAX_CARS = 4;
const BASELINE_FRAMES = 10;
const CAR_FRAMES = 5;
const COUNTDOWN_SECONDS = 3;
const TAP_RADIUS = 2;
const MIN_ZONE_SIZE = 0.03;
// The camera's height on each setup step; the step panel takes the rest.
const SETUP_STAGE_HEIGHTS = {
  zone: '50dvh',
  baseline: '50dvh',
  cars: '34dvh',
  mode: '24dvh',
  ready: '24dvh',
};
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
let step = openingStep(setup);
let readZone = null;
let stopFrames = null;
let lastTime = 0;
let levels = [];
let collector = null; // { frames, count, resolve }: frames wanted by a capture
let capturing = false; // a capture is pending: the setup buttons are off
let offerTap = false; // the camera missed a sticker: offer to tap it
let pointerMode = step === 'zone' ? 'zone' : 'none'; // 'none' | 'zone' | 'tap'
let dragStart = null;
let draftZone = null;
let session = null; // null on the Setup screen
let frozenTime = null; // time at which a race ended or was stopped
let countdownShown = null;
let wakeLock = null;
let fpsStart = null; // { time, frames }: window for the frame rate
const clock = createSessionClock();
let stream = null; // the open camera stream
let zoomQueue = Promise.resolve(); // zoom changes, one after another

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
    stream = await openCamera(video);
  } catch (error) {
    showMessage(
      `Could not open the camera: ${error.message} ` +
        "Allow the camera for this site in Chrome's site settings, then press Retry.",
    );
    return;
  }
  // The page went to the background while the camera was opening.
  if (document.visibilityState === 'hidden') {
    closeCamera(video);
    return;
  }
  await setupZoom();
  if (session === null && step === 'zone') setHint(stepHint());
  layout();
  keepAwake();
  readZone = createZoneReader(video);
  if (stopFrames) stopFrames();
  clock.restart();
  stopFrames = onFrames(
    video,
    (frameTime) => handleFrame(clock.time(frameTime)),
    showFrameError,
  );
}

function stopCamera() {
  if (stopFrames) stopFrames();
  stopFrames = null;
  closeCamera(video);
  stream = null;
}

function formatZoom(value) {
  return `${Number(value).toFixed(1)}×`;
}

// Shows the zoom slider when the camera has a zoom, and gives a new stream
// the stored zoom again.
async function setupZoom() {
  const range = zoomRange(stream?.getVideoTracks()[0]);
  $('zoom-row').hidden = range === null;
  if (range === null) return;
  const slider = $('zoom');
  slider.min = range.min;
  slider.max = range.max;
  slider.step = range.step;
  try {
    const zoom = await applyZoom(stream, setup.settings.zoom);
    slider.value = zoom;
    $('zoom-value').textContent = formatZoom(zoom);
  } catch {
    // The camera refused the zoom. It keeps its own.
    $('zoom-row').hidden = true;
  }
}

function queueZoom(value) {
  zoomQueue = zoomQueue
    .then(() => applyZoom(stream, value))
    .catch((error) => setHint(`Could not zoom: ${error.message}`));
  return zoomQueue;
}

// Sizes the stage to the video's aspect ratio. On the Setup screen it stays
// above the panel, so the whole picture can be boxed and tapped.
function layout() {
  const { videoWidth, videoHeight } = video;
  if (!videoWidth || !videoHeight) return;
  const height = session === null ? SETUP_STAGE_HEIGHTS[step] : RUN_STAGE_HEIGHT;
  stage.style.aspectRatio = `${videoWidth} / ${videoHeight}`;
  stage.style.width = `min(100vw, calc(${height} * ${videoWidth / videoHeight}))`;
  overlay.width = videoWidth;
  overlay.height = videoHeight;
}

function onVideoResize() {
  // Its frames may have different sizes.
  if (cancelCapture()) setHint(stepHint());
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

// A phone stops the camera of a page in the background and does not give the
// old stream back, so the picture froze on return. Close it on hide and open
// a new one on show. Time in the background does not count.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') stopCamera();
  else startCamera();
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

function stepHint() {
  const { zone, cars } = setup;
  if (step === 'zone') {
    return zone
      ? 'Drag a new box to move it. A new box removes the cars.'
      : $('zoom-row').hidden
        ? 'Drag a box over the finish line, about one car length wide.'
        : 'Zoom in if the line looks small, then drag a box over it, about one car length wide.';
  }
  if (step === 'baseline') {
    return setup.baseline
      ? 'Capture the empty track again if the light changed, or keep it.'
      : 'Take all cars and hands out of the box, then capture the empty track.';
  }
  if (step === 'cars') {
    if (cars.length === 0) {
      return 'Put one car on the finish line, with its colour sticker inside the box.';
    }
    if (cars.length < MAX_CARS) {
      return 'Put the next car on the line, or press "Done with cars".';
    }
    return 'Four cars is the maximum. Press "Done with cars".';
  }
  return '';
}

function stepHeader() {
  const { cars, settings } = setup;
  if (step === 'zone') return ['Step 1/4', 'Finish line', 'Mark the finish line'];
  if (step === 'baseline') return ['Step 2/4', 'Empty track', 'Clear the track'];
  if (step === 'cars') {
    if (cars.length >= MAX_CARS) return ['Step 3/4', '4 of 4 cars', 'Grid is full'];
    const next = cars.length + 1;
    return ['Step 3/4', `Car ${next} of ${MAX_CARS}`, `Car ${next} to the line`];
  }
  if (step === 'mode') return ['Step 4/4', 'Session', 'Choose the session'];
  return ['Ready', sessionLabel(settings), 'Grid is set'];
}

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
    ? `Every car drives ${lapCount(lapTarget)}. Lap 1 from the grid does not count; the shortest lap after it wins.`
    : `The first car to complete ${lapCount(lapTarget)} wins.`;
}

function goTo(newStep) {
  step = newStep;
  offerTap = false;
  pointerMode = step === 'zone' ? 'zone' : 'none';
  dragStart = null;
  draftZone = null;
  renderSetup();
}

function setCapturing(value) {
  capturing = value;
  updateButtons();
}

function updateButtons() {
  const { zone, baseline, cars } = setup;
  const ready = zone !== null && baseline !== null && cars.length > 0;
  for (const button of $('setup').querySelectorAll('button')) {
    button.disabled = capturing;
  }
  $('lap-target').disabled = capturing;
  if (capturing) return;
  const canAdd = baseline !== null && cars.length < MAX_CARS;
  $('zone-next').disabled = zone === null;
  $('capture-baseline').disabled = zone === null;
  $('add-car').disabled = !canAdd;
  $('tap-note').disabled = !canAdd;
  $('cars-done').disabled = cars.length === 0;
  $('start').disabled = !ready;
  const race = setup.settings.mode === 'race';
  for (const id of ['lap-target', 'laps-down', 'laps-up', 'win-finish', 'win-fastest']) {
    $(id).disabled = !race;
  }
}

// `hint` replaces the usual step hint, for messages that must stay.
function renderSetup(hint) {
  const clamped = clampStep(step, setup);
  if (clamped !== step) {
    step = clamped;
    pointerMode = step === 'zone' ? 'zone' : 'none';
  }
  const { cars, settings } = setup;

  const [tag, sub, title] = stepHeader();
  $('step-tag').textContent = tag;
  $('step-sub').textContent = sub;
  $('step-title').textContent = title;
  // An <svg> has no `hidden` property, only the attribute.
  $('hero').toggleAttribute('hidden', step !== 'ready');
  for (const element of document.querySelectorAll('.step')) {
    element.hidden = element.dataset.step !== step;
  }

  updateButtons();
  $('add-car').textContent = `Add car ${Math.min(cars.length + 1, MAX_CARS)}`;
  $('baseline-next').hidden = setup.baseline === null;
  $('tap-note').hidden = !offerTap;

  for (const mode of ['practice', 'race']) {
    const on = settings.mode === mode;
    $(`mode-${mode}`).classList.toggle('on', on);
    $(`mode-${mode}`).querySelector('button').setAttribute('aria-pressed', String(on));
  }
  $('lap-target').value = settings.lapTarget;
  for (const button of document.querySelectorAll('[data-win-by]')) {
    button.setAttribute('aria-pressed', String(settings.winBy === button.dataset.winBy));
  }
  $('win-text').textContent = winText(settings);

  $('tolerance').value = settings.tolerance;
  $('tolerance-value').textContent = `±${settings.tolerance}°`;
  $('min-lap').value = settings.minLapTime;
  $('min-lap-value').textContent = `${settings.minLapTime} s`;

  $('cars').replaceChildren(...cars.map((car, index) => carItem(car, index, true)));
  $('grid').replaceChildren(...cars.map((car, index) => carItem(car, index, false)));
  $('summary').textContent =
    `${sessionLabel(settings)} · finish line set · empty track captured`;
  setHint(hint ?? stepHint());
  layout();
}

// A timing-tower row. On the cars step the name can be changed and the car
// removed.
function carItem(car, index, editable) {
  const item = document.createElement('li');

  const position = document.createElement('span');
  position.className = 'pos';
  position.textContent = String(index + 1);

  const note = document.createElement('span');
  note.className = 'note';
  note.style.background = carColor(car);

  let name;
  if (editable) {
    name = document.createElement('input');
    name.type = 'text';
    name.maxLength = 12;
    name.value = car.name;
    name.setAttribute('aria-label', `Name of car ${index + 1}`);
    name.addEventListener('change', () => {
      car.name = name.value.trim() || `Car ${index + 1}`;
      name.value = car.name;
      save();
    });
  } else {
    name = document.createElement('span');
    name.textContent = car.name;
  }
  name.classList.add('name');

  const bar = document.createElement('div');
  bar.className = 'bar';
  const fill = document.createElement('div');
  fill.className = 'fill';
  fill.dataset.car = String(index);
  bar.append(fill);

  item.append(position, note, name, bar);
  if (editable) {
    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${car.name}`);
    remove.addEventListener('click', () => {
      setup.cars.splice(index, 1);
      save();
      renderSetup();
    });
    item.append(remove);
  }
  return item;
}

// The white mark in the middle of a bar is the car's threshold.
function updateMeters() {
  document.querySelectorAll('.tower .fill').forEach((fill) => {
    const index = Number(fill.dataset.car);
    const car = setup.cars[index];
    if (!car) return;
    const level = levels[index] ?? 0;
    fill.style.width = `${Math.min(100, (level / car.threshold) * 50)}%`;
    fill.classList.toggle('on', level > car.threshold);
  });
}

function calibrationMessage(result) {
  if (result.reason === 'no-note') {
    return 'No colour sticker found. Put the car on the line with its sticker inside the box.';
  }
  if (result.reason === 'too-close-to-car') {
    const other = setup.cars[result.carIndex].name;
    return `Too close to ${other}. Use a different colour.`;
  }
  return 'This colour is too close to the floor or the strip. Use a different colour.';
}

function applyCalibration(result) {
  if (!result.ok) {
    offerTap = true;
    $('tap-note').hidden = false;
    setHint(calibrationMessage(result));
    return;
  }
  offerTap = false;
  setup.cars.push({ name: `Car ${setup.cars.length + 1}`, ...result.car });
  save();
  renderSetup();
}

$('zone-next').addEventListener('click', () => goTo('baseline'));
$('baseline-back').addEventListener('click', () => goTo('zone'));
$('baseline-next').addEventListener('click', () => goTo('cars'));
$('cars-back').addEventListener('click', () => goTo('baseline'));
$('cars-done').addEventListener('click', () => goTo('mode'));
$('mode-back').addEventListener('click', () => goTo('cars'));
$('mode-next').addEventListener('click', () => goTo('ready'));
$('edit-setup').addEventListener('click', () => goTo('zone'));

$('capture-baseline').addEventListener('click', async () => {
  setHint('Capturing…');
  const image = await collect(BASELINE_FRAMES);
  if (image === null) return;
  setup.baseline = image;
  save();
  goTo('cars');
});

$('add-car').addEventListener('click', async () => {
  setHint('Looking for the colour sticker…');
  const image = await collect(CAR_FRAMES);
  if (image === null) return; // cancelled: the canceller set the hint
  if (setup.baseline === null) {
    renderSetup();
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
  setHint('Keep the car on the line and tap its colour sticker in the picture.');
});

async function handleTap(point) {
  const { zone } = setup;
  const zx = (point.x - zone.x) / zone.w;
  const zy = (point.y - zone.y) / zone.h;
  if (zx < 0 || zx >= 1 || zy < 0 || zy >= 1) {
    setHint('Tap the sticker inside the box, with the car on the finish line.');
    return;
  }
  setHint('Reading the sticker colour…');
  const image = await collect(CAR_FRAMES);
  if (image === null) return; // cancelled: the canceller set the hint
  if (setup.baseline === null) {
    renderSetup();
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
    setHint('No colour found at that point. Tap the middle of the sticker.');
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

// The zone step stays in zone mode, so the box can be drawn again.
function finishDrag() {
  if (dragStart === null) return;
  const zone = draftZone;
  dragStart = null;
  draftZone = null;
  if (zone === null || zone.w < MIN_ZONE_SIZE || zone.h < MIN_ZONE_SIZE) {
    setHint('The box is too small. Drag a bigger box.');
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

for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => {
    setup.settings.mode = button.dataset.mode;
    save();
    renderSetup();
  });
}

for (const button of document.querySelectorAll('[data-win-by]')) {
  button.addEventListener('click', () => {
    setup.settings.winBy = button.dataset.winBy;
    setLapTarget(setup.settings.lapTarget);
  });
}

function setLapTarget(value) {
  // Lap 1 does not count in a fastest-lap race, so it needs a second lap.
  const minimum = setup.settings.winBy === 'fastestLap' ? 2 : 1;
  setup.settings.lapTarget = Math.min(999, Math.max(minimum, Math.round(value) || 10));
  save();
  renderSetup();
}

$('lap-target').addEventListener('change', () => {
  setLapTarget(Number($('lap-target').value));
});
$('laps-down').addEventListener('click', () => {
  setLapTarget(setup.settings.lapTarget - 1);
});
$('laps-up').addEventListener('click', () => {
  setLapTarget(setup.settings.lapTarget + 1);
});

$('settings-toggle').addEventListener('click', () => {
  const open = $('settings').hidden;
  $('settings').hidden = !open;
  $('settings-toggle').setAttribute('aria-expanded', String(open));
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

// While dragging, the picture follows the slider.
$('zoom').addEventListener('input', () => {
  const zoom = Number($('zoom').value);
  $('zoom-value').textContent = formatZoom(zoom);
  queueZoom(zoom);
});

// The empty track and the cars were captured at the old zoom.
$('zoom').addEventListener('change', async () => {
  const zoom = Number($('zoom').value);
  await queueZoom(zoom);
  if (zoom === setup.settings.zoom) return;
  setup.settings.zoom = zoom;
  if (setup.baseline !== null || setup.cars.length > 0) {
    handlePictureChange();
  } else {
    save();
  }
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
  goTo('zone');
});

// ---- Practice and Race ----------------------------------------------------

function newSession() {
  const { mode, lapTarget, minLapTime, winBy } = setup.settings;
  session = createSession({
    mode,
    carCount: setup.cars.length,
    lapTarget,
    minLapTime,
    winBy,
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
  document.body.classList.add('running');
  $('setup-head').hidden = true;
  $('setup').hidden = true;
  $('run').hidden = false;
  document.querySelector('.run-chk').hidden = false;
  $('start-race').hidden = !race;
  $('start-race').textContent = 'Start race';
  $('stop-race').hidden = true;
  $('reset').hidden = race;
  layout();
});

$('start-race').addEventListener('click', () => {
  if (frozenTime !== null) {
    // "New race": choose practice or race, laps and winner again first.
    showSession();
    return;
  }
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
  document.querySelector('.run-chk').hidden = true;
  document.body.classList.remove('running');
  $('setup-head').hidden = false;
  $('setup').hidden = false;
  layout();
}

function showSession() {
  showSetupScreen();
  goTo('mode');
}

$('back').addEventListener('click', showSession);

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

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function stat(label, value, className = '') {
  const node = element('div', 'stat');
  node.append(element('span', 'label', label), element('b', className, value));
  return node;
}

function dot(car) {
  const node = element('span', 'dot');
  node.style.background = carColor(car);
  return node;
}

// The time the session clock shows: race time after "Go", in practice the
// time since the first car started.
function sessionClock(now) {
  if (session.mode === 'race') {
    return session.goTime !== null && now >= session.goTime
      ? now - session.goTime
      : 0;
  }
  const starts = session.cars
    .map((car) => car.startTime)
    .filter((start) => start !== null);
  return starts.length > 0 ? now - Math.min(...starts) : 0;
}

function leaderLaps() {
  return Math.max(...session.cars.map((car) => car.laps.length));
}

function byFastestLap() {
  return session.mode === 'race' && session.winBy === 'fastestLap';
}

function runTag(now) {
  if (session.mode !== 'race') return 'Practice';
  const { goTime, lapTarget } = session;
  if (goTime === null || now < goTime) return `Grid · ${lapCount(lapTarget)}`;
  return `Lap ${Math.min(leaderLaps() + 1, lapTarget)}/${lapTarget}`;
}

function carCard(carIndex, position, now, fastest, gap) {
  const car = setup.cars[carIndex];
  const stats = carStats(session, carIndex, now);
  const race = session.mode === 'race';
  const card = element('div', 'card');

  const stripe = element('div', 'card-stripe');
  stripe.style.background = carColor(car);

  const head = element('div', 'card-head');
  if (race) head.append(element('span', 'card-pos', String(position + 1)));
  head.append(element('span', 'card-name', car.name));

  const isFastest = fastest !== null && fastest.car === carIndex;
  const statRow = element('div', 'card-stats');
  const bestStat = stat('Best', formatTime(stats.bestLap), isFastest ? 'fastest' : '');
  const lapsStat = stat('Laps', race ? `${stats.laps}/${session.lapTarget}` : String(stats.laps));
  if (byFastestLap()) {
    bestStat.classList.add('key');
    statRow.append(bestStat, lapsStat, stat('Gap', formatGap(gap) || '–'));
  } else {
    statRow.append(bestStat, lapsStat, stat('Total', formatTime(stats.total)));
  }

  card.append(
    stripe,
    head,
    element('div', 'card-last', formatTime(stats.lastLap)),
    statRow,
  );
  return card;
}

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

// The podium shows second, first, third from left to right.
const PODIUM_ORDER = [1, 0, 2];

function podiumStep(carIndex, position, gap, fastest) {
  const car = setup.cars[carIndex];
  const step = element('div', 'podium-step');
  const name = element('div', 'podium-name');
  name.append(dot(car), element('span', '', car.name));

  let note;
  if (position === 0) {
    const best = carStats(session, carIndex, frozenTime).bestLap;
    const isFastest = fastest !== null && fastest.car === carIndex;
    note = element('span', `label${isFastest ? ' fastest' : ''}`, `Best ${formatTime(best)}`);
  } else {
    note = element('span', 'label', formatGap(gap) || '–');
  }

  step.append(
    name,
    note,
    element('div', `podium-block p${position + 1}`, String(position + 1)),
  );
  return step;
}

function renderResult() {
  const order = standings(session);
  const carGaps = gaps(session);
  const fastest = fastestLap(session);
  const finished = isRaceOver(session);

  const label = finished ? 'Finish' : 'Stopped';
  $('finish-label').textContent = byFastestLap() ? `${label} · Fastest lap` : label;
  $('finish-laps').textContent = `${leaderLaps()}/${session.lapTarget}`;
  $('result-time').textContent = formatTime(sessionClock(frozenTime));

  const steps = PODIUM_ORDER.filter((position) => position < order.length).map(
    (position) => podiumStep(order[position], position, carGaps[position], fastest),
  );
  $('podium').style.gridTemplateColumns = `repeat(${steps.length}, minmax(0, 1fr))`;
  $('podium').replaceChildren(...steps);

  const others = order.slice(3).map((carIndex, offset) => {
    const car = setup.cars[carIndex];
    const item = element('li');
    item.append(
      element('span', '', String(offset + 4)),
      dot(car),
      element('span', '', car.name),
      element('b', '', formatGap(carGaps[offset + 3]) || '–'),
    );
    return item;
  });
  $('others').hidden = others.length === 0;
  $('others').replaceChildren(...others);
}

// A race that ended or was stopped shows the podium; otherwise the cards.
function renderRun(now) {
  const result = session.mode === 'race' && frozenTime !== null;
  $('live-view').hidden = result;
  $('cards').hidden = result;
  $('result').hidden = !result;
  $('podium').hidden = !result;
  if (result) {
    renderResult();
  } else {
    $('others').hidden = true;
    renderLive(now);
  }
}

// ---- Start ----------------------------------------------------------------

// ---- Install as an app ----------------------------------------------------

let installPrompt = null; // Chrome's deferred install prompt

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((error) => {
    console.warn('No offline support:', error);
  });
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  $('install').hidden = false;
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  $('install').hidden = true;
});

$('install').addEventListener('click', async () => {
  if (installPrompt === null) return;
  const prompt = installPrompt;
  installPrompt = null;
  $('install').hidden = true;
  await prompt.prompt();
});

$('retry').addEventListener('click', startCamera);
renderSetup();
startCamera();
