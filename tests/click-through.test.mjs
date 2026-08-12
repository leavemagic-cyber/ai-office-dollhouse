import assert from 'node:assert/strict';
import test from 'node:test';

import { CHROME, ClickThroughGuard, clickThroughAt, scaleFromRect } from '../resources/js/click-through.js';

// A 240x300 logical overlay on a 200% display, parked near the bottom right.
const rect = { left: 1000, top: 500, right: 1480, bottom: 1100 };
const scale = 2;

test('the drawing lets the mouse through, the chrome does not', () => {
  // Middle of a floor plate: this is the whole point of the overlay being an overlay.
  assert.equal(clickThroughAt({ x: 1240, y: 800 }, rect, scale), true);

  // Title bar, its buttons and the approach margin above them stay clickable.
  assert.equal(clickThroughAt({ x: 1240, y: 505 }, rect, scale), false);
  assert.equal(clickThroughAt({ x: 1440, y: 520 }, rect, scale), false);
  assert.equal(clickThroughAt({ x: 1240, y: 500 + (CHROME.bar + CHROME.approach) * scale - 1 }, rect, scale), false);
  assert.equal(clickThroughAt({ x: 1240, y: 500 + (CHROME.bar + CHROME.approach) * scale + 1 }, rect, scale), true);

  // All eight resize grips: every edge band, in physical pixels.
  for (const point of [
    { x: 1002, y: 800 }, { x: 1478, y: 800 }, { x: 1240, y: 1098 },
    { x: 1002, y: 502 }, { x: 1478, y: 1098 }
  ]) {
    assert.equal(clickThroughAt(point, rect, scale), false, `grip at ${point.x},${point.y}`);
  }
});

test('outside the overlay the window stays interactive, so entering the bar is instant', () => {
  assert.equal(clickThroughAt({ x: 900, y: 800 }, rect, scale), false);
  assert.equal(clickThroughAt({ x: 1240, y: 400 }, rect, scale), false);
  assert.equal(clickThroughAt({ x: 1480, y: 800 }, rect, scale), false, 'right edge is exclusive');
  assert.equal(clickThroughAt({ x: 1240, y: 1100 }, rect, scale), false, 'bottom edge is exclusive');
});

test('a missing or nonsense measurement never makes the overlay unclickable', () => {
  assert.equal(clickThroughAt({ x: 1240, y: 800 }, null, scale), false);
  assert.equal(clickThroughAt(null, rect, scale), false);
  assert.equal(clickThroughAt({ x: NaN, y: 800 }, rect, scale), false);
  assert.equal(clickThroughAt({ x: 1240, y: 800 }, { left: 5, top: 5, right: 5, bottom: 5 }, scale), false);
});

test('display scaling is measured from the window, not assumed', () => {
  assert.equal(scaleFromRect(rect, 240), 2);
  assert.equal(scaleFromRect({ left: 0, right: 240 }, 240), 1);
  assert.equal(scaleFromRect({ left: 0, right: 360 }, 240), 1.5);
  // Garbage in, safe default out: a stale rect must not shrink the chrome to nothing.
  assert.equal(scaleFromRect(null, 240), 1);
  assert.equal(scaleFromRect({ left: 0, right: 4_000 }, 240), 1);
  assert.equal(scaleFromRect(rect, 0), 1);
});

test('native failures never masquerade as a confirmed interactive window', async () => {
  const results = [
    { ok: true, clickThrough: true, ...rect },
    null,
    null,
    null,
    { ok: true, clickThrough: false, ...rect }
  ];
  const requests = [];
  const guard = new ClickThroughGuard(async (next) => {
    requests.push(next);
    return results.shift() ?? null;
  });

  await guard.request(true);
  assert.equal(guard.state, true);
  await guard.request(null);
  await guard.request(null);
  assert.equal(guard.state, true, 'failed cleanup cannot overwrite the last OS-confirmed state');
  assert.deepEqual(requests, [true, null, null, false]);

  await guard.ensureInteractive();
  assert.equal(guard.state, false);
  assert.equal(guard.failures, 0);
});

test('explicit restore always asks Windows even after an earlier false result', async () => {
  let calls = 0;
  const guard = new ClickThroughGuard(async () => {
    calls += 1;
    return { ok: true, clickThrough: false, ...rect };
  });
  await guard.ensureInteractive();
  await guard.ensureInteractive();
  assert.equal(calls, 2, 'hide and minimise paths must never trust a cached false');
});
