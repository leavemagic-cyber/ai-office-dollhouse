import { PEOPLE_PER_ANNEX } from './floor-layout.js';

export const SCHEMA_VERSION = 1;

export const RESOURCE_LIMITS = Object.freeze({
  sessionPodsPerProvider: 64,
  detailedAgentsPerPod: 32,
  unassignedAgentsPerProvider: 128,
  delegationsPerProvider: 128
});

const POD_CAPACITY_OMITTED = Symbol('pod-capacity-omitted');

export const BASE_PROJECT_SLOTS = 3;
export const BASE_PROJECT_CAPACITY = 2;

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
  'research_started',
  'review_started',
  'test_started',
  'build_started',
  'document_started',
  'context_started',
  'context_compaction_started',
  'external_wait_started',
  'rate_limit_started',
  'process_crash_reported',
  'meeting_started',
  'meeting_completed',
  'task_completed',
  'session_stopped',
  'agent_spawned',
  'agent_finished',
  'agent_failed',
  'process_crash_reported',
  'agent_cancelled',
  'delegation_started',
  'delegation_finished',
  'acting_lead_handoff',
  'discussion_started',
  'discussion_ended',
  'revision_requested',
  'review_passed',
  'delegated_decision_granted',
  'decision_recorded'
]);

const IMPORTANT_EVENTS = new Set([
  'owner_input_required',
  'task_completed',
  'session_stopped',
  'agent_failed',
  'adapter_disconnected',
  'acting_lead_handoff',
  'discussion_started',
  'revision_requested',
  'review_passed',
  'delegated_decision_granted',
  'decision_recorded'
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
      lastEventAt: null,
      lastTierAEventAtByProvider: {}
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
  const rawParticipants = Array.isArray(raw?.participantProviders || raw?.participant_providers)
    ? (raw.participantProviders || raw.participant_providers)
    : [];
  const rawChairProvider = raw?.chairProvider || raw?.chair_provider
    || raw?.moderatorProvider || raw?.moderator_provider || raw?.chair || raw?.moderator || null;
  const chairProvider = rawChairProvider ? normalizeProvider(rawChairProvider) : 'other';
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
    correlationId: safeLabel(raw?.correlationId || raw?.correlation_id || '', '', 64),
    targetProvider: raw?.targetProvider || raw?.target_provider ? normalizeProvider(raw.targetProvider || raw.target_provider) : null,
    participantProviders: [...new Set(rawParticipants.map(normalizeProvider).filter((item) => item !== 'other'))],
    chairProvider: chairProvider === 'other' ? null : chairProvider,
    authorityScope: safeLabel(raw?.authorityScope || raw?.authority_scope || '', '', 42),
    taskLabel: safeLabel(raw?.taskLabel || raw?.task_label || raw?.safeLabel || raw?.safe_label),
    role: safeLabel(raw?.role || raw?.agentType || raw?.agent_type || '', '', 24),
    toolName: safeLabel(raw?.toolName || raw?.tool_name || '', '', 30),
    visualKind: safeLabel(raw?.visualKind || raw?.visual_kind || raw?.animationKind || raw?.animation_kind || '', '', 24).toLowerCase(),
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
      omittedSessionStarts: 0,
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
    if (Object.keys(team.pods).length >= RESOURCE_LIMITS.sessionPodsPerProvider) {
      if (event.eventType === 'session_started' || event.eventType === 'session_observed') team.omittedSessionStarts += 1;
      return POD_CAPACITY_OMITTED;
    }
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
      lastImportantEvent: null,
      idleFrom: 'derived',
      idleSinceAt: event.timestamp,
      deliveredCount: 0,
      deliveredAt: null,
      actingLeadAgentId: null,
      discussionId: null,
      discussionProviders: [],
      discussionChairProvider: null,
      delegatedAuthority: null,
      overflowAgentCount: 0,
      restingOverflowCount: 0,
      restingOverflowAt: null,
      floorAssignment: null,
      baseSlot: null
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

export function activePodPopulation(pod) {
  return Math.max(1,
    Object.values(pod?.agents || {}).length
      + Math.max(0, Number(pod?.overflowAgentCount) || 0)
      + Math.max(0, Number(pod?.restingOverflowCount) || 0));
}

/**
 * First-floor residency is allocated once and an execution-floor promotion is sticky.
 * A project moves upstairs as soon as it reaches three active AIs, or immediately when
 * all three small-project slots are already occupied. It never moves back downstairs.
 */
export function reconcileFloorAssignments(state) {
  const activePods = Object.values(state?.teams || {})
    .flatMap((team) => Object.values(team?.pods || {}))
    .filter((pod) => pod.lifecycle === 'active')
    .sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0)
      || String(left.id || '').localeCompare(String(right.id || '')));

  const occupied = new Set();
  for (const pod of activePods) {
    pod.restingOverflowCount = Math.max(0, Number(pod.restingOverflowCount) || 0);
    if (pod.floorAssignment === 'execution') {
      pod.baseSlot = null;
      continue;
    }
    if (activePodPopulation(pod) >= 3) {
      pod.floorAssignment = 'execution';
      pod.baseSlot = null;
      continue;
    }
    const slot = Number(pod.baseSlot);
    if (pod.floorAssignment === 'base'
      && Number.isInteger(slot)
      && slot >= 0
      && slot < BASE_PROJECT_SLOTS
      && !occupied.has(slot)) {
      occupied.add(slot);
      continue;
    }
    pod.floorAssignment = null;
    pod.baseSlot = null;
  }

  for (const pod of activePods) {
    if (pod.floorAssignment) continue;
    const slot = Array.from({ length: BASE_PROJECT_SLOTS }, (_, index) => index)
      .find((index) => !occupied.has(index));
    if (slot === undefined) {
      pod.floorAssignment = 'execution';
      pod.baseSlot = null;
    } else {
      pod.floorAssignment = 'base';
      pod.baseSlot = slot;
      occupied.add(slot);
    }
  }
}

