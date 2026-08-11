function surfaceEvent(surface, timestamp) {
  const stateKey = [surface.installed, surface.appOpen, surface.processState, surface.version].join(':');
  return {
    eventId: `presence:${surface.surfaceId}:${stateKey}`,
    timestamp,
    provider: surface.provider,
    surfaceId: surface.surfaceId,
    surfaceKind: surface.surfaceKind,
    eventType: 'surface_discovered',
    installed: Boolean(surface.installed),
    appOpen: Boolean(surface.appOpen),
    processState: surface.processState || 'unknown',
    version: surface.version || '',
    executablePath: surface.executableName || '',
    observationTier: 'D',
    sourceConfidence: surface.presenceConfidence || 'unknown'
  };
}

const DEFAULT_MAX_EVENT_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_EVENT_READ_CHUNK_BYTES = 64 * 1024;
const DEFAULT_EVENT_TAIL_BYTES = 64 * 1024;
const DEFAULT_EVENT_LINE_BYTES = 64 * 1024;
const EVENT_IDENTITY_PROBE_BYTES = 512;
const textEncoder = typeof TextEncoder === 'undefined' ? null : new TextEncoder();
const hasTextDecoder = typeof TextDecoder !== 'undefined';

function positiveInteger(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function utf8ByteLength(value) {
  const text = String(value || '');
  return textEncoder ? textEncoder.encode(text).byteLength : text.length;
}

function fingerprintBytes(bytes) {
  let hash = 2_166_136_261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16_777_619);
  }
  return `${bytes.byteLength}:${(hash >>> 0).toString(16)}`;
}

