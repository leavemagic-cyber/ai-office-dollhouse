import { compactOfficeState, DISPLAY_MODES } from './domain.js';

const MODE_FPS = Object.freeze({
  [DISPLAY_MODES.FULL]: 30,
  [DISPLAY_MODES.LOW]: 12,
  [DISPLAY_MODES.DND]: 2,
  [DISPLAY_MODES.IMPORTANT]: 8
});

const LEVELS = Object.freeze(['green', 'yellow', 'orange', 'red']);

export class ResourceLifecycleManager {
  constructor({ state, onLevelChanged, recoveryCooldownMs = 20_000 }) {
    this.state = state;
    this.onLevelChanged = onLevelChanged;
    this.system = { cpuLoadPercent: 0, memoryLoadPercent: 0, onBattery: false };
    this.frameTimes = [];
    this.level = 'green';
    this.recoveryCooldownMs = recoveryCooldownMs;
    this.recoveryCandidate = null;
    this.recoverySince = 0;
    this.hidden = Boolean(globalThis.document?.hidden);
    this.compactionTimer = null;
    this.visibilityHandler = () => {
      this.hidden = Boolean(globalThis.document?.hidden);
      this.onLevelChanged?.(this.level, this.system);
    };
    globalThis.document?.addEventListener('visibilitychange', this.visibilityHandler);
  }

  updateSystemMetrics(metrics = {}, now = Date.now()) {
    this.system = { ...this.system, ...metrics };
    this.evaluateLevel(now);
  }

  recordFrame(durationMs) {
    if (!Number.isFinite(durationMs)) return;
    this.frameTimes.push(durationMs);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    if (this.frameTimes.length % 30 === 0) this.evaluateLevel();
  }

  evaluateLevel(now = Date.now()) {
    const cpu = Number(this.system.cpuLoadPercent || 0);
    const memory = Number(this.system.memoryLoadPercent || 0);
    const frameAverage = this.frameTimes.length
      ? this.frameTimes.reduce((sum, value) => sum + value, 0) / this.frameTimes.length
      : 0;
    let observed = 'green';
    if (cpu >= 90 || memory >= 94 || frameAverage >= 70) observed = 'red';
    else if (cpu >= 75 || memory >= 88 || frameAverage >= 45) observed = 'orange';
    else if (cpu >= 60 || memory >= 80 || this.system.onBattery || frameAverage >= 30) observed = 'yellow';
    const currentRank = LEVELS.indexOf(this.level);
    const observedRank = LEVELS.indexOf(observed);
    let next = this.level;
    if (observedRank > currentRank) {
      next = observed;
      this.recoveryCandidate = null;
      this.recoverySince = 0;
    } else if (observedRank < currentRank) {
      if (this.recoveryCandidate !== observed) {
        this.recoveryCandidate = observed;
        this.recoverySince = now;
      } else if (now - this.recoverySince >= this.recoveryCooldownMs) {
        next = LEVELS[Math.max(observedRank, currentRank - 1)];
        this.recoverySince = now;
      }
    } else {
      this.recoveryCandidate = null;
      this.recoverySince = 0;
    }
    if (next !== this.level) {
      this.level = next;
      this.onLevelChanged?.(next, this.system);
    }
    return this.level;
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

  frameIntervalMs(requestedMode) {
    const fps = this.fps(requestedMode);
    return fps > 0 ? Math.round(1000 / fps) : 1000;
  }

  animationBudget(requestedMode) {
    const mode = this.effectiveMode(requestedMode);
    if (mode === DISPLAY_MODES.FULL) return { movingDollsPerFloor: 2, decorativeMotion: true, signatureMotion: true };
    if (mode === DISPLAY_MODES.LOW) return { movingDollsPerFloor: 1, decorativeMotion: true, signatureMotion: true };
    if (mode === DISPLAY_MODES.IMPORTANT) return { movingDollsPerFloor: 0, decorativeMotion: false, signatureMotion: true };
    return { movingDollsPerFloor: 0, decorativeMotion: false, signatureMotion: true };
  }

  startCompaction() {
    if (this.compactionTimer) clearInterval(this.compactionTimer);
    this.compactionTimer = setInterval(() => compactOfficeState(this.state, Date.now()), 60_000);
  }

  dispose() {
    if (this.compactionTimer) clearInterval(this.compactionTimer);
    this.compactionTimer = null;
    globalThis.document?.removeEventListener('visibilitychange', this.visibilityHandler);
    this.frameTimes.length = 0;
  }
}
