import { floorForEvent, PROVIDER_ROOMS, SHARED_FLOOR_KEY } from './floor-layout.js';

export const SIGNATURE_EVENTS = Object.freeze({
  agent_spawned: { code: 'A', kind: 'arrival', duration: 8_000, priority: 5 },
  acting_lead_handoff: { code: 'B', kind: 'handoff', duration: 8_000, priority: 7 },
  discussion_started: { code: 'C', kind: 'discussion', duration: 10_000, priority: 6 },
  discussion_ended: { code: null, kind: 'discussion_return', duration: 8_000, priority: 6 },
  meeting_started: { code: 'C', kind: 'discussion', duration: 10_000, priority: 6 },
  meeting_completed: { code: null, kind: 'discussion_return', duration: 8_000, priority: 6 },
  agent_failed: { code: 'D', kind: 'error', duration: 10_000, priority: 9 },
  // A structured cancellation is a truthful neutral terminal state.  It must
  // not borrow the red error cue or any successful-delivery cue.
  agent_cancelled: { code: null, kind: 'cancelled', duration: 6_500, priority: 4 },
  revision_requested: { code: 'E', kind: 'revision', duration: 9_000, priority: 7 },
  review_passed: { code: 'F', kind: 'approved', duration: 8_000, priority: 6 },
  owner_input_required: { code: 'G', kind: 'owner_request', duration: 12_000, priority: 10 },
  delegated_decision_granted: { code: 'H', kind: 'authority', duration: 10_000, priority: 8 },
  multi_delivery: { code: 'I', kind: 'multi_delivery', duration: 8_000, priority: 8 },
  task_completed: { code: 'J', kind: 'final_delivery', duration: 12_000, priority: 9 }
});

function signatureCandidates(model, now) {
  const candidates = [];
  for (const event of model?.recentEvents || []) {
    const definition = SIGNATURE_EVENTS[event.eventType];
    if (!definition || now - event.timestamp < -1_000 || now - event.timestamp > 20_000) continue;
    candidates.push({
      id: event.eventId,
      event,
      timestamp: event.timestamp,
      ...definition
    });
  }
  for (const stopped of (model?.recentEvents || []).filter((event) => event.eventType === 'session_stopped')) {
    if (now - stopped.timestamp < -1_000 || now - stopped.timestamp > 20_000) continue;
    candidates.push({
      id: `close:${stopped.eventId}`,
      event: stopped,
      timestamp: stopped.timestamp,
      code: null,
      // task_completed already owns the full J chain. Session close only removes the
      // floor afterwards; replaying a second Owner report would interrupt and duplicate J.
      kind: 'closing_departure',
      duration: 12_000,
      priority: 8
    });
  }
  for (const provider of PROVIDER_ROOMS) {
    const deliveries = (model?.recentEvents || []).filter((event) =>
      event.provider === provider && event.eventType === 'agent_finished' && now - event.timestamp >= -1_000 && now - event.timestamp < 8_000
    );
    if (deliveries.length < 2) continue;
    const newest = Math.max(...deliveries.map((event) => event.timestamp));
    const definition = SIGNATURE_EVENTS.multi_delivery;
    candidates.push({
      id: `multi:${provider}:${newest}`,
      event: { ...deliveries[deliveries.length - 1], eventType: 'multi_delivery' },
      deliveries,
      timestamp: newest,
      ...definition
    });
  }
  return candidates;
}

export class ChoreographyCoordinator {
  constructor({ maxQueue = 24, retentionMs = 45_000 } = {}) {
    this.maxQueue = maxQueue;
    this.retentionMs = retentionMs;
    this.queue = [];
    this.active = null;
    this.seen = new Map();
  }

  ingest(model, now = Date.now()) {
    for (const candidate of signatureCandidates(model, now)) {
      if (this.seen.has(candidate.id)) continue;
      this.seen.set(candidate.id, now);
      this.queue.push(candidate);
    }
    this.queue.sort((a, b) => b.priority - a.priority || a.timestamp - b.timestamp);
    if (this.queue.length > this.maxQueue) this.queue.length = this.maxQueue;
    if (this.active && this.queue[0]?.priority > this.active.priority) {
      const interrupted = { ...this.active };
      delete interrupted.startedAt;
      this.queue.push(interrupted);
      this.active = null;
      this.queue.sort((a, b) => b.priority - a.priority || a.timestamp - b.timestamp);
      if (this.queue.length > this.maxQueue) this.queue.length = this.maxQueue;
    }
    for (const [id, seenAt] of this.seen) {
      if (now - seenAt > this.retentionMs) this.seen.delete(id);
    }
  }

  current(now = Date.now()) {
    if (this.active && now - this.active.startedAt >= this.active.duration) this.active = null;
    while (!this.active && this.queue.length) {
      const next = this.queue.shift();
      if (now - next.timestamp > this.retentionMs) continue;
      this.active = { ...next, startedAt: now };
    }
    if (!this.active) return null;
    return {
      ...this.active,
      progress: Math.max(0, Math.min(1, (now - this.active.startedAt) / this.active.duration))
    };
  }

  clear() {
    this.queue.length = 0;
    this.active = null;
    this.seen.clear();
  }
}

export function cueAppearsOnFloor(cue, { room, annexIndex = 0 }, model) {
  if (!cue) return false;
  // The single-floor view is the whole building on one plate, so every cue belongs to it.
  // Without this the default view plays no signature animation at all.
  if (room === 'all') return true;
  const provider = cue.event.provider;
  if (!PROVIDER_ROOMS.includes(provider)) return false;
  // A cue plays on the floor its session actually sits on: its own team floor, or the
  // shared office when the session never opened subagents.
  const events = cue.deliveries?.length ? cue.deliveries : [cue.event];
  const floors = events.map((event) => floorForEvent(model, provider, event));
  // Owner, all first-floor small projects and the permanent discussion room share one
  // physical plate. Owner request/authority/delivery also reach this destination even
  // when their source project is upstairs.
  if (room === 'owner') {
    return ['owner_request', 'authority', 'final_delivery', 'closing_report', 'discussion', 'discussion_return'].includes(cue.kind)
      || floors.some((floor) => floor.room === 'owner');
  }
  // Discussion AIs are an independent runtime participant set and may differ from the
  // executing AIs. They exist only in the permanent first-floor meeting room; execution
  // floors continue their work and never blank out or duplicate these participants.
  if (cue.kind === 'discussion' || cue.kind === 'discussion_return') return false;
  if (room === 'lobby') return false;
  if (room === SHARED_FLOOR_KEY) return floors.some((floor) => floor.room === SHARED_FLOOR_KEY);
  if (provider !== room) return false;
  return floors.some((floor) => floor.room === room && floor.annexIndex === annexIndex);
}

export const globalChoreography = new ChoreographyCoordinator();
