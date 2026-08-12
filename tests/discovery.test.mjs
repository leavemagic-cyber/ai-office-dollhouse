import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoDiscovery, EventInboxReader } from '../resources/js/discovery.js';

function line(event) {
  return `${JSON.stringify(event)}\n`;
}

function createBridge(files) {
  const reads = [];
  return {
    isNative: true,
    reads,
    eventFile: (name) => name,
    async getFileStats(path) {
      const entry = files.get(path);
      if (!entry) throw new Error('not found');
      return {
        size: Buffer.byteLength(entry.text, 'utf8'),
        createdAt: entry.createdAt,
        isFile: true
      };
    },
    async readFile(path, options = {}) {
      const entry = files.get(path);
      const pos = Number(options.pos || 0);
      const size = Number(options.size || Buffer.byteLength(entry.text, 'utf8'));
      reads.push({ path, pos, size });
      return Buffer.from(entry.text, 'utf8').subarray(pos, pos + size).toString('utf8');
    }
  };
}

test('each presence scan refreshes Tier-D last-seen identity', async () => {
  const received = [];
  let timestamp = 1_000;
  const discovery = new AutoDiscovery({
    bridge: {
      discover: async () => ({
        timestamp: timestamp += 1_000,
        surfaces: [{ provider: 'codex', surfaceId: 'codex:app', surfaceKind: 'app', installed: true, appOpen: true, processState: 'open' }],
        system: {}
      })
    },
    onEvent: (event) => received.push(event)
  });
  await discovery.scan({ force: true });
  await discovery.scan({ force: true });
  assert.equal(received.length, 2);
  assert.notEqual(received[0].eventId, received[1].eventId);
  assert.equal(received[1].timestamp, 3_000);
});

test('two consecutive discovery failures emit one provider adapter disconnect', async () => {
  const received = [];
  let calls = 0;
  const discovery = new AutoDiscovery({
    bridge: {
      discover: async () => {
        calls += 1;
        if (calls === 1) return { timestamp: 1_000, surfaces: [{ provider: 'codex', surfaceId: 'codex:app' }], system: {} };
        throw new Error('probe unavailable');
      }
    },
    onEvent: (event) => received.push(event)
  });
  await discovery.scan({ force: true });
  await discovery.scan({ force: true });
  assert.equal(received.filter((event) => event.eventType === 'adapter_disconnected').length, 0);
  await discovery.scan({ force: true });
  const disconnects = received.filter((event) => event.eventType === 'adapter_disconnected');
  assert.equal(disconnects.length, 1);
  assert.equal(disconnects[0].provider, 'codex');
  assert.equal(disconnects[0].observationTier, 'D');
});

test('event inbox reads bounded incremental slices and carries a partial NDJSON line', async () => {
  const first = { eventId: 'first', eventType: 'turn_started' };
  const second = { eventId: 'second', eventType: 'turn_completed' };
  const partial = line(first).slice(0, -1);
  const files = new Map([['events.ndjson', { text: partial, createdAt: 1 }]]);
  const bridge = createBridge(files);
  const received = [];
  const reader = new EventInboxReader({
    bridge,
    onEvent: (event) => received.push(event),
    readChunkBytes: 256,
    maxFileBytes: 1024
  });

  assert.equal(await reader.poll(), 0);
  assert.deepEqual(received, []);
  const firstLength = Buffer.byteLength(partial, 'utf8');

  files.get('events.ndjson').text += `\n${line(second)}`;
  assert.equal(await reader.poll(), 2);
  assert.deepEqual(received.map((event) => event.eventId), ['first', 'second']);
  assert.equal(bridge.reads.at(-1).pos, firstLength);

  const readsAfterChange = bridge.reads.length;
  assert.equal(await reader.poll(), 0);
  assert.equal(bridge.reads.length, readsAfterChange);
  assert.ok(bridge.reads.every((read) => read.size <= 256));
});

test('event inbox recovers from archive replacement and current-file truncation', async () => {
  const files = new Map([
    ['events.1.ndjson', { text: line({ eventId: 'archive-before' }), createdAt: 1 }],
    ['events.ndjson', { text: line({ eventId: 'current-before-is-longer' }), createdAt: 10 }]
  ]);
  const bridge = createBridge(files);
  const received = [];
  const reader = new EventInboxReader({ bridge, onEvent: (event) => received.push(event) });

  assert.equal(await reader.poll(), 2);
  files.set('events.1.ndjson', { text: line({ eventId: 'archive-after' }), createdAt: 2 });
  files.set('events.ndjson', { text: line({ eventId: 'current-after' }), createdAt: 10 });

  assert.equal(await reader.poll(), 2);
  assert.deepEqual(received.map((event) => event.eventId), [
    'archive-before',
    'current-before-is-longer',
    'archive-after',
    'current-after'
  ]);
  const archiveReads = bridge.reads.filter((read) => read.path === 'events.1.ndjson');
  const currentReads = bridge.reads.filter((read) => read.path === 'events.ndjson');
  assert.equal(archiveReads.at(-1).pos, 0);
  assert.equal(currentReads.at(-1).pos, 0);
});

