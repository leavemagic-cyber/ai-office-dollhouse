import {
  applyOfficeEvent,
  createInitialState,
  degradeStaleSessions,
  DISPLAY_MODES,
  safeLabel
} from './domain.js';
import { AutoDiscovery, EventInboxReader } from './discovery.js';
import { NativeBridge } from './native-bridge.js';
import { globalChoreography } from './choreography.js';
import {
  annexCountForDisplay,
  currentPresenceOpen,
  floorPopulationForDisplay,
  floorSpecsForModel,
  livePodsForDisplay,
  SHARED_FLOOR_KEY,
  sharedFloorSessions
} from './floor-layout.js';
import { ROOM_META, RoomRenderer, SINGLE_FLOOR_CAPACITY, SINGLE_FLOOR_KEY, totalOccupants } from './renderer.js';
import { ClickThroughGuard, clickThroughAt, scaleFromRect } from './click-through.js';
import { PLATE } from './sketch.js';
import { ResourceLifecycleManager } from './resource-manager.js';

const bridge = new NativeBridge();
const MIN_OVERLAY_WIDTH = 118;
const MAX_OVERLAY_WIDTH = 360;
const MIN_OVERLAY_HEIGHT = 82;
const MAX_OVERLAY_HEIGHT = 720;
// Owner picked this size and the bottom-right corner on 2026-08-11 after seeing it live.
// A user's own move or resize still wins over both.
const DEFAULT_OVERLAY_WIDTH = 240;
const OVERLAY_EDGE_GAP = 8;
// One floor gets the room several floors would have taken, so the office is legible.
const SINGLE_FLOOR_ZOOM = 1.5;
// Backing store is supersampled so the 0.4-0.9px sketch strokes stay crisp on any DPI.
const SKETCH_SUPERSAMPLE = Math.min(4, Math.max(2, Math.round((globalThis.devicePixelRatio || 1) * 2)));
const FLOOR_CANVAS_WIDTH = Math.round(PLATE.logicalWidth * SKETCH_SUPERSAMPLE);
const FLOOR_CANVAS_HEIGHT = Math.round(PLATE.logicalHeight * SKETCH_SUPERSAMPLE);
// Bumped when the default geometry changes; older saved layouts are re-seeded once.
const LAYOUT_VERSION = 5;

function boundedInteger(value, fallback, minimum, maximum) {
  const numeric = Math.round(Number(value));
  return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback;
}

function defaultOverlayWidth() {
  const workArea = Number(globalThis.screen?.availWidth) || 1_920;
  // Never let the default swallow a small screen: cap it at a quarter of the work area.
  const cap = Math.min(MAX_OVERLAY_WIDTH, Math.round(workArea * .25));
  return boundedInteger(Math.min(DEFAULT_OVERLAY_WIDTH, cap), DEFAULT_OVERLAY_WIDTH, MIN_OVERLAY_WIDTH, MAX_OVERLAY_WIDTH);
}

/**
 * The webview's CSS pixels and the native window's logical pixels drift apart under
 * Windows display scaling, and Neutralino moves windows in physical pixels while sizing
 * them in logical ones. The screen edge is therefore read natively, not guessed.
 */
function bottomRightWindowPosition(metrics, widthLogical, heightLogical) {
  if (!metrics?.ok) return null;
  const logicalWidth = Number(metrics.width);
  const logicalHeight = Number(metrics.height);
  const scale = Number(metrics.scale) > 0 ? Number(metrics.scale) : 1;
  if (!Number.isFinite(logicalWidth) || logicalWidth < widthLogical * 1.5) return null;
  return {
    x: Math.round((logicalWidth - widthLogical - OVERLAY_EDGE_GAP) * scale),
    y: Math.round((logicalHeight - heightLogical - OVERLAY_EDGE_GAP) * scale)
  };
}

function overlayHeightForFloorCount(width, floorCount) {
  const canvasWidth = Math.max(100, width - 6);
  const floorHeight = canvasWidth * (PLATE.logicalHeight / PLATE.logicalWidth);
  const count = Math.max(1, floorCount);
  // 21px covers the title bar (15px) plus the window's own top and bottom padding, so the
  // bottom plate keeps its name plate instead of being clipped by the window edge.
  return boundedInteger(21 + count * floorHeight + Math.max(0, count - 1) * 4, MIN_OVERLAY_HEIGHT, MIN_OVERLAY_HEIGHT, MAX_OVERLAY_HEIGHT);
}

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem('ai-office-v2-settings') || '{}');
    const migrating = Number(stored.layoutVersion) !== LAYOUT_VERSION;
    return {
      mode: Object.values(DISPLAY_MODES).includes(stored.mode) ? stored.mode : DISPLAY_MODES.FULL,
      privacyMask: Boolean(stored.privacyMask),
      // The overlay is deliberately tiny and must stay visible above the
      // working app; it never calls focus and its process stays low priority.
      alwaysOnTop: true,
      overlayWidth: migrating ? defaultOverlayWidth() : boundedInteger(stored.overlayWidth, defaultOverlayWidth(), MIN_OVERLAY_WIDTH, MAX_OVERLAY_WIDTH),
      windowX: boundedInteger(stored.windowX, 6, -10_000, 10_000),
      windowY: boundedInteger(stored.windowY, 160, -10_000, 10_000),
      autoProtect: true,
      projection: stored.projection === 'plan' ? 'plan' : 'axon',
      // auto: one shared floor until the office outgrows it; single/floors force a choice.
      floorLayout: ['single', 'floors'].includes(stored.floorLayout) ? stored.floorLayout : 'auto',
      layoutVersion: LAYOUT_VERSION,
      seedCorner: migrating
    };
  } catch {
    return {
      mode: DISPLAY_MODES.FULL,
      privacyMask: false,
      alwaysOnTop: true,
      overlayWidth: DEFAULT_OVERLAY_WIDTH,
      windowX: 6,
      windowY: 160,
      autoProtect: true,
      projection: 'axon',
      floorLayout: 'auto',
      layoutVersion: LAYOUT_VERSION,
      seedCorner: true
    };
  }
}