function fingerprintText(value) {
  const text = String(value || '');
  if (textEncoder) return fingerprintBytes(textEncoder.encode(text));
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

function fingerprintByteCount(fingerprint) {
  const match = /^(\d+):[0-9a-f]+$/i.exec(String(fingerprint || ''));
  const bytes = Number(match?.[1]);
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0;
}

function createdAtFor(stats) {
  const createdAt = Number(stats?.createdAt);
  return Number.isFinite(createdAt) && createdAt >= 0 ? createdAt : null;
}

function emptyFileState(createdAt = null) {
  return {
    size: -1,
    cursor: 0,
    pending: '',
    discardLeadingPartial: false,
    createdAt,
    tailFingerprint: null,
    decoder: hasTextDecoder ? new TextDecoder('utf-8') : null
  };
}

export class AutoDiscovery {
  constructor({ bridge, onEvent, onSystemMetrics, onStatus, intervalMs = 30_000 }) {
    this.bridge = bridge;
    this.onEvent = onEvent;
    this.onSystemMetrics = onSystemMetrics;
    this.onStatus = onStatus;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.running = false;
  }

  async scan({ force = false } = {}) {
    if (!force && typeof document !== 'undefined' && document.hidden) return null;
    if (this.running) return null;
    this.running = true;
    try {
      const result = await this.bridge.discover();
      const timestamp = Number(result.timestamp) || Date.now();
      for (const surface of result.surfaces || []) this.onEvent(surfaceEvent(surface, timestamp));
      this.onSystemMetrics?.(result.system || {});
      this.onStatus?.({ ok: true, lastScanAt: timestamp, error: null });
      return result;
    } catch (error) {
      this.onStatus?.({ ok: false, lastScanAt: Date.now(), error: String(error.message || error) });
      return null;
    } finally {
      this.running = false;
    }
  }

  start() {
    this.stop();
    this.scan({ force: true });
    this.timer = setInterval(() => this.scan(), this.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export class EventInboxReader {
  constructor({
    bridge,
    onEvent,
    onStatus,
    intervalMs = 900,
    maxFileBytes = DEFAULT_MAX_EVENT_FILE_BYTES,
    readChunkBytes = DEFAULT_EVENT_READ_CHUNK_BYTES,
    tailBytes = DEFAULT_EVENT_TAIL_BYTES,
    maxLineBytes = DEFAULT_EVENT_LINE_BYTES
  }) {
    this.bridge = bridge;
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.intervalMs = intervalMs;
    this.maxFileBytes = positiveInteger(maxFileBytes, DEFAULT_MAX_EVENT_FILE_BYTES);
    this.readChunkBytes = Math.min(
      positiveInteger(readChunkBytes, DEFAULT_EVENT_READ_CHUNK_BYTES),
      this.maxFileBytes
    );
    this.tailBytes = Math.max(
      this.readChunkBytes,
      positiveInteger(tailBytes, DEFAULT_EVENT_TAIL_BYTES)
    );
    this.maxLineBytes = positiveInteger(maxLineBytes, DEFAULT_EVENT_LINE_BYTES);
    this.timer = null;
    this.fileStates = new Map();
    this.reading = false;
  }

  reportIssue(path, code, details = {}) {
    this.onStatus?.({ ok: false, path, code, ...details });
  }

  async readSegment(path, pos, size, state) {
    const options = { pos, size };
    const filesystem = globalThis.Neutralino?.filesystem;
    if (state.decoder && typeof filesystem?.readBinaryFile === 'function') {
      const binary = await filesystem.readBinaryFile(path, options);
      const bytes = binary instanceof ArrayBuffer
        ? new Uint8Array(binary)
        : ArrayBuffer.isView(binary) ? new Uint8Array(binary.buffer, binary.byteOffset, binary.byteLength) : new Uint8Array();
      return {
        content: state.decoder.decode(bytes, { stream: true }),
        bytesRead: bytes.byteLength,
        tailFingerprint: fingerprintBytes(bytes.subarray(Math.max(0, bytes.byteLength - EVENT_IDENTITY_PROBE_BYTES)))
      };
    }
    if (typeof filesystem?.readFile === 'function') {
      const content = await filesystem.readFile(path, options);
      const text = String(content || '');
      return {
        content: text,
        bytesRead: utf8ByteLength(text),
        tailFingerprint: fingerprintText(text.slice(-EVENT_IDENTITY_PROBE_BYTES))
      };
    }
    const content = await this.bridge.readFile(path, options);
    const text = String(content || '');
    return {
      content: text,
      bytesRead: utf8ByteLength(text),
      tailFingerprint: fingerprintText(text.slice(-EVENT_IDENTITY_PROBE_BYTES))
    };
  }

  async readIdentityFingerprint(path, pos, size) {
    const filesystem = globalThis.Neutralino?.filesystem;
    if (typeof filesystem?.readBinaryFile === 'function') {
      const binary = await filesystem.readBinaryFile(path, { pos, size });
      const bytes = binary instanceof ArrayBuffer
        ? new Uint8Array(binary)
        : ArrayBuffer.isView(binary) ? new Uint8Array(binary.buffer, binary.byteOffset, binary.byteLength) : new Uint8Array();
      return fingerprintBytes(bytes);
    }
    const content = typeof filesystem?.readFile === 'function'
      ? await filesystem.readFile(path, { pos, size })
      : await this.bridge.readFile(path, { pos, size });
    return fingerprintText(content);
  }

  consumeChunk(state, content) {
    const result = { applied: 0, parseErrors: 0, oversizedLines: 0, dispatchErrors: 0 };
    let text = `${state.pending}${String(content || '')}`;
    state.pending = '';

    if (state.discardLeadingPartial) {
      const firstNewline = text.indexOf('\n');
      if (firstNewline < 0) {
        if (utf8ByteLength(text) > this.maxLineBytes) result.oversizedLines += 1;
        else state.pending = text;
        return result;
      }
      text = text.slice(firstNewline + 1);
      state.discardLeadingPartial = false;
    }

    const lines = text.split('\n');
    const pending = lines.pop() || '';
    for (const rawLine of lines) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (!line) continue;
      if (utf8ByteLength(line) > this.maxLineBytes) {
        result.oversizedLines += 1;
        continue;
      }
      try {
        const event = JSON.parse(line);
        if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('event must be an object');
        try {
          this.onEvent(event);
          result.applied += 1;
        } catch {
          result.dispatchErrors += 1;
        }
      } catch {
        result.parseErrors += 1;
      }
    }

    if (utf8ByteLength(pending) > this.maxLineBytes) {
      state.discardLeadingPartial = true;
      result.oversizedLines += 1;
    } else {
      state.pending = pending;
    }
    return result;
  }

  async readPath(path) {
    if (!path) return 0;
    let stats;
    try { stats = await this.bridge.getFileStats(path); } catch {
      this.fileStates.delete(path);
      return 0;
    }
    if (stats?.isFile === false) {
      this.reportIssue(path, 'event_file_not_regular');
      return 0;
    }
    const size = Number(stats?.size);
    if (!Number.isSafeInteger(size) || size < 0) {
      this.reportIssue(path, 'event_file_invalid_size');
      return 0;
    }

    const createdAt = createdAtFor(stats);
    let state = this.fileStates.get(path) || emptyFileState(createdAt);
    let wasReplaced = size < state.size
      || size < state.cursor
      || (createdAt !== null && state.createdAt !== null && createdAt !== state.createdAt);
    // A writer can replace an archive with a larger file at the same path. If
    // creation metadata is unavailable or unchanged, compare a bounded hash
    // of the old end-of-file before treating growth as a normal append.
    if (!wasReplaced && size > state.size && state.cursor >= state.size && state.tailFingerprint) {
      // The final read can be shorter than the standard 512-byte probe. Keep
      // the probe length aligned with the stored fingerprint so ordinary
      // multi-chunk appends never look like a replacement.
      const probeSize = Math.min(state.size, fingerprintByteCount(state.tailFingerprint));
      if (probeSize > 0) {
        try {
          const fingerprint = await this.readIdentityFingerprint(path, state.size - probeSize, probeSize);
          wasReplaced = fingerprint !== state.tailFingerprint;
        } catch {
          // The later incremental read remains safe; retry identity probing on
          // the next observed growth rather than exposing filesystem details.
        }
      }
    }
    if (wasReplaced) state = emptyFileState(createdAt);
    if (size === state.size && state.cursor >= size) return 0;

    let start = Math.min(state.cursor, size);
    if (size > this.maxFileBytes) {
      const tailStart = Math.max(0, size - this.tailBytes);
      if (start < tailStart) {
        const skippedBytes = tailStart - start;
        start = tailStart;
        state.cursor = start;
        state.pending = '';
        state.discardLeadingPartial = start > 0;
        this.reportIssue(path, 'event_file_oversize', { skippedBytes });
      }
    }

    const requestedBytes = Math.min(this.readChunkBytes, size - start);
    if (requestedBytes <= 0) {
      state.size = size;
      state.createdAt = createdAt;
      this.fileStates.set(path, state);
      return 0;
    }

    let segment;
    try {
      segment = await this.readSegment(path, start, requestedBytes, state);
    } catch {
      this.reportIssue(path, 'event_file_read_failed');
      return 0;
    }

    const consumedBytes = Math.min(requestedBytes, Math.max(0, Number(segment.bytesRead) || 0));
    state.cursor = Math.min(size, start + consumedBytes);
    state.size = size;
    state.createdAt = createdAt;
    if (state.cursor >= size) state.tailFingerprint = segment.tailFingerprint || null;
    const result = this.consumeChunk(state, segment.content);
    this.fileStates.set(path, state);
    if (result.parseErrors || result.oversizedLines || result.dispatchErrors) {
      this.reportIssue(path, 'event_inbox_rejected', {
        parseErrors: result.parseErrors,
        oversizedLines: result.oversizedLines,
        dispatchErrors: result.dispatchErrors
      });
    }
    return result.applied;
  }

  async poll() {
    if (this.reading || !this.bridge.isNative) return 0;
    this.reading = true;
    try {
      const archived = await this.readPath(this.bridge.eventFile('events.1.ndjson'));
      const current = await this.readPath(this.bridge.eventFile('events.ndjson'));
      const total = archived + current;
      if (total) this.onStatus?.({ ok: true, applied: total, at: Date.now() });
      return total;
    } finally {
      this.reading = false;
    }
  }

  start() {
    this.stop();
    this.poll();
    this.timer = setInterval(() => this.poll(), this.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
