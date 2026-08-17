import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deliveryHomeForCue,
  deliveryPlacementsForCue,
  deliveryReturnFacing,
  drawLiveRoutineProp,
  drawWorkerIdleProp,
  drawWorkProp,
  idleCueForModel,
  isCueMainPerson,
  LIVE_DISCUSSION_ROUTINES,
  LIVE_IDLE_ROUTINES,
  LIVE_REST_ROUTINES,
  LIVE_WAITING_ROUTINES,
  LIVE_WORK_ROUTINES,
  liveRoutineFor,
  P4_ACTIONS,
  occupantsFromModel,
  P4_SLOT_MS,
  poseFor,
  totalOccupants
} from '../resources/js/renderer.js';
import { assignSeats, officeLayout } from '../resources/js/sketch.js';

function placement(activity, extra = {}) {
  const layout = officeLayout('codex', 1);
  const seat = layout.seats.find((candidate) => !candidate.role);
  return {
    layout,
    actor: {
      ...seat,
      role: 'seat',
      desk: true,
      order: 0,
      person: {
        id: 'pod:codex:s1:main',
        provider: 'codex',
        activity,
        actionStyle: 4,
        idleFrom: activity === 'idle' ? 'turn_completed' : null,
        ...extra
      }
    }
  };
}

test('a live worker stays at its own desk but cycles local routines without a new command', () => {
  const { layout, actor } = placement('working');
  const poses = [0, 9_000, 18_000, 27_000, 36_000].map((time) => poseFor(actor, {
    time,
    mode: 'full',
    layout,
    room: 'codex',
    idleCue: null
  }));
  for (const pose of poses) {
    assert.equal(pose.gx, actor.gx);
    assert.equal(pose.gy, actor.gy);
    assert.equal(pose.workAction, undefined, 'a local routine cannot claim a structured work action');
  }
  assert.deepEqual(new Set(poses.map((pose) => pose.routineAction)), new Set(LIVE_WORK_ROUTINES));
  assert.ok(poses.some((pose) => pose.pose === 'type'), 'ordinary keyboard work remains visibly active');
  assert.ok(poses.some((pose) => pose.pose === 'stand'), 'a brief in-place stretch keeps the live worker from freezing');
});

test('idle stays at its own seat while it cycles quiet local routines outside P4', () => {
  const { layout, actor } = placement('idle');
  const poses = [0, 9_000, 18_000, 27_000].map((time) => poseFor(actor, {
    time, mode: 'full', layout, room: 'codex', idleCue: null
  }));
  for (const pose of poses) {
    assert.equal(pose.gx, actor.gx);
    assert.equal(pose.gy, actor.gy);
  }
  assert.deepEqual(new Set(poses.map((pose) => pose.routineAction)), new Set(LIVE_IDLE_ROUTINES));
  assert.ok(poses.every((pose) => pose.idleAction === undefined), 'P4 remains a separate, event-free optional overlay');
});

test('daily routines are visual-only and cannot animate a snapshot as a live person', () => {
  const { actor } = placement('working');
  assert.equal(liveRoutineFor({ ...actor, person: { ...actor.person, snapshot: true } }, { time: 9_000, mode: 'full' }), null);
  assert.equal(liveRoutineFor({ ...actor, person: { ...actor.person, activity: 'unknown' } }, { time: 9_000, mode: 'full' }), null);
  assert.equal(liveRoutineFor(actor, { time: 9_000, mode: 'dnd' }), null);
});

test('the building-wide idle slot selects only a turn-completed live worker', () => {
  const pod = {
    id: 'pod:codex:s1',
    activity: 'idle',
    idleFrom: 'turn_completed',
    idleSinceAt: 1_000,
    agents: [{ id: 'main:s1', isMain: true }]
  };
  const model = {
    effectiveMode: 'full',
    providers: {
      codex: { livePods: [pod] },
      claude: { livePods: [] }, gemini: { livePods: [] }, grok: { livePods: [] }
    }
  };
  assert.ok(idleCueForModel(model, 'pod:codex:s1:main', 65_000));
  assert.equal(idleCueForModel(model, 'someone-else', 65_000), null);
  assert.equal(idleCueForModel({ ...model, effectiveMode: 'important' }, 'pod:codex:s1:main', 65_000), null);
  assert.equal(idleCueForModel({
    ...model,
    providers: { ...model.providers, codex: { livePods: [{ ...pod, idleFrom: 'derived' }] } }
  }, 'pod:codex:s1:main', 65_000), null);
});

