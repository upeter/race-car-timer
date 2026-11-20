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
