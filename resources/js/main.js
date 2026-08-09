import {
  applyOfficeEvent,
  createInitialState,
  createSyntheticEvents,
  degradeStaleSessions,
  DISPLAY_MODES,
  PROVIDERS,
  summarizeState
} from './domain.js';
import { AutoDiscovery, EventInboxReader } from './discovery.js';
import { NativeBridge } from './native-bridge.js';
import { OfficeRenderer } from './renderer.js';
import { ResourceLifecycleManager } from './resource-manager.js';

const state = createInitialState();
const bridge = new NativeBridge();
const elements = Object.fromEntries([
  'office-canvas', 'office-scroll', 'control-panel', 'toggle-panel', 'truth-chip', 'resource-chip',
  'scan-now', 'scan-time', 'play-demo', 'privacy-toggle', 'always-on-top', 'auto-protect',
  'effective-mode', 'provider-list', 'metric-cpu', 'metric-memory', 'metric-teams', 'metric-pods',
  'metric-agents', 'metric-events', 'activity-list', 'footer-message', 'version-label'
].map((id) => [id, document.getElementById(id)]));

const providerLabels = { codex: 'Codex', claude: 'Claude', gemini: 'Gemini', grok: 'Grok' };
const eventLabels = {
  session_started: '開始工作階段', session_observed: '發現工作階段', turn_started: '開始處理',
  turn_completed: '本輪交件', owner_input_required: '前往 Owner 請示', owner_input_received: '取得 Owner 回覆',
  agent_spawned: '新部屬報到', agent_finished: '部屬完成報告', agent_failed: '部屬遇到問題',
  task_completed: '工作完成', session_stopped: '工作階段結束', adapter_disconnected: '事件來源中斷',
  surface_discovered: '更新 App／CLI presence', delegation_started: '開始委派區間', delegation_finished: '委派區間結束'
};
const modeLabels = { full: '完整動態', low: '低動態', dnd: '勿擾', important: '只顯示重要事件' };

let integrationStatus = {};
let systemMetrics = {};
let discoveryStatus = { ok: false, lastScanAt: null, error: null };
let inboxStatus = { ok: true, applied: 0 };
let uiPending = false;

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('ai-office-settings') || '{}');
    if (Object.values(DISPLAY_MODES).includes(saved.mode)) state.settings.mode = saved.mode;
    state.settings.privacyMask = Boolean(saved.privacyMask);
    state.settings.alwaysOnTop = Boolean(saved.alwaysOnTop);
    state.settings.autoProtect = saved.autoProtect !== false;
    state.settings.collapsedFloors = saved.collapsedFloors && typeof saved.collapsedFloors === 'object' ? saved.collapsedFloors : {};
  } catch { /* use defaults */ }
}

function saveSettings() {
  localStorage.setItem('ai-office-settings', JSON.stringify({
    mode: state.settings.mode,
    privacyMask: state.settings.privacyMask,
    alwaysOnTop: state.settings.alwaysOnTop,
    autoProtect: state.settings.autoProtect,
    collapsedFloors: state.settings.collapsedFloors
  }));
}

loadSettings();

const resourceManager = new ResourceLifecycleManager({
  state,
  onLevelChanged: () => scheduleUi()
});
const renderer = new OfficeRenderer({
  canvas: elements['office-canvas'],
  scrollContainer: elements['office-scroll'],
  state,
  resourceManager,
  onSettingsChanged: saveSettings
});

function handleEvent(event) {
  const result = applyOfficeEvent(state, event, Date.now());
  if (result.applied) renderer.invalidate();
  scheduleUi();
  return result;
}

const discovery = new AutoDiscovery({
  bridge,
  onEvent: handleEvent,
  onSystemMetrics: (metrics) => {
    systemMetrics = metrics;
    resourceManager.updateSystemMetrics(metrics);
    scheduleUi();
  },
  onStatus: (status) => {
    discoveryStatus = status;
    scheduleUi();
  }
});

const inbox = new EventInboxReader({
  bridge,
  onEvent: handleEvent,
  onStatus: (status) => {
    inboxStatus = status;
    scheduleUi();
  }
});

function scheduleUi() {
  if (uiPending) return;
  uiPending = true;
  requestAnimationFrame(() => {
    uiPending = false;
    updateUi();
  });
}

function setFooter(message, isError = false) {
  elements['footer-message'].textContent = message;
  elements['footer-message'].style.color = isError ? '#e88b8b' : '';
}

