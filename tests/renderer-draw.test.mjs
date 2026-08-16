import test from 'node:test';
import assert from 'node:assert/strict';

import { globalChoreography } from '../resources/js/choreography.js';
import { RoomRenderer } from '../resources/js/renderer.js';
import { idleCueForModel, P4_ACTIONS, P4_SLOT_MS } from '../resources/js/renderer.js';
import { PLATE } from '../resources/js/sketch.js';

function recordingCanvas() {
  const calls = [];
  const stack = [];
  const context = {
    calls,
    globalAlpha: 1,
    lineWidth: 1,
    strokeStyle: '#000',
    fillStyle: '#000',
    lineCap: 'round',
    lineJoin: 'round',
    imageSmoothingEnabled: true,
    save() {
      stack.push({
        globalAlpha: this.globalAlpha, lineWidth: this.lineWidth,
        strokeStyle: this.strokeStyle, fillStyle: this.fillStyle,
        lineCap: this.lineCap, lineJoin: this.lineJoin
      });
    },
    restore() { Object.assign(this, stack.pop() || {}); },
    setTransform(...args) { calls.push(['setTransform', ...args]); },
    clearRect(...args) { calls.push(['clearRect', ...args]); },
    setLineDash(...args) { calls.push(['setLineDash', ...args]); },
    beginPath() { calls.push(['beginPath']); },
    closePath() { calls.push(['closePath']); },
    moveTo(...args) { calls.push(['moveTo', ...args]); },
    lineTo(...args) { calls.push(['lineTo', ...args]); },
    quadraticCurveTo(...args) { calls.push(['quadraticCurveTo', ...args]); },
    bezierCurveTo(...args) { calls.push(['bezierCurveTo', ...args]); },
    arc(...args) { calls.push(['arc', ...args]); },
    ellipse(...args) { calls.push(['ellipse', ...args]); },
    rect(...args) { calls.push(['rect', ...args]); },
    strokeRect(...args) { calls.push(['strokeRect', ...args]); },
    stroke() { calls.push(['stroke']); },
    fill() { calls.push(['fill']); },
    clip() { calls.push(['clip']); },
    translate(...args) { calls.push(['translate', ...args]); },
    scale(...args) { calls.push(['scale', ...args]); },
    rotate(...args) { calls.push(['rotate', ...args]); }
    ,fillText(...args) { calls.push(['fillText', ...args]); }
    ,strokeText(...args) { calls.push(['strokeText', ...args]); }
    ,measureText(value) { calls.push(['measureText', value]); return { width: String(value).length * 4 }; }
    ,recordAnimationCue(category, name, details = {}) { calls.push(['animation', category, name, details]); }
  };
  return {
    width: PLATE.logicalWidth * 2,
    height: PLATE.logicalHeight * 2,
    context,
    getContext() { return context; }
  };
}

function modelAt(now, recentEvents, {
  floorAssignment = 'execution', activity = 'running', workVisual = null,
  restingAgents = [], agents = null
} = {}) {
  const pod = {
    id: 'pod:codex:draw',
    label: 'draw',
    createdAt: now - 10_000,
    lastActivityAt: now,
    lifecycle: activity === 'completed' ? 'completed' : 'active',
    activity,
    closingUntil: activity === 'completed' ? now + 12_000 : null,
    floorAssignment,
    baseSlot: floorAssignment === 'base' ? 0 : null,
    actingLeadAgentId: null,
    overflowAgentCount: 0,
    restingOverflowCount: 0,
    restingAgents,
    workVisual,
    idleFrom: activity === 'idle' ? 'turn_completed' : null,
    idleSinceAt: activity === 'idle' ? now - 60_000 : null,
    agents: agents || [
      { id: 'main:draw', isMain: true, role: 'Codex App', activity: 'working' },
      { id: 'helper:1', role: 'Claude CLI', activity: 'working' },
      { id: 'helper:2', role: 'subagent', activity: 'working' },
      { id: 'helper:3', role: 'subagent', activity: 'working' }
    ]
  };
  const empty = { livePods: [], snapshotWork: [] };
  return {
    effectiveMode: 'full',
    frameIntervalMs: 33,
    owner: { inboxCount: 0, activity: 'idle' },
    providers: { codex: { livePods: [pod], snapshotWork: [] }, claude: empty, gemini: empty, grok: empty },
    recentEvents
  };
}