function saveSettings(settings) {
  localStorage.setItem('ai-office-v2-settings', JSON.stringify(settings));
}

function visibleLabel(value, privacy, fallback = '既有工作') {
  return privacy ? fallback : safeLabel(value, fallback, 42);
}

function compactModel(state, existingSnapshot, resourceManager, systemMetrics, settings) {
  const privacy = settings.privacyMask;
  const now = Date.now();
  const providers = {};
  for (const provider of ['codex', 'claude', 'gemini', 'grok']) {
    const team = state.teams[provider];
    const surfaces = Object.values(state.surfaces).filter((surface) => surface.provider === provider);
    const livePods = livePodsForDisplay(team, surfaces, provider, now)
      .map((pod, podIndex) => ({
        id: pod.id,
        label: visibleLabel(pod.label, privacy, `工作 ${podIndex + 1}`),
        activity: pod.activity,
        surfaceKind: pod.surfaceKind,
        actingLeadAgentId: pod.actingLeadAgentId,
        discussionId: pod.discussionId,
        delegatedAuthority: visibleLabel(pod.delegatedAuthority, privacy, ''),
        overflowAgentCount: Math.max(0, pod.overflowAgentCount || 0),
        lastActivityAt: pod.lastActivityAt,
        agents: Object.values(pod.agents || {})
          .filter((agent) => agent.lifecycle !== 'finished')
          .map((agent, agentIndex) => ({
            id: agent.id,
            role: privacy ? (agent.isMain ? '經理' : `subagent ${agentIndex}`) : safeLabel(agent.role, agent.isMain ? '經理' : 'subagent', 18),
            activity: agent.activity,
            isMain: Boolean(agent.isMain)
          }))
      }));
    const snapshotWork = (existingSnapshot?.providers?.[provider]?.work || []).map((work, index) => ({
      ...work,
      label: visibleLabel(work.label, privacy, `既有工作 ${index + 1}`),
      workspace: visibleLabel(work.workspace, privacy, '本機工作區'),
      agents: (work.agents || []).map((agent, agentIndex) => ({
        ...agent,
        label: privacy ? `subagent ${agentIndex + 1}` : safeLabel(agent.label, 'subagent', 18),
        role: privacy ? 'subagent' : safeLabel(agent.role, 'subagent', 18)
      }))
    }));
    const recentSnapshotWork = snapshotWork.filter((work) => work.recent);
    const annexCount = annexCountForDisplay(livePods, snapshotWork);
    providers[provider] = {
      livePods,
      snapshotWork,
      snapshotSource: existingSnapshot?.providers?.[provider]?.source || '無安全既有工作索引',
      installed: surfaces.some((surface) => surface.installed),
      appOpen: currentPresenceOpen(surfaces, provider, now),
      surfaceKinds: [...new Set(surfaces.filter((surface) => surface.installed).map((surface) => surface.kind))],
      annexCount,
      expansionAt: recentSnapshotWork.length
        ? Math.max(team?.expansionAt || 0, ...recentSnapshotWork.map((work) => Number(work.updatedAt || 0)))
        : team?.expansionAt || 0
    };
  }
  const waitingOwnerCount = Object.values(providers)
    .flatMap((provider) => provider.livePods)
    .filter((pod) => pod.activity === 'waiting_owner').length;
  return {
    schemaVersion: 2,
    generatedAt: Date.now(),
    effectiveMode: resourceManager.effectiveMode(settings.mode),
    frameIntervalMs: resourceManager.frameIntervalMs(settings.mode),
    animationBudget: resourceManager.animationBudget(settings.mode),
    requestedMode: settings.mode,
    resourceLevel: resourceManager.level,
    settings: { ...settings },
    owner: { inboxCount: waitingOwnerCount, activity: waitingOwnerCount ? 'attention' : 'idle' },
    providers,
    surfaces: state.surfaces,
    existingTruth: existingSnapshot?.truth || '既有工作快照未載入。',
    metrics: {
      eventCount: state.metrics.applied,
      lastEventAt: state.metrics.lastEventAt,
      cpuLoadPercent: systemMetrics.cpuLoadPercent ?? null,
      memoryLoadPercent: systemMetrics.memoryLoadPercent ?? null
    },
    recentEvents: state.eventLog.slice(-24).map((event) => ({
      eventId: event.eventId,
      provider: event.provider,
      eventType: event.eventType,
      timestamp: event.timestamp,
      sessionId: event.sessionId,
      agentId: event.agentId,
      parentAgentId: event.parentAgentId,
      correlationId: event.correlationId,
      targetProvider: event.targetProvider,
      participantProviders: event.participantProviders,
      authorityScope: visibleLabel(event.authorityScope, privacy, ''),
      taskLabel: visibleLabel(event.taskLabel, privacy, '工作'),
      important: event.important
    }))
  };
}