test('a P4 slot never transfers its half-played action to another worker', () => {
  const worker = (id) => ({ id, activity: 'idle', idleFrom: 'turn_completed', idleSinceAt: 1_000, agents: [] });
  const providers = {
    codex: { livePods: [worker('pod:codex:a'), worker('pod:codex:b')] },
    claude: { livePods: [] }, gemini: { livePods: [] }, grok: { livePods: [] }
  };
  const model = { effectiveMode: 'full', providers };
  const now = 3_000_000_001;
  const ids = ['pod:codex:a:main', 'pod:codex:b:main'];
  const owner = ids.find((id) => idleCueForModel(model, id, now));
  const remaining = ids.find((id) => id !== owner);
  assert.ok(owner);
  const withoutOwner = {
    ...model,
    providers: { ...providers, codex: { livePods: providers.codex.livePods.filter((pod) => `${pod.id}:main` !== owner) } }
  };
  assert.equal(idleCueForModel(withoutOwner, remaining, now + 1_000), null);
});

test('a P4 slot suppressed by Important or DND never resumes mid-action', () => {
  const pod = { id: 'pod:codex:suppressed', activity: 'idle', idleFrom: 'turn_completed', idleSinceAt: 1_000, agents: [] };
  const providers = {
    codex: { livePods: [pod] },
    claude: { livePods: [] }, gemini: { livePods: [] }, grok: { livePods: [] }
  };
  for (const [index, mode] of ['important', 'dnd'].entries()) {
    const now = 3_300_000_001 + index * P4_SLOT_MS * 2;
    assert.equal(idleCueForModel({ effectiveMode: mode, providers }, `${pod.id}:main`, now), null);
    assert.equal(idleCueForModel({ effectiveMode: 'full', providers }, `${pod.id}:main`, now + 6_000), null);
    const next = idleCueForModel({ effectiveMode: 'full', providers }, `${pod.id}:main`, (Math.floor(now / P4_SLOT_MS) + 1) * P4_SLOT_MS);
    assert.ok(next);
    assert.equal(next.progress, 0);
  }
});

test('signature J returns the exact main worker to its assigned manager desk', () => {
  const event = { provider: 'codex', sessionId: 'target' };
  const model = {
    providers: {
      codex: {
        livePods: [{
          id: 'pod:codex:target', activity: 'idle', idleFrom: 'derived', idleSinceAt: 10,
          agents: [{ id: 'main:target', isMain: true }, { id: 'helper:target', role: 'reviewer' }]
        }]
      },
      claude: { livePods: [] }, gemini: { livePods: [] }, grok: { livePods: [] }
    }
  };
  const layout = officeLayout('all', 1);
  const occupants = occupantsFromModel('all', model, 0);
  const assigned = assignSeats(layout, occupants).find((entry) => isCueMainPerson(entry.person, event));
  const home = deliveryHomeForCue('all', model, 0, layout, event);
  assert.equal(assigned.role, 'manager');
  assert.deepEqual(home, { gx: assigned.gx, gy: assigned.gy, facing: assigned.facing });
  assert.equal(isCueMainPerson({ id: 'pod:codex:not-target:main' }, event), false);
  assert.equal(deliveryReturnFacing(home, .91), -1);
  assert.equal(deliveryReturnFacing(home, .92), assigned.facing);
});

test('signature J still knows the original desk while the main is temporarily away', () => {
  const event = { provider: 'codex', sessionId: 'away' };
  const model = {
    providers: {
      codex: { livePods: [{ id: 'pod:codex:away', activity: 'waiting_owner', agents: [{ id: 'main:away', isMain: true }] }] },
      claude: { livePods: [] }, gemini: { livePods: [] }, grok: { livePods: [] }
    }
  };
  const layout = officeLayout('codex', 1);
  const home = deliveryHomeForCue('codex', model, 0, layout, event);
  assert.deepEqual(home, { gx: 1.9, gy: 5, facing: -1 });
});

