import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOfficeEvent,
  compactOfficeState,
  createInitialState,
  degradeStaleSessions,
  summarizeState,
  workVisualForEvent
} from '../resources/js/domain.js';
import { observationForSourceEvidence, sourceEvidenceFor } from '../resources/js/event-evidence.js';

const base = 1_800_000_000_000;

function event(overrides = {}) {
  const value = {
    eventId: `e-${Math.random()}`,
    timestamp: base,
    provider: 'codex',
    surfaceId: 'codex:app',
    surfaceKind: 'app',
    eventType: 'session_started',
    sessionId: 'session-a',
    taskLabel: '命理',
    ...overrides
  };
  if (!Object.prototype.hasOwnProperty.call(overrides, 'sourceEvidence')) {
    value.sourceEvidence = sourceEvidenceFor(value.eventType);
  }
  const observation = observationForSourceEvidence(value.sourceEvidence);
  if (!Object.prototype.hasOwnProperty.call(overrides, 'observationTier')) {
    value.observationTier = observation.observationTier;
  }
  if (!Object.prototype.hasOwnProperty.call(overrides, 'sourceConfidence')) {
    value.sourceConfidence = observation.sourceConfidence;
  }
  return value;
}

test('every design-canon work vignette requires and accepts an explicit structured fact', () => {
  const explicit = [
    'coding', 'research', 'search', 'test', 'git', 'merge_conflict', 'build',
    'document', 'night', 'context', 'external_wait', 'rate_limit', 'review', 'whiteboard', 'crash'
  ];
  for (const visualKind of explicit) {
    assert.equal(workVisualForEvent({ eventType: 'tool_started', visualKind }), visualKind);
  }
  assert.equal(workVisualForEvent({ eventType: 'test_started' }), 'test');
  assert.equal(workVisualForEvent({ eventType: 'context_compaction_started' }), 'context');
  assert.equal(workVisualForEvent({ eventType: 'rate_limit_started' }), 'rate_limit');
  assert.equal(workVisualForEvent({ eventType: 'process_crash_reported' }), 'crash');
  assert.equal(workVisualForEvent({ eventType: 'tool_started', toolName: 'Write' }), null);
  assert.equal(workVisualForEvent({ eventType: 'tool_started', toolName: 'Grep' }), null);
  assert.equal(workVisualForEvent({ eventType: 'process_observed', visualKind: 'secret_thought' }), null, 'unknown evidence never invents a vignette');
});

test('same provider shares a team floor but keeps independent session pods', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({ eventId: 'a', sessionId: 'session-a', taskLabel: '命理' }), base);
  applyOfficeEvent(state, event({ eventId: 'b', sessionId: 'session-b', taskLabel: '辦公室動畫' }), base);

  assert.equal(Object.keys(state.teams).length, 1);
  assert.deepEqual(Object.keys(state.teams.codex.pods).sort(), ['session-a', 'session-b']);
  assert.equal(state.teams.codex.pods['session-a'].label, '命理');
  assert.equal(state.teams.codex.pods['session-b'].label, '辦公室動畫');
});

test('subagent stays in its session pod and promotes only that main agent', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({ eventId: 'a' }), base);
  applyOfficeEvent(state, event({
    eventId: 'agent-a',
    eventType: 'agent_spawned',
    agentId: 'child-a',
    agentType: 'researcher'
  }), base);

  const pod = state.teams.codex.pods['session-a'];
  assert.ok(pod.agents['child-a']);
  assert.equal(pod.agents['main:session-a'].role, 'manager');
  assert.equal(pod.role, 'manager');
});

test('process exit never completes a session', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({ eventId: 'a', eventType: 'turn_started' }), base);
  applyOfficeEvent(state, event({
    eventId: 'exit',
    eventType: 'process_exited',
    sessionId: null,
    processState: 'exited'
  }), base);

  assert.equal(state.teams.codex.pods['session-a'].lifecycle, 'active');
  assert.notEqual(state.teams.codex.pods['session-a'].activity, 'completed');
  assert.equal(state.surfaces['codex:app'].processState, 'exited');
});