function statusForRoom(room, model) {
  if (room === 'owner') {
    return model.owner.inboxCount
      ? { kind: 'live', label: `${model.owner.inboxCount} 件請示`, count: model.owner.inboxCount }
      : { kind: 'empty', label: '永久保留主位', count: 0 };
  }
  if (room === 'lobby') {
    const opened = Object.values(model.surfaces).filter((surface) => surface.appOpen).length;
    return { kind: opened ? 'live' : 'empty', label: `${opened} 個介面開啟`, count: opened };
  }
  if (room === SHARED_FLOOR_KEY) {
    const solo = sharedFloorSessions(model);
    const people = solo.reduce((sum, session) => sum + session.population, 0);
    return solo.length
      ? { kind: solo.every((session) => session.source === 'snapshot') ? 'snapshot' : 'live', label: `單獨工作 · ${solo.length} 件`, count: people }
      : { kind: 'empty', label: '無單獨工作', count: 0 };
  }
  const provider = model.providers[room];
  if (provider.livePods.length) {
    const people = provider.livePods.reduce((sum, pod) => sum + Math.max(1, pod.agents.length), 0);
    return { kind: 'live', label: `真實事件 · ${provider.livePods.length} 任務`, count: people };
  }
  const recent = provider.snapshotWork.filter((work) => work.recent);
  if (recent.length) {
    const people = recent.reduce((sum, work) => sum + 1 + Math.min(4, work.openChildren || 0), 0);
    return { kind: 'snapshot', label: `既有快照 · ${recent.length} 任務`, count: people };
  }
  if (provider.snapshotWork.length) return { kind: 'snapshot', label: '既有紀錄 · 狀態未確認', count: 0 };
  if (provider.appOpen || provider.installed) return { kind: 'empty', label: provider.appOpen ? '程式開啟 · 無工作事件' : '已安裝 · 無工作事件', count: 0 };
  return { kind: 'empty', label: '目前未出現', count: 0 };
}

