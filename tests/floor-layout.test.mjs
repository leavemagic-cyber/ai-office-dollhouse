import test from 'node:test';
import assert from 'node:assert/strict';

import {
  annexCountForDisplay,
  currentPresenceOpen,
  floorForEvent,
  floorKey,
  floorSpecsForModel,
  livePodsForDisplay,
  PEOPLE_PER_ANNEX,
  sessionHasSubagents,
  SHARED_FLOOR_KEY,
  UNKNOWN_FREEZE_MS,
  sharedFloorSessions,
  teamSessions
} from '../resources/js/floor-layout.js';

const roomMeta = {
  owner: { title: 'Owner 決策室' }, codex: { title: 'Codex 工事樓' }, claude: { title: 'Claude 審閱樓' },
  gemini: { title: 'Gemini 諮詢樓' }, grok: { title: 'Grok 探索樓' }, lobby: { title: '既有工作大廳' },
  shared: { title: '共用辦公層' }
};

/** A session with `helpers` subagents beside its main worker. */
function pod(id, label, helpers = 0, extra = {}) {
  return {
    id,
    label,
    activity: 'running',
    agents: [{ id: `${id}:main`, isMain: true }, ...Array.from({ length: helpers }, (_, index) => ({ id: `${id}:a${index}` }))],
    overflowAgentCount: 0,
    ...extra
  };
}

test('every session keeps a provider-isolated floor', () => {
  const model = {
    providers: {
      codex: { livePods: [pod('c1', 'titan', 2), pod('c2', '單獨查詢', 0)] },
      claude: { livePods: [pod('l1', '審稿', 1), pod('l2', 'dollhouse', 3)] },
      gemini: { livePods: [pod('g1', '翻譯', 0)] },
      grok: { livePods: [] }
    }
  };
  const specs = floorSpecsForModel(model, roomMeta);
  assert.deepEqual(specs.map((spec) => spec.key), ['owner', 'codex', 'codex:2', 'claude', 'claude:2', 'gemini', 'lobby']);
  // The floor is named after the project, because that is what the Owner is watching.
  assert.equal(specs[1].title, 'Codex 工事樓・titan');
  assert.equal(specs[3].title, 'Claude 審閱樓・審稿');
  assert.equal(specs[4].sessionId, 'l2');
  assert.equal(floorKey('grok', 2), 'grok:3');
  assert.deepEqual(sharedFloorSessions(model), []);
});

test('solo work never mixes providers on a shared floor', () => {
  const model = {
    providers: {
      codex: { livePods: [pod('c1', '單獨查詢')] },
      claude: { livePods: [] },
      gemini: { livePods: [] },
      grok: { livePods: [pod('k1', '查核')] }
    }
  };
  assert.deepEqual(floorSpecsForModel(model, roomMeta).map((spec) => spec.key), ['owner', 'codex', 'grok', 'lobby']);
  assert.deepEqual(floorSpecsForModel({ providers: {} }, roomMeta).map((spec) => spec.key), ['owner', 'lobby']);
  assert.equal(sessionHasSubagents(pod('x', 'x', 0)), false);
  assert.equal(sessionHasSubagents(pod('x', 'x', 1)), true);
  assert.equal(sessionHasSubagents({ agents: [{ isMain: true }], overflowAgentCount: 4 }), true);
});

test('active-only layout removes idle shells and keeps only floors with useful work', () => {
  const now = 4_000_000;
  const model = {
    generatedAt: now,
    owner: { inboxCount: 0 },
    recentEvents: [],
    providers: {
      codex: { livePods: [pod('c1', 'titan', 14)], snapshotWork: [] },
      claude: { livePods: [], snapshotWork: [{ recent: true, id: 's1', label: '舊工作', agents: [] }] },
      gemini: { livePods: [], snapshotWork: [], appOpen: true },
      grok: { livePods: [], snapshotWork: [] }
    }
  };
  const specs = floorSpecsForModel(model, roomMeta, { activeOnly: true });
  // Owner is permanent; the live and snapshot work remain on provider-isolated floors.
  assert.deepEqual(specs.map((spec) => spec.key), ['owner', 'codex', 'claude']);
});

test('active-only layout surfaces a short important event without reviving idle provider floors', () => {
  const now = 5_000_000;
  const model = {
    generatedAt: now,
    owner: { inboxCount: 1 },
    recentEvents: [{ provider: 'gemini', eventType: 'task_completed', important: true, timestamp: now - 1_000, sessionId: 'gone' }],
    providers: {
      codex: { livePods: [], snapshotWork: [] },
      claude: { livePods: [], snapshotWork: [] },
      gemini: { livePods: [], snapshotWork: [] },
      grok: { livePods: [], snapshotWork: [] }
    }
  };
  const specs = floorSpecsForModel(model, roomMeta, { activeOnly: true });
  // The session is gone: Owner can receive the delivery, but no empty shared office is
  // conjured for the missing source floor.
  assert.deepEqual(specs.map((spec) => spec.key), ['owner']);
  assert.deepEqual(floorForEvent(model, 'gemini', model.recentEvents[0]), { room: SHARED_FLOOR_KEY, annexIndex: 0 });
});

