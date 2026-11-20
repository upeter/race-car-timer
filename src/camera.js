export const ZONE_LONG_SIDE = 80;

// False when the page is not served over HTTPS (or localhost), or the
// browser has no camera API.
export function cameraSupported() {
  return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export async function openCamera(video) {
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

// Calls callback(time) once per video frame, time in seconds. Uses the
// frame's media time when the browser gives it. Returns a stop function.
export function onFrames(video, callback) {
  let stopped = false;
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    const step = (now, metadata) => {
      if (stopped) return;
      callback(metadata.mediaTime);
      video.requestVideoFrameCallback(step);
    };
    video.requestVideoFrameCallback(step);
  } else {
    const step = () => {
      if (stopped) return;
      callback(performance.now() / 1000);
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