test('signature J reserves the courier desk on a full floor', () => {
  const event = { provider: 'codex', sessionId: 'full' };
  const model = {
    providers: {
      codex: {
        livePods: [{
          id: 'pod:codex:full',
          activity: 'idle',
          agents: [
            { id: 'main:full', isMain: true },
            ...Array.from({ length: 5 }, (_, index) => ({ id: `helper:${index}`, role: 'reviewer' }))
          ]
        }]
      },
      claude: { livePods: [] }, gemini: { livePods: [] }, grok: { livePods: [] }
    }
  };
  const layout = officeLayout('codex', 1);
  const occupants = occupantsFromModel('codex', model, 0);
  const before = assignSeats(layout, occupants);
  const during = deliveryPlacementsForCue(layout, occupants, event);
  assert.equal(before.length, 6);
  assert.equal(during.length, 5);
  for (const helper of during) {
    const original = before.find((entry) => entry.person.id === helper.person.id);
    assert.deepEqual(
      { gx: helper.gx, gy: helper.gy, facing: helper.facing },
      { gx: original.gx, gy: original.gy, facing: original.facing }
    );
  }
  assert.equal(during.some((entry) => isCueMainPerson(entry.person, event)), false);
});

test('P4 props mirror in the same local frame as a left-facing worker', () => {
  const transforms = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, rect() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {},
    translate: (x, y) => transforms.push(['translate', x, y]),
    scale: (x, y) => transforms.push(['scale', x, y]),
    set strokeStyle(value) {}, set fillStyle(value) {}, set lineWidth(value) {}
  };
  drawWorkerIdleProp(ctx, 20, 30, { stroke: '#fff', text: '#fff' }, 'drink', .5, -1);
  assert.deepEqual(transforms, [['translate', 20, 30], ['scale', -1, 1], ['translate', -20, -30]]);
});

test('the complete visual-only routine, idle, and structured-work prop inventories draw without labels', () => {
  assert.deepEqual(P4_ACTIONS, [
    'daze', 'drink', 'read', 'water', 'blanket', 'pet', 'robot',
    'elevator_wait', 'stickers', 'photo'
  ]);
  const makeContext = () => {
    let marks = 0;
    return {
      get marks() { return marks; },
      save() {}, restore() {}, translate() {}, scale() {}, beginPath() {}, closePath() {},
      moveTo() { marks += 1; }, lineTo() { marks += 1; }, rect() { marks += 1; },
      arc() { marks += 1; }, ellipse() { marks += 1; }, quadraticCurveTo() { marks += 1; },
      bezierCurveTo() { marks += 1; }, stroke() { marks += 1; }, fill() { marks += 1; },
      set strokeStyle(value) {}, set fillStyle(value) {}, set lineWidth(value) {}
    };
  };
  for (const action of P4_ACTIONS) {
    const ctx = makeContext();
    drawWorkerIdleProp(ctx, 20, 30, { stroke: '#aaa', text: '#aaa' }, action, .5, 1);
    assert.ok(ctx.marks > 0, `${action} must draw an actual prop`);
  }
  for (const action of [
    ...LIVE_WORK_ROUTINES, ...LIVE_WAITING_ROUTINES, ...LIVE_IDLE_ROUTINES,
    ...LIVE_DISCUSSION_ROUTINES, ...LIVE_REST_ROUTINES
  ]) {
    const ctx = makeContext();
    drawLiveRoutineProp(ctx, 20, 30, { stroke: '#aaa' }, action, .5, 1);
    assert.ok(ctx.marks > 0, `${action} must draw an actual local routine prop`);
  }
  for (const action of [
    'coding', 'research', 'search', 'test', 'git', 'merge_conflict', 'build',
    'document', 'night', 'context', 'external_wait', 'rate_limit', 'review', 'whiteboard', 'crash'
  ]) {
    const ctx = makeContext();
    drawWorkProp(ctx, 20, 30, { stroke: '#aaa' }, action, .5, 1);
    assert.ok(ctx.marks > 0, `${action} must draw an actual work vignette`);
  }
});

