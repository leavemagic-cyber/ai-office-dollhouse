const PROVIDER_ALLOWLIST = new Set(['codex', 'claude', 'gemini', 'grok', 'all']);
const ACTION_ALLOWLIST = new Set(['status', 'install']);
const SNAPSHOT_PROVIDERS = ['codex', 'claude', 'gemini', 'grok'];
const INSTANCE_STALE_MS = 45_000;
const INSTANCE_HEARTBEAT_MS = 10_000;

function quoteWindows(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function lastJsonLine(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]); } catch { /* try prior line */ }
  }
  throw new Error('Native command did not return JSON');
}

function unavailableSnapshot() {
  return {
    schemaVersion: 1,
    generatedAt: Date.now(),
    truth: '既有工作快照目前不可用；只顯示可靠的即時事件。',
    providers: Object.fromEntries(SNAPSHOT_PROVIDERS.map((provider) => [provider, {
      available: false,
      source: '既有工作快照不可用',
      work: []
    }]))
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class NativeBridge {
  constructor() {
    this.isNative = typeof globalThis.Neutralino !== 'undefined' && typeof globalThis.NL_PATH !== 'undefined';
    this.appRoot = this.isNative ? globalThis.NL_PATH : '';
    this.dataDirectory = null;
    this.instanceLockDirectory = '';
    this.instanceLockFile = '';
    this.instanceToken = '';
    this.instanceProcessId = null;
    this.instanceAcquired = false;
    this.instanceHeartbeatTimer = null;
    this.modelWritePromise = Promise.resolve();
  }

  async initialize() {
    if (!this.isNative) return true;
    globalThis.Neutralino.init();
    globalThis.Neutralino.events.on('windowClose', async () => {
      await this.releaseSingleInstance();
      globalThis.Neutralino.app.exit();
    });
    const localAppData = await globalThis.Neutralino.os.getEnv('LOCALAPPDATA');
    this.dataDirectory = `${localAppData}\\AIOfficeDollhouse`;
    try { await globalThis.Neutralino.filesystem.createDirectory(this.dataDirectory); } catch { /* already exists */ }
    const rawPid = await globalThis.Neutralino.app.getProcessId();
    const processId = Number(rawPid?.id ?? rawPid);
    if (!Number.isInteger(processId) || processId <= 0) throw new Error('Invalid application process ID');
    this.instanceProcessId = processId;
    if (await this.acquireSingleInstance()) return true;
    await globalThis.Neutralino.os.showMessageBox(
      'AI 玩偶辦公室',
      'AI 玩偶辦公室已在執行中；不會再啟動第二個浮層。',
      'OK',
      'INFO'
    );
    await globalThis.Neutralino.app.exit();
    return false;
  }

  async readInstanceOwner() {
    try {
      const parsed = JSON.parse(await globalThis.Neutralino.filesystem.readFile(this.instanceLockFile));
      const processId = Number(parsed?.processId);
      const heartbeatAt = Number(parsed?.heartbeatAt);
      const token = typeof parsed?.token === 'string' ? parsed.token : '';
      if (!Number.isInteger(processId) || processId <= 0 || !Number.isFinite(heartbeatAt) || !token) return null;
      return { processId, heartbeatAt, token };
    } catch {
      return null;
    }
  }

  async isProcessRunning(processId) {
    if (!Number.isInteger(processId) || processId <= 0 || !this.isNative) return false;
    try {
      const result = await globalThis.Neutralino.os.execCommand(
        `tasklist.exe /FI "PID eq ${processId}" /NH`,
        { background: false }
      );
      return new RegExp(`\\b${processId}\\b`).test(String(result?.stdOut || ''));
    } catch {
      // If Windows cannot confirm a process is gone, preserve the existing lock.
      return true;
    }
  }

  async removeStaleInstanceLock() {
    try { await globalThis.Neutralino.filesystem.remove(this.instanceLockFile); } catch { /* absent or already removed */ }
    try { await globalThis.Neutralino.filesystem.remove(this.instanceLockDirectory); } catch { /* another instance won the race */ }
  }

  async writeInstanceHeartbeat({ initial = false } = {}) {
    if (!this.instanceAcquired || !this.instanceToken || !this.instanceProcessId) return false;
    if (!initial) {
      const owner = await this.readInstanceOwner();
      if (!owner || owner.processId !== this.instanceProcessId || owner.token !== this.instanceToken) {
        this.instanceAcquired = false;
        if (this.instanceHeartbeatTimer) clearInterval(this.instanceHeartbeatTimer);
        this.instanceHeartbeatTimer = null;
        return false;
      }
    }
    await globalThis.Neutralino.filesystem.writeFile(this.instanceLockFile, JSON.stringify({
      schemaVersion: 1,
      processId: this.instanceProcessId,
      token: this.instanceToken,
      heartbeatAt: Date.now()
    }));
    return true;
  }

  async acquireSingleInstance() {
    if (!this.isNative) return true;
    this.instanceLockDirectory = `${this.dataDirectory}\\instance.lock`;
    this.instanceLockFile = `${this.instanceLockDirectory}\\owner.json`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await globalThis.Neutralino.filesystem.createDirectory(this.instanceLockDirectory);
        this.instanceToken = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
        this.instanceAcquired = true;
        await this.writeInstanceHeartbeat({ initial: true });
        const owner = await this.readInstanceOwner();
        if (owner?.processId === this.instanceProcessId && owner.token === this.instanceToken) {
          this.instanceHeartbeatTimer = setInterval(() => {
            this.writeInstanceHeartbeat().catch(() => {});
          }, INSTANCE_HEARTBEAT_MS);
          return true;
        }
        this.instanceAcquired = false;
      } catch { /* inspect the lock owner below */ }

      // A competing process may have just created the directory and be writing
      // its owner marker. Never remove a fresh markerless directory.
      await sleep(120);
      const owner = await this.readInstanceOwner();
      if (owner) {
        if (await this.isProcessRunning(owner.processId)) return false;
        // A valid owner marker whose PID is gone is stale immediately; the
        // heartbeat age only protects a markerless creation race below.
        await this.removeStaleInstanceLock();
        continue;
      }
      if (!owner) {
        try {
          const stats = await globalThis.Neutralino.filesystem.getStats(this.instanceLockDirectory);
          if (Date.now() - Number(stats.modifiedAt || 0) < INSTANCE_STALE_MS) return false;
        } catch {
          return false;
        }
      }
      await this.removeStaleInstanceLock();
    }
    return false;
  }

  async releaseSingleInstance() {
    if (this.instanceHeartbeatTimer) clearInterval(this.instanceHeartbeatTimer);
    this.instanceHeartbeatTimer = null;
    if (!this.isNative || !this.instanceAcquired) return;
    const owner = await this.readInstanceOwner();
    if (owner?.processId === this.instanceProcessId && owner.token === this.instanceToken) {
      await this.removeStaleInstanceLock();
    }
    this.instanceAcquired = false;
    this.instanceToken = '';
  }

  scriptPath(name) {
    if (!/^[a-z0-9-]+\.ps1$/i.test(name)) throw new Error('Invalid internal script name');
    return `${this.appRoot}\\scripts\\${name}`;
  }

  async runPowerShell(scriptName, namedArgs = {}) {
    if (!this.isNative) return { exitCode: 0, stdOut: '{}', stdErr: '' };
    const script = this.scriptPath(scriptName);
    const args = Object.entries(namedArgs).flatMap(([key, value]) => {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) throw new Error('Invalid internal argument name');
      const text = String(value);
      if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('Invalid internal argument value');
      return [`-${key}`, text];
    });
    const command = [
      quoteWindows('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'),
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      quoteWindows(script),
      ...args
    ].join(' ');
    return globalThis.Neutralino.os.execCommand(command, { background: false });
  }

  async runNodeScript(scriptName) {
    if (!this.isNative) return { exitCode: 0, stdOut: '{}', stdErr: '' };
    if (!/^[a-z0-9-]+\.mjs$/i.test(scriptName)) throw new Error('Invalid internal Node script name');
    const bundledNode = `${this.appRoot}\\runtime\\node.exe`;
    let executable = 'node.exe';
    try {
      if ((await globalThis.Neutralino.filesystem.getStats(bundledNode)).isFile) executable = quoteWindows(bundledNode);
    } catch { /* a developer installation can use its system Node runtime */ }
    const command = [
      executable,
      '--no-warnings',
      quoteWindows(`${this.appRoot}\\scripts\\${scriptName}`)
    ].join(' ');
    return globalThis.Neutralino.os.execCommand(command, { background: false });
  }

  async discover() {
    const result = await this.runPowerShell('discover.ps1');
    if (Number(result.exitCode) !== 0) throw new Error(result.stdErr || 'Discovery failed');
    return lastJsonLine(result.stdOut);
  }

  async lowerOwnPriority() {
    if (!this.isNative) return { ok: false, changed: 0 };
    const rawPid = await globalThis.Neutralino.app.getProcessId();
    const processId = Number(rawPid?.id ?? rawPid);
    if (!Number.isInteger(processId) || processId <= 0) throw new Error('Invalid application process ID');
    const result = await this.runPowerShell('set-low-priority.ps1', { ProcessId: processId });
    if (Number(result.exitCode) !== 0) throw new Error(result.stdErr || 'Priority setup failed');
    return lastJsonLine(result.stdOut);
  }

  /** Primary work area in logical pixels: the same units window.move and setSize use. */
  async screenMetrics() {
    const result = await this.runPowerShell('screen-metrics.ps1');
    if (Number(result.exitCode) !== 0) throw new Error(result.stdErr || 'Screen metrics failed');
    return lastJsonLine(result.stdOut);
  }

  /** Average wallpaper luminance, so the sketch overlay can flip between ink and white. */
  /**
   * Adds or removes WS_EX_TRANSPARENT on the overlay window and reports the window rect
   * in physical pixels. `on = null` only measures. Returns null when the native layer is
   * unavailable, so the caller can keep the overlay interactive rather than guess.
   */
  async setClickThrough(on = null) {
    if (!this.isNative) return null;
    try {
      const processId = await globalThis.Neutralino.app.getProcessId();
      const result = await this.runPowerShell('set-click-through.ps1', {
        ProcessId: Math.trunc(Number(processId) || 0),
        On: on === null ? '-1' : (on ? 1 : 0)
      });
      const payload = lastJsonLine(result.stdOut);
      return payload?.ok ? payload : null;
    } catch {
      return null;
    }
  }

  async mousePosition() {
    if (!this.isNative) return null;
    try {
      return await globalThis.Neutralino.computer.getMousePosition();
    } catch {
      return null;
    }
  }

  async desktopLuminance() {
    const result = await this.runPowerShell('desktop-luminance.ps1');
    if (Number(result.exitCode) !== 0) throw new Error(result.stdErr || 'Luminance probe failed');
    return lastJsonLine(result.stdOut);
  }

  async integrationStatus() {
    const result = await this.runPowerShell('install-integrations.ps1', { Provider: 'all', Action: 'status' });
    return lastJsonLine(result.stdOut);
  }

  async existingWorkSnapshot() {
    try {
      const result = await this.runNodeScript('snapshot-work.mjs');
      if (Number(result.exitCode) !== 0) return unavailableSnapshot();
      return lastJsonLine(result.stdOut);
    } catch {
      // Snapshot support is optional. A missing helper must never prevent real
      // hook events, discovery, or the low-impact overlay from starting.
      return unavailableSnapshot();
    }
  }

  async installIntegration(provider) {
    if (!PROVIDER_ALLOWLIST.has(provider) || provider === 'all') throw new Error('Unsupported provider');
    const action = 'install';
    if (!ACTION_ALLOWLIST.has(action)) throw new Error('Unsupported action');
    const result = await this.runPowerShell('install-integrations.ps1', { Provider: provider, Action: action });
    const parsed = lastJsonLine(result.stdOut);
    if (Number(result.exitCode) !== 0 || !parsed.ok) throw new Error(parsed.error || result.stdErr || 'Integration install failed');
    return parsed;
  }

  async setAlwaysOnTop(enabled) {
    if (this.isNative) await globalThis.Neutralino.window.setAlwaysOnTop(Boolean(enabled));
  }

  async currentWindowTitle() {
    return this.isNative ? globalThis.Neutralino.window.getTitle() : document.title;
  }

  async configureCurrentWindow({ title, width, height, x, y, alwaysOnTop = false }) {
    if (!this.isNative) return;
    await globalThis.Neutralino.window.setTitle(title);
    await globalThis.Neutralino.window.setBorderless(true);
    await globalThis.Neutralino.window.setSize({ width, height });
    if (Number.isFinite(x) && Number.isFinite(y)) await globalThis.Neutralino.window.move(x, y);
    await globalThis.Neutralino.window.setAlwaysOnTop(Boolean(alwaysOnTop));
  }

  async setCurrentWindowSize(width, height) {
    if (!this.isNative) return;
    await globalThis.Neutralino.window.setSize({ width: Math.round(width), height: Math.round(height) });
  }

  async moveCurrentWindow(x, y) {
    if (!this.isNative) return;
    await globalThis.Neutralino.window.move(Math.round(x), Math.round(y));
  }

  async currentWindowSize() {
    if (!this.isNative) return { width: window.innerWidth, height: window.innerHeight };
    return globalThis.Neutralino.window.getSize();
  }

  async currentWindowPosition() {
    if (!this.isNative) return { x: 0, y: 0 };
    return globalThis.Neutralino.window.getPosition();
  }

  async makeDraggable(element, exclude = []) {
    if (this.isNative) await globalThis.Neutralino.window.setDraggableRegion(element, { exclude });
  }

  async minimize() { if (this.isNative) await globalThis.Neutralino.window.minimize(); }
  async hide() { if (this.isNative) await globalThis.Neutralino.window.hide(); }
  async show({ focus = false } = {}) {
    if (!this.isNative) return;
    // A user-minimized overlay is an explicit "do not disturb" choice. Do not
    // revive it merely because another work event arrives.
    let minimized = false;
    try { minimized = await globalThis.Neutralino.window.isMinimized(); } catch { /* best effort */ }
    if (minimized) return;
    await globalThis.Neutralino.window.show();
    if (focus) await globalThis.Neutralino.window.focus();
  }
  async close() {
    if (!this.isNative) return;
    await this.releaseSingleInstance();
    await globalThis.Neutralino.app.exit();
  }
  async snapshot(path) { if (this.isNative) await globalThis.Neutralino.window.snapshot(path); }

  on(name, handler) {
    if (this.isNative) globalThis.Neutralino.events.on(name, (event) => handler(event.detail));
  }

  async broadcast(name, detail = {}) {
    if (this.isNative) await globalThis.Neutralino.events.broadcast(name, detail);
  }

  async getFileStats(path) {
    if (!this.isNative) throw new Error('Native file access unavailable');
    return globalThis.Neutralino.filesystem.getStats(path);
  }

  async readFile(path, options = undefined) {
    if (!this.isNative) return '';
    return globalThis.Neutralino.filesystem.readFile(path, options);
  }

  eventFile(name = 'events.ndjson') {
    return this.dataDirectory ? `${this.dataDirectory}\\${name}` : '';
  }

  sharedModelFile() {
    return this.dataDirectory ? `${this.dataDirectory}\\office-state-v2.json` : '';
  }

  async writeSharedModel(model) {
    if (!this.isNative) return;
    const target = this.sharedModelFile();
    const temporary = `${target}.next`;
    const payload = JSON.stringify(model);
    const write = async () => {
      await globalThis.Neutralino.filesystem.writeFile(temporary, payload);
      // Neutralino's move API intentionally has no overwrite flag. A short
      // missing-file interval is safe (`readSharedModel` returns null), while
      // this ordered replacement prevents readers from seeing half-written JSON.
      try { await globalThis.Neutralino.filesystem.remove(target); } catch { /* first write or already absent */ }
      await globalThis.Neutralino.filesystem.move(temporary, target);
    };
    const queued = this.modelWritePromise.catch(() => {}).then(write);
    this.modelWritePromise = queued.catch((error) => {
      this.log('warn', `Shared model refresh skipped: ${String(error?.code || 'write failed')}`);
    });
    await this.modelWritePromise;
  }

  async readSharedModel() {
    if (!this.isNative) return null;
    try {
      const raw = await globalThis.Neutralino.filesystem.readFile(this.sharedModelFile());
      return JSON.parse(raw);
    } catch { return null; }
  }

  async memoryInfo() {
    if (!this.isNative) return null;
    try { return await globalThis.Neutralino.computer.getMemoryInfo(); } catch { return null; }
  }

  log(level, message) {
    if (this.isNative) {
      globalThis.Neutralino.debug.log(String(message), String(level || 'INFO').toUpperCase()).catch(() => {});
    } else {
      console.log(`[${level}] ${message}`);
    }
  }
}

export { lastJsonLine };