function setPodActivity(pod, activity, { resolvesOwnerRequest = false } = {}) {
  if (pod.activity === 'waiting_owner' && !resolvesOwnerRequest) return;
  pod.activity = activity;
  if (activity !== 'unknown') delete pod.unknownSinceAt;
}

function recomputeTeam(team, timestamp) {
  const pods = Object.values(team.pods);
  const activePods = pods.filter((pod) => pod.lifecycle === 'active');
  const waiting = activePods.some((pod) => pod.activity === 'waiting_owner');
  const running = activePods.some((pod) => pod.activity === 'running');
  team.lifecycle = waiting || running || activePods.length ? 'active' : pods.length ? 'sleeping' : 'empty';

  const agentCount = activePods.reduce((sum, pod) => (
    sum + Object.values(pod.agents).filter((agent) => agent.lifecycle !== 'finished').length + Math.max(0, pod.overflowAgentCount || 0)
  ), 0);
  const nextAnnex = Math.max(1, Math.ceil(agentCount / PEOPLE_PER_ANNEX));
  if (nextAnnex !== team.annexCount) {
    team.annexCount = nextAnnex;
    team.expansionAt = timestamp;
  }
}

function recomputeOwner(state) {
  const waitingCount = Object.values(state.teams).reduce((total, team) => (
    total + Object.values(team.pods).filter((pod) => (
      pod.lifecycle === 'active' && pod.activity === 'waiting_owner'
    )).length
  ), 0);
  state.owner.inboxCount = waitingCount;
  state.owner.activity = waitingCount ? 'attention' : 'idle';
}

function terminalAgentActivity(eventType) {
  if (eventType === 'agent_failed') return 'failed';
  if (eventType === 'agent_cancelled') return 'cancelled';
  return 'delivered';
}

const WORK_VISUAL_KINDS = new Set([
  'coding', 'research', 'search', 'test', 'git', 'merge_conflict', 'build',
  'document', 'night', 'context', 'external_wait', 'rate_limit', 'review', 'whiteboard', 'crash'
]);