function event(now, eventType, extra = {}) {
  return {
    eventId: `${eventType}:${Math.random()}`,
    eventType,
    provider: 'codex',
    sessionId: 'draw',
    timestamp: now - 1_000,
    ...extra
  };
}

function actualDraw(eventRows, {
  room = 'codex', floorAssignment = 'execution', activity = 'running', workVisual = null,
  restingAgents = [], agents = null, wallNow = Date.now(), drawTime = 1_000, phase = 'resident'
  ,cueProgress = null
} = {}) {
  const now = wallNow;
  const rows = typeof eventRows === 'function' ? eventRows(now) : eventRows;
  const model = modelAt(now, rows, { floorAssignment, activity, workVisual, restingAgents, agents });
  globalChoreography.clear();
  globalChoreography.ingest(model, now);
  if (Number.isFinite(cueProgress)) {
    globalChoreography.current(now);
    if (globalChoreography.active) globalChoreography.active.startedAt = now - globalChoreography.active.duration * cueProgress;
  }
  const canvas = recordingCanvas();
  const renderer = new RoomRenderer({ canvas, room, annexIndex: 0 });
  renderer.setTheme({ luminance: .12, tone: true });
  renderer.setPhase('resident', 0);
  if (phase !== 'resident') renderer.setPhase(phase, 0);
  renderer.setModel(model, false);
  const realNow = Date.now;
  Date.now = () => now;
  try { renderer.draw(drawTime); } finally { Date.now = realNow; }
  return canvas.context.calls;
}

function figureHeads(calls) {
  return calls.filter(([name, , , rx, ry]) => name === 'ellipse'
    && Math.abs(rx - 1.25) < .001 && Math.abs(ry - 1.25) < .001).length;
}

function animationMarks(calls, category = null) {
  return calls.filter(([kind, group]) => kind === 'animation' && (!category || group === category));
}

function geometryCount(calls) {
  return calls.filter(([name]) => !['animation', 'setTransform', 'clearRect', 'setLineDash', 'beginPath', 'closePath', 'stroke', 'fill', 'clip'].includes(name)).length;
}

test('A-J and cancellation cues draw human motion through RoomRenderer.draw', () => {
  const cases = [
    ['agent_spawned', 2, {}],
    ['acting_lead_handoff', 2, { targetProvider: 'grok' }],
    ['discussion_started', 4, { room: 'owner', floorAssignment: 'base', participantProviders: ['codex', 'claude', 'grok', 'gemini'] }],
    ['agent_failed', 1, {}],
    ['revision_requested', 2, {}],
    ['review_passed', 2, {}],
    ['owner_input_required', 1, { room: 'owner', floorAssignment: 'base' }],
    ['delegated_decision_granted', 2, {}],
    ['agent_cancelled', 2, {}],
    ['task_completed', 1, {}]
  ];
  for (const [eventType, minimumHeads, extra] of cases) {
    const calls = actualDraw((now) => [event(now, eventType, extra)], extra);
    assert.ok(figureHeads(calls) >= minimumHeads, `${eventType} must draw ${minimumHeads}+ real figures`);
  }

  const multi = actualDraw((now) => [
    event(now - 200, 'agent_finished', { eventId: 'finish:1', agentId: 'helper:1' }),
    event(now, 'agent_finished', { eventId: 'finish:2', agentId: 'helper:2' })
  ]);
  assert.ok(figureHeads(multi) >= 3, 'multi-delivery must draw a visible human queue');
});

test('project closure uses actual people and distinguishes report from quiet departure', () => {
  const quiet = actualDraw((now) => [event(now, 'session_stopped', { eventId: 'stop:quiet' })], { activity: 'completed' });
  assert.ok(figureHeads(quiet) >= 4, 'unreported closure walks the team out without inventing an Owner report');

  const reported = actualDraw((now) => [
    event(now - 1_000, 'task_completed', { eventId: 'done:reported' }),
    event(now, 'session_stopped', { eventId: 'stop:reported' })
  ], { activity: 'completed' });
  assert.ok(figureHeads(reported) >= 1, 'task_completed keeps the physical J courier chain ahead of floor departure');
  assert.equal(animationMarks(reported, 'closure').length, 0, 'session close must not preempt or duplicate J');
});