test('turn idle, final delivery, and stopped keep distinct evidence', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({ eventId: 'start', eventType: 'session_started' }), base);
  let pod = state.teams.codex.pods['session-a'];
  assert.equal(pod.idleFrom, 'derived');
  assert.equal(pod.deliveredCount, 0);

  applyOfficeEvent(state, event({ eventId: 'turn', eventType: 'turn_started', timestamp: base + 1 }), base + 1);
  assert.equal(pod.idleFrom, null);
  applyOfficeEvent(state, event({ eventId: 'turn-done', eventType: 'turn_completed', timestamp: base + 2 }), base + 2);
  assert.equal(pod.activity, 'idle');
  assert.equal(pod.idleFrom, 'turn_completed');
  assert.equal(pod.deliveredCount, 0);

  applyOfficeEvent(state, event({ eventId: 'task-done', eventType: 'task_completed', timestamp: base + 3 }), base + 3);
  assert.equal(pod.activity, 'idle');
  assert.equal(pod.idleFrom, 'derived');
  assert.equal(pod.deliveredCount, 1);
  assert.equal(pod.deliveredAt, base + 3);

  applyOfficeEvent(state, event({ eventId: 'stop', eventType: 'session_stopped', timestamp: base + 4 }), base + 4);
  pod = state.teams.codex.pods['session-a'];
  assert.equal(pod.lifecycle, 'completed');
  assert.equal(pod.deliveredCount, 1, 'stopping never invents another delivery');
  const late = applyOfficeEvent(state, event({ eventId: 'late-turn', eventType: 'turn_completed', timestamp: base + 5 }), base + 5);
  assert.equal(late.applied, false);
  assert.equal(late.reason, 'terminal_session_event');
  assert.equal(pod.lifecycle, 'completed');
});

test('direct task metadata drives a truthful task lifecycle without inventing an agent result', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({ eventId: 'task-start', eventType: 'task_started' }), base);
  let pod = state.teams.codex.pods['session-a'];
  assert.equal(pod.activity, 'running');
  assert.equal(pod.agents['main:session-a'].activity, 'working');

  applyOfficeEvent(state, event({ eventId: 'patch-ended', eventType: 'patch_apply_ended' }), base + 1);
  pod = state.teams.codex.pods['session-a'];
  assert.equal(pod.activity, 'running');
  assert.equal(pod.deliveredCount, 0, 'a patch end is not a review pass or delivery');

  applyOfficeEvent(state, event({ eventId: 'interrupted', eventType: 'task_interrupted' }), base + 2);
  pod = state.teams.codex.pods['session-a'];
  assert.equal(pod.activity, 'unknown');
  assert.equal(pod.agents['main:session-a'].activity, 'unknown');
  assert.equal(pod.lifecycle, 'active', 'an interruption is not a completed session');
});

test('special relationship state requires matching provider-neutral evidence', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({ eventId: 'start', eventType: 'session_started' }), base);
  const forgedTier = applyOfficeEvent(state, event({
    eventId: 'forged-hook-tier',
    eventType: 'task_completed',
    observationTier: 'B',
    sourceConfidence: 'local_session_record',
    sourceEvidence: 'hook:task_completed'
  }), base + 1);
  assert.equal(forgedTier.applied, false);
  assert.equal(forgedTier.reason, 'semantic_evidence_missing');

  const invented = applyOfficeEvent(state, event({
    eventId: 'invented-review',
    eventType: 'review_passed',
    provider: 'claude',
    surfaceId: 'claude:cli',
    sourceEvidence: 'hook:task_completed'
  }), base + 2);
  assert.equal(invented.applied, false);
  assert.equal(invented.reason, 'semantic_evidence_missing');

  const direct = applyOfficeEvent(state, event({
    eventId: 'direct-review',
    eventType: 'review_passed',
    provider: 'gemini',
    surfaceId: 'gemini:cli',
    sessionId: 'gemini-session',
    sourceEvidence: 'orchestration:review_passed'
  }), base + 3);
  assert.equal(direct.applied, true);
  assert.equal(state.teams.gemini.pods['gemini-session'].lastImportantEvent, 'review_passed');
});