async function startTower() {
  const tower = document.getElementById('tower');
  tower.hidden = true;
  const settings = loadSettings();
  const state = createInitialState();
  state.settings = { ...state.settings, ...settings };
  let existingSnapshot = null;
  let systemMetrics = {};
  let currentModel = null;
  let broadcastQueued = false;
  const floorViews = new Map();
  const floorRoot = document.getElementById('tower-floors');
  let floorObserver = null;
  let overlayVisible = false;
  let activeFloorCount = 0;
  let appliedWindowGeometry = '';
  let screenInfo = null;
  // Ink sketch on light desktops, white sketch on dark ones. Wallpaper luminance decides;
  // the system colour scheme is the fallback when the probe is unavailable.
  const sketchTheme = { luminance: null, prefersDark: false, lock: 'auto', tone: true };
  const darkSchemeQuery = globalThis.matchMedia?.('(prefers-color-scheme: dark)') || null;
  sketchTheme.prefersDark = Boolean(darkSchemeQuery?.matches);

  function applySketchTheme() {
    for (const view of floorViews.values()) view.renderer.setTheme(sketchTheme);
  }

  async function refreshDesktopLuminance() {
    try {
      const probe = await bridge.desktopLuminance();
      if (!probe?.ok || !Number.isFinite(Number(probe.luminance))) return;
      sketchTheme.luminance = Number(probe.luminance);
      applySketchTheme();
    } catch {
      // The wallpaper probe is optional; the system colour scheme already covers us.
    }
  }

  darkSchemeQuery?.addEventListener?.('change', (event) => {
    sketchTheme.prefersDark = Boolean(event.matches);
    applySketchTheme();
  });

  await bridge.configureCurrentWindow({
    title: 'AI Office Float',
    icon: '/resources/icons/app-icon.png',
    width: settings.overlayWidth,
    height: overlayHeightForFloorCount(settings.overlayWidth, 1),
    x: settings.windowX,
    y: settings.windowY,
    alwaysOnTop: settings.alwaysOnTop
  });
  await bridge.hide().catch(() => {});
  screenInfo = await bridge.screenMetrics().catch(() => null);
  if (settings.seedCorner) {
    // First run on this layout version: park the overlay in the bottom-right corner.
    delete settings.seedCorner;
    settings.anchor = 'bottom-right';
    const corner = bottomRightWindowPosition(screenInfo, settings.overlayWidth, overlayHeightForFloorCount(settings.overlayWidth, 1));
    if (corner) {
      settings.windowX = corner.x;
      settings.windowY = corner.y;
      await bridge.moveCurrentWindow(corner.x, corner.y).catch(() => {});
    }
    saveSettings(settings);
  }
  await bridge.makeDraggable(document.getElementById('tower-drag'), [...document.querySelectorAll('.tower-bar button')]);
  try { await bridge.lowerOwnPriority(); } catch { /* best effort */ }
  refreshDesktopLuminance();
  setInterval(refreshDesktopLuminance, 600_000);

  /**
   * Product rule 6: the animation may never intercept the Owner's work. The window is
   * taken out of Windows hit testing whenever the cursor is over the drawing, and put
   * back the moment it reaches the title bar, the buttons or a resize grip. Neutralino
   * has no click-through API, so this is the native window style toggled from here.
   */
  const clickThrough = new ClickThroughGuard((next) => bridge.setClickThrough(next));
  let clickThroughScale = 1;
  let clickThroughBusy = false;

  async function applyClickThrough(next) {
    clickThroughBusy = true;
    try {
      const measured = await clickThrough.request(next);
      if (measured) {
        clickThroughScale = scaleFromRect(measured, effectiveOverlayWidth());
      }
    } finally {
      clickThroughBusy = false;
    }
  }

  /** Never leave a hidden or minimised window in the click-through state. */
  async function restoreClickThroughForChrome() {
    clickThrough.invalidateRect();
    const measured = await clickThrough.ensureInteractive();
    if (measured) clickThroughScale = scaleFromRect(measured, effectiveOverlayWidth());
  }

  function invalidateClickThroughRect() {
    clickThrough.invalidateRect();
  }

  async function pollClickThrough() {
    if (clickThroughBusy) return;
    if (document.hidden) {
      if (clickThrough.state !== false) await restoreClickThroughForChrome();
      return;
    }
    if (!clickThrough.rect) {
      await applyClickThrough(null);
      return;
    }
    const cursor = await bridge.mousePosition();
    // Missing cursor data is the safe, interactive decision. This also retries a native
    // cleanup if the last confirmed OS state was click-through.
    const wanted = clickThroughAt(cursor, clickThrough.rect, clickThroughScale);
    if (wanted !== clickThrough.state) await applyClickThrough(wanted);
  }

  setInterval(() => { pollClickThrough().catch(() => {}); }, 140);

  const resourceManager = new ResourceLifecycleManager({
    state,
    onLevelChanged: () => scheduleBroadcast()
  });

  let singleFloorActive = false;

  function effectiveOverlayWidth() {
    // The single floor is not magnified: the Owner asked for more room for people, not a
    // bigger drawing. Extra capacity is handled inside the floor plan, not by the window.
    return settings.overlayWidth;
  }

  function countLeavingViews() {
    let total = 0;
    for (const view of floorViews.values()) if (view.leavingTimer) total += 1;
    return total;
  }

  function synchronizeOverlayWindow(floorCount) {
    activeFloorCount = floorCount;
    // Floors that are still erasing themselves keep their room until the animation ends.
    const visibleCount = floorCount + countLeavingViews();
    const width = effectiveOverlayWidth();
    const height = overlayHeightForFloorCount(width, visibleCount);
    const geometry = `${width}x${height}`;
    if (geometry !== appliedWindowGeometry) {
      appliedWindowGeometry = geometry;
      bridge.setCurrentWindowSize(width, height).catch(() => {});
      invalidateClickThroughRect();
      // Anchored to the bottom-right corner: the stack grows upward instead of
      // sliding off the bottom of the screen as floors appear.
      if (settings.anchor === 'bottom-right') {
        const corner = bottomRightWindowPosition(screenInfo, width, height);
        if (corner) {
          settings.windowX = corner.x;
          settings.windowY = corner.y;
          bridge.moveCurrentWindow(corner.x, corner.y).catch(() => {});
        }
      }
    }
    const shouldShow = visibleCount > 0;
    tower.hidden = !shouldShow;
    if (shouldShow === overlayVisible) return;
    overlayVisible = shouldShow;
    if (shouldShow) bridge.show({ focus: false }).catch(() => {});
    else restoreClickThroughForChrome().finally(() => bridge.hide().catch(() => {}));
  }

  async function ensureIntegrationCoverage() {
    if (!bridge.isNative) return { installed: [], alreadyReady: [] };
    const status = await bridge.integrationStatus();
    if (!status?.ok) throw new Error(status?.error || '整合狀態讀取失敗');
    const missing = (status.results || []).filter((item) => !item.installed).map((item) => item.provider);
    const installed = [];
    for (const provider of missing) {
      await bridge.installIntegration(provider);
      installed.push(provider);
    }
    return {
      installed,
      alreadyReady: (status.results || []).filter((item) => item.installed).map((item) => item.provider)
    };
  }

  function sourceForFloor(room, model, annexIndex = 0, annexCount = 1, spec = null) {
    if (room === 'owner') return model.owner.inboxCount ? `${model.owner.inboxCount} 件請示正在等候` : 'Owner 永久保留位置';
    if (room === 'lobby') return 'App／CLI presence 與舊工作檔案，不生成人員';
    if (room === SHARED_FLOOR_KEY) {
      const solo = sharedFloorSessions(model);
      return solo.length ? `沒有 subagent 的單獨工作 · ${solo.map((session) => session.label).join('、')}` : '目前沒有單獨工作';
    }
    const provider = model.providers[room];
    // Two floors of the same provider are two different projects, so the footer event has
    // to belong to this floor's session -- otherwise every floor shows the same headline.
    const recentEvent = [...(model.recentEvents || [])].reverse().find((event) =>
      event.provider === room
      && model.generatedAt - event.timestamp < 15_000
      && (!spec?.sessionId || !event.sessionId || String(spec.sessionId).endsWith(`:${event.sessionId}`) || String(spec.sessionId) === String(event.sessionId))
    );
    const eventLabels = {
      agent_spawned: '新成員進門', agent_finished: '成員交件', agent_failed: '發現錯誤', agent_cancelled: '成員已取消',
      acting_lead_handoff: 'acting lead 交接', discussion_started: '前往跨團隊討論',
      discussion_ended: '討論結束返回', revision_requested: '文件退回修改', review_passed: '審查通過',
      owner_input_required: '前往 Owner 請示', owner_input_received: '收到 Owner 回覆',
      delegated_decision_granted: 'Owner 授權範圍', decision_recorded: '決定紀錄已送出',
      task_completed: '任務交件', turn_completed: '本輪報告完成', session_started: '新工作入駐'
    };
    // A provider floor is one subagent team, so it is named after that session's project.
    const prefix = spec?.sessionLabel ? `${spec.sessionLabel} · ` : '';
    if (recentEvent && eventLabels[recentEvent.eventType]) return `${prefix}${eventLabels[recentEvent.eventType]} · ${recentEvent.taskLabel}`;
    if (spec?.sessionId) {
      const pod = provider.livePods.find((entry) => entry.id === spec.sessionId);
      if (pod) return `${prefix}live · ${pod.agents.length} 名成員`;
    }
    if (provider.livePods.length) return `${prefix}live · ${provider.livePods.map((pod) => pod.label).join('、')}`;
    const recent = provider.snapshotWork.filter((work) => work.recent);
    if (recent.length) return `${prefix}近期快照 · ${recent.map((work) => work.label).join('、')}`;
    if (provider.snapshotWork.length) return `舊紀錄 ${provider.snapshotWork.length} 件 · 未畫成員工`;
    return provider.appOpen ? '程式開啟，尚無結構化工作事件' : '目前無工作資料';
  }

  function annexPopulation(room, model, annexIndex) {
    return floorPopulationForDisplay(model, room, annexIndex);
  }

  function createFloorView(spec) {
    const card = document.createElement('section');
    card.className = 'floor-card new-annex';
    card.dataset.floorKey = spec.key;
    card.dataset.room = spec.room;
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'floor-head';
    head.setAttribute('aria-label', `${spec.title}：展開或隱藏`);
    const emblem = Object.assign(document.createElement('span'), { className: 'floor-emblem' });
    emblem.style.background = ROOM_META[spec.room]?.emblem || '#7f8a93';
    const name = Object.assign(document.createElement('span'), { className: 'floor-name', textContent: spec.title });
    const status = Object.assign(document.createElement('span'), { className: 'floor-status', textContent: '等待狀態' });
    const caret = Object.assign(document.createElement('span'), { className: 'floor-caret', textContent: '▸' });
    head.append(emblem, name, status, caret);
    const scene = Object.assign(document.createElement('div'), { className: 'floor-scene' });
    const canvas = Object.assign(document.createElement('canvas'), { className: 'floor-canvas', width: FLOOR_CANVAS_WIDTH, height: FLOOR_CANVAS_HEIGHT });
    canvas.setAttribute('aria-label', `${spec.title}玩偶動畫`);
    scene.append(canvas);
    const foot = Object.assign(document.createElement('div'), { className: 'floor-foot' });
    const source = Object.assign(document.createElement('span'), { className: 'floor-source', textContent: '等待偵測' });
    const clock = Object.assign(document.createElement('span'), { className: 'floor-clock', textContent: '--:--' });
    foot.append(source, clock);
    card.append(head, scene, foot);
    const renderer = new RoomRenderer({
      canvas,
      room: spec.room,
      annexIndex: spec.annexIndex,
      onFrame: (durationMs) => resourceManager.recordFrame(durationMs)
    });
    renderer.setTheme(sketchTheme);
    renderer.setProjection(settings.projection);
    renderer.setPhase('entering', performance.now());
    const view = { ...spec, card, head, name, status, source, clock, caret, canvas, renderer, inView: true, leavingTimer: null, orderIndex: floorViews.size };
    floorViews.set(spec.key, view);
    card.addEventListener('animationend', () => card.classList.remove('new-annex'), { once: true });
    if (floorObserver) floorObserver.observe(card);
    return view;
  }

  function removeFloorView(key, view) {
    if (view.leavingTimer) clearTimeout(view.leavingTimer);
    view.leavingTimer = null;
    view.renderer.stop();
    floorObserver?.unobserve(view.card);
    view.card.remove();
    floorViews.delete(key);
    synchronizeOverlayWindow(activeFloorCount);
  }

  /**
   * Floors are drawn in, and erased out: a finished floor plays the reverse blueprint
   * animation before its card is removed and the others close up.
   */
  function ensureFloorViews(model) {
    const stacked = floorSpecsForModel(model, ROOM_META, { activeOnly: true });
    const headcount = totalOccupants(model);
    // One shared office while the team fits on a single plate; separate provider floors
    // once it does not. The Owner can also pin either view from the title bar.
    const single = stacked.length > 0 && (
      settings.floorLayout === 'single'
      || (settings.floorLayout === 'auto' && headcount > 0 && headcount <= SINGLE_FLOOR_CAPACITY)
    );
    singleFloorActive = single;
    const specs = single
      ? [{ key: SINGLE_FLOOR_KEY, room: SINGLE_FLOOR_KEY, annexIndex: 0, annexCount: 1, title: `AI 辦公室 · ${headcount} 人` }]
      : stacked;
    const desiredKeys = new Set(specs.map((spec) => spec.key));
    for (const [key, view] of floorViews) {
      if (desiredKeys.has(key)) {
        if (!view.leavingTimer) continue;
        clearTimeout(view.leavingTimer);
        view.leavingTimer = null;
        view.card.classList.remove('leaving');
        view.card.style.maxHeight = '';
        view.card.style.opacity = '';
        view.renderer.setPhase('resident', performance.now());
        continue;
      }
      if (view.leavingTimer) continue;
      view.card.style.maxHeight = `${view.card.offsetHeight}px`;
      view.card.classList.add('leaving');
      requestAnimationFrame(() => {
        if (!view.leavingTimer) return;
        view.card.style.maxHeight = '0px';
        view.card.style.opacity = '0';
      });
      view.renderer.setPhase('leaving', performance.now());
      if (view.inView && !document.hidden) view.renderer.start();
      view.leavingTimer = setTimeout(() => removeFloorView(key, view), 680);
    }
    const ordered = [];
    for (const [index, spec] of specs.entries()) {
      const view = floorViews.get(spec.key) || createFloorView(spec);
      Object.assign(view, spec);
      view.orderIndex = index;
      view.name.textContent = spec.title;
      view.head.setAttribute('aria-label', `${spec.title}：展開或隱藏`);
      view.canvas.setAttribute('aria-label', `${spec.title}玩偶動畫`);
      ordered.push(view);
    }
    // Keep a closing floor at its original position so the stack collapses in place.
    for (const view of floorViews.values()) {
      if (!view.leavingTimer) continue;
      ordered.splice(Math.min(view.orderIndex, ordered.length), 0, view);
    }
    for (const view of ordered) floorRoot.append(view.card);
    return specs;
  }

  function updateTower() {
    if (!currentModel) return;
    const liveCount = Object.values(currentModel.providers).reduce((sum, provider) => sum + provider.livePods.length, 0);
    const recentSnapshots = Object.values(currentModel.providers).reduce((sum, provider) => sum + provider.snapshotWork.filter((work) => work.recent).length, 0);
    document.getElementById('tower-truth').textContent = liveCount
      ? `${liveCount} 個結構化 live 任務`
      : recentSnapshots ? `${recentSnapshots} 個近期既有工作快照` : '未收到進行中工作事件';
    const modeButton = document.getElementById('tower-mode');
    const modeLabel = ({ full: '完整', low: '低動態', dnd: '勿擾', important: '重要事件' })[settings.mode];
    modeButton.textContent = ({ full: '◌', low: '◔', dnd: '◑', important: '●' })[settings.mode];
    modeButton.title = `動畫模式：${modeLabel}`;
    modeButton.setAttribute('aria-label', `動畫模式：${modeLabel}`);
    const privacyButton = document.getElementById('tower-privacy');
    privacyButton.textContent = settings.privacyMask ? '◉' : '◐';
    privacyButton.setAttribute('aria-pressed', String(settings.privacyMask));
    const layoutButton = document.getElementById('tower-layout');
    const layoutLabel = ({ auto: `自動（超過 ${SINGLE_FLOOR_CAPACITY} 人分層）`, single: '單一樓層', floors: '分層顯示' })[settings.floorLayout];
    layoutButton.textContent = ({ auto: '▦', single: '▤', floors: '▥' })[settings.floorLayout];
    layoutButton.title = `樓層顯示：${layoutLabel}`;
    layoutButton.setAttribute('aria-label', `樓層顯示：${layoutLabel}`);
    const floorSpecs = ensureFloorViews(currentModel);
    for (const spec of floorSpecs) {
      const { room, key, annexIndex, annexCount } = spec;
      const view = floorViews.get(key);
      if (!view) continue;
      if (room === SINGLE_FLOOR_KEY) {
        view.card.classList.toggle('live', true);
        view.card.classList.remove('snapshot', 'collapsed');
        view.caret.textContent = '▾';
        view.status.textContent = spec.title;
        view.source.textContent = '全部進行中的工作在同一層';
        view.clock.textContent = new Date(currentModel.generatedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
        if (view.canvas.height !== FLOOR_CANVAS_HEIGHT) view.renderer.resize(FLOOR_CANVAS_WIDTH, FLOOR_CANVAS_HEIGHT);
        const showSingle = view.inView && !document.hidden;
        view.renderer.setModel(currentModel, showSingle);
        if (showSingle) view.renderer.start(); else view.renderer.stop();
        continue;
      }
      const status = statusForRoom(room, currentModel);
      view.card.classList.toggle('live', status.kind === 'live');
      view.card.classList.toggle('snapshot', status.kind === 'snapshot');
      const population = annexPopulation(room, currentModel, annexIndex);
      if (view.canvas.height !== FLOOR_CANVAS_HEIGHT) view.renderer.resize(FLOOR_CANVAS_WIDTH, FLOOR_CANVAS_HEIGHT);
      view.status.textContent = annexCount > 1 ? `${population} 人 · ${annexIndex + 1}/${annexCount}` : status.label;
      view.source.textContent = sourceForFloor(room, currentModel, annexIndex, annexCount, spec);
      view.clock.textContent = new Date(currentModel.generatedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
      // Active-only floors are always expanded; there are no empty floors to collapse.
      const expanded = true;
      view.card.classList.toggle('collapsed', !expanded);
      view.caret.textContent = expanded ? '▾' : '▸';
      const shouldRender = expanded && view.inView && !document.hidden;
      view.renderer.setModel(currentModel, shouldRender);
      if (shouldRender) view.renderer.start(); else view.renderer.stop();
    }
    synchronizeOverlayWindow(floorSpecs.length);
  }

  async function broadcastModel() {
    broadcastQueued = false;
    currentModel = compactModel(state, existingSnapshot, resourceManager, systemMetrics, settings);
    globalChoreography.ingest(currentModel, Date.now());
    try { localStorage.setItem('ai-office-v2-last-model', JSON.stringify(currentModel)); } catch { /* cache is optional */ }
    updateTower();
    await bridge.writeSharedModel(currentModel);
  }

  function scheduleBroadcast() {
    if (broadcastQueued) return;
    broadcastQueued = true;
    setTimeout(broadcastModel, 80);
  }

  const discovery = new AutoDiscovery({
    bridge,
    onEvent: (event) => { applyOfficeEvent(state, event, Date.now()); scheduleBroadcast(); },
    onSystemMetrics: (metrics) => { systemMetrics = metrics; resourceManager.updateSystemMetrics(metrics); scheduleBroadcast(); },
    onStatus: (status) => {
      if (status.error) document.getElementById('tower-message').textContent = `偵測降級：${status.error}`;
    }
  });
  const inbox = new EventInboxReader({
    bridge,
    onEvent: (event) => { applyOfficeEvent(state, event, Date.now()); scheduleBroadcast(); },
    onStatus: (status) => {
      if (status.ok === false) document.getElementById('tower-message').textContent = '事件檔有無法解析的資料，已忽略該列。';
    }
  });

  async function refreshExistingSnapshot() {
    try {
      existingSnapshot = await bridge.existingWorkSnapshot();
      const availableProviders = Object.values(existingSnapshot?.providers || {}).filter((provider) => provider?.available).length;
      document.getElementById('tower-message').textContent = availableProviders
        ? '啟動即完成偵測；黃色是近期快照，不冒充 live。'
        : '既有工作快照暫不可用；仍會顯示可靠即時事件。';
    } catch (error) {
      document.getElementById('tower-message').textContent = `既有工作快照不可用：${error.message}`;
    }
    scheduleBroadcast();
  }

  floorObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const key = entry.target.dataset.floorKey;
      const view = floorViews.get(key);
      if (!view) continue;
      view.inView = entry.isIntersecting;
      const expanded = !view.card.classList.contains('collapsed');
      if (expanded && view.inView && !document.hidden) {
        if (currentModel) view.renderer.setModel(currentModel);
        view.renderer.start();
      } else view.renderer.stop();
    }
  }, { root: floorRoot, threshold: .05 });
  ensureFloorViews(null);
  for (const view of floorViews.values()) floorObserver.observe(view.card);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && clickThrough.state !== false) restoreClickThroughForChrome().catch(() => {});
    for (const view of floorViews.values()) {
      const active = !document.hidden && view.inView && !view.card.classList.contains('collapsed');
      if (active) {
        if (currentModel) view.renderer.setModel(currentModel);
        view.renderer.start();
      } else view.renderer.stop();
    }
  });

  document.getElementById('tower-minimize').addEventListener('click', async () => {
    // Clear the click-through style first: a minimised window that still ignores the
    // mouse cannot be restored by clicking it.
    await restoreClickThroughForChrome();
    await bridge.minimize();
  });
  document.getElementById('tower-close').addEventListener('click', () => bridge.close());
  document.getElementById('tower-privacy').addEventListener('click', () => {
    settings.privacyMask = !settings.privacyMask; saveSettings(settings); scheduleBroadcast();
  });
  document.getElementById('tower-layout').addEventListener('click', () => {
    const order = ['auto', 'single', 'floors'];
    settings.floorLayout = order[(order.indexOf(settings.floorLayout) + 1) % order.length];
    saveSettings(settings);
    scheduleBroadcast();
  });
  document.getElementById('tower-mode').addEventListener('click', () => {
    const modes = [DISPLAY_MODES.FULL, DISPLAY_MODES.LOW, DISPLAY_MODES.DND, DISPLAY_MODES.IMPORTANT];
    settings.mode = modes[(modes.indexOf(settings.mode) + 1) % modes.length];
    state.settings.mode = settings.mode;
    saveSettings(settings);
    scheduleBroadcast();
  });

  // Every edge and corner resizes. Height follows the floor count, so a drag maps onto
  // the overlay width: outward grows the office, inward shrinks it.
  const GRIP_DIRECTIONS = {
    e: { x: 1, y: 0 }, w: { x: -1, y: 0 },
    n: { x: 0, y: -1 }, s: { x: 0, y: 1 },
    ne: { x: 1, y: -1 }, nw: { x: -1, y: -1 },
    se: { x: 1, y: 1 }, sw: { x: -1, y: 1 }
  };
  let resizeState = null;
  const beginResize = (event) => {
    const grip = event.currentTarget.dataset.grip;
    if (!GRIP_DIRECTIONS[grip]) return;
    event.preventDefault();
    event.stopPropagation();
    resizeState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: settings.overlayWidth,
      direction: GRIP_DIRECTIONS[grip],
      element: event.currentTarget
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveResize = (event) => {
    if (!resizeState || event.pointerId !== resizeState.pointerId) return;
    const dx = (event.clientX - resizeState.startX) * resizeState.direction.x;
    const dy = (event.clientY - resizeState.startY) * resizeState.direction.y;
    const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
    const nextWidth = boundedInteger(resizeState.startWidth + delta, settings.overlayWidth, MIN_OVERLAY_WIDTH, MAX_OVERLAY_WIDTH);
    if (nextWidth === settings.overlayWidth) return;
    settings.overlayWidth = nextWidth;
    synchronizeOverlayWindow(activeFloorCount);
  };
  const completeResize = (event) => {
    if (!resizeState || event.pointerId !== resizeState.pointerId) return;
    try { resizeState.element.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    resizeState = null;
    saveSettings(settings);
  };
  for (const grip of document.querySelectorAll('.tower-grip')) {
    grip.addEventListener('pointerdown', beginResize);
    grip.addEventListener('pointermove', moveResize);
    grip.addEventListener('pointerup', completeResize);
    grip.addEventListener('pointercancel', completeResize);
  }

  document.getElementById('tower-drag').addEventListener('pointerup', (event) => {
    if (event.target.closest('.window-actions')) return;
    setTimeout(async () => {
      try {
        const position = await bridge.currentWindowPosition();
        settings.windowX = boundedInteger(position.x, settings.windowX, -10_000, 10_000);
        settings.windowY = boundedInteger(position.y, settings.windowY, -10_000, 10_000);
        saveSettings(settings);
      } catch { /* keeping the current location is sufficient */ }
      // The window just moved, so every cached screen rectangle is wrong: the next poll
      // has to measure again before it decides what is chrome and what is drawing.
      invalidateClickThroughRect();
    }, 0);
  });

  const [, , , integrationResult] = await Promise.all([
    discovery.scan({ force: true }),
    inbox.poll(),
    refreshExistingSnapshot(),
    ensureIntegrationCoverage().catch((error) => ({ error: error.message }))
  ]);
  if (integrationResult?.installed?.length) {
    document.getElementById('tower-message').textContent = `已自動啟用 ${integrationResult.installed.join('、')} 精準偵測；Codex 首次可能需信任一次。`;
  } else if (integrationResult?.error) {
    document.getElementById('tower-message').textContent = `精準偵測維持降級：${integrationResult.error}`;
  }
  degradeStaleSessions(state, Date.now());
  discovery.start();
  inbox.start();
  resourceManager.startCompaction();
  await broadcastModel();

  setInterval(() => {
    degradeStaleSessions(state, Date.now());
    scheduleBroadcast();
  }, 2000);
  setInterval(refreshExistingSnapshot, 30_000);
}

async function start() {
  const acquired = await bridge.initialize();
  if (!acquired) return;
  await startTower();
}

start().catch((error) => {
  document.body.textContent = `AI 玩偶辦公室啟動失敗：${error.message}`;
  document.body.style.background = '#201b20';
  document.body.style.color = '#f0d9d9';
  document.body.style.padding = '16px';
});