test('event inbox detects a larger same-metadata replacement instead of skipping its new prefix', async () => {
  const files = new Map([['events.1.ndjson', {
    text: line({ eventId: 'old-archive', eventType: 'turn_started' }),
    createdAt: 7
  }]]);
  const bridge = createBridge(files);
  const received = [];
  const reader = new EventInboxReader({ bridge, onEvent: (event) => received.push(event) });

  assert.equal(await reader.readPath('events.1.ndjson'), 1);
  files.set('events.1.ndjson', {
    text: `${line({ eventId: 'new-prefix', eventType: 'turn_started' })}${line({ eventId: 'new-suffix', eventType: 'turn_completed' })}`,
    createdAt: 7
  });

  assert.equal(await reader.readPath('events.1.ndjson'), 2);
  assert.deepEqual(received.map((event) => event.eventId), ['old-archive', 'new-prefix', 'new-suffix']);
  const archiveReads = bridge.reads.filter((read) => read.path === 'events.1.ndjson');
  assert.equal(archiveReads.at(-1).pos, 0);
});

test('event inbox does not mistake a normal append after a short final chunk for replacement', async () => {
  const targetSize = 64 * 1024 + 200;
  const prefix = '{"eventId":"oversized-old","eventType":"turn_started","pad":"';
  const suffix = '"}\n';
  const padLength = targetSize - Buffer.byteLength(prefix, 'utf8') - Buffer.byteLength(suffix, 'utf8');
  const original = `${prefix}${'x'.repeat(padLength)}${suffix}`;
  assert.equal(Buffer.byteLength(original, 'utf8'), targetSize);
  const files = new Map([['events.1.ndjson', { text: original, createdAt: 9 }]]);
  const bridge = createBridge(files);
  const received = [];
  const reader = new EventInboxReader({ bridge, onEvent: (event) => received.push(event), readChunkBytes: 64 * 1024 });

  assert.equal(await reader.readPath('events.1.ndjson'), 0);
  assert.equal(await reader.readPath('events.1.ndjson'), 0);
  const originalSize = Buffer.byteLength(original, 'utf8');
  files.get('events.1.ndjson').text += line({ eventId: 'normal-after-short-tail', eventType: 'turn_completed' });

  assert.equal(await reader.readPath('events.1.ndjson'), 1);
  assert.deepEqual(received.map((event) => event.eventId), ['normal-after-short-tail']);
  const archiveReads = bridge.reads.filter((read) => read.path === 'events.1.ndjson');
  assert.equal(archiveReads.at(-1).pos, originalSize);
});

test('event inbox tails oversized files and rejects malformed or oversized lines without surfacing content', async () => {
  const accepted = { eventId: 'tail-accepted', eventType: 'turn_started' };
  const files = new Map([
    ['events.ndjson', {
      text: `${'x'.repeat(200)}\nnot-json\n${line(accepted)}`,
      createdAt: 1
    }]
  ]);
  const bridge = createBridge(files);
  const received = [];
  const statuses = [];
  const reader = new EventInboxReader({
    bridge,
    onEvent: (event) => received.push(event),
    onStatus: (status) => statuses.push(status),
    maxFileBytes: 100,
    readChunkBytes: 96,
    tailBytes: 96,
    maxLineBytes: 96
  });

  assert.equal(await reader.poll(), 1);
  assert.deepEqual(received.map((event) => event.eventId), ['tail-accepted']);
  assert.ok(bridge.reads.every((read) => read.size <= 96));
  assert.ok(bridge.reads.some((read) => read.pos > 0));
  assert.ok(statuses.some((status) => status.code === 'event_file_oversize'));
  assert.ok(statuses.some((status) => status.code === 'event_inbox_rejected' && status.parseErrors === 1));

  files.set('events.ndjson', {
    text: `${JSON.stringify({ eventId: 'too-large', value: 'x'.repeat(180) })}\n${line({ eventId: 'good', eventType: 'turn_completed' })}`,
    createdAt: 2
  });
  const lineReader = new EventInboxReader({
    bridge,
    onEvent: (event) => received.push(event),
    onStatus: (status) => statuses.push(status),
    maxFileBytes: 1024,
    readChunkBytes: 512,
    maxLineBytes: 96
  });
  assert.equal(await lineReader.readPath('events.ndjson'), 1);
  assert.equal(received.at(-1).eventId, 'good');
  assert.ok(statuses.some((status) => status.code === 'event_inbox_rejected' && status.oversizedLines >= 1));
});
