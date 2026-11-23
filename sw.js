// Offline support. App files are fetched network-first, so an online phone
// always gets the newest version without a version bump here; the cached
// copy is used only when the network fails (a track without Wi-Fi). Fonts
// never change, so they are served from the cache first.

const CACHE = 'race-car-timer-v1';

const APP_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'src/calibrate.js',
  'src/camera.js',
  'src/color.js',
  'src/detector.js',
  'src/laps.js',
  'src/main.js',
  'src/race.js',
  'src/storage.js',
  'src/ui.js',
  'src/wizard.js',
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
  } else if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    // Past the browser's HTTP cache: GitHub Pages lets it keep files for 10
    // minutes, which after a deploy mixed a new index.html with an old
    // main.js. 'no-cache' revalidates, so an unchanged file is a cheap 304.
    const response = await fetch(request, { cache: 'no-cache' });
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const page = await cache.match('index.html');
      if (page) return page;
    }
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // Font files come back opaque (no CORS mode), with status 0.
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}
