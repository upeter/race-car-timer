import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Runs sw.js in a sandbox with a fake service worker scope, a fake Cache
// Storage and a fetch that records how it was called.
function loadServiceWorker() {
  const listeners = {};
  const fetchCalls = [];
  const cache = { put: async () => {}, match: async () => undefined };
  const sandbox = {
    URL,
    self: {
      location: new URL('https://example.test/app/sw.js'),
      addEventListener: (type, listener) => {
        listeners[type] = listener;
      },
    },
    caches: { open: async () => cache },
    fetch: async (request, init) => {
      fetchCalls.push({ request, init });
      return { ok: true, clone: () => ({}) };
    },
  };
  vm.runInNewContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), sandbox);
  return { listeners, fetchCalls };
}

function fetchEvent(url) {
  let responded;
  const event = {
    request: { method: 'GET', url, mode: 'no-cors' },
    respondWith: (promise) => {
      responded = promise;
    },
  };
  return { event, responded: () => responded };
}

// The browser's HTTP cache may hold an app file for 10 minutes (GitHub
// Pages max-age). Right after a deploy that mixed a new index.html with an
// old main.js.
test('app files are fetched past the HTTP cache', async () => {
  const { listeners, fetchCalls } = loadServiceWorker();
  const { event, responded } = fetchEvent('https://example.test/app/src/main.js');
  listeners.fetch(event);
  await responded();
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].init?.cache, 'no-cache');
});
