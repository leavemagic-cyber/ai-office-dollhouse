import test from 'node:test';
import assert from 'node:assert/strict';

import { ChoreographyCoordinator, cueAppearsOnFloor, SIGNATURE_EVENTS } from '../resources/js/choreography.js';

test('all Owner-approved A-J signature codes have a real event mapping', () => {
  assert.deepEqual([...new Set(Object.values(SIGNATURE_EVENTS).map((item) => item.code).filter(Boolean))].sort(), 'ABCDEFGHIJ'.split(''));
});

test('explicit cancellation uses a neutral cue, never the error or delivery cue', () => {
  const now = 80_000;
  const coordinator = new ChoreographyCoordinator();
  coordinator.ingest({ recentEvents: [
    { eventId: 'cancelled', provider: 'codex', eventType: 'agent_cancelled', timestamp: now, sessionId: 's1' }
  ] }, now);
  const cue = coordinator.current(now);
  assert.equal(cue.kind, 'cancelled');
  assert.equal(cue.code, null);
  assert.notEqual(cue.kind, 'error');
  assert.notEqual(cue.kind, 'final_delivery');
});

test('global choreography queue is bounded and prioritizes an Owner request', () => {
  const now = 50_000;
  const coordinator = new ChoreographyCoordinator({ maxQueue: 3 });
  const events = [
    { eventId: 'a', provider: 'codex', eventType: 'agent_spawned', timestamp: now, sessionId: 's1' },
    { eventId: 'd', provider: 'codex', eventType: 'agent_failed', timestamp: now, sessionId: 's1' },
    { eventId: 'g', provider: 'codex', eventType: 'owner_input_required', timestamp: now, sessionId: 's1' },
    { eventId: 'f', provider: 'claude', eventType: 'review_passed', timestamp: now, sessionId: 's2' }
  ];
  coordinator.ingest({ recentEvents: events }, now);
  assert.equal(coordinator.queue.length, 3);
  assert.equal(coordinator.current(now).code, 'G');
});

test('a newly arrived higher-priority cue preempts but preserves the active lower-priority cue', () => {
  const now = 70_000;
  const coordinator = new ChoreographyCoordinator();
  coordinator.ingest({ recentEvents: [
    { eventId: 'a', provider: 'codex', eventType: 'agent_spawned', timestamp: now, sessionId: 's1' }
  ] }, now);
  assert.equal(coordinator.current(now).code, 'A');
  coordinator.ingest({ recentEvents: [
    { eventId: 'a', provider: 'codex', eventType: 'agent_spawned', timestamp: now, sessionId: 's1' },
    { eventId: 'g', provider: 'codex', eventType: 'owner_input_required', timestamp: now + 100, sessionId: 's1' }
  ] }, now + 100);
  assert.equal(coordinator.current(now + 100).code, 'G');
  assert.ok(coordinator.queue.some((cue) => cue.code === 'A'));
});

test('cross-floor request and discussion cues appear only on truthful destination floors', () => {
  const model = {
    providers: {
      codex: { livePods: [{ id: 'pod:codex:s1', agents: Array.from({ length: 14 }, () => ({})) }, { id: 'pod:codex:s2', agents: [{}] }] },
      claude: { livePods: [] }, gemini: { livePods: [] }, grok: { livePods: [] }
    }
  };
  const request = { kind: 'owner_request', event: { provider: 'codex', sessionId: 's2' } };
  assert.equal(cueAppearsOnFloor(request, { room: 'owner' }, model), true);
  assert.equal(cueAppearsOnFloor(request, { room: 'codex', annexIndex: 0 }, model), false);
  // s2 is a lone worker, so it has no floor of its own: its cue plays in the shared office.
  assert.equal(cueAppearsOnFloor(request, { room: 'shared' }, model), true);
  assert.equal(cueAppearsOnFloor(request, { room: 'codex', annexIndex: 1 }, model), false);
  const discussion = { kind: 'discussion', event: { provider: 'codex', sessionId: 's1' } };
  assert.equal(cueAppearsOnFloor(discussion, { room: 'lobby' }, model), true);
  assert.equal(cueAppearsOnFloor(discussion, { room: 'gemini' }, model), false);
});

test('a finished task is reported to the Owner, on the Owner floor and the team floor', () => {
  const model = {
    providers: {
      codex: { livePods: [{ id: 'pod:codex:s1', agents: [{ isMain: true }, {}, {}] }] },
      claude: { livePods: [] }, gemini: { livePods: [] }, grok: { livePods: [] }
    }
  };
  // Signature J is the walk to the Owner's room, so it has to reach both ends of the trip.
  const delivery = { kind: 'final_delivery', event: { provider: 'codex', sessionId: 's1' } };
  assert.equal(cueAppearsOnFloor(delivery, { room: 'owner' }, model), true);
  assert.equal(cueAppearsOnFloor(delivery, { room: 'codex', annexIndex: 0 }, model), true);
  assert.equal(cueAppearsOnFloor(delivery, { room: 'claude' }, model), false);
  assert.equal(cueAppearsOnFloor(delivery, { room: 'shared' }, model), false);
  assert.equal(SIGNATURE_EVENTS.task_completed.code, 'J');
  assert.equal(SIGNATURE_EVENTS.task_completed.kind, 'final_delivery');
  // The single-floor view is the whole building, and it is the default under 13 people:
  // if cues skipped it, the Owner would never see a signature animation at all.
  assert.equal(cueAppearsOnFloor(delivery, { room: 'all' }, model), true);
  assert.equal(cueAppearsOnFloor({ kind: 'owner_request', event: { provider: 'grok', sessionId: 'x' } }, { room: 'all' }, model), true);
});

test('two timely subagent deliveries synthesize the I queue animation', () => {
  const now = 90_000;
  const coordinator = new ChoreographyCoordinator();
  coordinator.ingest({ recentEvents: [
    { eventId: 'x1', provider: 'grok', eventType: 'agent_finished', timestamp: now - 200, sessionId: 's1' },
    { eventId: 'x2', provider: 'grok', eventType: 'agent_finished', timestamp: now - 100, sessionId: 's1' }
  ] }, now);
  const cue = coordinator.current(now);
  assert.equal(cue.code, 'I');
  assert.equal(cue.deliveries.length, 2);
});
