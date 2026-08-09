import assert from 'node:assert/strict';
import { applyOfficeEvent, compactOfficeState, createInitialState, summarizeState } from '../resources/js/domain.js';

const state = createInitialState(0);
const providers = ['codex', 'claude', 'gemini', 'grok'];
const start = Date.UTC(2026, 7, 9, 0, 0, 0);
const steps = 12_000;
const startedAt = performance.now();

for (let index = 0; index < steps; index += 1) {
  const timestamp = start + index * 2_400;
  const cycle = Math.floor(index / 10);
  const provider = providers[cycle % providers.length];
  const sessionId = `${provider}-session-${cycle % 16}`;
  const phase = index % 10;
  const base = {
    eventId: `soak-${index}`,
    timestamp,
    provider,
    surfaceId: `${provider}:cli`,
    surfaceKind: 'cli',
    sessionId,
    taskLabel: `Work ${index % 16}`,
    observationTier: 'A'
  };
  const eventType = phase === 0 ? 'session_started'
    : phase === 1 ? 'turn_started'
      : phase === 2 ? 'agent_spawned'
        : phase === 3 ? 'agent_finished'
          : phase === 8 ? 'turn_completed'
            : phase === 9 ? 'session_stopped'
              : 'tool_started';
  const agentId = phase === 2 || phase === 3 ? `${sessionId}:child:${cycle}` : null;
  applyOfficeEvent(state, { ...base, eventType, agentId, parentAgentId: `main:${sessionId}` }, timestamp);
  if (index % 250 === 0) compactOfficeState(state, timestamp);
}

const virtualEnd = start + steps * 2_400;
compactOfficeState(state, virtualEnd + 31 * 60_000);
const summary = summarizeState(state);
const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;

assert.ok(state.eventLog.length <= 500, `event log leaked: ${state.eventLog.length}`);
assert.ok(Object.keys(state.seenEventIds).length <= 2048, 'dedupe index leaked');
assert.ok(summary.agentCount <= 64, `agent population leaked: ${summary.agentCount}`);
assert.ok(summary.podCount <= 64, `pod population leaked: ${summary.podCount}`);
assert.ok(durationMs < 15_000, `virtual soak too slow: ${durationMs}ms`);

console.log(JSON.stringify({ ok: true, virtualHours: 8, events: steps, durationMs, ...summary }));
