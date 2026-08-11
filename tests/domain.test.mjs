import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOfficeEvent,
  compactOfficeState,
  createInitialState,
  degradeStaleSessions,
  summarizeState
} from '../resources/js/domain.js';

const base = 1_800_000_000_000;

function event(overrides = {}) {
  return {
    eventId: `e-${Math.random()}`,
    timestamp: base,
    provider: 'codex',
    surfaceId: 'codex:app',
    surfaceKind: 'app',
    eventType: 'session_started',
    sessionId: 'session-a',
    taskLabel: '命理',
    observationTier: 'A',
    ...overrides
  };
}

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

test('adapter disconnect degrades active work to unknown, not completed', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({ eventId: 'a', eventType: 'turn_started' }), base);
  applyOfficeEvent(state, event({ eventId: 'lost', eventType: 'adapter_disconnected', sessionId: null }), base);
  assert.equal(state.teams.codex.pods['session-a'].activity, 'unknown');
  assert.equal(state.teams.codex.pods['session-a'].lifecycle, 'active');
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

test('replayed active sessions become unknown when lifecycle evidence is stale', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({ eventId: 'running', eventType: 'turn_started' }), base);
  degradeStaleSessions(state, base + 10_000, 1000);
  assert.equal(state.teams.codex.pods['session-a'].activity, 'unknown');
  assert.equal(state.teams.codex.pods['session-a'].lifecycle, 'active');
});

test('unresolved Owner requests survive stale and disconnect degradation until explicitly resolved', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({ eventId: 'wait', eventType: 'owner_input_required' }), base);
  const pod = state.teams.codex.pods['session-a'];

  degradeStaleSessions(state, base + 10_000, 1000);
  assert.equal(pod.activity, 'waiting_owner');
  assert.equal(pod.lastActivityAt, base + 10_000);
  assert.equal(state.owner.inboxCount, 1);

  applyOfficeEvent(state, event({ eventId: 'turn-after-wait', eventType: 'turn_started' }), base + 10_001);
  applyOfficeEvent(state, event({ eventId: 'spawn-after-wait', eventType: 'agent_spawned', agentId: 'still-waiting' }), base + 10_002);
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
    participantProviders: ['codex', 'claude']
  }), base + 1).applied, true);
  const pod = state.teams.codex.pods['session-a'];
  assert.equal(pod.activity, 'discussing');
  assert.equal(pod.discussionId, 'review-room-1');
  assert.deepEqual(state.eventLog.at(-1).participantProviders, ['codex', 'claude']);
  assert.equal(applyOfficeEvent(state, event({
    eventId: 'bad-discussion',
    eventType: 'discussion_started',
    sessionId: null
  }), base + 2).applied, false);
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
  assert.equal(state.teams.codex.annexCount, 2);
});

test('repeated Owner request events do not duplicate the same waiting visitor', () => {
  const state = createInitialState(base);
  applyOfficeEvent(state, event({ eventId: 'wait-1', eventType: 'owner_input_required' }), base);
  applyOfficeEvent(state, event({ eventId: 'wait-2', eventType: 'owner_input_required' }), base + 1);
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
  assert.equal(state.teams.codex.annexCount, 3);
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
