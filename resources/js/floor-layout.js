export const PROVIDER_ROOMS = Object.freeze(['codex', 'claude', 'gemini', 'grok']);
export const MAX_RENDERED_ANNEXES_PER_PROVIDER = 12;
export const PEOPLE_PER_ANNEX = 14;
// Owner, 2026-08-12: one floor shows at most six people. Above that the figures would
// have to be shrunk to fit, and a shrunken figure is a worse answer than an honest "+N".
export const FLOOR_WORKSTATIONS = 6;
// Recent work history is context, never competition for the live office. When no
// lifecycle-backed work exists, keep only a small newest-first static digest visible.
export const MAX_VISIBLE_SNAPSHOT_FLOORS = 2;
// Retained only as a neutral destination for a short cue whose session can no longer be
// matched. Live work never mixes providers on this floor.
export const SHARED_FLOOR_KEY = 'shared';

const LIVE_EVENT_FRESH_MS = 10 * 60_000;
// Unknown is a bounded uncertainty state, not a permanent second kind of "live".
// A real adapter disconnect gets ten minutes of frozen visibility; an ancient replay
// whose uncertainty began long ago expires immediately instead of rebuilding old floors.
export const UNKNOWN_FREEZE_MS = 10 * 60_000;
const CURRENT_PRESENCE_FRESH_MS = 60_000;
const IMPORTANT_EVENT_FRESH_MS = 20_000;

export function floorKey(room, annexIndex = 0) {
  return annexIndex > 0 ? `${room}:${annexIndex + 1}` : room;
}

/** Headcount a session shows: the main worker plus its subagents, summarised overflow included. */
export function sessionPopulation(session) {
  return Math.max(1, (session?.agents || []).length + Math.max(0, Number(session?.overflowAgentCount) || 0));
}

/**
 * Whether a session has subagents remains useful for population and presentation, but
 * every live session now owns a provider-isolated floor regardless of this value.
 */
export function sessionHasSubagents(session) {
  return sessionPopulation(session) > 1;
}

/**
 * One provider's sessions in display order. Live pods win outright; only a provider with
 * no live pod at all falls back to its recent snapshot work, which is the same precedence
 * the renderer uses when it turns a model into people.
 */
export function sessionsForProvider(providerState) {
  const live = providerState?.livePods || [];
  if (live.length) {
    return live.map((pod, index) => ({
      id: pod.id,
      label: pod.label,
      index,
      source: 'live',
      activity: pod.activity,
      updatedAt: Number(pod.lastActivityAt) || 0,
      population: sessionPopulation(pod),
      team: sessionHasSubagents(pod)
    }));
  }
  return (providerState?.snapshotWork || []).filter((work) => work.recent).map((work, index) => ({
    id: work.id,
    label: work.label,
    index,
    source: 'snapshot',
    // A snapshot proves that a work record exists, not that it is executing now.
    activity: 'snapshot',
    updatedAt: Number(work.updatedAt) || 0,
    // Snapshot work lists helpers only, so the main worker is added on top.
    population: Math.max(1, 1 + (work.agents || []).length),
    team: (work.agents || []).length > 0 || Number(work.openChildren) > 0
  }));
}

/** One provider's sessions, each on its own floor, capped at the renderable count. */
export function teamSessions(model, room) {
  if (!PROVIDER_ROOMS.includes(room)) return [];
  return sessionsForProvider(model?.providers?.[room])
    .slice(0, MAX_RENDERED_ANNEXES_PER_PROVIDER);
}

/** Compatibility surface: cross-provider live work is never co-located. */
export function sharedFloorSessions(model) {
  void model;
  return [];
}

function titleFor(roomMeta, room) {
  return roomMeta?.[room]?.title || room;
}

function recentImportantEvents(model, room) {
  const now = Number(model?.generatedAt) || Date.now();
  return (model?.recentEvents || []).filter((event) => {
    const age = now - Number(event?.timestamp || 0);
    if (age < 0 || age > IMPORTANT_EVENT_FRESH_MS) return false;
    // Finished work is reported to the Owner in person, so a delivery has to be able to
    // open the Owner floor even when the inbox is empty (signature J).
    if (room === 'owner') return ['owner_input_required', 'task_completed'].includes(event?.eventType) || event?.targetProvider === 'owner';
    if (room === 'lobby') return event?.eventType === 'discussion_started' || (event?.participantProviders || []).length > 1;
    return event?.provider === room && Boolean(event?.important);
  });
}

export function floorPopulationForDisplay(model, room, annexIndex = 0) {
  // Owner is the permanent resident. Visitors add to the room; they never determine
  // whether the Owner exists.
  if (room === 'owner') return 1 + Math.min(3, Number(model?.owner?.inboxCount || 0));
  if (room === 'lobby') {
    return Object.values(model?.providers || {}).reduce((sum, provider) => (
      sum + (provider?.livePods || []).filter((pod) => pod.activity === 'discussing').length
    ), 0);
  }
  if (room === SHARED_FLOOR_KEY) {
    const total = sharedFloorSessions(model).reduce((sum, session) => sum + session.population, 0);
    return Math.min(FLOOR_WORKSTATIONS, total);
  }
  if (!PROVIDER_ROOMS.includes(room)) return 0;
  // One provider floor is one subagent team, so its population is that session's own.
  const session = teamSessions(model, room)[annexIndex];
  // A recent snapshot may keep a truthful static work card visible, but it never creates
  // a person. Only lifecycle-backed live sessions contribute office population.
  return session?.source === 'live' ? Math.min(FLOOR_WORKSTATIONS, session.population) : 0;
}

