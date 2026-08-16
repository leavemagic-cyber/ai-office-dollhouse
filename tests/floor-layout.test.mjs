import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activeDiscussionProviders,
  annexCountForDisplay,
  baseFloorSessions,
  currentPresenceOpen,
  executionSessions,
  floorForEvent,
  floorPopulationForDisplay,
  floorSpecsForModel,
  livePodsForDisplay,
  PEOPLE_PER_ANNEX,
  sessionHasSubagents,
  SHARED_FLOOR_KEY,
  teamSessions,
  UNKNOWN_FREEZE_MS
} from '../resources/js/floor-layout.js';

const roomMeta = {
  owner: { title: 'Owner' }, codex: { title: 'Codex' }, claude: { title: 'Claude' },
  gemini: { title: 'Gemini' }, grok: { title: 'Grok' }
};

function pod(id, helpers = 0, extra = {}) {
  return {
    id,
    label: id,
    activity: 'running',
    createdAt: Number(extra.createdAt) || 1,
    lastActivityAt: Number(extra.lastActivityAt) || 1,
    agents: [{ id: `${id}:main`, isMain: true }, ...Array.from({ length: helpers }, (_, index) => ({ id: `${id}:a${index}` }))],
    overflowAgentCount: 0,
    ...extra
  };
}

function modelWith(entries, recentEvents = []) {
  const providers = Object.fromEntries(['codex', 'claude', 'gemini', 'grok'].map((provider) => [provider, { livePods: [], snapshotWork: [] }]));
  for (const [provider, project] of entries) providers[provider].livePods.push(project);
  return { generatedAt: 10_000, owner: { inboxCount: 0 }, providers, recentEvents };
}

test('the first three small projects share the permanent first floor', () => {
  const model = modelWith([
    ['codex', pod('c1', 1, { createdAt: 1 })],
    ['claude', pod('l1', 0, { createdAt: 2 })],
    ['grok', pod('g1', 1, { createdAt: 3 })]
  ]);
  assert.deepEqual(baseFloorSessions(model).map((session) => [session.id, session.baseSlot]), [['c1', 0], ['l1', 1], ['g1', 2]]);
  assert.deepEqual(executionSessions(model), []);
  assert.deepEqual(floorSpecsForModel(model, roomMeta, { activeOnly: true }).map((spec) => spec.key), ['owner']);
  assert.equal(floorPopulationForDisplay(model, 'owner'), 1 + 2 + 1 + 2);
});

test('three-person projects and a fourth small project each own an execution floor', () => {
  const model = modelWith([
    ['codex', pod('large', 2, { createdAt: 1, floorAssignment: 'execution' })],
    ['claude', pod('small-a', 0, { createdAt: 2, floorAssignment: 'base', baseSlot: 0 })],
    ['gemini', pod('small-b', 1, { createdAt: 3, floorAssignment: 'base', baseSlot: 1 })],
    ['grok', pod('small-c', 0, { createdAt: 4, floorAssignment: 'base', baseSlot: 2 })],
    ['codex', pod('small-fourth', 0, { createdAt: 5, floorAssignment: 'execution' })]
  ]);
  const specs = floorSpecsForModel(model, roomMeta, { activeOnly: true });
  assert.deepEqual(specs.map((spec) => spec.key), ['owner', 'execution:large', 'execution:small-fourth']);
  assert.deepEqual(teamSessions(model, 'codex').map((session) => session.id), ['large', 'small-fourth']);
  assert.equal(floorPopulationForDisplay(model, 'codex', 0), 3);
  assert.equal(floorPopulationForDisplay(model, 'codex', 1), 1);
});

test('execution assignment is obeyed even after active headcount falls below three', () => {
  const model = modelWith([['gemini', pod('sticky', 0, { floorAssignment: 'execution', createdAt: 1 })]]);
  assert.deepEqual(baseFloorSessions(model), []);
  assert.deepEqual(executionSessions(model).map((session) => session.id), ['sticky']);
  assert.deepEqual(floorForEvent(model, 'gemini', { sessionId: 'sticky' }), { room: 'gemini', annexIndex: 0 });
});

test('project cues follow base projects downstairs and execution projects upstairs', () => {
  const model = modelWith([
    ['codex', pod('down', 0, { floorAssignment: 'base', baseSlot: 0 })],
    ['codex', pod('up', 2, { floorAssignment: 'execution', createdAt: 2 })]
  ]);
  assert.deepEqual(floorForEvent(model, 'codex', { sessionId: 'down' }), { room: 'owner', annexIndex: 0 });
  assert.deepEqual(floorForEvent(model, 'codex', { sessionId: 'up' }), { room: 'codex', annexIndex: 0 });
  assert.deepEqual(floorForEvent(model, 'codex', {}), { room: SHARED_FLOOR_KEY, annexIndex: 0 });
});

