export const SCHEMA_VERSION = 1;

export const DISPLAY_MODES = Object.freeze({
  FULL: 'full',
  LOW: 'low',
  DND: 'dnd',
  IMPORTANT: 'important'
});

export const PROVIDERS = Object.freeze({
  codex: { label: 'Codex', accent: '#56b6c2', floor: '#183c47' },
  claude: { label: 'Claude', accent: '#e6a36b', floor: '#4a3027' },
  gemini: { label: 'Gemini', accent: '#a890e8', floor: '#342e56' },
  grok: { label: 'Grok', accent: '#9fc66d', floor: '#30442e' },
  other: { label: '其他 AI', accent: '#aeb8c4', floor: '#303844' }
});

const SESSION_EVENTS = new Set([
  'session_started',
  'session_observed',
  'session_title',
  'turn_started',
  'turn_completed',
  'owner_input_required',
  'owner_input_received',
  'tool_started',
  'tool_finished',
  'task_completed',
  'session_stopped',
  'agent_spawned',
  'agent_finished',
  'agent_failed',
  'delegation_started',
  'delegation_finished'
]);

const IMPORTANT_EVENTS = new Set([
  'owner_input_required',
  'task_completed',
  'session_stopped',
  'agent_failed',
  'adapter_disconnected'
]);

export function normalizeProvider(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw.includes('codex') || raw === 'openai') return 'codex';
  if (raw.includes('claude') || raw === 'anthropic') return 'claude';
  if (raw.includes('gemini') || raw === 'google') return 'gemini';
  if (raw.includes('grok') || raw === 'xai') return 'grok';
  return 'other';
}