test('actual meeting room draws exactly the structured 2, 3, or 4 participants', () => {
  const smallProject = [
    { id: 'main:draw', isMain: true, role: 'Codex App', activity: 'working' },
    { id: 'helper:1', role: 'Claude CLI', activity: 'working' }
  ];
  for (const providers of [
    ['codex', 'claude'],
    ['codex', 'claude', 'grok'],
    ['codex', 'claude', 'grok', 'gemini']
  ]) {
    const calls = actualDraw((now) => [event(now, 'discussion_started', {
      participantProviders: providers
    })], { room: 'owner', floorAssignment: 'base', activity: 'discussing', agents: smallProject });
    assert.deepEqual(animationMarks(calls, 'discussion-participant').map((mark) => mark[2]), providers);
    assert.equal(figureHeads(calls), providers.length + 3, 'Owner and the two executing project workers remain while exact attendees enter');
    const returning = actualDraw((now) => [event(now, 'discussion_ended', {
      participantProviders: providers
    })], { room: 'owner', floorAssignment: 'base', activity: 'discussing', agents: smallProject });
    assert.deepEqual(animationMarks(returning, 'discussion-participant').map((mark) => mark[2]), providers);
    assert.equal(figureHeads(returning), providers.length + 3, 'the executing project keeps working while exact attendees return');
    assert.ok(animationMarks(returning, 'discussion-participant').every((mark) => mark[3].returning === true));
  }

  const ownerExcluded = actualDraw((now) => [event(now, 'discussion_started', {
    participantProviders: ['owner', 'codex', 'claude']
  })], { room: 'owner', floorAssignment: 'base', activity: 'discussing', agents: smallProject });
  assert.deepEqual(animationMarks(ownerExcluded, 'discussion-participant').map((mark) => mark[2]), ['codex', 'claude']);
  assert.equal(figureHeads(ownerExcluded), 5, 'Owner stays at the desk and is never duplicated as a meeting participant');

  const independent = actualDraw((now) => [event(now, 'discussion_started', {
    participantProviders: ['claude', 'grok'],
    chairProvider: 'grok'
  })], { room: 'owner', floorAssignment: 'base', activity: 'discussing', agents: smallProject });
  assert.deepEqual(animationMarks(independent, 'discussion-participant').map((mark) => mark[2]), ['grok', 'claude'], 'the Owner-selected chair takes the head seat');
  assert.equal(figureHeads(independent), 5, 'the emitting Codex project remains staffed but is not invented as an attendee');

  for (const eventType of ['meeting_started', 'meeting_completed']) {
    const aliased = actualDraw((now) => [event(now, eventType, {
      participantProviders: ['claude', 'grok', 'gemini']
    })], { room: 'owner', floorAssignment: 'base', activity: 'discussing', agents: smallProject });
    assert.deepEqual(animationMarks(aliased, 'discussion-participant').map((mark) => mark[2]), ['claude', 'grok', 'gemini']);
    assert.equal(figureHeads(aliased), 6, `${eventType} uses the same permanent meeting room without hiding project workers`);
  }

  const executionKeepsWorking = actualDraw((now) => [event(now, 'discussion_started', {
    participantProviders: ['claude', 'grok', 'gemini']
  })], { room: 'codex', floorAssignment: 'execution' });
  assert.equal(animationMarks(executionKeepsWorking, 'discussion-participant').length, 0);
  assert.equal(figureHeads(executionKeepsWorking), 4, 'discussion AIs do not blank or replace the execution-floor team');
});

test('first-floor I queues at its own project lead and never reports to Owner', () => {
  const smallTeam = [
    { id: 'main:draw', isMain: true, role: 'Codex App', activity: 'working' },
    { id: 'helper:1', role: 'Claude CLI', activity: 'working' }
  ];
  const calls = actualDraw((now) => [
    event(now - 200, 'agent_finished', { eventId: 'base-finish:1', agentId: 'helper:1' }),
    event(now, 'agent_finished', { eventId: 'base-finish:2', agentId: 'helper:2' })
  ], { room: 'owner', floorAssignment: 'base', agents: smallTeam, cueProgress: .5 });
  const mark = animationMarks(calls, 'signature').find((entry) => entry[2] === 'multi-delivery');
  assert.ok(mark, 'I reaches the physical multi-delivery queue');
  assert.equal(mark[3].roomDesign, 'first-floor');
  assert.ok(mark[3].manager.gy < 5, 'I targets the small-project main AI desk, not the Owner desk');
  assert.equal(animationMarks(calls, 'signature').some((entry) => entry[2] === 'owner-report'), false);
  assert.ok(figureHeads(calls) >= 2, 'the helper and project lead are physically drawn');
});