test('extreme session counts stay truthful but cap live Canvas floors', () => {
  const model = { providers: { codex: { livePods: Array.from({ length: 100 }, (_, index) => pod(`c${index}`, `專案 ${index}`, 2)) } } };
  const specs = floorSpecsForModel(model, roomMeta);
  const codex = specs.filter((spec) => spec.room === 'codex');
  assert.equal(codex.length, 12);
  assert.equal(codex.at(-1).overflowSummary, true);
  assert.equal(teamSessions(model, 'codex').length, 12);
  // A team past the cap is summarised on the last floor. It must not be pushed into the
  // shared office, which would open an empty "no solo work" plate.
  assert.deepEqual(floorForEvent(model, 'codex', { sessionId: 'c40' }), { room: 'codex', annexIndex: 11 });
  const live = floorSpecsForModel({ ...model, generatedAt: 1, recentEvents: [] }, roomMeta, { activeOnly: true });
  assert.equal(live.some((spec) => spec.key === SHARED_FLOOR_KEY), false);
});

test('a cue lands on the floor its own session is standing on', () => {
  const model = {
    providers: {
      codex: { livePods: [pod('sess:one', 'A', 2), pod('sess:two', 'B', 0), pod('sess:three', 'C', 1)] },
      claude: { livePods: [] }, gemini: { livePods: [] }, grok: { livePods: [] }
    }
  };
  assert.deepEqual(floorForEvent(model, 'codex', { sessionId: 'one' }), { room: 'codex', annexIndex: 0 });
  assert.deepEqual(floorForEvent(model, 'codex', { sessionId: 'two' }), { room: 'codex', annexIndex: 1 });
  assert.deepEqual(floorForEvent(model, 'codex', { sessionId: 'three' }), { room: 'codex', annexIndex: 2 });
  assert.deepEqual(floorForEvent(model, 'codex', {}), { room: SHARED_FLOOR_KEY, annexIndex: 0 });
});

test('one floor fits fourteen small figures before the count is summarised', () => {
  const roster = (count) => ({ agents: Array.from({ length: count }, () => ({})), overflowAgentCount: 0 });
  assert.equal(PEOPLE_PER_ANNEX, 14);
  assert.equal(annexCountForDisplay([roster(14)], []), 1);
  assert.equal(annexCountForDisplay([roster(15)], []), 2);
});

test('unknown Tier-A work freezes even when lower-confidence presence expires', () => {
  const now = 2_000_000;
  const team = { pods: {
    stale: { lifecycle: 'active', activity: 'unknown', lastActivityAt: now - 1_000, agents: Array.from({ length: 20 }, () => ({})) }
  } };
  const historicalHook = [{ provider: 'grok', observationTier: 'A', appOpen: true, lastSeenAt: now - 500 }];
  assert.equal(currentPresenceOpen(historicalHook, 'grok', now), false);
  assert.deepEqual(livePodsForDisplay(team, historicalHook, 'grok', now), [team.pods.stale]);
  assert.equal(annexCountForDisplay([], []), 1);
});

test('an unknown freeze is bounded and ancient replayed work does not reopen a floor', () => {
  const now = 9_000_000;
  const fresh = { lifecycle: 'active', activity: 'unknown', unknownSinceAt: now - UNKNOWN_FREEZE_MS + 1, lastActivityAt: now - 20_000 };
  const expired = { lifecycle: 'active', activity: 'unknown', unknownSinceAt: now - UNKNOWN_FREEZE_MS, lastActivityAt: now - 20_000 };
  assert.deepEqual(livePodsForDisplay({ pods: { fresh, expired } }, [], 'grok', now), [fresh]);
});

test('the headcount counts real people, not the ones that fit on a plate', async () => {
  const { totalOccupants, SINGLE_FLOOR_CAPACITY } = await import('../resources/js/renderer.js');
  // Owner has a separate permanent room and does not consume a worker seat.
  const model = { providers: { codex: { livePods: [pod('big', '大隊', 9)] }, claude: { livePods: [] }, gemini: { livePods: [] }, grok: { livePods: [] } } };
  assert.equal(totalOccupants(model), 10);
  assert.ok(totalOccupants(model) > SINGLE_FLOOR_CAPACITY, 'ten workers must not fit one work floor');
});

test('fresh Tier-D presence may freeze an unknown live team without inventing new work', () => {
  const now = 3_000_000;
  const unknown = { lifecycle: 'active', activity: 'unknown', lastActivityAt: now - 20_000, agents: [{}, {}] };
  const surfaces = [{ provider: 'codex', observationTier: 'D', appOpen: true, lastSeenAt: now - 1_000 }];
  assert.equal(currentPresenceOpen(surfaces, 'codex', now), true);
  assert.deepEqual(livePodsForDisplay({ pods: { unknown } }, surfaces, 'codex', now), [unknown]);
});