export function safeLabel(value, fallback = '未命名工作', maxLength = 42) {
  const normalized = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return fallback;
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(1, maxLength - 1))}…`
    : normalized;
}

export function createInitialState(now = Date.now()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    owner: {
      id: 'owner',
      label: 'Owner',
      activity: 'idle',
      inboxCount: 0
    },
    teams: {},
    surfaces: {},
    settings: {
      mode: DISPLAY_MODES.FULL,
      privacyMask: false,
      alwaysOnTop: false,
      autoProtect: true,
      pinnedTeams: {},
      collapsedFloors: {}
    },
    metrics: {
      received: 0,
      applied: 0,
      duplicates: 0,
      rejected: 0,
      lastEventAt: null
    },
    eventLog: [],
    diagnostics: [],
    seenEventIds: {}
  };
}

function normalizeEvent(raw, now) {
  const provider = normalizeProvider(raw?.provider);
  const timestamp = Number.isFinite(Number(raw?.timestamp))
    ? Number(raw.timestamp)
    : Date.parse(raw?.timestamp || '') || now;
  const eventType = String(raw?.eventType || raw?.event_type || '').trim().toLowerCase();
  const sessionId = raw?.sessionId || raw?.session_id || null;
  const agentId = raw?.agentId || raw?.agent_id || null;
  const parentAgentId = raw?.parentAgentId || raw?.parent_agent_id || null;
  const surfaceKind = String(raw?.surfaceKind || raw?.surface_kind || 'unknown').toLowerCase();
  const surfaceId = String(raw?.surfaceId || raw?.surface_id || `${provider}:${surfaceKind}`);
  const eventId = String(
    raw?.eventId ||
    raw?.event_id ||
    `${provider}:${surfaceId}:${sessionId || '-'}:${agentId || '-'}:${eventType}:${timestamp}`
  );
  return {
    eventId,
    timestamp,
    provider,
    eventType,
    surfaceId,
    surfaceKind,
    sessionId: sessionId ? String(sessionId) : null,
    agentId: agentId ? String(agentId) : null,
    parentAgentId: parentAgentId ? String(parentAgentId) : null,
    taskLabel: safeLabel(raw?.taskLabel || raw?.task_label || raw?.safeLabel || raw?.safe_label),
    role: safeLabel(raw?.role || raw?.agentType || raw?.agent_type || '', '', 24),
    toolName: safeLabel(raw?.toolName || raw?.tool_name || '', '', 30),
    processState: String(raw?.processState || raw?.process_state || '').toLowerCase(),
    observationTier: String(raw?.observationTier || raw?.observation_tier || 'D').toUpperCase(),
    sourceConfidence: String(raw?.sourceConfidence || raw?.source_confidence || 'unknown'),
    hasInstalled: Object.prototype.hasOwnProperty.call(raw || {}, 'installed'),
    hasAppOpen: Object.prototype.hasOwnProperty.call(raw || {}, 'appOpen') || Object.prototype.hasOwnProperty.call(raw || {}, 'app_open'),
    installed: Boolean(raw?.installed),
    appOpen: Boolean(raw?.appOpen ?? raw?.app_open),
    ephemeral: Boolean(raw?.ephemeral),
    important: Boolean(raw?.important || IMPORTANT_EVENTS.has(eventType)),
    version: safeLabel(raw?.version || '', '', 24),
    executablePath: safeLabel(raw?.executablePath || raw?.executable_path || '', '', 120)
  };
}

function addDiagnostic(state, level, code, message, now) {
  state.diagnostics.push({ level, code, message: safeLabel(message, code, 160), timestamp: now });
  if (state.diagnostics.length > 120) {
    state.diagnostics.splice(0, state.diagnostics.length - 120);
  }
}

function ensureSurface(state, event) {
  const previous = state.surfaces[event.surfaceId] || {};
  const surface = {
    id: event.surfaceId,
    provider: event.provider,
    kind: event.surfaceKind,
    installed: event.hasInstalled ? event.installed : (previous.installed || SESSION_EVENTS.has(event.eventType)),
    appOpen: event.hasAppOpen ? event.appOpen : (previous.appOpen || SESSION_EVENTS.has(event.eventType)),
    processState: event.processState || previous.processState || 'unknown',
    version: event.version || previous.version || '',
    executablePath: event.executablePath || previous.executablePath || '',
    observationTier: event.observationTier || previous.observationTier || 'D',
    lastSeenAt: event.timestamp
  };
  state.surfaces[event.surfaceId] = surface;
  return surface;
}

function ensureTeam(state, event) {
  const provider = event.provider;
  let team = state.teams[provider];
  if (!team) {
    const style = PROVIDERS[provider] || PROVIDERS.other;
    team = {
      id: `team:${provider}`,
      provider,
      label: style.label,
      accent: style.accent,
      floorColor: style.floor,
      lifecycle: 'active',
      pods: {},
      unassigned: {},
      delegations: {},
      annexCount: 1,
      createdAt: event.timestamp,
      expansionAt: event.timestamp,
      lastActivityAt: event.timestamp
    };
    state.teams[provider] = team;
  }
  team.lastActivityAt = Math.max(team.lastActivityAt || 0, event.timestamp);
  return team;
}

function ensurePod(state, event) {
  if (!event.sessionId) return null;
  const team = ensureTeam(state, event);
  let pod = team.pods[event.sessionId];
  if (!pod) {
    pod = {
      id: `pod:${event.provider}:${event.sessionId}`,
      sessionId: event.sessionId,
      provider: event.provider,
      surfaceId: event.surfaceId,
      surfaceKind: event.surfaceKind,
      label: event.taskLabel,
      lifecycle: 'active',
      activity: 'idle',
      role: 'specialist',
      agents: {},
      createdAt: event.timestamp,
      lastActivityAt: event.timestamp,
      completedAt: null,
      pinned: false,
      lastImportantEvent: null
    };
    pod.agents[`main:${event.sessionId}`] = {
      id: `main:${event.sessionId}`,
      parentAgentId: null,
      role: 'specialist',
      activity: 'idle',
      lifecycle: 'active',
      createdAt: event.timestamp,
      lastActivityAt: event.timestamp,
      finishedAt: null,
      isMain: true
    };
    team.pods[event.sessionId] = pod;
    team.expansionAt = event.timestamp;
  }
  if (event.taskLabel && event.taskLabel !== '未命名工作') pod.label = event.taskLabel;
  pod.lastActivityAt = Math.max(pod.lastActivityAt || 0, event.timestamp);
  return pod;
}

function mainAgent(pod) {
  return pod?.agents?.[`main:${pod.sessionId}`] || null;
}

function recomputeTeam(team, timestamp) {
  const pods = Object.values(team.pods);
  const activePods = pods.filter((pod) => pod.lifecycle === 'active');
  const waiting = activePods.some((pod) => pod.activity === 'waiting_owner');
  const running = activePods.some((pod) => pod.activity === 'running');
  team.lifecycle = waiting || running || activePods.length ? 'active' : pods.length ? 'sleeping' : 'empty';

  const agentCount = pods.reduce((sum, pod) => (
    sum + Object.values(pod.agents).filter((agent) => agent.lifecycle !== 'finished').length
  ), 0);
  const nextAnnex = Math.max(1, Math.ceil(pods.length / 2), Math.ceil(agentCount / 10));
  if (nextAnnex !== team.annexCount) {
    team.annexCount = nextAnnex;
    team.expansionAt = timestamp;
  }
}

function applyAgentEvent(state, event, pod) {
  const team = state.teams[event.provider];
  if (!event.agentId) {
    addDiagnostic(state, 'warn', 'agent_id_missing', `${event.eventType} 缺少 agent ID`, event.timestamp);
    return;
  }

  if (event.ephemeral || event.provider === 'gemini' && event.eventType.startsWith('delegation_')) {
    const key = event.agentId || `${event.sessionId}:${event.toolName}`;
    if (event.eventType === 'delegation_finished') {
      delete team.delegations[key];
    } else {
      team.delegations[key] = {
        id: key,
        sessionId: event.sessionId,
        label: event.role || '委派中',
        startedAt: event.timestamp,
        ephemeral: true
      };
    }
    return;
  }

  const reliablePod = pod && event.sessionId;
  if (!reliablePod) {
    team.unassigned[event.agentId] = {
      id: event.agentId,
      role: event.role || '未歸屬',
      activity: 'unknown',
      lifecycle: 'unknown',
      createdAt: event.timestamp,
      lastActivityAt: event.timestamp
    };
    return;
  }

  if (event.eventType === 'agent_spawned') {
    const parentAgentId = event.parentAgentId || `main:${event.sessionId}`;
    pod.agents[event.agentId] = {
      id: event.agentId,
      parentAgentId,
      role: event.role || 'subagent',
      activity: 'working',
      lifecycle: 'active',
      createdAt: event.timestamp,
      lastActivityAt: event.timestamp,
      finishedAt: null,
      isMain: false
    };
    const main = mainAgent(pod);
    if (main) main.role = 'manager';
    pod.role = 'manager';
    pod.activity = 'running';
  } else {
    const agent = pod.agents[event.agentId];
    if (!agent) {
      team.unassigned[event.agentId] = {
        id: event.agentId,
        role: event.role || '未歸屬',
        activity: event.eventType === 'agent_failed' ? 'failed' : 'unknown',
        lifecycle: 'unknown',
        createdAt: event.timestamp,
        lastActivityAt: event.timestamp
      };
      return;
    }
    agent.lifecycle = 'finished';
    agent.activity = event.eventType === 'agent_failed' ? 'failed' : 'delivered';
    agent.lastActivityAt = event.timestamp;
    agent.finishedAt = event.timestamp;
    if (event.eventType === 'agent_failed') pod.lastImportantEvent = 'agent_failed';
  }
}

export function applyOfficeEvent(state, rawEvent, now = Date.now()) {
  state.metrics.received += 1;
  const event = normalizeEvent(rawEvent, now);
  if (!event.eventType) {
    state.metrics.rejected += 1;
    addDiagnostic(state, 'warn', 'event_type_missing', '收到缺少 event_type 的事件', now);
    return { applied: false, reason: 'event_type_missing', event };
  }
  if (state.seenEventIds[event.eventId]) {
    state.metrics.duplicates += 1;
    return { applied: false, reason: 'duplicate', event };
  }
  state.seenEventIds[event.eventId] = event.timestamp;
  ensureSurface(state, event);

  if (event.eventType === 'surface_discovered' || event.eventType === 'process_observed') {
    state.metrics.applied += 1;
    state.metrics.lastEventAt = event.timestamp;
    state.eventLog.push(event);
    compactOfficeState(state, now);
    return { applied: true, event };
  }

  if (event.eventType === 'process_exited') {
    const surface = state.surfaces[event.surfaceId];
    if (surface) {
      surface.appOpen = false;
      surface.processState = 'exited';
    }
  } else if (event.eventType === 'adapter_disconnected') {
    Object.values(state.teams).forEach((team) => {
      Object.values(team.pods).forEach((pod) => {
        if (pod.surfaceId === event.surfaceId && pod.lifecycle === 'active') pod.activity = 'unknown';
      });
    });
  } else if (SESSION_EVENTS.has(event.eventType)) {
    const pod = ensurePod(state, event);
    if (!pod) {
      state.metrics.rejected += 1;
      addDiagnostic(state, 'warn', 'session_id_missing', `${event.eventType} 缺少 session ID`, event.timestamp);
      compactOfficeState(state, now);
      return { applied: false, reason: 'session_id_missing', event };
    }
    const main = mainAgent(pod);
    switch (event.eventType) {
      case 'session_started':
      case 'session_observed':
        pod.lifecycle = 'active';
        pod.activity = 'idle';
        break;
      case 'session_title':
        pod.label = event.taskLabel;
        break;
      case 'turn_started':
        pod.lifecycle = 'active';
        pod.activity = 'running';
        if (main) main.activity = 'working';
        break;
      case 'turn_completed':
        pod.activity = 'idle';
        if (main) main.activity = 'delivered';
        break;
      case 'owner_input_required':
        pod.activity = 'waiting_owner';
        pod.lastImportantEvent = 'owner_input_required';
        state.owner.inboxCount += 1;
        state.owner.activity = 'attention';
        break;
      case 'owner_input_received':
        pod.activity = 'running';
        state.owner.inboxCount = Math.max(0, state.owner.inboxCount - 1);
        state.owner.activity = state.owner.inboxCount ? 'attention' : 'idle';
        break;
      case 'tool_started':
        pod.activity = 'running';
        if (main) {
          main.activity = 'working';
          main.role = event.toolName ? safeLabel(event.toolName, main.role, 22) : main.role;
        }
        break;
      case 'tool_finished':
        if (main) main.activity = 'working';
        break;
      case 'task_completed':
        pod.activity = 'idle';
        pod.lastImportantEvent = 'task_completed';
        if (main) main.activity = 'delivered';
        break;
      case 'session_stopped':
        pod.lifecycle = 'completed';
        pod.activity = 'completed';
        pod.completedAt = event.timestamp;
        pod.lastImportantEvent = 'session_stopped';
        if (main) {
          main.activity = 'completed';
          main.lifecycle = 'finished';
          main.finishedAt = event.timestamp;
        }
        break;
      case 'agent_spawned':
      case 'agent_finished':
      case 'agent_failed':
      case 'delegation_started':
      case 'delegation_finished':
        applyAgentEvent(state, event, pod);
        break;
      default:
        break;
    }
  } else {
    state.metrics.rejected += 1;
    addDiagnostic(state, 'info', 'event_type_unknown', `忽略未知事件 ${event.eventType}`, event.timestamp);
    compactOfficeState(state, now);
    return { applied: false, reason: 'event_type_unknown', event };
  }

  Object.values(state.teams).forEach((team) => recomputeTeam(team, event.timestamp));
  state.metrics.applied += 1;
  state.metrics.lastEventAt = event.timestamp;
  state.eventLog.push(event);
  compactOfficeState(state, now);
  return { applied: true, event };
}

export function compactOfficeState(state, now = Date.now(), options = {}) {
  const agentTtl = options.agentTtl ?? 5 * 60_000;
  const podTtl = options.podTtl ?? 30 * 60_000;
  const maxEvents = options.maxEvents ?? 500;
  const maxSeen = options.maxSeen ?? 2048;

  Object.values(state.teams).forEach((team) => {
    Object.values(team.pods).forEach((pod) => {
      Object.entries(pod.agents).forEach(([id, agent]) => {
        if (!agent.isMain && agent.finishedAt && now - agent.finishedAt > agentTtl) {
          delete pod.agents[id];
        }
      });
      if (pod.completedAt && !pod.pinned && now - pod.completedAt > podTtl) {
        delete team.pods[pod.sessionId];
      }
    });
    Object.entries(team.unassigned).forEach(([id, agent]) => {
      if (now - agent.lastActivityAt > agentTtl) delete team.unassigned[id];
    });
    Object.entries(team.delegations).forEach(([id, delegation]) => {
      if (now - delegation.startedAt > agentTtl) delete team.delegations[id];
    });
    recomputeTeam(team, now);
  });

  if (state.eventLog.length > maxEvents) state.eventLog.splice(0, state.eventLog.length - maxEvents);
  const seenKeys = Object.keys(state.seenEventIds);
  if (seenKeys.length > maxSeen) {
    seenKeys
      .sort((a, b) => state.seenEventIds[a] - state.seenEventIds[b])
      .slice(0, seenKeys.length - maxSeen)
      .forEach((key) => delete state.seenEventIds[key]);
  }
}

export function degradeStaleSessions(state, now = Date.now(), staleAfter = 5 * 60_000) {
  Object.values(state.teams).forEach((team) => {
    Object.values(team.pods).forEach((pod) => {
      if (pod.lifecycle === 'active' && now - pod.lastActivityAt > staleAfter) {
        pod.activity = 'unknown';
      }
    });
    recomputeTeam(team, now);
  });
}

export function createSyntheticEvents(start = Date.now()) {
  const minute = 60_000;
  return [
    { eventId: 'demo-1', timestamp: start, provider: 'codex', surfaceKind: 'app', surfaceId: 'codex:app', eventType: 'session_started', sessionId: 'demo-fate', taskLabel: '命理研究', observationTier: 'A' },
    { eventId: 'demo-2', timestamp: start + 100, provider: 'codex', surfaceKind: 'app', surfaceId: 'codex:app', eventType: 'turn_started', sessionId: 'demo-fate', taskLabel: '命理研究', observationTier: 'A' },
    { eventId: 'demo-3', timestamp: start + 200, provider: 'codex', surfaceKind: 'app', surfaceId: 'codex:app', eventType: 'agent_spawned', sessionId: 'demo-fate', agentId: 'fate-researcher', agentType: 'researcher', observationTier: 'A' },
    { eventId: 'demo-4', timestamp: start + 300, provider: 'codex', surfaceKind: 'app', surfaceId: 'codex:app', eventType: 'session_started', sessionId: 'demo-office', taskLabel: '辦公室動畫', observationTier: 'A' },
    { eventId: 'demo-5', timestamp: start + 400, provider: 'codex', surfaceKind: 'app', surfaceId: 'codex:app', eventType: 'agent_spawned', sessionId: 'demo-office', agentId: 'office-reviewer', agentType: 'reviewer', observationTier: 'A' },
    { eventId: 'demo-6', timestamp: start + 500, provider: 'claude', surfaceKind: 'cli', surfaceId: 'claude:cli', eventType: 'session_started', sessionId: 'demo-claude-review', taskLabel: '設計反方審查', observationTier: 'A' },
    { eventId: 'demo-7', timestamp: start + 600, provider: 'claude', surfaceKind: 'cli', surfaceId: 'claude:cli', eventType: 'turn_started', sessionId: 'demo-claude-review', taskLabel: '設計反方審查', observationTier: 'A' },
    { eventId: 'demo-8', timestamp: start + 700, provider: 'gemini', surfaceKind: 'cli', surfaceId: 'gemini:cli', eventType: 'session_started', sessionId: 'demo-gemini', taskLabel: '資料整理', observationTier: 'A' },
    { eventId: 'demo-9', timestamp: start + 800, provider: 'gemini', surfaceKind: 'cli', surfaceId: 'gemini:cli', eventType: 'delegation_started', sessionId: 'demo-gemini', agentId: 'gemini-tool-1', agentType: '委派工具', ephemeral: true, observationTier: 'A' },
    { eventId: 'demo-10', timestamp: start + minute, provider: 'grok', surfaceKind: 'cli', surfaceId: 'grok:cli', eventType: 'session_started', sessionId: 'demo-grok', taskLabel: '反例檢查', observationTier: 'A' }
  ];
}

export function summarizeState(state) {
  const teams = Object.values(state.teams);
  const pods = teams.flatMap((team) => Object.values(team.pods));
  const agents = pods.flatMap((pod) => Object.values(pod.agents));
  return {
    teamCount: teams.length,
    podCount: pods.length,
    agentCount: agents.filter((agent) => agent.lifecycle !== 'finished').length,
    unassignedCount: teams.reduce((sum, team) => sum + Object.keys(team.unassigned).length, 0),
    delegationCount: teams.reduce((sum, team) => sum + Object.keys(team.delegations).length, 0),
    waitingOwnerCount: pods.filter((pod) => pod.activity === 'waiting_owner').length,
    eventCount: state.eventLog.length
  };
}