test('actual owner floor distinguishes delivered report from quiet project exit', () => {
  const smallTeam = [
    { id: 'main:draw', isMain: true, role: 'Codex App', activity: 'working' },
    { id: 'helper:1', role: 'Claude CLI', activity: 'working' }
  ];
  const quiet = actualDraw((now) => [event(now, 'session_stopped', { eventId: 'base-stop:quiet' })], {
    room: 'owner', floorAssignment: 'base', activity: 'completed', agents: smallTeam
  });
  assert.deepEqual(animationMarks(quiet, 'closure').map((mark) => mark[2]), ['closing_departure']);
  assert.equal(animationMarks(quiet, 'signature').some((mark) => mark[2] === 'owner-report'), false);

  const report = actualDraw((now) => [
    event(now - 500, 'task_completed', { eventId: 'base-done' }),
    event(now, 'session_stopped', { eventId: 'base-stop:reported' })
  ], { room: 'owner', floorAssignment: 'base', activity: 'completed', agents: smallTeam });
  assert.equal(animationMarks(report, 'closure').length, 0);
  assert.ok(animationMarks(report, 'signature').some((mark) => mark[2] === 'owner-report'));
});

test('all structured work scenes reach RoomRenderer.draw and generic work invents none', () => {
  const actions = [
    'coding', 'research', 'search', 'test', 'git', 'merge_conflict', 'build',
    'document', 'night', 'context', 'external_wait', 'rate_limit', 'review', 'whiteboard', 'crash'
  ];
  const baseline = actualDraw([], { workVisual: null, drawTime: 1_100 });
  for (const action of actions) {
    const calls = actualDraw([], { workVisual: action, drawTime: 1_100 });
    assert.ok(animationMarks(calls, 'work').some((mark) => mark[2] === action), `${action} must reach the real draw path`);
    assert.ok(geometryCount(calls) > geometryCount(baseline), `${action} must add real Canvas geometry, not only a cue name`);
  }
  assert.equal(animationMarks(baseline, 'work').length, 0);
});

test('all ten P4 actions plus Owner idle actions reach RoomRenderer.draw', () => {
  const found = new Set();
  for (let slot = 10_000; slot < 10_500 && found.size < P4_ACTIONS.length; slot += 1) {
    const wallNow = slot * P4_SLOT_MS + 5_000;
    const probe = modelAt(wallNow, [], { activity: 'idle' });
    const cue = idleCueForModel(probe, 'pod:codex:draw:main', wallNow);
    if (!cue || found.has(cue.action)) continue;
    const calls = actualDraw([], { activity: 'idle', wallNow, drawTime: 5_000 });
    const quietFrame = actualDraw([], { activity: 'idle', wallNow: slot * P4_SLOT_MS + 15_000, drawTime: 5_000 });
    assert.ok(animationMarks(calls, 'worker-idle').some((mark) => mark[2] === cue.action), `${cue.action} must reach the real draw path`);
    assert.ok(geometryCount(calls) > geometryCount(quietFrame), `${cue.action} must add visible Canvas geometry`);
    if (['blanket', 'robot', 'elevator_wait', 'stickers', 'photo'].includes(cue.action)) {
      assert.ok(figureHeads(calls) > 4, `${cue.action} must draw the interacting coworker or elevator occupants`);
    }
    found.add(cue.action);
  }
  assert.deepEqual([...found].sort(), [...P4_ACTIONS].sort());

  const ownerFrames = [];
  for (const [drawTime, action] of [[0, 'coffee'], [8_000, 'documents'], [16_000, 'rest']]) {
    const calls = actualDraw([], { room: 'owner', floorAssignment: 'base', drawTime });
    assert.ok(animationMarks(calls, 'owner-idle').some((mark) => mark[2] === action));
    ownerFrames.push(JSON.stringify(calls.filter(([name]) => ['arc', 'ellipse', 'rect', 'lineTo', 'bezierCurveTo'].includes(name))));
  }
  assert.equal(new Set(ownerFrames).size, 3, 'all three Owner idle actions produce different real Canvas geometry');
});

test('actual room draw emits no visible text or obsolete floating question label', () => {
  for (const calls of [
    actualDraw([], { room: 'owner', floorAssignment: 'base' }),
    actualDraw((now) => [event(now, 'owner_input_required')], { room: 'owner', floorAssignment: 'base', cueProgress: .9 }),
    actualDraw([], { room: 'codex', floorAssignment: 'execution' })
  ]) {
    assert.equal(calls.some(([name]) => ['fillText', 'strokeText', 'measureText'].includes(name)), false);
  }
});

