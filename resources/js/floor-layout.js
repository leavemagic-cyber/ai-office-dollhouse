export const PROVIDER_ROOMS = Object.freeze(['codex', 'claude', 'gemini', 'grok']);
export const MAX_RENDERED_ANNEXES_PER_PROVIDER = 12;
export const BASE_PROJECT_SLOTS = 3;
export const BASE_PROJECT_CAPACITY = 2;
export const EXECUTION_STAFF_WORKSTATIONS = 6;
export const EXECUTION_REST_SEATS = 3;
// Compatibility name used by renderer/tests: staff capacity excludes the supervisor.
export const FLOOR_WORKSTATIONS = EXECUTION_STAFF_WORKSTATIONS;
export const PEOPLE_PER_ANNEX = 1 + EXECUTION_STAFF_WORKSTATIONS;
export const MAX_VISIBLE_SNAPSHOT_FLOORS = 0;
export const SHARED_FLOOR_KEY = 'shared';

const LIVE_EVENT_FRESH_MS = 10 * 60_000;
export const UNKNOWN_FREEZE_MS = 10 * 60_000;
const CURRENT_PRESENCE_FRESH_MS = 60_000;

export function floorKey(room, annexIndex = 0) {
  return annexIndex > 0 ? `${room}:${annexIndex + 1}` : room;
}

export function sessionPopulation(session) {
  return Math.max(1, (session?.agents || []).length + Math.max(0, Number(session?.overflowAgentCount) || 0));
}

export function sessionHasSubagents(session) {
  return sessionPopulation(session) > 1;
}

export function sessionsForProvider(providerState) {
  const live = providerState?.livePods || [];
  if (live.length) {
    return live.map((pod, index) => ({
      id: pod.id,
      label: pod.label,
      index,
      provider: pod.provider || null,
      source: 'live',
      activity: pod.activity,
      createdAt: Number(pod.createdAt) || Number(pod.lastActivityAt) || index,
      updatedAt: Number(pod.lastActivityAt) || 0,
      population: sessionPopulation(pod),
      team: sessionHasSubagents(pod),
      floorAssignment: pod.floorAssignment || null,
      baseSlot: Number.isInteger(pod.baseSlot) ? pod.baseSlot : null
    }));
  }
  return (providerState?.snapshotWork || []).filter((work) => work.recent).map((work, index) => ({
    id: work.id,
    label: work.label,
    index,
    provider: null,
    source: 'snapshot',
    activity: 'snapshot',
    createdAt: Number(work.updatedAt) || index,
    updatedAt: Number(work.updatedAt) || 0,
    population: 0,
    team: false,
    floorAssignment: null,
    baseSlot: null
  }));
}

/**
 * Stable cross-provider project roster. Current models contain assignments from
 * domain.js; the fallback allocator only protects cached models during an upgrade.
 */
export function liveProjectSessions(model) {
  const sessions = PROVIDER_ROOMS.flatMap((provider) =>
    sessionsForProvider(model?.providers?.[provider])
      .filter((session) => session.source === 'live')
      .map((session) => ({ ...session, provider }))
  ).sort((left, right) => left.createdAt - right.createdAt
    || left.provider.localeCompare(right.provider)
    || String(left.id).localeCompare(String(right.id)));

  const occupied = new Set();
  for (const session of sessions) {
    if (session.floorAssignment === 'execution' || session.population >= 3) {
      session.floorAssignment = 'execution';
      session.baseSlot = null;
      continue;
    }
    if (session.floorAssignment === 'base'
      && session.baseSlot >= 0
      && session.baseSlot < BASE_PROJECT_SLOTS
      && !occupied.has(session.baseSlot)) {
      occupied.add(session.baseSlot);
      continue;
    }
    session.floorAssignment = null;
    session.baseSlot = null;
  }
  for (const session of sessions) {
    if (session.floorAssignment) continue;
    const slot = Array.from({ length: BASE_PROJECT_SLOTS }, (_, index) => index)
      .find((index) => !occupied.has(index));
    if (slot === undefined) {
      session.floorAssignment = 'execution';
    } else {
      session.floorAssignment = 'base';
      session.baseSlot = slot;
      occupied.add(slot);
    }
  }
  return sessions;
}

export function baseFloorSessions(model) {
  return liveProjectSessions(model)
    .filter((session) => session.floorAssignment === 'base')
    .sort((left, right) => left.baseSlot - right.baseSlot);
}

export function executionSessions(model) {
  return liveProjectSessions(model).filter((session) => session.floorAssignment === 'execution');
}

/** Each execution project owns one floor; provider is identity, not floor grouping. */
export function teamSessions(model, room) {
  if (!PROVIDER_ROOMS.includes(room)) return [];
  return executionSessions(model)
    .filter((session) => session.provider === room)
    .slice(0, MAX_RENDERED_ANNEXES_PER_PROVIDER);
}

export function sharedFloorSessions(model) {
  void model;
  return [];
}

function titleFor(roomMeta, room) {
  return roomMeta?.[room]?.title || room;
}

/** The permanent meeting room uses the latest unmatched discussion start event. */
export function orderedDiscussionProviders(providers, chairProvider = null) {
  const participants = [...new Set((providers || []).filter((provider) => PROVIDER_ROOMS.includes(provider)))].slice(0, 4);
  if (!chairProvider || !participants.includes(chairProvider)) return participants;
  return [chairProvider, ...participants.filter((provider) => provider !== chairProvider)];
}

