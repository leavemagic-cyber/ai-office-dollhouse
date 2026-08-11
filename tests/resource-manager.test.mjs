import test from 'node:test';
import assert from 'node:assert/strict';

import { DISPLAY_MODES } from '../resources/js/domain.js';
import { ResourceLifecycleManager } from '../resources/js/resource-manager.js';

function fakeDocument() {
  const listeners = new Map();
  return {
    hidden: false,
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name) { listeners.delete(name); },
    emit(name) { listeners.get(name)?.(); }
  };
}

test('resource pressure degrades immediately and recovers one level per cooldown', () => {
  const priorDocument = globalThis.document;
  globalThis.document = fakeDocument();
  try {
    const changes = [];
    const manager = new ResourceLifecycleManager({ state: { settings: { autoProtect: true } }, onLevelChanged: (level) => changes.push(level), recoveryCooldownMs: 1000 });
    manager.updateSystemMetrics({ cpuLoadPercent: 95, memoryLoadPercent: 40 }, 0);
    assert.equal(manager.level, 'red');
    manager.updateSystemMetrics({ cpuLoadPercent: 10, memoryLoadPercent: 20 }, 100);
    assert.equal(manager.level, 'red');
    manager.updateSystemMetrics({ cpuLoadPercent: 10, memoryLoadPercent: 20 }, 1101);
    assert.equal(manager.level, 'orange');
    manager.updateSystemMetrics({ cpuLoadPercent: 10, memoryLoadPercent: 20 }, 2102);
    assert.equal(manager.level, 'yellow');
    manager.updateSystemMetrics({ cpuLoadPercent: 10, memoryLoadPercent: 20 }, 3103);
    assert.equal(manager.level, 'green');
    assert.deepEqual(changes.slice(0, 4), ['red', 'orange', 'yellow', 'green']);
    manager.dispose();
  } finally {
    globalThis.document = priorDocument;
  }
});

test('hidden state yields DND policy and normal full mode retains 30 FPS', () => {
  const priorDocument = globalThis.document;
  globalThis.document = fakeDocument();
  try {
    const manager = new ResourceLifecycleManager({ state: { settings: { autoProtect: true } } });
    assert.equal(manager.effectiveMode(DISPLAY_MODES.FULL), DISPLAY_MODES.FULL);
    assert.equal(manager.fps(DISPLAY_MODES.FULL), 30);
    globalThis.document.hidden = true;
    globalThis.document.emit('visibilitychange');
    assert.equal(manager.effectiveMode(DISPLAY_MODES.FULL), DISPLAY_MODES.DND);
    assert.equal(manager.fps(DISPLAY_MODES.FULL), 0);
    manager.dispose();
  } finally {
    globalThis.document = priorDocument;
  }
});

