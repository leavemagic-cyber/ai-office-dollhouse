const PROVIDER_ALLOWLIST = new Set(['codex', 'claude', 'gemini', 'grok', 'all']);
const ACTION_ALLOWLIST = new Set(['status', 'install']);

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

export class NativeBridge {
  constructor() {
    this.isNative = typeof globalThis.Neutralino !== 'undefined' && typeof globalThis.NL_PATH !== 'undefined';
    this.appRoot = this.isNative ? globalThis.NL_PATH : '';
    this.dataDirectory = null;
  }

  async initialize() {
    if (!this.isNative) return;
    globalThis.Neutralino.init();
    globalThis.Neutralino.events.on('windowClose', () => globalThis.Neutralino.app.exit());
    const localAppData = await globalThis.Neutralino.os.getEnv('LOCALAPPDATA');
    this.dataDirectory = `${localAppData}\\AIOfficeDollhouse`;
    try { await globalThis.Neutralino.filesystem.createDirectory(this.dataDirectory); } catch { /* already exists */ }
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

  async integrationStatus() {
    const result = await this.runPowerShell('install-integrations.ps1', { Provider: 'all', Action: 'status' });
    return lastJsonLine(result.stdOut);
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

  async confirmIntegration(providerLabel) {
    if (!this.isNative) return false;
    const result = await globalThis.Neutralino.os.showMessageBox(
      '啟用精準偵測',
      `將備份既有設定，加入 ${providerLabel} 的唯讀生命週期 hook。hook 不讀取 prompt、回覆或 transcript，只記錄安全化的 session、狀態及上下級識別。是否繼續？`,
      'YES_NO',
      'QUESTION'
    );
    return String(result).toUpperCase() === 'YES';
  }

  async setAlwaysOnTop(enabled) {
    if (this.isNative) await globalThis.Neutralino.window.setAlwaysOnTop(Boolean(enabled));
  }

  async getFileStats(path) {
    if (!this.isNative) throw new Error('Native file access unavailable');
    return globalThis.Neutralino.filesystem.getStats(path);
  }

  async readFile(path) {
    if (!this.isNative) return '';
    return globalThis.Neutralino.filesystem.readFile(path);
  }

  eventFile(name = 'events.ndjson') {
    return this.dataDirectory ? `${this.dataDirectory}\\${name}` : '';
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