test('Tier-B local session records never overwrite a matching Tier-A Codex pod', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({
    eventId: 'tier-a-turn',
    eventType: 'turn_started',
    observationTier: 'A',
    sourceConfidence: 'structured'
  }), base);
  const fallback = applyOfficeEvent(state, event({
    eventId: 'tier-b-seed',
    eventType: 'session_observed',
    observationTier: 'B',
    sourceConfidence: 'local_session_record',
    timestamp: base + 1
  }), base + 1);

  assert.equal(fallback.applied, false);
  assert.equal(fallback.reason, 'tier_a_precedence');
  const pod = state.teams.codex.pods['session-a'];
  assert.equal(pod.activity, 'running', 'a lower-confidence seed cannot reset actual hook work to idle');
  assert.equal(pod.lastTierAAt, base);
});

test('adapter disconnect degrades active work to unknown, not completed', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({ eventId: 'a', eventType: 'turn_started' }), base);
  applyOfficeEvent(state, event({ eventId: 'lost', eventType: 'adapter_disconnected', sessionId: null }), base);
  const pod = state.teams.codex.pods['session-a'];
  assert.equal(pod.activity, 'unknown');
  assert.equal(pod.lifecycle, 'active');
  assert.equal(pod.unknownSinceAt, base);
  assert.ok(Object.values(pod.agents).every((agent) => agent.activity === 'unknown'));
});

test('Gemini delegation is decoration and does not create population', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({
    eventId: 'gem-session',
    provider: 'gemini',
    surfaceId: 'gemini:cli',
    surfaceKind: 'cli',
    sessionId: 'gem-session'
  }), base);
  applyOfficeEvent(state, event({
    eventId: 'gem-delegation',
    provider: 'gemini',
    surfaceId: 'gemini:cli',
    surfaceKind: 'cli',
    sessionId: 'gem-session',
    eventType: 'delegation_started',
    agentId: 'tool-delegation',
    agentType: 'subagent-tool',
    ephemeral: true
  }), base);

  const summary = summarizeState(state);
  assert.equal(summary.agentCount, 1);
  assert.equal(summary.delegationCount, 1);
});

test('duplicate event is idempotent', () => {
  const state = createInitialState(base);
  const first = event({ eventId: 'same' });
  assert.equal(applyOfficeEvent(state, first, base).applied, true);
  assert.equal(applyOfficeEvent(state, first, base).applied, false);
  assert.equal(state.metrics.duplicates, 1);
  assert.equal(Object.keys(state.teams.codex.pods).length, 1);
});

test('completed child agents and pods are released after their TTL', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({ eventId: 'a' }), base);
  applyOfficeEvent(state, event({ eventId: 'spawn', eventType: 'agent_spawned', agentId: 'child' }), base);
  applyOfficeEvent(state, event({ eventId: 'finish', eventType: 'agent_finished', agentId: 'child' }), base + 10);
  applyOfficeEvent(state, event({ eventId: 'stop', eventType: 'session_stopped' }), base + 20);

  compactOfficeState(state, base + 1000, { agentTtl: 100, podTtl: 200 });
  assert.equal(Object.keys(state.teams.codex.pods).length, 0);
});

test('explicit subagent cancellation stays neutral rather than becoming a delivery or failure', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({ eventId: 'start-cancelled' }), base);
  applyOfficeEvent(state, event({ eventId: 'spawn-cancelled', eventType: 'agent_spawned', agentId: 'child-cancelled' }), base + 1);
  applyOfficeEvent(state, event({ eventId: 'cancelled', eventType: 'agent_cancelled', agentId: 'child-cancelled' }), base + 2);

  const child = state.teams.codex.pods['session-a'].agents['child-cancelled'];
  assert.equal(child.lifecycle, 'finished');
  assert.equal(child.activity, 'cancelled');
  assert.notEqual(child.activity, 'delivered');
  assert.notEqual(child.activity, 'failed');
  assert.equal(state.eventLog.at(-1).important, false);
});