test('discussion participants are independent and always use the permanent first-floor meeting room', () => {
  const discussion = {
    eventType: 'discussion_started', provider: 'codex', targetProvider: 'claude',
    participantProviders: ['claude', 'grok', 'gemini'], chairProvider: 'gemini', correlationId: 'round-1'
  };
  const model = modelWith([], [discussion]);
  assert.deepEqual(activeDiscussionProviders(model), ['gemini', 'claude', 'grok'], 'the explicit chair takes the head seat without inferring provider or target attendees');
  assert.deepEqual(floorForEvent(model, 'codex', discussion), { room: 'owner', annexIndex: 0 });
  assert.equal(floorPopulationForDisplay(model, 'owner'), 4);

  const ended = { ...model, recentEvents: [discussion, { eventType: 'discussion_ended', provider: 'codex', correlationId: 'round-1' }] };
  assert.deepEqual(activeDiscussionProviders(ended), []);

  const meeting = { ...discussion, eventType: 'meeting_started', correlationId: 'round-2' };
  assert.deepEqual(activeDiscussionProviders(modelWith([], [meeting])), ['gemini', 'claude', 'grok']);
  assert.deepEqual(floorForEvent(model, 'codex', meeting), { room: 'owner', annexIndex: 0 });
  const meetingEnded = modelWith([], [meeting, { eventType: 'meeting_completed', provider: 'codex', correlationId: 'round-2' }]);
  assert.deepEqual(activeDiscussionProviders(meetingEnded), []);

  const compacted = modelWith([['codex', pod('live-meeting', 0, {
    activity: 'discussing',
    discussionProviders: ['claude', 'grok'],
    discussionChairProvider: 'grok'
  })]]);
  assert.deepEqual(activeDiscussionProviders(compacted), ['grok', 'claude'], 'the selected chair survives recent-event compaction');
});

test('historical snapshots never open staffed-looking floors', () => {
  const model = modelWith([]);
  model.providers.codex.snapshotWork = [{ recent: true, id: 'old', agents: [{ id: 'old-helper' }] }];
  assert.deepEqual(floorSpecsForModel(model, roomMeta, { activeOnly: true }).map((spec) => spec.key), ['owner']);
  assert.equal(floorPopulationForDisplay(model, 'codex', 0), 0);
});

test('an execution floor displays one supervisor plus at most six active staff', () => {
  const model = modelWith([['claude', pod('large', 20, { floorAssignment: 'execution' })]]);
  assert.equal(PEOPLE_PER_ANNEX, 7);
  assert.equal(floorPopulationForDisplay(model, 'claude', 0), 7);
  assert.equal(sessionHasSubagents(model.providers.claude.livePods[0]), true);
  assert.equal(annexCountForDisplay([model.providers.claude.livePods[0]], []), 3);
});

test('per-provider execution floors remain bounded without co-locating projects', () => {
  const projects = Array.from({ length: 20 }, (_, index) => pod(`c${index}`, 2, {
    createdAt: index + 1,
    floorAssignment: 'execution'
  }));
  const model = modelWith(projects.map((project) => ['codex', project]));
  assert.equal(teamSessions(model, 'codex').length, 12);
  assert.equal(floorSpecsForModel(model, roomMeta).filter((spec) => spec.room === 'codex').length, 12);
  assert.deepEqual(floorForEvent(model, 'codex', { sessionId: 'c19' }), { room: SHARED_FLOOR_KEY, annexIndex: 0 });
});

test('unknown Tier-A work has a bounded frozen display window', () => {
  const now = 2_000_000;
  const fresh = { lifecycle: 'active', activity: 'unknown', unknownSinceAt: now - UNKNOWN_FREEZE_MS + 1, lastActivityAt: now - 20_000 };
  const expired = { lifecycle: 'active', activity: 'unknown', unknownSinceAt: now - UNKNOWN_FREEZE_MS, lastActivityAt: now - 20_000 };
  assert.deepEqual(livePodsForDisplay({ pods: { fresh, expired } }, [], 'grok', now), [fresh]);
  assert.equal(currentPresenceOpen([{ provider: 'grok', observationTier: 'D', appOpen: true, lastSeenAt: now - 1_000 }], 'grok', now), true);
});
