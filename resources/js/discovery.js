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
  constructor({ bridge, onEvent, onStatus, intervalMs = 900 }) {
    this.bridge = bridge;
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.fileStates = new Map();
    this.reading = false;
  }

  async readPath(path) {
    if (!path) return 0;
    let stats;
    try { stats = await this.bridge.getFileStats(path); } catch { return 0; }
    const size = Number(stats.size || 0);
    const previous = this.fileStates.get(path) || { size: -1, lineCount: 0 };
    if (size === previous.size) return 0;
    const content = await this.bridge.readFile(path);
    const lines = String(content || '').split(/\r?\n/).filter(Boolean);
    const start = size < previous.size ? 0 : Math.min(previous.lineCount, lines.length);
    let applied = 0;
    let parseErrors = 0;
    for (let index = start; index < lines.length; index += 1) {
      try {
        const event = JSON.parse(lines[index]);
        this.onEvent(event);
        applied += 1;
      } catch { parseErrors += 1; }
    }
    this.fileStates.set(path, { size, lineCount: lines.length });
    if (parseErrors) this.onStatus?.({ ok: false, parseErrors, path });
    return applied;
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