test('unknown event and missing session are rejected without inventing work', () => {
  const state = createInitialState(base);
  assert.equal(applyOfficeEvent(state, event({ eventId: 'unknown', eventType: 'thinking_secretly' }), base).applied, false);
  assert.equal(applyOfficeEvent(state, event({ eventId: 'missing', eventType: 'turn_started', sessionId: null }), base).applied, false);
  assert.equal(Object.keys(state.teams).length, 0);
});

test('presence scan can change an open surface back to closed without completing work', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({
    eventId: 'presence-open',
    eventType: 'surface_discovered',
    sessionId: null,
    installed: true,
    appOpen: true,
    processState: 'open'
  }), base);
  applyOfficeEvent(state, event({
    eventId: 'presence-closed',
    eventType: 'surface_discovered',
    sessionId: null,
    installed: true,
    appOpen: false,
    processState: 'closed'
  }), base + 1);
  assert.equal(state.surfaces['codex:app'].appOpen, false);
});

test('Tier-A observation evidence survives event-log compaction', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({ eventId: 'tier-a', eventType: 'session_started' }), base);
  for (let index = 0; index < 4; index += 1) {
    applyOfficeEvent(state, event({
      eventId: `presence-${index}`,
      eventType: 'surface_discovered',
      sessionId: null,
      observationTier: 'D',
      timestamp: base + index + 1
    }), base + index + 1);
  }
  compactOfficeState(state, base + 10, { maxEvents: 1 });
  assert.equal(state.eventLog.length, 1);
  assert.equal(state.metrics.lastTierAEventAtByProvider.codex, base);
});

test('replayed active sessions become unknown when lifecycle evidence is stale', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({ eventId: 'running', eventType: 'turn_started' }), base);
  degradeStaleSessions(state, base + 10_000, 1000);
  const pod = state.teams.codex.pods['session-a'];
  assert.equal(pod.activity, 'unknown');
  assert.equal(pod.lifecycle, 'active');
  assert.equal(pod.unknownSinceAt, base + 1000, 'staleness begins at the evidence deadline, not application restart time');
  assert.ok(Object.values(pod.agents).every((agent) => agent.activity === 'unknown'));
});

test('the default stale window preserves a ten-minute running task', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({ eventId: 'long-running', eventType: 'turn_started' }), base);
  degradeStaleSessions(state, base + 9 * 60_000);
  assert.equal(state.teams.codex.pods['session-a'].activity, 'running');
  degradeStaleSessions(state, base + 10 * 60_000 + 1);
  assert.equal(state.teams.codex.pods['session-a'].activity, 'unknown');
});

test('unresolved Owner requests survive stale and disconnect degradation until explicitly resolved', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({
    eventId: 'wait', eventType: 'owner_input_required', sourceEvidence: 'session:owner_input_required'
  }), base);
  const pod = state.teams.codex.pods['session-a'];

  degradeStaleSessions(state, base + 10_000, 1000);
  assert.equal(pod.activity, 'waiting_owner');
  assert.equal(pod.lastActivityAt, base + 10_000);
  assert.equal(state.owner.inboxCount, 1);

  applyOfficeEvent(state, event({
    eventId: 'turn-after-wait', eventType: 'turn_started', sourceEvidence: 'session:lifecycle'
  }), base + 10_001);
  applyOfficeEvent(state, event({
    eventId: 'dispatch-after-wait', eventType: 'delegation_requested'
  }), base + 10_002);
  assert.equal(pod.activity, 'waiting_owner');
  assert.equal(state.owner.inboxCount, 1);

  applyOfficeEvent(state, event({
    eventId: 'disconnect',
    eventType: 'adapter_disconnected',
    sessionId: null
  }), base + 10_003);
  assert.equal(pod.activity, 'waiting_owner');
  assert.equal(state.owner.inboxCount, 1);

  applyOfficeEvent(state, event({ eventId: 'answer', eventType: 'owner_input_received' }), base + 10_004);
  assert.equal(pod.activity, 'running');
  assert.equal(state.owner.inboxCount, 0);
  degradeStaleSessions(state, base + 20_000, 1000);
  assert.equal(pod.activity, 'unknown');
});