export function activeDiscussionProviders(model) {
  const events = model?.recentEvents || [];
  const ended = new Set();
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const key = event?.correlationId || `${event?.provider || ''}:${event?.sessionId || ''}`;
    if (event?.eventType === 'discussion_ended' || event?.eventType === 'meeting_completed') {
      ended.add(key);
      continue;
    }
    if (!['discussion_started', 'meeting_started'].includes(event?.eventType) || ended.has(key)) continue;
    const explicit = orderedDiscussionProviders(event.participantProviders, event.chairProvider);
    if (explicit.length >= 2) return explicit.slice(0, 4);
  }
  for (const provider of PROVIDER_ROOMS) {
    const pod = (model?.providers?.[provider]?.livePods || []).find((candidate) => candidate.activity === 'discussing');
    if (!pod) continue;
    const participants = orderedDiscussionProviders(pod.discussionProviders, pod.discussionChairProvider);
    if (participants.length >= 2) return participants;
  }
  return [];
}

export function floorPopulationForDisplay(model, room, annexIndex = 0) {
  if (room === 'owner') {
    const projects = baseFloorSessions(model).reduce((sum, session) => sum + Math.min(BASE_PROJECT_CAPACITY, session.population), 0);
    return 1 + projects + activeDiscussionProviders(model).length;
  }
  if (!PROVIDER_ROOMS.includes(room)) return 0;
  const session = teamSessions(model, room)[annexIndex];
  if (!session) return 0;
  return Math.min(PEOPLE_PER_ANNEX, session.population);
}

export function floorHasUsefulWork(spec, model) {
  if (!spec) return false;
  if (spec.room === 'owner') return true;
  return floorPopulationForDisplay(model, spec.room, spec.annexIndex) > 0;
}

export function floorSpecsForModel(model, roomMeta, options = {}) {
  void options;
  const specs = [{
    key: 'owner',
    room: 'owner',
    annexIndex: 0,
    annexCount: 1,
    title: titleFor(roomMeta, 'owner')
  }];
  const byProvider = new Map();
  for (const session of executionSessions(model)) {
    const annexIndex = byProvider.get(session.provider) || 0;
    byProvider.set(session.provider, annexIndex + 1);
    if (annexIndex >= MAX_RENDERED_ANNEXES_PER_PROVIDER) continue;
    specs.push({
      key: `execution:${session.id}`,
      room: session.provider,
      annexIndex,
      annexCount: 1,
      sessionId: session.id,
      sessionLabel: session.label,
      evidenceSource: 'live',
      updatedAt: session.updatedAt,
      title: session.label || titleFor(roomMeta, session.provider)
    });
  }
  return specs;
}

export function currentPresenceOpen(surfaces, provider, now = Date.now()) {
  return (surfaces || []).some((surface) => (
    surface?.provider === provider
    && surface.observationTier === 'D'
    && surface.appOpen === true
    && now - Number(surface.lastSeenAt || 0) >= 0
    && now - Number(surface.lastSeenAt || 0) < CURRENT_PRESENCE_FRESH_MS
  ));
}

export function livePodsForDisplay(team, surfaces, provider, now = Date.now()) {
  void surfaces;
  void provider;
  return Object.values(team?.pods || {}).filter((pod) => {
    if (pod?.lifecycle === 'completed' && Number(pod.closingUntil) > now) return true;
    if (pod?.lifecycle !== 'active') return false;
    if (pod.activity === 'unknown') {
      const unknownAge = now - Number(pod.unknownSinceAt || pod.lastActivityAt || 0);
      return unknownAge >= 0 && unknownAge < UNKNOWN_FREEZE_MS;
    }
    const age = now - Number(pod.lastActivityAt || 0);
    return age >= 0 && age < LIVE_EVENT_FRESH_MS;
  });
}

export function annexCountForDisplay(livePods = [], snapshotWork = []) {
  const livePopulation = livePods.reduce((sum, pod) => sum + sessionPopulation(pod), 0);
  const snapshotPopulation = snapshotWork.filter((work) => work.recent).reduce((sum, work) => (
    sum + Math.max(1, 1 + (work.agents || []).length)
  ), 0);
  return Math.max(1, Math.ceil(Math.max(livePopulation, snapshotPopulation) / PEOPLE_PER_ANNEX));
}

export function floorForSession(model, room, sessionId) {
  const shared = { room: SHARED_FLOOR_KEY, annexIndex: 0 };
  if (!PROVIDER_ROOMS.includes(room) || !sessionId) return shared;
  const session = liveProjectSessions(model).find((candidate) => (
    candidate.provider === room && matchesSession(candidate.id, sessionId)
  ));
  if (!session) return shared;
  if (session.floorAssignment === 'base') return { room: 'owner', annexIndex: 0 };
  const providerFloors = teamSessions(model, room);
  const index = providerFloors.findIndex((candidate) => matchesSession(candidate.id, sessionId));
  if (index < 0) return shared;
  return { room, annexIndex: Math.min(index, MAX_RENDERED_ANNEXES_PER_PROVIDER - 1) };
}

export function floorForEvent(model, room, event) {
  if (['discussion_started', 'discussion_ended', 'meeting_started', 'meeting_completed'].includes(event?.eventType)) {
    return { room: 'owner', annexIndex: 0 };
  }
  return floorForSession(model, room, event?.sessionId);
}

function matchesSession(podId, sessionId) {
  if (!sessionId) return false;
  const id = String(podId || '');
  return id === String(sessionId) || id.endsWith(`:${sessionId}`);
}