export function floorHasUsefulWork(spec, model) {
  if (!spec) return false;
  if (floorPopulationForDisplay(model, spec.room, spec.annexIndex) > 0) return true;
  if (PROVIDER_ROOMS.includes(spec.room)) {
    const session = teamSessions(model, spec.room)[spec.annexIndex];
    if (session?.source === 'snapshot') return true;
  }
  if (spec.room === SHARED_FLOOR_KEY) {
    // Shared live work is forbidden. An unmatched transient cue is skipped instead of
    // opening an empty cross-provider shell that looks like a workplace.
    return false;
  }
  const events = recentImportantEvents(model, spec.room);
  if (!events.length) return false;
  if (!PROVIDER_ROOMS.includes(spec.room)) return true;
  return events.some((event) => floorForEvent(model, spec.room, event).annexIndex === spec.annexIndex);
}

export function floorSpecsForModel(model, roomMeta, options = {}) {
  const activeOnly = Boolean(options.activeOnly);
  const specs = [];
  const ownerSpec = { key: 'owner', room: 'owner', annexIndex: 0, annexCount: 1, title: titleFor(roomMeta, 'owner') };
  // The Owner decision room is an independent, permanent top floor. activeOnly only
  // applies to work floors and must never hide or merge this room.
  specs.push(ownerSpec);
  const liveSpecs = [];
  const snapshotSpecs = [];
  for (const room of PROVIDER_ROOMS) {
    const sessions = teamSessions(model, room);
    const allSessions = sessionsForProvider(model?.providers?.[room]).length;
    for (const [annexIndex, session] of sessions.entries()) {
      // The floor is named after the project or task, not after the provider: the Owner
      // needs to see which piece of work owns the floor.
      const label = String(session.label || '').trim();
      const spec = {
        key: floorKey(room, annexIndex),
        room,
        annexIndex,
        annexCount: sessions.length,
        sessionId: session.id,
        sessionLabel: label,
        evidenceSource: session.source,
        updatedAt: Number(session.updatedAt) || 0,
        overflowSummary: annexIndex === sessions.length - 1 && allSessions > sessions.length,
        title: label ? `${titleFor(roomMeta, room)}・${label}` : titleFor(roomMeta, room)
      };
      if (!activeOnly || floorHasUsefulWork(spec, model)) {
        (session.source === 'live' ? liveSpecs : snapshotSpecs).push(spec);
      }
    }
  }
  // A real task must never be pushed below historical cards. While any Tier-A session
  // is live, history disappears from the active overlay. With no live work, a bounded
  // newest-first snapshot digest remains available without pretending to be staffed.
  snapshotSpecs.sort((left, right) => right.updatedAt - left.updatedAt || left.key.localeCompare(right.key));
  specs.push(...liveSpecs);
  if (!liveSpecs.length) specs.push(...snapshotSpecs.slice(0, MAX_VISIBLE_SNAPSHOT_FLOORS));
  const lobbySpec = { key: 'lobby', room: 'lobby', annexIndex: 0, annexCount: 1, title: titleFor(roomMeta, 'lobby') };
  if (!activeOnly || floorHasUsefulWork(lobbySpec, model)) specs.push(lobbySpec);
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
  return Object.values(team?.pods || {}).filter((pod) => {
    if (pod?.lifecycle !== 'active') return false;
    // A disconnected adapter changes certainty, not lifecycle. Freeze the last reliable
    // Tier-A pod in grey for a bounded interval. `unknownSinceAt` is the evidence boundary;
    // falling back to lastActivityAt keeps older persisted state safe to replay.
    if (pod.activity === 'unknown') {
      const unknownAge = now - Number(pod.unknownSinceAt || pod.lastActivityAt || 0);
      return unknownAge >= 0 && unknownAge < UNKNOWN_FREEZE_MS;
    }
    const age = now - Number(pod.lastActivityAt || 0);
    return age >= 0 && age < LIVE_EVENT_FRESH_MS;
  });
}

export function annexCountForDisplay(livePods = [], snapshotWork = []) {
  const livePopulation = livePods.reduce((sum, pod) => (
    sum + Math.max(1, (pod.agents || []).length + Math.max(0, pod.overflowAgentCount || 0))
  ), 0);
  const snapshotPopulation = snapshotWork.filter((work) => work.recent).reduce((sum, work) => (
    sum + Math.max(1, 1 + (work.agents || []).length)
  ), 0);
  return Math.max(1, Math.ceil(Math.max(livePopulation, snapshotPopulation) / PEOPLE_PER_ANNEX));
}

/**
 * Which provider floor a session is standing on. Missing or expired session IDs return a
 * neutral compatibility destination that is never rendered as an active shared floor.
 */
export function floorForSession(model, room, sessionId) {
  const shared = { room: SHARED_FLOOR_KEY, annexIndex: 0 };
  if (!PROVIDER_ROOMS.includes(room)) return shared;
  const teams = sessionsForProvider(model?.providers?.[room]);
  const index = teams.findIndex((session) => matchesSession(session.id, sessionId));
  if (index < 0) return shared;
  // A team past the rendered floor cap is summarised on the last floor, not moved into
  // the shared office: its cue must not open an empty "no solo work" plate.
  return { room, annexIndex: Math.min(index, MAX_RENDERED_ANNEXES_PER_PROVIDER - 1) };
}

export function floorForEvent(model, room, event) {
  return floorForSession(model, room, event?.sessionId);
}

function matchesSession(podId, sessionId) {
  if (!sessionId) return false;
  const id = String(podId || '');
  return id === String(sessionId) || id.endsWith(`:${sessionId}`);
}