test('signature choreography events are accepted only with a real session', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({ eventId: 'start' }), base);
  assert.equal(applyOfficeEvent(state, event({
    eventId: 'discussion',
    eventType: 'discussion_started',
    correlationId: 'review-room-1',
    participantProviders: ['claude', 'grok'],
    chairProvider: 'grok'
  }), base + 1).applied, true);
  const pod = state.teams.codex.pods['session-a'];
  assert.equal(pod.activity, 'discussing');
  assert.equal(pod.discussionId, 'review-room-1');
  assert.deepEqual(pod.discussionProviders, ['claude', 'grok'], 'the executing Codex provider is not invented as an attendee');
  assert.equal(pod.discussionChairProvider, 'grok');
  assert.deepEqual(state.eventLog.at(-1).participantProviders, ['claude', 'grok']);
  const ended = applyOfficeEvent(state, event({
    eventId: 'discussion-ended',
    eventType: 'discussion_ended',
    correlationId: 'review-room-1'
  }), base + 2);
  assert.deepEqual(ended.event.participantProviders, ['claude', 'grok'], 'return trip preserves the exact independent participant set');
  assert.equal(ended.event.chairProvider, 'grok', 'return trip preserves the Owner-selected chair');
  assert.equal(pod.activity, 'running');

  const meeting = applyOfficeEvent(state, event({
    eventId: 'meeting',
    eventType: 'meeting_started',
    correlationId: 'meeting-room-1',
    participantProviders: ['gemini', 'claude'],
    moderator_provider: 'claude'
  }), base + 3);
  assert.equal(meeting.applied, true);
  assert.deepEqual(pod.discussionProviders, ['gemini', 'claude']);
  assert.equal(pod.discussionChairProvider, 'claude');
  const meetingEnded = applyOfficeEvent(state, event({
    eventId: 'meeting-ended',
    eventType: 'meeting_completed',
    correlationId: 'meeting-room-1'
  }), base + 4);
  assert.deepEqual(meetingEnded.event.participantProviders, ['gemini', 'claude']);
  assert.equal(meetingEnded.event.chairProvider, 'claude');
  assert.equal(pod.activity, 'running');

  assert.equal(applyOfficeEvent(state, event({
    eventId: 'bad-discussion',
    eventType: 'discussion_started',
    sessionId: null
  }), base + 5).applied, false);
});

test('acting lead and delegated decision state remain tied to one session pod', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({ eventId: 'start' }), base);
  applyOfficeEvent(state, event({
    eventId: 'lead',
    eventType: 'acting_lead_handoff',
    agentId: 'review-lead'
  }), base + 1);
  applyOfficeEvent(state, event({
    eventId: 'authority',
    eventType: 'delegated_decision_granted',
    authorityScope: 'design review only'
  }), base + 2);
  const pod = state.teams.codex.pods['session-a'];
  assert.equal(pod.actingLeadAgentId, 'review-lead');
  assert.equal(pod.delegatedAuthority, 'design review only');
  assert.equal(state.teams.claude, undefined);
});

test('annex count expands vertically without changing session identity', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({ eventId: 'start' }), base);
  for (let index = 0; index < 20; index += 1) {
    applyOfficeEvent(state, event({
      eventId: `spawn-${index}`,
      eventType: 'agent_spawned',
      agentId: `child-${index}`
    }), base + index + 1);
  }
  assert.equal(Object.keys(state.teams.codex.pods).length, 1);
  assert.equal(state.teams.codex.annexCount, 3);
});

test('repeated Owner request events do not duplicate the same waiting visitor', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({
    eventId: 'wait-1', eventType: 'owner_input_required', sourceEvidence: 'session:owner_input_required'
  }), base);
  applyOfficeEvent(state, event({
    eventId: 'wait-2', eventType: 'owner_input_required', sourceEvidence: 'session:owner_input_required'
  }), base + 1);
  assert.equal(state.owner.inboxCount, 1);
  applyOfficeEvent(state, event({ eventId: 'answer', eventType: 'owner_input_received' }), base + 2);
  assert.equal(state.owner.inboxCount, 0);
});

