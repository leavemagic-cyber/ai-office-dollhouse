import test from 'node:test';
import assert from 'node:assert/strict';

import { ChoreographyCoordinator, cueAppearsOnFloor, SIGNATURE_EVENTS } from '../resources/js/choreography.js';
import { observationForSourceEvidence, sourceEvidenceFor } from '../resources/js/event-evidence.js';
import { completionStage, ownerIdleActionAt, ownerRequestStage } from '../resources/js/renderer.js';

function observedEvent(value) {
  const sourceEvidence = value.sourceEvidence || sourceEvidenceFor(value.eventType);
  return {
    ...observationForSourceEvidence(sourceEvidence),
    sourceEvidence,
    ...value
  };
}

function observedModel(recentEvents) {
  return { recentEvents: recentEvents.map(observedEvent) };
}

test('all Owner-approved A-J signature codes have a real event mapping', () => {
  assert.deepEqual([...new Set(Object.values(SIGNATURE_EVENTS).map((item) => item.code).filter(Boolean))].sort(), 'ABCDEFGHIJ'.split(''));
});

test('Owner signatures keep the approved physical beats', () => {
  assert.deepEqual([0, .4, .65, .9].map(ownerRequestStage), ['leave_team', 'elevator', 'three_knocks', 'request_queue']);
  assert.deepEqual([0, .35, .55, .78, .95].map(completionStage), ['worker_to_lead', 'lead_accepts', 'lead_to_lift', 'elevator', 'owner_report']);
  assert.deepEqual([0, 8_000, 16_000].map(ownerIdleActionAt), ['coffee', 'documents', 'rest']);
});

test('explicit cancellation uses a neutral cue, never the error or delivery cue', () => {
  const now = 80_000;
  const coordinator = new ChoreographyCoordinator();
  coordinator.ingest(observedModel([
    { eventId: 'cancelled', provider: 'codex', eventType: 'agent_cancelled', timestamp: now, sessionId: 's1' }
  ]), now);
  const cue = coordinator.current(now);
  assert.equal(cue.kind, 'cancelled');
  assert.equal(cue.code, null);
  assert.notEqual(cue.kind, 'error');
  assert.notEqual(cue.kind, 'final_delivery');
});

test('signature cues are provider-neutral, source-gated, and initial seeds stay silent', () => {
  const now = 85_000;
  const taskStart = new ChoreographyCoordinator();
  taskStart.ingest(observedModel([
    { eventId: 'started', provider: 'codex', eventType: 'task_started', timestamp: now, sessionId: 's1', observationTier: 'B', sourceConfidence: 'local_session_record', sourceEvidence: 'session:task_started' }
  ]), now);
  assert.equal(taskStart.current(now).kind, 'arrival');
  assert.equal(taskStart.current(now).code, 'A');

  const delivery = new ChoreographyCoordinator();
  delivery.ingest(observedModel([
    { eventId: 'completed', provider: 'claude', eventType: 'task_completed', timestamp: now, sessionId: 's1', sourceEvidence: 'hook:task_completed' }
  ]), now);
  assert.equal(delivery.current(now).kind, 'final_delivery');
  assert.equal(delivery.current(now).code, 'J');

  const directDispatch = new ChoreographyCoordinator();
  directDispatch.ingest(observedModel([
    { eventId: 'dispatch', provider: 'codex', eventType: 'delegation_requested', timestamp: now, sessionId: 's1', observationTier: 'B', sourceConfidence: 'local_session_record', sourceEvidence: 'session:delegation_requested' }
  ]), now + 1);
  assert.equal(directDispatch.current(now + 1).kind, 'delegation_request');
  assert.equal(directDispatch.current(now + 1).code, 'B', 'a directly observed dispatch gets the B intent beat');

  const directMessage = new ChoreographyCoordinator();
  directMessage.ingest(observedModel([
    { eventId: 'message', provider: 'codex', eventType: 'coordination_message', timestamp: now, sessionId: 's1', sourceEvidence: 'session:coordination_message' }
  ]), now);
  assert.equal(directMessage.current(now).code, 'C', 'a directly observed message gets the C communication beat');

  const directRevision = new ChoreographyCoordinator();
  directRevision.ingest(observedModel([
    { eventId: 'patch', provider: 'codex', eventType: 'patch_apply_ended', timestamp: now, sessionId: 's1', sourceEvidence: 'session:patch_apply_ended' }
  ]), now);
  assert.equal(directRevision.current(now).code, 'E', 'a directly observed patch action gets the E revision beat');

  const ownerReply = new ChoreographyCoordinator();
  ownerReply.ingest(observedModel([
    { eventId: 'reply', provider: 'codex', eventType: 'owner_input_received', timestamp: now, sessionId: 's1', sourceEvidence: 'session:owner_input_received' }
  ]), now);
  assert.equal(ownerReply.current(now).kind, 'owner_response');
  assert.equal(ownerReply.current(now).code, 'H', 'a directly observed Owner reply gets the H response beat');

  const initialSeed = new ChoreographyCoordinator();
  initialSeed.ingest(observedModel([
    { eventId: 'old-completion', provider: 'gemini', eventType: 'task_completed', timestamp: now, sessionId: 's1', animationEligible: false, sourceEvidence: 'hook:task_completed' }
  ]), now);
  assert.equal(initialSeed.current(now), null, 'old state seeds must not replay a big delivery animation');

  const inventedReview = new ChoreographyCoordinator();
  inventedReview.ingest(observedModel([
    { eventId: 'not-a-review', provider: 'grok', eventType: 'review_passed', timestamp: now, sessionId: 's1', sourceEvidence: 'hook:task_completed' }
  ]), now);
  assert.equal(inventedReview.current(now), null, 'a completion record is never relabelled as a review pass');

  const explicitReview = new ChoreographyCoordinator();
  explicitReview.ingest(observedModel([
    { eventId: 'review', provider: 'gemini', eventType: 'review_passed', timestamp: now, sessionId: 's1', sourceEvidence: 'orchestration:review_passed' }
  ]), now);
  assert.equal(explicitReview.current(now).code, 'F');

  const namedReviewCommand = new ChoreographyCoordinator();
  namedReviewCommand.ingest(observedModel([
    { eventId: 'named-review', provider: 'codex', eventType: 'review_passed', timestamp: now, sessionId: 's1', sourceEvidence: 'session:review_passed' }
  ]), now);
  assert.equal(namedReviewCommand.current(now).code, 'F', 'an explicit review-passed command is a real Tier-B action');
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
  coordinator.ingest(observedModel(events), now);
  assert.equal(coordinator.queue.length, 3);
  assert.equal(coordinator.current(now).code, 'G');
});

