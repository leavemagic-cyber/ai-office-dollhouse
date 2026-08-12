import assert from 'node:assert/strict';
import test from 'node:test';
import { CLOSE_CLEANUP_TIMEOUT_MS, NativeBridge } from '../resources/js/native-bridge.js';

function withNativeWindow(windowApi) {
  const neutralinoBefore = Object.getOwnPropertyDescriptor(globalThis, 'Neutralino');
  const pathBefore = Object.getOwnPropertyDescriptor(globalThis, 'NL_PATH');
  Object.defineProperty(globalThis, 'Neutralino', { configurable: true, value: { window: windowApi } });
  Object.defineProperty(globalThis, 'NL_PATH', { configurable: true, value: 'C:\\fake-app' });
  return () => {
    if (neutralinoBefore) Object.defineProperty(globalThis, 'Neutralino', neutralinoBefore);
    else delete globalThis.Neutralino;
    if (pathBefore) Object.defineProperty(globalThis, 'NL_PATH', pathBefore);
    else delete globalThis.NL_PATH;
  };
}

function withNativeRuntime(runtime) {
  const neutralinoBefore = Object.getOwnPropertyDescriptor(globalThis, 'Neutralino');
  const pathBefore = Object.getOwnPropertyDescriptor(globalThis, 'NL_PATH');
  Object.defineProperty(globalThis, 'Neutralino', { configurable: true, value: runtime });
  Object.defineProperty(globalThis, 'NL_PATH', { configurable: true, value: 'C:\\fake-app' });
  return () => {
    if (neutralinoBefore) Object.defineProperty(globalThis, 'Neutralino', neutralinoBefore);
    else delete globalThis.Neutralino;
    if (pathBefore) Object.defineProperty(globalThis, 'NL_PATH', pathBefore);
    else delete globalThis.NL_PATH;
  };
}

test('automatic show respects a user-minimized overlay', async (t) => {
  const calls = [];
  const restore = withNativeWindow({
    isMinimized: async () => { calls.push('isMinimized'); return true; },
    show: async () => { calls.push('show'); },
    focus: async () => { calls.push('focus'); }
  });
  t.after(restore);

  await new NativeBridge().show({ focus: false });
  assert.deepEqual(calls, ['isMinimized']);
});

test('automatic show does not restore or focus a non-minimized overlay', async (t) => {
  const calls = [];
  const restore = withNativeWindow({
    isMinimized: async () => { calls.push('isMinimized'); return false; },
    show: async () => { calls.push('show'); },
    focus: async () => { calls.push('focus'); }
  });
  t.after(restore);

  await new NativeBridge().show({ focus: false });
  assert.deepEqual(calls, ['isMinimized', 'show']);
});

test('close exits even when stale-lock cleanup fails', async (t) => {
  let exited = 0;
  const restore = withNativeRuntime({ app: { exit: async () => { exited += 1; } } });
  t.after(restore);
  const bridge = new NativeBridge();
  bridge.releaseSingleInstance = async () => { throw new Error('locked'); };
  await bridge.close();
  assert.equal(exited, 1);
});

test('close exits after a bounded wait when lock cleanup never settles', async (t) => {
  let exited = 0;
  const restore = withNativeRuntime({ app: { exit: async () => { exited += 1; } } });
  t.after(restore);
  const bridge = new NativeBridge();
  bridge.releaseSingleInstance = () => new Promise(() => {});
  const startedAt = Date.now();
  await bridge.close();
  assert.equal(exited, 1);
  assert.ok(Date.now() - startedAt < CLOSE_CLEANUP_TIMEOUT_MS + 500);
});

test('missing Node snapshot helper degrades safely without blocking live events', async (t) => {
  const restore = withNativeRuntime({
    filesystem: { getStats: async () => { throw new Error('not packaged'); } },
    os: { execCommand: async () => ({ exitCode: 1, stdOut: '', stdErr: 'node.exe was not found' }) }
  });
  t.after(restore);

  const snapshot = await new NativeBridge().existingWorkSnapshot();
  assert.equal(snapshot.schemaVersion, 1);
  assert.match(snapshot.truth, /可靠的即時事件/);
  for (const provider of ['codex', 'claude', 'gemini', 'grok']) {
    assert.equal(snapshot.providers[provider].available, false);
    assert.deepEqual(snapshot.providers[provider].work, []);
  }
});

