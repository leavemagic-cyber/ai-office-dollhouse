import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deliveryHomeForCue,
  deliveryPlacementsForCue,
  deliveryReturnFacing,
  drawWorkerIdleProp,
  idleCueForModel,
  isCueMainPerson,
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

test('generic running stays at its own computer regardless of the render clock', () => {
  const { layout, actor } = placement('working');
  const poses = [0, 7_200, 12_500, 31_000, 86_400_000].map((time) => poseFor(actor, {
    time,
    mode: 'full',
    layout,
    room: 'codex',
    idleCue: null
  }));
  for (const pose of poses) {
    assert.equal(pose.gx, actor.gx);
    assert.equal(pose.gy, actor.gy);
    assert.equal(pose.pose, 'type');
  }
});

test('idle never inherits the old clock-driven manager patrol', () => {
  const { layout, actor } = placement('idle');
  for (const time of [0, 7_200, 12_500, 31_000]) {
    const pose = poseFor(actor, { time, mode: 'full', layout, room: 'codex', idleCue: null });
    assert.equal(pose.gx, actor.gx);
    assert.equal(pose.gy, actor.gy);
    assert.equal(pose.pose, 'sit');
  }
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
