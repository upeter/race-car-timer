export const ZONE_LONG_SIDE = 80;

// False when the page is not served over HTTPS (or localhost), or the
// browser has no camera API.
export function cameraSupported() {
  return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// Stops every track of the stream shown in `video`, if any.
export function closeCamera(video) {
  video.srcObject?.getTracks().forEach((track) => track.stop());
  video.srcObject = null;
}

export async function openCamera(video) {
  closeCamera(video);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 60 },
    },
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

// The zoom the camera offers as { min, max, step }, or null when it has no
// zoom (or only one level).
export function zoomRange(track) {
  const zoom = track?.getCapabilities?.().zoom;
  if (!zoom || !(zoom.max > zoom.min)) return null;
  return { min: zoom.min, max: zoom.max, step: zoom.step > 0 ? zoom.step : 0.1 };
}

// `value` inside the range and on its steps; the minimum when null.
export function clampZoom(value, range) {
  if (value === null || !Number.isFinite(value)) return range.min;
  const steps = Math.round((value - range.min) / range.step);
  const snapped = range.min + steps * range.step;
  return Math.min(range.max, Math.max(range.min, Number(snapped.toFixed(4))));
}

// Sets the zoom of the stream's video track. Resolves with the zoom used,
// or null when the camera has no zoom.
export async function applyZoom(stream, value) {
  const track = stream?.getVideoTracks()[0];
  const range = zoomRange(track);
  if (range === null) return null;
  const zoom = clampZoom(value, range);
  await track.applyConstraints({ advanced: [{ zoom }] });
  return zoom;
}

// A reopened camera stream starts its media time again near zero. This
// clock shifts each new stream so that time never jumps back: the first
// frame after restart() gets the last time seen before it.
export function createSessionClock() {
  let offset = 0;
  let last = 0;
  let restarted = false;
  return {
    time(frameTime) {
      if (restarted) {
        offset = last - frameTime;
        restarted = false;
      }
      last = frameTime + offset;
      return last;
    },
    restart() {
      restarted = true;
    },
  };
}

const CLOCK_CHECK_CALLBACKS = 5;

// Calls callback(time) once per video frame, time in seconds. Uses the
// frame's media time when it advances, otherwise the callback's own clock
// (decided once, in the first 5 callbacks, which are not passed on). An error in the callback goes to
// onError and does not stop the loop. Returns a stop function.
export function onFrames(video, callback, onError) {
  let stopped = false;
  const run = (time) => {
    try {
      callback(time);
    } catch (error) {
      console.error(error);
      onError?.(error);
    }
  };
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    // The first callbacks only test the clock; they are not passed on, so
    // the two clocks are never mixed.
    let useMediaTime = true;
    let seen = 0;
    let firstMediaTime = null;
    const step = (now, metadata) => {
      if (stopped) return;
      if (seen < CLOCK_CHECK_CALLBACKS) {
        seen++;
        firstMediaTime ??= metadata.mediaTime;
        if (seen === CLOCK_CHECK_CALLBACKS) {
          useMediaTime = metadata.mediaTime > firstMediaTime;
        }
      }
      if (seen >= CLOCK_CHECK_CALLBACKS) {
        run(useMediaTime ? metadata.mediaTime : now / 1000);
      }
      video.requestVideoFrameCallback(step);
    };
    video.requestVideoFrameCallback(step);
  } else {
    const step = () => {
      if (stopped) return;
      run(performance.now() / 1000);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  return () => {
    stopped = true;
  };
}

// Returns readZone(zone): the pixels of the zone, downscaled so that the
// long side is ZONE_LONG_SIDE pixels. `zone` is in fractions of the video.
export function createZoneReader(video) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return function readZone(zone) {
    const sx = zone.x * video.videoWidth;
    const sy = zone.y * video.videoHeight;
    const sw = Math.max(1, zone.w * video.videoWidth);
    const sh = Math.max(1, zone.h * video.videoHeight);
    const scale = ZONE_LONG_SIDE / Math.max(sw, sh);
    const width = Math.max(1, Math.round(sw * scale));
    const height = Math.max(1, Math.round(sh * scale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    context.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
    return {
      data: context.getImageData(0, 0, width, height).data,
      width,
      height,
    };
  };
}