test('shared model writes are serialized through a complete temporary file', async (t) => {
  const root = 'C:\\local\\AIOfficeDollhouse';
  const target = `${root}\\office-state-v2.json`;
  const temporary = `${target}.next`;
  const files = new Map([[target, JSON.stringify({ generation: 0 })]]);
  const calls = [];
  const restore = withNativeRuntime({
    filesystem: {
      writeFile: async (path, data) => { calls.push(`write:${path}`); files.set(path, data); },
      remove: async (path) => { calls.push(`remove:${path}`); files.delete(path); },
      move: async (source, destination) => {
        calls.push(`move:${source}`);
        if (!files.has(source) || files.has(destination)) throw new Error('replacement order is unsafe');
        files.set(destination, files.get(source));
        files.delete(source);
      }
    }
  });
  t.after(restore);
  const bridge = new NativeBridge();
  bridge.dataDirectory = root;

  await Promise.all([
    bridge.writeSharedModel({ generation: 1 }),
    bridge.writeSharedModel({ generation: 2 })
  ]);

  assert.deepEqual(JSON.parse(files.get(target)), { generation: 2 });
  assert.equal(files.has(temporary), false);
  assert.deepEqual(calls, [
    `write:${temporary}`, `remove:${target}`, `move:${temporary}`,
    `write:${temporary}`, `remove:${target}`, `move:${temporary}`
  ]);
});

test('single-instance guard owns and releases only its token-matched lock', async (t) => {
  const directories = new Set(['C:\\local\\AIOfficeDollhouse']);
  const files = new Map();
  const runtime = {
    filesystem: {
      createDirectory: async (path) => {
        if (directories.has(path)) throw new Error('already exists');
        directories.add(path);
      },
      getStats: async (path) => ({ isFile: files.has(path), modifiedAt: 0 }),
      readFile: async (path) => {
        if (!files.has(path)) throw new Error('missing');
        return files.get(path);
      },
      writeFile: async (path, data) => files.set(path, data),
      remove: async (path) => { files.delete(path); directories.delete(path); }
    },
    os: { execCommand: async () => ({ stdOut: '' }) }
  };
  const restore = withNativeRuntime(runtime);
  t.after(restore);
  const bridge = new NativeBridge();
  bridge.dataDirectory = 'C:\\local\\AIOfficeDollhouse';
  bridge.instanceProcessId = 321;

  assert.equal(await bridge.acquireSingleInstance(), true);
  const ownerPath = 'C:\\local\\AIOfficeDollhouse\\instance.lock\\owner.json';
  assert.equal(JSON.parse(files.get(ownerPath)).processId, 321);
  await bridge.releaseSingleInstance();
  assert.equal(files.has(ownerPath), false);
  assert.equal(directories.has('C:\\local\\AIOfficeDollhouse\\instance.lock'), false);
});

test('single-instance guard retains a live owner lock', async (t) => {
  const owner = JSON.stringify({ processId: 99, token: 'other', heartbeatAt: Date.now() });
  const restore = withNativeRuntime({
    filesystem: {
      createDirectory: async () => { throw new Error('already exists'); },
      getStats: async () => ({ modifiedAt: Date.now() }),
      readFile: async () => owner,
      remove: async () => { throw new Error('must not remove a live lock'); }
    },
    os: { execCommand: async () => ({ stdOut: 'ai-office.exe                 99 Console' }) }
  });
  t.after(restore);
  const bridge = new NativeBridge();
  bridge.dataDirectory = 'C:\\local\\AIOfficeDollhouse';
  bridge.instanceProcessId = 321;

  assert.equal(await bridge.acquireSingleInstance(), false);
});

test('single-instance guard replaces a dead owner lock without a long restart delay', async (t) => {
  const lockDirectory = 'C:\\local\\AIOfficeDollhouse\\instance.lock';
  const ownerPath = `${lockDirectory}\\owner.json`;
  const directories = new Set(['C:\\local\\AIOfficeDollhouse', lockDirectory]);
  const files = new Map([[ownerPath, JSON.stringify({ processId: 99, token: 'dead', heartbeatAt: Date.now() })]]);
  const restore = withNativeRuntime({
    filesystem: {
      createDirectory: async (path) => {
        if (directories.has(path)) throw new Error('already exists');
        directories.add(path);
      },
      getStats: async () => ({ modifiedAt: Date.now() }),
      readFile: async (path) => {
        if (!files.has(path)) throw new Error('missing');
        return files.get(path);
      },
      writeFile: async (path, data) => files.set(path, data),
      remove: async (path) => { files.delete(path); directories.delete(path); }
    },
    os: { execCommand: async () => ({ stdOut: '' }) }
  });
  t.after(restore);
  const bridge = new NativeBridge();
  bridge.dataDirectory = 'C:\\local\\AIOfficeDollhouse';
  bridge.instanceProcessId = 321;

  assert.equal(await bridge.acquireSingleInstance(), true);
  assert.equal(JSON.parse(files.get(ownerPath)).processId, 321);
  await bridge.releaseSingleInstance();
});
