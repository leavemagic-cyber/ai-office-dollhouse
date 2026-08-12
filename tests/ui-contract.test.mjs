import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../resources/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../resources/styles.css', import.meta.url), 'utf8');
const main = readFileSync(new URL('../resources/js/main.js', import.meta.url), 'utf8');

test('Owner is a dedicated top root and never shares the work-floor container', () => {
  assert.ok(html.indexOf('id="owner-floor"') < html.indexOf('id="tower-floors"'));
  assert.match(css, /\.owner-floor\s*\{[^}]*z-index:\s*6[^}]*isolation:\s*isolate/s);
  assert.match(css, /\.tower-floors \.floor-card\s*\{\s*width:\s*82%/);
  assert.match(css, /\.owner-floor \.floor-card\s*\{\s*width:\s*100%/);
  assert.match(main, /view\.room === 'owner' \? ownerRoot : floorRoot/);
});

test('window controls stay above every resize grip', () => {
  assert.match(css, /\.tower-bar\s*\{[^}]*z-index:\s*10/s);
  assert.match(css, /\.tower-grips\s*\{[^}]*z-index:\s*2/s);
  const closeStart = main.indexOf("const closeButton = document.getElementById('tower-close')");
  const closeEnd = main.indexOf("document.getElementById('tower-privacy')", closeStart);
  const closeHandler = main.slice(closeStart, closeEnd);
  assert.match(closeHandler, /bridge\.close\(\)/);
  assert.match(closeHandler, /addEventListener\('pointerdown', requestClose\)/);
  assert.doesNotMatch(closeHandler, /restoreClickThroughForChrome/);
});