test('explicit session stop releases every child agent with the pod', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({ eventId: 'spawn-stop', eventType: 'agent_spawned', agentId: 'child-stop' }), base);
  applyOfficeEvent(state, event({ eventId: 'stop-all', eventType: 'session_stopped' }), base + 1);
  assert.ok(Object.values(state.teams.codex.pods['session-a'].agents).every((agent) => agent.lifecycle === 'finished'));
  compactOfficeState(state, base + 1 + 31 * 60_000);
  assert.equal(state.teams.codex.pods['session-a'], undefined);
});

test('large live teams keep an exact overflow count while detailed agent objects stay bounded', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({ eventId: 'overflow-start' }), base);
  for (let index = 0; index < 40; index += 1) {
    applyOfficeEvent(state, event({ eventId: `overflow-${index}`, eventType: 'agent_spawned', agentId: `overflow-child-${index}` }), base + index + 1);
  }
  const pod = state.teams.codex.pods['session-a'];
  assert.equal(Object.keys(pod.agents).length, 32);
  assert.equal(pod.overflowAgentCount, 9);
  assert.equal(state.teams.codex.annexCount, 6);
});

test('three two-person-or-smaller projects occupy first-floor slots and the fourth opens an execution floor', () => {
  const state = createInitialState(base);
  for (let index = 0; index < 4; index += 1) {
    applyOfficeEvent(state, event({
      eventId: `project-${index}`,
      provider: ['codex', 'claude', 'grok', 'gemini'][index],
      sessionId: `project-${index}`,
      timestamp: base + index
    }), base + index);
  }
  const pods = Object.values(state.teams).flatMap((team) => Object.values(team.pods));
  assert.deepEqual(pods.filter((pod) => pod.floorAssignment === 'base').map((pod) => pod.baseSlot).sort(), [0, 1, 2]);
  assert.equal(pods.filter((pod) => pod.floorAssignment === 'execution').length, 1);
});

test('a third project member promotes the whole project permanently', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({ eventId: 'promote-start' }), base);
  applyOfficeEvent(state, event({ eventId: 'promote-a', eventType: 'agent_spawned', agentId: 'a' }), base + 1);
  const pod = state.teams.codex.pods['session-a'];
  assert.equal(pod.floorAssignment, 'base');
  applyOfficeEvent(state, event({ eventId: 'promote-b', eventType: 'agent_spawned', agentId: 'b' }), base + 2);
  assert.equal(pod.floorAssignment, 'execution');
  applyOfficeEvent(state, event({ eventId: 'promote-b-done', eventType: 'agent_finished', agentId: 'b' }), base + 3);
  assert.equal(pod.floorAssignment, 'execution');
  assert.equal(pod.baseSlot, null);
});

test('completed overflow workers remain represented in the same-floor rest pool', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({ eventId: 'rest-start' }), base);
  for (let index = 0; index < 33; index += 1) {
    applyOfficeEvent(state, event({ eventId: `rest-spawn-${index}`, eventType: 'agent_spawned', agentId: `rest-${index}` }), base + index + 1);
  }
  const pod = state.teams.codex.pods['session-a'];
  const before = pod.overflowAgentCount;
  applyOfficeEvent(state, event({ eventId: 'rest-finish-overflow', eventType: 'agent_finished', agentId: 'not-detailed' }), base + 50);
  assert.equal(pod.overflowAgentCount, before - 1);
  assert.equal(pod.restingOverflowCount, 1);
  assert.equal(pod.floorAssignment, 'execution');
});

test('completed sessions retained for TTL do not keep empty annex floors alive', () => {
  const state = createInitialState(base);
  for (let index = 0; index < 6; index += 1) {
    const sessionId = `completed-${index}`;
    applyOfficeEvent(state, event({ eventId: `start-${index}`, eventType: 'session_started', sessionId }), base + index * 2);
    applyOfficeEvent(state, event({ eventId: `stop-${index}`, eventType: 'session_stopped', sessionId }), base + index * 2 + 1);
  }
  assert.equal(Object.keys(state.teams.codex.pods).length, 6);
  assert.equal(state.teams.codex.annexCount, 1);
});