function formatTime(timestamp) {
  if (!timestamp) return '尚未掃描';
  return new Date(timestamp).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function surfaceSummary(provider) {
  const surfaces = Object.values(state.surfaces).filter((surface) => surface.provider === provider);
  return {
    surfaces,
    installed: surfaces.some((surface) => surface.installed),
    open: surfaces.some((surface) => surface.appOpen),
    kinds: surfaces.filter((surface) => surface.installed).map((surface) => surface.kind).join('、') || '未偵測'
  };
}

function renderProviderCards() {
  const container = elements['provider-list'];
  const activeElement = document.activeElement;
  const activeProvider = activeElement?.dataset?.provider || null;
  container.replaceChildren();
  for (const provider of ['codex', 'claude', 'gemini', 'grok']) {
    const summary = surfaceSummary(provider);
    const status = integrationStatus[provider];
    const card = document.createElement('div');
    card.className = 'provider-card';
    const title = document.createElement('strong');
    const dot = document.createElement('span');
    dot.className = `provider-dot ${summary.open ? 'open' : summary.installed ? 'installed' : ''}`;
    title.append(dot, document.createTextNode(providerLabels[provider]));
    const meta = document.createElement('div');
    meta.className = 'provider-meta';
    meta.textContent = `${summary.open ? '已開啟' : summary.installed ? '已安裝' : '未偵測'} · ${summary.kinds} · ${status?.installed ? '精準事件已啟用' : 'presence-only'}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.provider = provider;
    button.textContent = status?.installed ? '已啟用' : '啟用精準偵測';
    button.disabled = Boolean(status?.installed || !bridge.isNative);
    button.addEventListener('click', () => enableIntegration(provider));
    card.append(title, meta, button);
    container.append(card);
    if (activeProvider === provider && !button.disabled) button.focus();
  }
}

function renderActivity() {
  const list = elements['activity-list'];
  list.replaceChildren();
  let events = state.eventLog.filter((event) => event.eventType !== 'surface_discovered');
  if (state.settings.mode === DISPLAY_MODES.IMPORTANT) events = events.filter((event) => event.important);
  for (const event of events.slice(-8).reverse()) {
    const item = document.createElement('li');
    if (event.important) item.classList.add('important');
    const provider = state.settings.privacyMask ? 'AI' : (PROVIDERS[event.provider]?.label || 'AI');
    const label = state.settings.privacyMask ? '工作' : event.taskLabel;
    item.textContent = `${formatTime(event.timestamp)}　${provider}｜${label}｜${eventLabels[event.eventType] || event.eventType}`;
    list.append(item);
  }
  if (!list.children.length) {
    const item = document.createElement('li');
    item.textContent = '尚無結構化工作事件；大廳只顯示可信的 App／CLI presence。';
    list.append(item);
  }
}

function updateUi() {
  const summary = summarizeState(state);
  const effectiveMode = resourceManager.effectiveMode(state.settings.mode);
  elements['effective-mode'].textContent = effectiveMode === state.settings.mode
    ? modeLabels[effectiveMode]
    : `${modeLabels[effectiveMode]}（自動降載）`;
  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.setAttribute('aria-checked', String(button.dataset.mode === state.settings.mode));
  });
  elements['privacy-toggle'].setAttribute('aria-pressed', String(state.settings.privacyMask));
  elements['always-on-top'].setAttribute('aria-pressed', String(state.settings.alwaysOnTop));
  elements['auto-protect'].checked = state.settings.autoProtect;
  elements['scan-time'].textContent = formatTime(discoveryStatus.lastScanAt);

  const structuredCount = Object.values(integrationStatus).filter((item) => item?.installed).length;
  if (inboxStatus.ok === false || discoveryStatus.error) {
    elements['truth-chip'].className = 'status-chip status-warn';
    elements['truth-chip'].textContent = '部分來源未確認';
  } else if (summary.podCount) {
    elements['truth-chip'].className = 'status-chip status-good';
    elements['truth-chip'].textContent = `${summary.podCount} 個結構化 session`;
  } else {
    elements['truth-chip'].className = 'status-chip status-neutral';
    elements['truth-chip'].textContent = structuredCount ? '等待生命週期事件' : 'presence-only';
  }

  elements['resource-chip'].className = `status-chip resource-${resourceManager.level}`;
  elements['resource-chip'].textContent = `資源：${resourceManager.level[0].toUpperCase()}${resourceManager.level.slice(1)}`;
  elements['metric-cpu'].textContent = Number.isFinite(Number(systemMetrics.cpuLoadPercent)) ? `${systemMetrics.cpuLoadPercent}%` : '—';
  elements['metric-memory'].textContent = Number.isFinite(Number(systemMetrics.memoryLoadPercent)) ? `${systemMetrics.memoryLoadPercent}%` : '—';
  elements['metric-teams'].textContent = summary.teamCount;
  elements['metric-pods'].textContent = summary.podCount;
  elements['metric-agents'].textContent = summary.agentCount;
  elements['metric-events'].textContent = state.metrics.applied;
  renderProviderCards();
  renderActivity();
}

async function refreshIntegrationStatus() {
  if (!bridge.isNative) return;
  try {
    const response = await bridge.integrationStatus();
    integrationStatus = Object.fromEntries((response.results || []).map((item) => [item.provider, item]));
  } catch (error) {
    setFooter(`整合狀態檢查失敗：${error.message}`, true);
  }
  scheduleUi();
}

async function enableIntegration(provider) {
  const label = providerLabels[provider];
  const approved = await bridge.confirmIntegration(label);
  if (!approved) return;
  setFooter(`正在備份設定並啟用 ${label} 精準偵測…`);
  try {
    const result = await bridge.installIntegration(provider);
    await refreshIntegrationStatus();
    const item = result.results?.[0];
    const trust = item?.requiresTrust ? ' 請到 Codex /hooks 完成一次信任。' : '';
    setFooter(`${label} 精準偵測已設定。${trust}`);
  } catch (error) {
    setFooter(`${label} 整合失敗，外部設定未被覆寫：${error.message}`, true);
  }
}

function bindControls() {
  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      state.settings.mode = button.dataset.mode;
      saveSettings();
      renderer.invalidate();
      scheduleUi();
    });
  });
  elements['auto-protect'].addEventListener('change', (event) => {
    state.settings.autoProtect = event.target.checked;
    saveSettings(); renderer.invalidate(); scheduleUi();
  });
  elements['privacy-toggle'].addEventListener('click', () => {
    state.settings.privacyMask = !state.settings.privacyMask;
    saveSettings(); renderer.invalidate(); scheduleUi();
  });
  elements['always-on-top'].addEventListener('click', async () => {
    state.settings.alwaysOnTop = !state.settings.alwaysOnTop;
    await bridge.setAlwaysOnTop(state.settings.alwaysOnTop);
    saveSettings(); scheduleUi();
  });
  elements['scan-now'].addEventListener('click', async () => {
    elements['scan-now'].disabled = true;
    await discovery.scan({ force: true });
    await refreshIntegrationStatus();
    elements['scan-now'].disabled = false;
  });
  elements['play-demo'].addEventListener('click', () => {
    const start = Date.now();
    createSyntheticEvents(start).forEach((event, index) => {
      setTimeout(() => handleEvent(event), Math.min(index * 180, 1500));
    });
    setFooter('正在播放明確標示的 synthetic 示範；不代表外部 AI 的 live 狀態。');
  });
  elements['toggle-panel'].addEventListener('click', () => {
    const workspace = document.querySelector('.workspace');
    workspace.classList.toggle('panel-hidden');
    workspace.classList.toggle('panel-open');
    renderer.resize();
  });
}

async function start() {
  bindControls();
  await bridge.initialize();
  try { await bridge.lowerOwnPriority(); } catch (error) { bridge.log('warn', `Priority setup skipped: ${error.message}`); }
  elements['version-label'].textContent = 'v0.1.0';
  await bridge.setAlwaysOnTop(state.settings.alwaysOnTop);
  await refreshIntegrationStatus();
  await discovery.scan({ force: true });
  await inbox.poll();
  degradeStaleSessions(state, Date.now());
  discovery.start();
  inbox.start();
  resourceManager.startCompaction();
  renderer.start();
  scheduleUi();
  if (!bridge.isNative) setFooter('瀏覽器預覽模式：原生偵測停用，可播放 synthetic 示範。');
  const launchArgs = Array.isArray(globalThis.NL_ARGS) ? globalThis.NL_ARGS : [];
  if (bridge.isNative && launchArgs.includes('--capture-test')) {
    createSyntheticEvents(Date.now()).forEach(handleEvent);
    setTimeout(async () => {
      const captureDirectory = `${globalThis.NL_PATH}\\.visual-test`;
      try { await globalThis.Neutralino.filesystem.createDirectory(captureDirectory); } catch { /* exists */ }
      const scroll = elements['office-scroll'];
      scroll.scrollTop = 0;
      await globalThis.Neutralino.window.snapshot(`${captureDirectory}\\office-top.png`);
      scroll.scrollTop = 250;
      renderer.invalidate();
      await new Promise((resolve) => setTimeout(resolve, 300));
      await globalThis.Neutralino.window.snapshot(`${captureDirectory}\\office-teams.png`);
      scroll.scrollTop = scroll.scrollHeight;
      renderer.invalidate();
      await new Promise((resolve) => setTimeout(resolve, 300));
      await globalThis.Neutralino.window.snapshot(`${captureDirectory}\\office-lobby.png`);
      document.querySelector('.workspace').classList.add('panel-open');
      renderer.resize();
      await new Promise((resolve) => setTimeout(resolve, 300));
      await globalThis.Neutralino.window.snapshot(`${captureDirectory}\\office-panel.png`);
    }, 1800);
  }
}

globalThis.addEventListener('beforeunload', () => {
  discovery.stop();
  inbox.stop();
  renderer.dispose();
  resourceManager.dispose();
});

start().catch((error) => {
  bridge.log('error', error.stack || error.message || String(error));
  setFooter(`啟動失敗：${error.message || error}`, true);
});