test('recent snapshots have a static floor contract but zero people', () => {
  const model = {
    providers: {
      codex: { livePods: [], snapshotWork: [{ recent: true, id: 'snap', label: '近期工作', agents: [{ label: 'historical' }] }] },
      claude: { livePods: [], snapshotWork: [] }, gemini: { livePods: [], snapshotWork: [] }, grok: { livePods: [], snapshotWork: [] }
    }
  };
  assert.deepEqual(occupantsFromModel('codex', model, 0), []);
  assert.equal(totalOccupants(model), 0);
});

test('runtime acting lead decides the execution-floor supervisor seat regardless of provider', () => {
  const model = {
    providers: {
      codex: { livePods: [{
        id: 'pod:codex:mixed', activity: 'running', floorAssignment: 'execution', actingLeadAgentId: 'grok-cli',
        agents: [
          { id: 'main:mixed', isMain: true, role: 'Codex App', activity: 'working' },
          { id: 'grok-cli', role: 'Grok CLI', activity: 'working' },
          { id: 'helper', role: 'subagent', activity: 'working' }
        ], restingAgents: []
      }] },
      claude: { livePods: [] }, gemini: { livePods: [] }, grok: { livePods: [] }
    }
  };
  const occupants = occupantsFromModel('codex', model, 0);
  const lead = occupants.find((person) => person.supervisor);
  assert.equal(lead.rawAgentId, 'grok-cli');
  assert.equal(lead.provider, 'grok');
  assert.ok(occupants.some((person) => person.id === 'pod:codex:mixed:main' && !person.supervisor), 'main APP remains a staff occupant when CLI is acting lead');
  const layout = officeLayout('codex', 1, { occupants });
  assert.equal(assignSeats(layout, occupants).find((entry) => entry.person.supervisor).role, 'manager');
});

test('completed execution worker walks to the same-floor rest zone then sits there', () => {
  const finishedAt = 50_000;
  const model = {
    generatedAt: finishedAt + 1_000,
    providers: {
      codex: { livePods: [{
        id: 'pod:codex:rest', activity: 'running', floorAssignment: 'execution',
        agents: [{ id: 'main:rest', isMain: true, role: 'Codex App', activity: 'working' }],
        restingAgents: [{ id: 'done', role: 'Claude CLI', activity: 'delivered', finishedAt }]
      }] },
      claude: { livePods: [] }, gemini: { livePods: [] }, grok: { livePods: [] }
    }
  };
  const occupants = occupantsFromModel('codex', model, 0);
  const layout = officeLayout('codex', 1, { occupants });
  const restPlacement = assignSeats(layout, occupants).find((entry) => entry.person.resting);
  const walking = poseFor(restPlacement, { time: 1_000, now: finishedAt + 1_000, mode: 'full', layout, room: 'codex', idleCue: null });
  assert.equal(walking.pose, 'walk');
  const rested = poseFor(restPlacement, { time: 5_000, now: finishedAt + 5_000, mode: 'full', layout, room: 'codex', idleCue: null });
  assert.ok(['sit', 'drink'].includes(rested.pose));
  assert.deepEqual([rested.gx, rested.gy], [restPlacement.gx, restPlacement.gy]);
});

test('a completed helper in a first-floor small project stays at its workstation', () => {
  const model = {
    providers: {
      codex: { livePods: [{
        id: 'pod:codex:small', activity: 'idle', floorAssignment: 'base', baseSlot: 0,
        agents: [{ id: 'main:small', isMain: true, role: 'Codex App', activity: 'idle' }],
        restingAgents: [{ id: 'done-small', role: 'Claude CLI', activity: 'delivered', finishedAt: 1_000 }]
      }] },
      claude: { livePods: [] }, gemini: { livePods: [] }, grok: { livePods: [] }
    }, recentEvents: []
  };
  const occupants = occupantsFromModel('owner', model, 0);
  const helper = occupants.find((person) => person.id === 'done-small');
  assert.equal(helper.activity, 'idle');
  assert.equal(helper.resting, undefined);
  const layout = officeLayout('owner', 1, { occupants });
  assert.equal(assignSeats(layout, occupants).find((entry) => entry.person.id === 'done-small').desk, true);
});
