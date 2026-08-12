// Where the overlay must stay clickable, and where it must let the mouse reach the
// application underneath (product rule 6: the animation may never intercept work).
//
// Windows has no per-region hit testing we can reach from a webview, and Neutralino 11.7
// exposes no click-through API, so the whole window is toggled between interactive and
// WS_EX_TRANSPARENT depending on where the cursor is. Everything here is pure so the
// decision can be tested without a desktop.

// Logical pixels, matching the chrome in styles.css: the title bar row plus the resize
// grip band. The approach margin above the bar buys the toggle time to take effect
// before the cursor reaches a button.
export const CHROME = Object.freeze({ bar: 15, approach: 20, edge: 12 });
// Poll quickly enough that a normal move-and-click on X cannot outrun the native
// WS_EX_TRANSPARENT hand-off. This is only a cursor-position query, not a render loop.
export const CLICK_THROUGH_POLL_MS = 50;

/**
 * True when the cursor is over the drawing rather than the chrome, which is when the
 * window has to disappear from hit testing. Outside the window the answer is false: the
 * overlay stays interactive so that entering the title bar from the desktop is instant.
 *
 * `rect` is in physical pixels (GetWindowRect); `scale` converts the logical chrome
 * measurements to physical ones under Windows display scaling.
 */
export function clickThroughAt(cursor, rect, scale = 1, chrome = CHROME) {
  if (!rect || !cursor) return false;
  const { left, top, right, bottom } = rect;
  if (!(right > left && bottom > top)) return false;
  const x = Number(cursor.x);
  const y = Number(cursor.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (x < left || x >= right || y < top || y >= bottom) return false;

  const factor = Number(scale) > 0 ? Number(scale) : 1;
  const barBand = (chrome.bar + chrome.approach) * factor;
  const edgeBand = chrome.edge * factor;
  const onChrome = y < top + barBand
    || x < left + edgeBand
    || x >= right - edgeBand
    || y >= bottom - edgeBand;
  return !onChrome;
}

/** Physical pixels per logical pixel, derived from the measured window rect. */
export function scaleFromRect(rect, logicalWidth) {
  const width = Number(rect?.right) - Number(rect?.left);
  const logical = Number(logicalWidth);
  if (!Number.isFinite(width) || !Number.isFinite(logical) || logical <= 0 || width <= 0) return 1;
  const scale = width / logical;
  // Windows scaling factors live between 1 and 4; anything else means a stale rect.
  return scale >= .5 && scale <= 4 ? scale : 1;
}

/**
 * Tracks only native-confirmed click-through state. A failed Windows call must never be
 * recorded as interactive because that would stop later cleanup attempts while
 * WS_EX_TRANSPARENT may still be set on the real window.
 */
export class ClickThroughGuard {
  constructor(setNative, { failureLimit = 2 } = {}) {
    this.setNative = setNative;
    this.failureLimit = Math.max(1, Number(failureLimit) || 2);
    this.state = null;
    this.rect = null;
    this.failures = 0;
  }

  async callNative(next) {
    try {
      return await this.setNative(next);
    } catch {
      return null;
    }
  }

  record(measured) {
    if (!measured || typeof measured.clickThrough !== 'boolean') return null;
    this.state = measured.clickThrough;
    this.rect = measured;
    this.failures = 0;
    return measured;
  }

  recordFailure() {
    this.failures += 1;
    this.rect = null;
  }

  async request(next) {
    const measured = this.record(await this.callNative(next));
    if (measured) return measured;
    this.recordFailure();
    // The fallback is awaited and its result is verified. Until Windows confirms false,
    // the last confirmed state stays intact and every later poll remains able to retry.
    if (this.failures >= this.failureLimit && next !== false) return this.ensureInteractive();
    return null;
  }

  async ensureInteractive() {
    const measured = this.record(await this.callNative(false));
    if (measured) return measured;
    this.recordFailure();
    return null;
  }

  invalidateRect() {
    this.rect = null;
  }
}