/** Only explicit structured event facts may select a specific work vignette. */
export function workVisualForEvent(event) {
  if (WORK_VISUAL_KINDS.has(event?.visualKind)) return event.visualKind;
  const eventMap = {
    research_started: 'research', review_started: 'review', test_started: 'test',
    build_started: 'build', document_started: 'document', context_started: 'context',
    context_compaction_started: 'context', external_wait_started: 'external_wait',
    rate_limit_started: 'rate_limit', process_crash_reported: 'crash'
  };
  if (eventMap[event?.eventType]) return eventMap[event.eventType];
  return null;
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
    const detailedCount = Object.values(pod.agents).filter((agent) => agent.lifecycle !== 'finished').length;
    if (detailedCount >= RESOURCE_LIMITS.detailedAgentsPerPod) {
      pod.overflowAgentCount = Math.min(Number.MAX_SAFE_INTEGER, (pod.overflowAgentCount || 0) + 1);
    } else {
      pod.agents[event.agentId] = {
        id: event.agentId,
        parentAgentId,
        role: event.role || 'subagent',
        activity: 'working',
        lifecycle: 'active',
        createdAt: event.timestamp,
        lastActivityAt: event.timestamp,
        finishedAt: null,
        seatOrdinal: Math.max(0, detailedCount - 1),
        isMain: false
      };
    }
    const main = mainAgent(pod);
    if (main) main.role = 'manager';
    pod.role = 'manager';
    setPodActivity(pod, 'running');
  } else {
    const agent = pod.agents[event.agentId];
    if (!agent) {
      if (pod.overflowAgentCount > 0) {
        pod.overflowAgentCount -= 1;
        pod.restingOverflowCount = Math.min(3, (pod.restingOverflowCount || 0) + 1);
        pod.restingOverflowAt = event.timestamp;
        if (event.eventType === 'agent_failed') pod.lastImportantEvent = 'agent_failed';
        return;
      }
      team.unassigned[event.agentId] = {
        id: event.agentId,
        role: event.role || '未歸屬',
        activity: event.eventType === 'agent_failed' || event.eventType === 'agent_cancelled'
          ? terminalAgentActivity(event.eventType)
          : 'unknown',
        lifecycle: 'unknown',
        createdAt: event.timestamp,
        lastActivityAt: event.timestamp
      };
      return;
    }
    agent.lifecycle = 'finished';
    agent.activity = terminalAgentActivity(event.eventType);
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
  if (event.observationTier === 'A' && event.provider !== 'other') {
    state.metrics.lastTierAEventAtByProvider[event.provider] = Math.max(
      Number(state.metrics.lastTierAEventAtByProvider[event.provider]) || 0,
      event.timestamp
    );
  }
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
    const team = state.teams[event.provider];
    Object.values(team?.pods || {}).forEach((pod) => {
      if (pod.lifecycle !== 'active') return;
      if (pod.activity !== 'waiting_owner') {
        pod.activity = 'unknown';
        pod.unknownSinceAt = event.timestamp;
      }
      for (const agent of Object.values(pod.agents || {})) {
        if (agent.lifecycle !== 'finished') agent.activity = 'unknown';
      }
    });
  } else if (SESSION_EVENTS.has(event.eventType)) {
    const pod = ensurePod(state, event);
    if (pod === POD_CAPACITY_OMITTED) {
      state.metrics.rejected += 1;
      addDiagnostic(state, 'warn', 'pod_capacity', `Provider ${event.provider} 同時工作階段超過安全顯示容量`, event.timestamp);
      compactOfficeState(state, now);
      return { applied: false, reason: 'pod_capacity', event };
    }
    if (!pod) {
      state.metrics.rejected += 1;
      addDiagnostic(state, 'warn', 'session_id_missing', `${event.eventType} 缺少 session ID`, event.timestamp);
      compactOfficeState(state, now);
      return { applied: false, reason: 'session_id_missing', event };
    }
    if (pod.lifecycle === 'completed'
      && !['session_started', 'session_observed', 'session_title'].includes(event.eventType)) {
      state.metrics.rejected += 1;
      addDiagnostic(state, 'info', 'terminal_session_event', `Ignored ${event.eventType} after session stop`, event.timestamp);
      compactOfficeState(state, now);
      return { applied: false, reason: 'terminal_session_event', event };
    }
    const main = mainAgent(pod);
    switch (event.eventType) {
      case 'session_started':
      case 'session_observed':
        pod.lifecycle = 'active';
        setPodActivity(pod, 'idle');
        pod.idleFrom = 'derived';
        pod.idleSinceAt = event.timestamp;
        break;
      case 'session_title':
        pod.label = event.taskLabel;
        break;
      case 'turn_started':
        pod.lifecycle = 'active';
        setPodActivity(pod, 'running');
        pod.idleFrom = null;
        pod.idleSinceAt = null;
        if (main) main.activity = 'working';
        // A turn starting proves work, but not what physical vignette is truthful.
        pod.workVisual = null;
        break;
      case 'turn_completed':
        setPodActivity(pod, 'idle');
        pod.idleFrom = 'turn_completed';
        pod.idleSinceAt = event.timestamp;
        if (main) main.activity = 'delivered';
        pod.workVisual = null;
        break;
      case 'owner_input_required':
        pod.activity = 'waiting_owner';
        pod.lastImportantEvent = 'owner_input_required';
        break;
      case 'owner_input_received':
        setPodActivity(pod, 'running', { resolvesOwnerRequest: true });
        pod.idleFrom = null;
        pod.idleSinceAt = null;
        break;
      case 'tool_started':
        setPodActivity(pod, 'running');
        pod.idleFrom = null;
        pod.idleSinceAt = null;
        if (main) {
          main.activity = 'working';
          main.role = event.toolName ? safeLabel(event.toolName, main.role, 22) : main.role;
        }
        pod.workVisual = workVisualForEvent(event);
        break;
      case 'tool_finished':
        if (main) main.activity = 'working';
        pod.workVisual = null;
        break;
      case 'research_started':
      case 'review_started':
      case 'test_started':
      case 'build_started':
      case 'document_started':
      case 'context_started':
      case 'context_compaction_started':
      case 'external_wait_started':
      case 'rate_limit_started':
      case 'process_crash_reported':
        setPodActivity(pod, 'running');
        pod.workVisual = workVisualForEvent(event);
        if (main) main.activity = 'working';
        break;
      case 'task_completed':
        setPodActivity(pod, 'idle', { resolvesOwnerRequest: true });
        pod.lastImportantEvent = 'task_completed';
        pod.idleFrom = 'derived';
        pod.idleSinceAt = event.timestamp;
        pod.deliveredCount = Math.min(Number.MAX_SAFE_INTEGER, (pod.deliveredCount || 0) + 1);
        pod.deliveredAt = event.timestamp;
        if (main) main.activity = 'delivered';
        break;
      case 'session_stopped':
        pod.lifecycle = 'completed';
        setPodActivity(pod, 'completed', { resolvesOwnerRequest: true });
        pod.completedAt = event.timestamp;
        pod.lastImportantEvent = 'session_stopped';
        pod.closingUntil = event.timestamp + 12_000;
        pod.workVisual = null;
        for (const agent of Object.values(pod.agents)) {
          agent.activity = 'completed';
          agent.lifecycle = 'finished';
          agent.finishedAt = event.timestamp;
        }
        pod.overflowAgentCount = 0;
        pod.restingOverflowCount = 0;
        break;
      case 'agent_spawned':
      case 'agent_finished':
      case 'agent_failed':
      case 'agent_cancelled':
      case 'delegation_started':
      case 'delegation_finished':
        applyAgentEvent(state, event, pod);
        break;
      case 'acting_lead_handoff':
        setPodActivity(pod, 'running');
        pod.actingLeadAgentId = event.agentId || event.parentAgentId || null;
        pod.lastImportantEvent = 'acting_lead_handoff';
        break;
      case 'discussion_started':
      case 'meeting_started':
        setPodActivity(pod, 'discussing');
        pod.discussionId = event.correlationId || event.eventId;
        // The provider identifies the project that emitted the event, not a meeting
        // attendee. Participants are an independent structured set and are never inferred
        // from the executing session, target provider, or process identity.
        pod.discussionProviders = [...new Set(event.participantProviders
          .filter((provider) => provider && provider !== 'other'))].slice(0, 4);
        pod.discussionChairProvider = pod.discussionProviders.includes(event.chairProvider)
          ? event.chairProvider
          : null;
        pod.lastImportantEvent = 'discussion_started';
        pod.discussionVisual = event.visualKind || null;
        break;
      case 'discussion_ended':
      case 'meeting_completed':
        if (event.participantProviders.length < 2 && pod.discussionProviders.length >= 2) {
          event.participantProviders = [...pod.discussionProviders];
        }
        if (!event.chairProvider && pod.discussionChairProvider) {
          event.chairProvider = pod.discussionChairProvider;
        }
        setPodActivity(pod, 'running');
        pod.discussionId = null;
        pod.discussionProviders = [];
        pod.discussionChairProvider = null;
        pod.discussionVisual = null;
        break;
      case 'revision_requested':
        setPodActivity(pod, 'running');
        pod.lastImportantEvent = 'revision_requested';
        break;
      case 'review_passed':
        setPodActivity(pod, 'idle');
        pod.lastImportantEvent = 'review_passed';
        break;
      case 'delegated_decision_granted':
        setPodActivity(pod, 'running');
        pod.delegatedAuthority = event.authorityScope || 'delegated';
        pod.lastImportantEvent = 'delegated_decision_granted';
        break;
      case 'decision_recorded':
        setPodActivity(pod, 'idle');
        pod.lastImportantEvent = 'decision_recorded';
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

  reconcileFloorAssignments(state);
  Object.values(state.teams).forEach((team) => recomputeTeam(team, event.timestamp));
  recomputeOwner(state);
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

  reconcileFloorAssignments(state);
  Object.values(state.teams).forEach((team) => {
    Object.values(team.pods).forEach((pod) => {
      Object.entries(pod.agents).forEach(([id, agent]) => {
        if (pod.lifecycle !== 'active' && !agent.isMain && agent.finishedAt && now - agent.finishedAt > agentTtl) {
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
    const unassigned = Object.entries(team.unassigned);
    if (unassigned.length > RESOURCE_LIMITS.unassignedAgentsPerProvider) {
      unassigned.sort((a, b) => a[1].lastActivityAt - b[1].lastActivityAt)
        .slice(0, unassigned.length - RESOURCE_LIMITS.unassignedAgentsPerProvider)
        .forEach(([id]) => delete team.unassigned[id]);
    }
    Object.entries(team.delegations).forEach(([id, delegation]) => {
      if (now - delegation.startedAt > agentTtl) delete team.delegations[id];
    });
    const delegations = Object.entries(team.delegations);
    if (delegations.length > RESOURCE_LIMITS.delegationsPerProvider) {
      delegations.sort((a, b) => a[1].startedAt - b[1].startedAt)
        .slice(0, delegations.length - RESOURCE_LIMITS.delegationsPerProvider)
        .forEach(([id]) => delete team.delegations[id]);
    }
    recomputeTeam(team, now);
  });
  recomputeOwner(state);

  if (state.eventLog.length > maxEvents) state.eventLog.splice(0, state.eventLog.length - maxEvents);
  const seenKeys = Object.keys(state.seenEventIds);
  if (seenKeys.length > maxSeen) {
    seenKeys
      .sort((a, b) => state.seenEventIds[a] - state.seenEventIds[b])
      .slice(0, seenKeys.length - maxSeen)
      .forEach((key) => delete state.seenEventIds[key]);
  }
}

export function degradeStaleSessions(state, now = Date.now(), staleAfter = 10 * 60_000) {
  Object.values(state.teams).forEach((team) => {
    Object.values(team.pods).forEach((pod) => {
      if (pod.lifecycle !== 'active') return;
      if (pod.activity === 'waiting_owner') {
        // This is an unresolved Owner request, not stale work. Refresh its
        // display heartbeat so active-only mode keeps the Owner floor visible
        // until a resolving event arrives.
        pod.lastActivityAt = Math.max(Number(pod.lastActivityAt) || 0, now);
      } else if (now - pod.lastActivityAt > staleAfter) {
        pod.activity = 'unknown';
        // Preserve when the evidence first became stale. Using `now` would resurrect an
        // ancient replay for a fresh uncertainty window on every application restart.
        pod.unknownSinceAt ||= Number(pod.lastActivityAt || 0) + staleAfter;
        for (const agent of Object.values(pod.agents || {})) {
          if (agent.lifecycle !== 'finished') agent.activity = 'unknown';
        }
      }
    });
    recomputeTeam(team, now);
  });
  recomputeOwner(state);
}

export function summarizeState(state) {
  const teams = Object.values(state.teams);
  const pods = teams.flatMap((team) => Object.values(team.pods));
  const agents = pods.flatMap((pod) => Object.values(pod.agents));
  return {
    teamCount: teams.length,
    podCount: pods.length,
    agentCount: agents.filter((agent) => agent.lifecycle !== 'finished').length + pods.reduce((sum, pod) => sum + Math.max(0, pod.overflowAgentCount || 0), 0),
    unassignedCount: teams.reduce((sum, team) => sum + Object.keys(team.unassigned).length, 0),
    delegationCount: teams.reduce((sum, team) => sum + Object.keys(team.delegations).length, 0),
    waitingOwnerCount: pods.filter((pod) => pod.activity === 'waiting_owner').length,
    eventCount: state.eventLog.length
  };
}
