import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../scripts/click-through/AIOfficeClickThrough.cs', import.meta.url), 'utf8');

test('native click-through guard owns the same 40ms chrome and edge contract', () => {
  assert.match(source, /ChromeBar = 15/);
  assert.match(source, /ChromeApproach = 20/);
  assert.match(source, /ResizeEdge = 12/);
  assert.match(source, /Thread\.Sleep\(40\)/);
  assert.match(source, /GetDpiForWindow/);
});

test('native click-through guard clears the style when hidden, minimized, replaced, or exited', () => {
  assert.match(source, /!IsWindowVisible\(window\) \|\| IsIconic\(window\)/);
  assert.match(source, /lastWindow != IntPtr\.Zero && lastWindow != window/);
  assert.match(source, /if \(target\.HasExited\) break/);
  assert.match(source, /finally[\s\S]*Apply\(lastWindow, false\)/);
});
