import { compactOfficeState, DISPLAY_MODES } from './domain.js';

const MODE_FPS = Object.freeze({
  [DISPLAY_MODES.FULL]: 16,
  [DISPLAY_MODES.LOW]: 6,
  [DISPLAY_MODES.DND]: 1,
  [DISPLAY_MODES.IMPORTANT]: 4
});

export class ResourceLifecycleManager {
  constructor({ state, onLevelChanged }) {
    this.state = state;
    this.onLevelChanged = onLevelChanged;
    this.system = { cpuLoadPercent: 0, memoryLoadPercent: 0, onBattery: false };
    this.frameTimes = [];
    this.level = 'green';
    this.hidden = document.hidden;
    this.compactionTimer = null;
    this.visibilityHandler = () => { this.hidden = document.hidden; };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  updateSystemMetrics(metrics = {}) {
    this.system = { ...this.system, ...metrics };
    this.evaluateLevel();
  }

  recordFrame(durationMs) {
    if (!Number.isFinite(durationMs)) return;
    this.frameTimes.push(durationMs);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    if (this.frameTimes.length % 30 === 0) this.evaluateLevel();
  }

  evaluateLevel() {
    const cpu = Number(this.system.cpuLoadPercent || 0);
    const memory = Number(this.system.memoryLoadPercent || 0);
    const frameAverage = this.frameTimes.length
      ? this.frameTimes.reduce((sum, value) => sum + value, 0) / this.frameTimes.length
      : 0;
    let next = 'green';
    if (cpu >= 90 || memory >= 94 || frameAverage >= 70) next = 'red';
    else if (cpu >= 75 || memory >= 88 || frameAverage >= 45) next = 'orange';
    else if (cpu >= 60 || memory >= 80 || this.system.onBattery || frameAverage >= 30) next = 'yellow';
    if (next !== this.level) {
      this.level = next;
      this.onLevelChanged?.(next, this.system);
    }
    return next;
  }

  effectiveMode(requestedMode) {
    if (this.hidden) return DISPLAY_MODES.DND;
    if (!this.state.settings.autoProtect) return requestedMode;
    if (requestedMode === DISPLAY_MODES.DND || requestedMode === DISPLAY_MODES.IMPORTANT) return requestedMode;
    if (this.level === 'red') return DISPLAY_MODES.IMPORTANT;
    if (this.level === 'orange' || this.level === 'yellow') return DISPLAY_MODES.LOW;
    return requestedMode;
  }

  fps(requestedMode) {
    if (this.hidden) return 0;
    return MODE_FPS[this.effectiveMode(requestedMode)] || 10;
  }

  animationBudget(requestedMode) {
    const mode = this.effectiveMode(requestedMode);
    if (mode === DISPLAY_MODES.FULL) return { movingDolls: 8, particles: 24, majorAnimation: true };
    if (mode === DISPLAY_MODES.LOW) return { movingDolls: 3, particles: 4, majorAnimation: false };
    if (mode === DISPLAY_MODES.IMPORTANT) return { movingDolls: 2, particles: 0, majorAnimation: false };
    return { movingDolls: 0, particles: 0, majorAnimation: false };
  }

  startCompaction() {
    if (this.compactionTimer) clearInterval(this.compactionTimer);
    this.compactionTimer = setInterval(() => compactOfficeState(this.state, Date.now()), 60_000);
  }

  dispose() {
    if (this.compactionTimer) clearInterval(this.compactionTimer);
    this.compactionTimer = null;
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.frameTimes.length = 0;
  }
}