test('a newly arrived higher-priority cue preempts but preserves the active lower-priority cue', () => {
  const now = 70_000;
  const coordinator = new ChoreographyCoordinator();
  coordinator.ingest(observedModel([
    { eventId: 'a', provider: 'codex', eventType: 'agent_spawned', timestamp: now, sessionId: 's1' }
  ]), now);
  assert.equal(coordinator.current(now).code, 'A');
  coordinator.ingest(observedModel([
    { eventId: 'a', provider: 'codex', eventType: 'agent_spawned', timestamp: now, sessionId: 's1' },
    { eventId: 'g', provider: 'codex', eventType: 'owner_input_required', timestamp: now + 100, sessionId: 's1' }
  ]), now + 100);
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
  // A two-person-or-smaller project lives on the first floor, not a provider floor.
  assert.equal(cueAppearsOnFloor(request, { room: 'shared' }, model), false);
  assert.equal(cueAppearsOnFloor(request, { room: 'codex', annexIndex: 1 }, model), false);
  const discussion = { kind: 'discussion', event: { provider: 'codex', sessionId: 's1' } };
  assert.equal(cueAppearsOnFloor(discussion, { room: 'owner' }, model), true);
  assert.equal(cueAppearsOnFloor(discussion, { room: 'codex', annexIndex: 0 }, model), false, 'independent discussion AIs never blank an execution floor');
  assert.equal(cueAppearsOnFloor(discussion, { room: 'lobby' }, model), false);
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
  assert.equal(SIGNATURE_EVENTS.session_stopped, undefined, 'closing a session is not proof of delivery');
  // The single-floor view is the whole building, and it is the default under 13 people:
  // if cues skipped it, the Owner would never see a signature animation at all.
  assert.equal(cueAppearsOnFloor(delivery, { room: 'all' }, model), true);
  assert.equal(cueAppearsOnFloor({ kind: 'owner_request', event: { provider: 'grok', sessionId: 'x' } }, { room: 'all' }, model), true);
});

test('two timely subagent deliveries synthesize the I queue animation', () => {
  const now = 90_000;
  const coordinator = new ChoreographyCoordinator();
  coordinator.ingest(observedModel([
    { eventId: 'x1', provider: 'grok', eventType: 'agent_finished', timestamp: now - 200, sessionId: 's1' },
    { eventId: 'x2', provider: 'grok', eventType: 'agent_finished', timestamp: now - 100, sessionId: 's1' }
  ]), now);
  const cue = coordinator.current(now);
  assert.equal(cue.code, 'I');
  assert.equal(cue.deliveries.length, 2);
});

test('session close never duplicates or preempts the task-completed J report', () => {
  const now = 120_000;
  const stopped = { eventId: 'stop', provider: 'codex', eventType: 'session_stopped', timestamp: now, sessionId: 's1' };
  const withoutDelivery = new ChoreographyCoordinator();
  withoutDelivery.ingest(observedModel([stopped]), now);
  assert.equal(withoutDelivery.current(now).kind, 'closing_departure');

  const withDelivery = new ChoreographyCoordinator();
  withDelivery.ingest(observedModel([
    { eventId: 'done', provider: 'codex', eventType: 'task_completed', timestamp: now - 500, sessionId: 's1' },
    stopped
  ]), now);
  assert.equal(withDelivery.current(now).kind, 'final_delivery');
  withDelivery.active.startedAt = now - withDelivery.active.duration;
  assert.equal(withDelivery.current(now).kind, 'closing_departure');
});