test('same-floor rest walk, construction beats, and physical archive all reach actual draw', () => {
  const now = 2_000_000;
  const rest = actualDraw([], {
    wallNow: now, restingAgents: [{ id: 'done', role: 'Claude CLI', activity: 'delivered', finishedAt: now - 1_000 }]
  });
  assert.ok(animationMarks(rest, 'rest').some((mark) => mark[2] === 'walk'));

  const construction = new Set();
  for (const elapsed of [20, 160, 260, 420, 700, 850, 950, 1_050, 1_180]) {
    const calls = actualDraw([], { phase: 'entering', drawTime: elapsed, wallNow: now + elapsed });
    for (const mark of animationMarks(calls, 'construction')) construction.add(mark[2]);
    if (elapsed === 160) assert.ok(figureHeads(calls) >= 2, 'engineer beat draws both engineer figures');
    if (elapsed === 1_180) assert.ok(figureHeads(calls) >= 2, 'occupancy beat draws box-carrying staff');
  }
  assert.deepEqual([...construction], [
    'blueprint', 'engineers', 'elevator', 'slab', 'connections',
    'install', 'tape-removal', 'ribbon', 'occupancy'
  ]);

  const archive = new Set();
  for (const elapsed of [120, 270, 420, 540]) {
    const calls = actualDraw([], { phase: 'leaving', drawTime: elapsed, wallNow: now + elapsed });
    for (const mark of animationMarks(calls, 'archive')) archive.add(mark[2]);
    assert.ok(geometryCount(calls) > 0, `archive frame ${elapsed} draws physical Canvas geometry`);
  }
  assert.deepEqual([...archive], ['pack', 'lights-out', 'remove-icon', 'seal']);
});

test('first-floor completed helper stays visible at its desk while execution rest never duplicates downstairs', () => {
  const wallNow = 12_345 * P4_SLOT_MS + 15_000;
  const finished = [{ id: 'done', role: 'Claude CLI', activity: 'delivered', finishedAt: wallNow - 8_000 }];
  const smallTeam = [{ id: 'main:draw', isMain: true, role: 'Codex App', activity: 'idle' }];
  const base = actualDraw([], {
    room: 'owner', floorAssignment: 'base', activity: 'idle', wallNow,
    agents: smallTeam, restingAgents: finished
  });
  assert.equal(figureHeads(base), 3, 'Owner, main APP, and completed helper remain visible downstairs');
  assert.equal(animationMarks(base, 'rest').length, 0, 'first-floor helper never walks to an execution rest room');

  const execution = actualDraw([], { floorAssignment: 'execution', wallNow, restingAgents: finished });
  const downstairs = actualDraw([], { room: 'owner', floorAssignment: 'execution', wallNow, restingAgents: finished });
  assert.ok(animationMarks(execution, 'rest').length > 0);
  assert.equal(figureHeads(downstairs), 1, 'execution-floor rest person is not duplicated beside Owner');
});

test('G knocks and all five J travel beats are proven through actual draw frames', () => {
  const beforeKnock = actualDraw((now) => [event(now, 'owner_input_required')], {
    room: 'owner', floorAssignment: 'base', cueProgress: .5
  });
  const knocking = actualDraw((now) => [event(now, 'owner_input_required')], {
    room: 'owner', floorAssignment: 'base', cueProgress: .7
  });
  assert.ok(knocking.filter(([name]) => name === 'arc').length >= beforeKnock.filter(([name]) => name === 'arc').length + 2,
    'three-knock frame adds visible knock arcs');
  assert.equal(animationMarks(knocking, 'signature').find((mark) => mark[2] === 'owner-request')[3].stage, 'three_knocks');

  const stages = [];
  for (const progress of [.12, .38, .6, .78, .94]) {
    const calls = actualDraw((now) => [event(now, 'task_completed')], { cueProgress: progress });
    const mark = animationMarks(calls, 'signature').find((entry) => entry[2] === 'delivery-stage');
    stages.push(mark[3].stage);
    assert.ok(figureHeads(calls) >= 1, `${mark[3].stage} draws an actual courier or lead figure`);
  }
  assert.deepEqual(stages, ['worker_to_lead', 'lead_accepts', 'lead_to_lift', 'elevator', 'owner_report']);
  const ownerReport = actualDraw((now) => [event(now, 'task_completed')], {
    room: 'owner', floorAssignment: 'base', cueProgress: .94
  });
  assert.ok(animationMarks(ownerReport, 'signature').some((mark) => mark[2] === 'owner-report'));
});
