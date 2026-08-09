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
